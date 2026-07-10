/**
 * qualityGate.js — Yayın öncesi AI kalite kapısı
 *
 * auto-onual.js ve panel'in manuel onay akışının yerini alacak otomatik
 * yayın yolları için ortak karar mantığı. Amaç: "bu aday yayınlanmaya değer mi?"
 *
 * Felsefe (price-checker.js ile tutarlı): emin olamadığın durumda SIKI davranma.
 * Ucuz/kesin kontrol (fiyat mantığı) önce çalışır ve AI'ya hiç gitmeyen adayları
 * eler — token tasarrufu. Hayatta kalanlar TEK istekte (batch) AI'dan puan alır.
 *
 * NOT: Burada HTTP tabanlı bir "ölü link" kontrolü YOKTUR — kasıtlı olarak.
 * Trendyol/Amazon gibi siteler bot korumasından dolayı çıplak fetch() isteklerine
 * canlı ürünlerde bile 403/404 döndürüyor (bkz. checkLinkFormat yorumu). Gerçek
 * canlılık kontrolü price-checker.js'in içerik-tabanlı, AI destekli, 2 kademeli
 * teyitli sistemine bırakılmıştır.
 *
 * Kullanım:
 *   const { runQualityGate } = require('./qualityGate.js') veya import (ESM)
 *   const results = await runQualityGate(candidates, { apiKey, threshold: 6 });
 *   // results: [{ id, publish: bool, score?, reason }]
 */

import { GoogleGenAI } from '@google/genai';

const DEFAULT_THRESHOLD = 6;
const DEFAULT_SCORE_ON_SKIP = 6; // AI atlanırsa/hata verirse nötr geç (pipeline'ı tıkamaz)

/**
 * Fiyat mantık kontrolü — imkansız/şişirilmiş indirimleri eler.
 * Eski fiyat yoksa kontrol edilemez, geçmesine izin ver (AI puanlaması karar verir).
 */
export function checkPriceSanity(oldPrice, newPrice) {
    if (!newPrice || newPrice <= 0) {
        return { ok: false, reason: 'Geçersiz fiyat (0 veya yok)' };
    }
    if (!oldPrice || oldPrice <= 0) {
        return { ok: true, reason: 'Eski fiyat yok, kontrol atlandı' };
    }
    if (newPrice > oldPrice) {
        return { ok: false, reason: 'Yeni fiyat eski fiyattan yüksek' };
    }
    const discount = (oldPrice - newPrice) / oldPrice;
    if (discount > 0.90) {
        return { ok: false, reason: `İndirim oranı gerçekçi değil (%${Math.round(discount * 100)})` };
    }
    return { ok: true, discount };
}

/**
 * Link biçim kontrolü — GERÇEK bir HTTP canlılık kontrolü YAPMAZ.
 *
 * NEDEN: Trendyol/Amazon gibi siteler bot korumasından dolayı çıplak fetch()
 * isteklerine, ürün gerçekten CANLI olsa bile 403/404 döndürüyor. Test edildi:
 * Playwright ile az önce scrape edilmiş, gerçekte canlı bir Trendyol linki,
 * bare HEAD isteğine 404, GET isteğine 403 döndürdü. Yani HTTP durum koduna
 * güvenerek "ölü link" kararı vermek yanlış-pozitif üretir ve iyi fırsatları
 * gereksiz yere eler.
 *
 * Gerçek canlılık/stok kontrolü price-checker.js'e bırakılmıştır — o, içerik
 * tabanlı + AI destekli + 2 kademeli teyitli bir sistemle bunu çok daha
 * güvenilir yapıyor. Burada sadece link'in yapısal olarak geçerli bir URL
 * olup olmadığına bakılır.
 */
export function checkLinkFormat(url) {
    if (!url) return { ok: false, reason: 'Link yok' };
    try {
        const u = new URL(url);
        if (!u.protocol.startsWith('http')) return { ok: false, reason: 'Geçersiz protokol' };
        return { ok: true };
    } catch {
        return { ok: false, reason: 'Geçersiz URL formatı' };
    }
}

