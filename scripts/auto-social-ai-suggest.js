/**
 * auto-social-ai-suggest.js — Zamanlı sosyal medya AI önerisi
 *
 * Günde 3 kez (13:00/17:00/21:00 TR'den 3dk önce) son 60 ilanı tarar, AI ile
 * (OpenRouter, deepseek/deepseek-v4-flash) kalite/satış potansiyeli/ilgi
 * çekicilik kriterlerine göre EN İYİ 20 ürünü PUANLAR ve Firestore'a yazar,
 * admin'e ('panel_admin_alerts' topic) push bildirimi gönderir. Bu aşamada
 * HİÇBİR ürün için başlık/caption ÜRETİLMEZ — admin panelde bu 20 adaydan
 * birini seçtiğinde SADECE o ürün için içerik üretilir (20'sinin tamamı için
 * gereksiz AI çağrısı yapılmaz, admin beğenmezse "Yeniden Üret" ile tekrar
 * dener). Panel açıldığında SocialContentManager.tsx bu hazır aday listesini
 * okuyup otomatik gösterir.
 *
 * NOT: Puanlama mantığı vercel-proxy/api/social-candidates.ts ile aynıdır
 * (admin panelindeki "AI ile Öner" butonuyla üretilen listeyle tutarlı olsun
 * diye). Orada değişiklik yaparsanız burada da güncelleyin.
 *
 * Çalıştırma: node scripts/auto-social-ai-suggest.js
 */

import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import * as fs from 'fs';
import * as path from 'path';
import { sendAdminNotification, sendAdminAlert } from './alertService.js';
import { trackOpenRouterUsage } from './aiUsageTracker.js';

// ─── .env Yükle (lokal geliştirme) ─────────────────────────────────────────
const ROOT_DIR = process.cwd();
const envPath = path.join(ROOT_DIR, '.env');
if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf8');
    for (const line of envContent.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eqIdx = trimmed.indexOf('=');
        if (eqIdx < 0) continue;
        const key = trimmed.substring(0, eqIdx).trim();
        const val = trimmed.substring(eqIdx + 1).trim().replace(/^["']|["']$/g, '');
        if (!process.env[key]) process.env[key] = val;
    }
}

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || '';
const MODEL = 'deepseek/deepseek-v4-flash';

function initFirebase() {
    if (getApps().length > 0) return getFirestore();
    const envJson = process.env.FIREBASE_SERVICE_ACCOUNT;
    let serviceAccount;
    if (envJson) {
        serviceAccount = JSON.parse(envJson);
    } else {
        const localPath = path.join(ROOT_DIR, 'firebase-service-account.json');
        if (fs.existsSync(localPath)) {
            serviceAccount = JSON.parse(fs.readFileSync(localPath, 'utf8'));
        } else {
            throw new Error('Firebase service account bulunamadı.');
        }
    }
    if (serviceAccount?.private_key) {
        serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, '\n').replace(/\n\n/g, '\n');
    }
    initializeApp({ credential: cert(serviceAccount) });
    return getFirestore();
}

async function fetchRecentDiscounts(db) {
    // NOT: 100 ürünle canlı testte gerçek (uzun) başlıklarla bazen Vercel
    // Hobby planının 60sn sunucusuz fonksiyon sınırını aşıp zaman aşımına
    // yol açtı (vercel-proxy/api/social-content.ts) — tutarlı olsun diye
    // burası da 60'a düşürüldü.
    const snap = await db.collection('discounts').orderBy('createdAt', 'desc').limit(60).get();
    return snap.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .filter(d => !d.isAd);
}

// Aynı ürün, scraper tarafından neredeyse birebir aynı başlıkla (farklı "id"
// ile) birden çok kez kaydedilebiliyor — canlı veriyle test edildiğinde bu,
// AI'nın top-20 listesinin birkaç slotunu aynı ürünün varyantlarıyla
// (örn. aynı vücut kreminin 3 farklı kokusu) doldurmasına yol açtığı
// görüldü. Modele gitmeden ÖNCE normalize edilmiş başlığa göre tekilleştirip
// (aynı başlıktan en yüksek indirimli olanı tutarak) havuzu temizliyoruz —
// modelin talimata uyup uymamasına bağlı kalmadan garanti bir çözüm. (Bkz.
// vercel-proxy/api/social-content.ts — aynı mantık orada da var.)
function normalizeTitleForDedup(title) {
    return String(title || '').toLowerCase().trim().replace(/\s+/g, ' ');
}

function dedupeByTitle(discounts) {
    const bestByTitle = new Map();
    for (const d of discounts) {
        const key = normalizeTitleForDedup(d.title);
        const pct = d.oldPrice > d.newPrice && d.oldPrice > 0 ? (d.oldPrice - d.newPrice) / d.oldPrice : 0;
        const existing = bestByTitle.get(key);
        if (!existing || pct > existing.pct) bestByTitle.set(key, { discount: d, pct });
    }
    return Array.from(bestByTitle.values()).map(v => v.discount);
}

async function suggestCandidates(discounts, db) {
    const deduped = dedupeByTitle(discounts);
    const compact = deduped.map((d, i) => ({
        index: i + 1,
        id: d.id,
        title: d.title,
        brand: d.brand,
        category: d.category,
        oldPrice: d.oldPrice || 0,
        newPrice: d.newPrice || 0,
        discountPercent: d.oldPrice > d.newPrice && d.oldPrice > 0
            ? Math.round(((d.oldPrice - d.newPrice) / d.oldPrice) * 100) : 0,
        reviewCount: d.reviewCount || '',
    }));

    const prompt = `Sen İNDİVA uygulamasının sosyal medya içerik editörüsün. Aşağıda son ${compact.length} indirim ilanı JSON olarak veriliyor.

GÖREV — EN İYİ 20 ADAYI PUANLA VE SIRALA:
Her ürünü sosyal medyada (Instagram story/post) paylaşılmaya UYGUNLUK açısından 1-10 arası puanla.
Puanlarken şu kriterleri birlikte değerlendir:
- Satış/popülerlik potansiyeli (reviewCount, marka tanınırlığı, kategori popülerliği ipucu olarak kullanılabilir)
- İndirim oranı (discountPercent) — yüksek indirim daha çekici; discountPercent 0 ise (veriye eski
  fiyat girilmemiş) bu ürünü GERÇEK bir indirim olarak SAYMA, sadece marka/ürün ilgi çekiciliğine
  göre değerlendir, asla sırf tanınmış marka diye yüksek puan verme
- İlgi çekicilik — geniş kitleye hitap eden, mainstream bir ürün/kategori/marka (çok nadir/niş bir ürün düşük puan almalı)
- ÇEŞİTLİLİK — aynı ürün ailesinden (aynı marka + aynı ürün tipi, sadece renk/beden/koku/desen
  farklı — örn. aynı vücut kreminin farklı kokuları, aynı tişörtün farklı renkleri) BİRDEN FAZLA
  ürünü seçme; bu tarz bir kümede sadece EN İYİ tekini seç, gerisini listeye alma

En yüksek puanlı 20 FARKLI ürünü seç (mümkünse farklı kategorilerden çeşitlilik olsun, aynı ürünü iki kez seçme).
Bu aşamada başlık veya sosyal medya metni YAZMA — sadece puanla ve kısa bir gerekçe ver.

İLANLAR (her ilanın başındaki "index" numarasıyla referans ver, "id" alanını YAZMA/KOPYALAMA):
${JSON.stringify(compact)}

SADECE aşağıdaki JSON formatında cevap ver, başka hiçbir şey yazma. Her "index" MUTLAKA
yukarıdaki listeden seçtiğin ilanın "index" alanındaki TAM SAYI olmalı (1 ile ${compact.length} arası),
"score" 1-10 arası tam sayı olmalı, "candidates" en yüksek puandan en düşüğe sıralı olmalı ve
en fazla 20 eleman içermeli, tüm index'ler birbirinden FARKLI olmalı:
{
  "candidates": [
    {"index": 1, "score": 9, "reasoning": "neden bu puanı verdiğin, kısa Türkçe (max 100 karakter)"},
    {"index": 2, "score": 8, "reasoning": "..."}
  ]
}`;

    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
            'Content-Type': 'application/json',
            'HTTP-Referer': 'https://indiva-proxy.vercel.app',
            'X-Title': 'INDIVA Panel Social Candidates (Scheduled)',
        },
        body: JSON.stringify({
            model: MODEL,
            messages: [{ role: 'user', content: prompt }],
            temperature: 0.4,
            usage: { include: true },
        }),
        // NOT: Bu script vercel-proxy'nin aksine Vercel'in 60sn sunucusuz
        // fonksiyon sınırına tabi DEĞİL — GitHub Actions workflow'unun kendi
        // 10 dakikalık bütçesi var (bkz. auto-social-ai-suggest.yml). 50sn'lik
        // eski sınır gerçek (uzun) başlıklarla canlıda zaman aşımına
        // ("aborted due to timeout" admin alerti) yol açtı — gerçek platform
        // kısıtı olmadığı için 120sn'ye çıkarıldı.
        signal: AbortSignal.timeout(120000),
    });

    if (!response.ok) {
        const errText = await response.text();
        throw new Error(`OpenRouter ${response.status}: ${errText.substring(0, 200)}`);
    }

    const data = await response.json();
    await trackOpenRouterUsage(db, data, 'auto-social-ai-suggest');
    const text = data?.choices?.[0]?.message?.content || '';
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('AI JSON döndürmedi');

    const result = JSON.parse(jsonMatch[0]);
    if (!Array.isArray(result.candidates) || result.candidates.length === 0) {
        throw new Error('AI eksik veri döndürdü');
    }

    const seen = new Set();
    const candidates = result.candidates
        .map(c => {
            const idx = Number(c.index);
            if (!Number.isInteger(idx) || seen.has(idx)) return null;
            const chosen = compact[idx - 1];
            if (!chosen) return null;
            seen.add(idx);
            // NOT: "discounts" DEĞİL "deduped" — dedupeByTitle() sonrası index'ler
            // deduped diziye göre; discounts[idx-1] tekilleştirmeden ÖNCEKİ (farklı
            // sıralı/uzunluklu) diziye göre olduğu için yanlış ürünü döndürürdü.
            const fullProduct = deduped[idx - 1];
            return {
                productId: chosen.id,
                score: Math.min(10, Math.max(1, Math.round(Number(c.score)) || 5)),
                reasoning: String(c.reasoning || '').slice(0, 200),
                product: {
                    id: fullProduct.id,
                    title: fullProduct.title || '',
                    imageUrl: fullProduct.imageUrl || '',
                    link: fullProduct.link || '',
                    category: fullProduct.category || '',
                    brand: fullProduct.brand || '',
                    oldPrice: fullProduct.oldPrice || 0,
                    newPrice: fullProduct.newPrice || 0,
                },
            };
        })
        .filter(Boolean)
        .sort((a, b) => b.score - a.score)
        .slice(0, 20);

    if (candidates.length === 0) throw new Error('AI geçerli aday seçemedi');
    return candidates;
}