/**
 * Linki, kaynaktan bağımsız karşılaştırılabilir bir kimliğe indirger.
 * Amaç: aynı ürün OnuAl'dan Amazon linkiyle, Cimri'den de aynı Amazon linkiyle
 * gelirse ikisinin AYNI ürün olduğunu anlayabilmek (izleme parametreleri,
 * slug farklılıkları vb. yüzünden ham URL karşılaştırması yetmez).
 */
export function normalizeLink(url) {
    if (!url) return '';
    try {
        const u = new URL(url);
        const host = u.hostname.replace(/^www\./, '').toLowerCase();

        // Amazon: /dp/ASIN veya /gp/product/ASIN — slug/parametre farklı olsa da aynı ürün
        if (host.includes('amazon.')) {
            const m = u.pathname.match(/\/(?:dp|gp\/product)\/([A-Z0-9]{10})/i);
            if (m) return `amazon:${m[1].toUpperCase()}`;
        }
        if (host.includes('trendyol.com')) {
            const m = u.pathname.match(/-p-(\d+)/);
            if (m) return `trendyol:${m[1]}`;
        }
        if (host.includes('hepsiburada.com')) {
            const m = u.pathname.match(/-p-([a-z0-9]+)$/i);
            if (m) return `hepsiburada:${m[1].toLowerCase()}`;
        }
        // Genel yedek: host + path, sorgu parametresiz (izleme param'ları elenmiş olur)
        return `${host}${u.pathname}`.replace(/\/$/, '').toLowerCase();
    } catch {
        return String(url).toLowerCase();
    }
}

/**
 * Verilen normalize linklerden hangileri Firestore'da ZATEN var — kaynaktan
 * bağımsız (submittedBy filtresi yok). Batch 'in' sorgusu (max 30/istek).
 */
export async function checkExistingLinks(db, normalizedLinks) {
    const existing = new Set();
    const unique = [...new Set(normalizedLinks.filter(Boolean))];
    for (let i = 0; i < unique.length; i += 30) {
        const chunk = unique.slice(i, i + 30);
        try {
            const snap = await db.collection('discounts')
                .where('normalizedLink', 'in', chunk)
                .select('normalizedLink')
                .get();
            snap.docs.forEach(d => {
                const v = d.data()?.normalizedLink;
                if (v) existing.add(v);
            });
        } catch (e) {
            console.warn(`   ⚠️ [QualityGate] Mükerrer kontrolü hatası: ${e.message}`);
        }
    }
    return existing;
}

/**
 * Adayları TEK Gemini isteğinde toplu puanla (1-10). Token tasarrufu için
 * her aday için ayrı istek ATILMAZ.
 */
export async function scoreDealsBatch(apiKey, items) {
    if (!apiKey || items.length === 0) {
        return items.map(it => ({ id: it.id, score: DEFAULT_SCORE_ON_SKIP, reason: 'AI atlandı (anahtar yok), varsayılan geç' }));
    }

    const genAI = new GoogleGenAI({ apiKey });
    const list = items.map((it, i) =>
        `${i + 1}. id=${it.id} | "${it.title}" | ${it.oldPrice || '?'} TL -> ${it.newPrice} TL | kategori: ${it.category || '?'}`
    ).join('\n');

    const prompt = `Sen İNDİVA uygulamasının kıdemli fırsat editörüsün. Aşağıdaki ${items.length} adayı
değerlendir: her biri kullanıcıya paylaşmaya gerçekten değer bir fırsat mı?

Kriterler:
- İndirim oranı gerçekçi ve cazip mi (çok düşükse düşük puan, mantıksız yüksekse şüpheli)
- Ürün/başlık anlamlı mı, spam veya bozuk veri değil mi
- Genel olarak bir kullanıcının tıklamak isteyeceği bir fırsat mı

Adaylar:
${list}

SADECE JSON array döndür, her id için sırayla:
[{"id":"...","score":1-10,"reason":"kısa neden (max 10 kelime)"}]`;

    try {
        const response = await genAI.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: [{ role: 'user', parts: [{ text: prompt }] }],
            config: { temperature: 0.2 },
        });
        const text = response.text ||
            (response.candidates?.[0]?.content?.parts || []).filter(p => p.text).map(p => p.text).join('');
        const match = text.match(/\[[\s\S]*\]/);
        if (!match) {
            return items.map(it => ({ id: it.id, score: DEFAULT_SCORE_ON_SKIP, reason: 'AI JSON döndürmedi, varsayılan geç' }));
        }
        const parsed = JSON.parse(match[0]);
        return items.map(it => {
            const found = parsed.find(p => String(p.id) === String(it.id));
            if (!found) return { id: it.id, score: DEFAULT_SCORE_ON_SKIP, reason: 'AI bu id için cevap vermedi, varsayılan geç' };
            return { id: it.id, score: Number(found.score) || DEFAULT_SCORE_ON_SKIP, reason: String(found.reason || '').slice(0, 100) };
        });
    } catch (err) {
        console.warn(`   ⚠️ [QualityGate] AI puanlama hatası: ${err.message}`);
        return items.map(it => ({ id: it.id, score: DEFAULT_SCORE_ON_SKIP, reason: `AI hata: ${err.message}, varsayılan geç` }));
    }
}