async function main() {
    console.log(`\n🤖 Zamanlı Sosyal Medya AI Önerisi: ${new Date().toLocaleString('tr-TR')}`);
    const db = initFirebase();

    if (!OPENROUTER_API_KEY) {
        console.error('❌ OPENROUTER_API_KEY tanımlı değil.');
        process.exit(1);
    }

    try {
        const discounts = await fetchRecentDiscounts(db);
        if (discounts.length === 0) {
            console.log('⏭️  Analiz edilecek ilan yok, atlanıyor.');
            return;
        }

        const candidates = await suggestCandidates(discounts, db);
        console.log(`✅ ${candidates.length} aday puanlandı:`);
        candidates.forEach(c => console.log(`   - [${c.score}/10] ${c.product.title}`));

        await db.collection('social_content_ai_suggestions').doc('latest').set({
            candidates,
            createdAt: FieldValue.serverTimestamp(),
            opened: false,
        });

        await sendAdminNotification(
            '🤖 20 yeni sosyal medya önerisi hazır!',
            'Beğendiğiniz ürünü seçin, içeriği o an üretilsin.',
            { type: 'SOCIAL_AI_READY' }
        );

        console.log('✅ Firestore\'a yazıldı ve admin bildirimi gönderildi.');
    } catch (err) {
        console.error(`💥 HATA: ${err.message}`);
        await sendAdminAlert('Sosyal Medya AI Önerisi Hatası', err.message);
        process.exit(1);
    }
}

main().then(() => process.exit(0));