/**
 * Ana orkestratör. Ucuz kontroller önce (fiyat mantığı, link biçimi, kaynaklar
 * arası mükerrer) — bunlardan geçemeyenler AI'ya hiç gitmez. Hayatta kalanlar
 * TEK istekte AI'dan puan alır.
 *
 * NOT (Cimri): Cimri adayları bu aşamada henüz cimri.com linkine sahiptir
 * (gerçek mağaza linki sadece yayın anında resolveCimriStoreLink ile çözülür).
 * Yani buradaki dedup, Cimri'nin GERÇEK hedefini henüz yakalayamaz — o yüzden
 * scrape.js'in publishBatch'i, Cimri linkini çözdükten SONRA checkExistingLinks
 * ile İKİNCİ bir kontrol yapar (bkz. scrape.js).
 *
 * @param {Array<{id, title, oldPrice, newPrice, category, link}>} candidates
 * @param {{apiKey?: string, threshold?: number, db?: object}} options
 * @returns {Promise<Array<{id, publish: boolean, score?, reason, normalizedLink?: string}>>}
 */
export async function runQualityGate(candidates, options = {}) {
    const { apiKey, threshold = DEFAULT_THRESHOLD, db } = options;
    const results = [];
    const survivors = [];

    for (const c of candidates) {
        const priceCheck = checkPriceSanity(c.oldPrice, c.newPrice);
        if (!priceCheck.ok) {
            results.push({ id: c.id, publish: false, reason: `Fiyat kontrolü: ${priceCheck.reason}` });
            continue;
        }
        const linkCheck = checkLinkFormat(c.link);
        if (!linkCheck.ok) {
            results.push({ id: c.id, publish: false, reason: `Link kontrolü: ${linkCheck.reason}` });
            continue;
        }
        survivors.push({ ...c, normalizedLink: normalizeLink(c.link) });
    }

    if (survivors.length === 0) return results;

    let dupSet = new Set();
    if (db) {
        dupSet = await checkExistingLinks(db, survivors.map(c => c.normalizedLink));
    }
    const afterDedup = [];
    survivors.forEach(c => {
        if (dupSet.has(c.normalizedLink)) {
            results.push({ id: c.id, publish: false, reason: 'Mükerrer: bu ürün başka bir kaynaktan zaten yayında' });
            return;
        }
        afterDedup.push(c);
    });

    if (afterDedup.length === 0) return results;

    const scores = await scoreDealsBatch(apiKey, afterDedup);
    afterDedup.forEach(c => {
        const s = scores.find(x => x.id === c.id) || { score: DEFAULT_SCORE_ON_SKIP, reason: 'skor bulunamadı' };
        results.push({
            id: c.id,
            publish: s.score >= threshold,
            score: s.score,
            reason: s.reason,
            normalizedLink: c.normalizedLink,
        });
    });

    return results;
}
