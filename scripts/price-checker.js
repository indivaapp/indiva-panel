/**
 * price-checker.js — INDIVA Akıllı Fiyat Takip ve Otomatik Pasife Alma
 * 
 * Özellikler:
 * - Hibrit Tarama: Klasik fetch + Jina Reader (Bot engeli aşımı)
 * - Gemini AI Entegrasyonu: Gemini 2.5 Flash ile yüksek doğruluktaki doğrulama
 * - Akıllı Önceliklendirme: Önce hızlı fiyat karşılaştırma, sonra AI
 * - Gerçek Zamanlı Senkronizasyon: Uygulama içi bildirim ve FCM sinyali
 */

import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore, FieldValue, Timestamp } from 'firebase-admin/firestore';
import { getMessaging } from 'firebase-admin/messaging';
import * as fs from 'fs';
import * as path from 'path';
import { fetchWithFallback } from './scraperService.js';
import { sendAdminAlert } from './alertService.js';
import { trackGeminiUsage } from './aiUsageTracker.js';
import { logPipelineRun } from './pipelineRunLogger.js';

// ─── .env Yükle ─────────────────────────────────────────────────────────────
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
        if (val.includes('YOUR_') || val.includes('indiva-panel-...')) continue;
        if (!process.env[key]) process.env[key] = val;
    }
}

// ─── Firebase ────────────────────────────────────────────────────────────────
function initFirebase() {
    if (getApps().length > 0) return getFirestore();

    let serviceAccount;
    const envJson = process.env.FIREBASE_SERVICE_ACCOUNT;

    if (envJson && !envJson.includes('indiva-panel-...')) {
        serviceAccount = JSON.parse(envJson);
    } else {
        const localPath = path.join(ROOT_DIR, 'firebase-service-account.json');
        if (fs.existsSync(localPath)) {
            serviceAccount = JSON.parse(fs.readFileSync(localPath, 'utf8'));
        } else {
            throw new Error('Firebase service account bulunamadı.');
        }
    }

    // PEM formatı için private_key'deki kaçış karakterlerini (\n) GERÇEK satır başlarına çevir
    if (serviceAccount && serviceAccount.private_key) {
        // Hem \n hem de \\n durumlarını kapsayacak şekilde temizlik yap
        serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, '\n').replace(/\n\n/g, '\n');
    }

    initializeApp({ credential: cert(serviceAccount) });
    return getFirestore();
}

// ─── HTTP & Scraper Utilities ────────────────────────────────────────────────
/**
 * fetchHtml - REFACTORED to use scraperService
 */
async function fetchHtml(url, useJina = false) {
    try {
        const { html } = await fetchWithFallback(url, { useJina, timeout: 15000 });
        return html;
    } catch (e) {
        console.warn(`      ⚠️ Fetch failed for ${url}: ${e.message}`);
        return null;
    }
}


// ─── FCM Sessiz Güncelleme ─────────────────────────────────────────────────────
/**
 * Mobil uygulamaya sessiz FCM push gönder.
 * HomePage.tsx "DISCOUNT_STATUS_UPDATED" event'ini dinliyor;
 * bu event ancak FCM data mesajı gelince tetiklenir.
 */
async function sendSilentExpiredNotification(discountId, title) {
    try {
        const message = {
            // "notification" alanı YOK — bu ekranı göstermez, sadece app'i tetikler
            data: {
                type: 'DISCOUNT_EXPIRED',
                discountId: discountId,
                status: 'İndirim Bitti',
                timestamp: Date.now().toString(),
            },
            topic: 'all_users',
            android: { priority: 'high' }
        };
        await getMessaging().send(message);
        console.log(`   📣 [FCM] Sessiz güncelleme gönderildi: ${title?.substring(0, 30)}...`);
    } catch (e) {
        console.warn(`   ⚠️ [FCM] Sessiz bildirim gönderilemedi: ${e.message}`);
        // Fail silently — Firebase kaydı zaten yapıldı
    }
}

// ─── Akıllı İçerik Kısaltma (Gemini maliyeti için) ────────────────────────────
// 12.000 karakterin tamamını Gemini'ye göndermek yerine, fiyat/stok bilgisiyle
// ilgili anahtar kelimelerin geçtiği bölgeyi (+ makul bir bağlam payı) kesip
// yolluyoruz. Fiyat bilgisi neredeyse hep bu anahtar kelimelerin yakınında
// olur; sayfanın geri kalanı (menü, footer, ilgili ürünler vb.) AI kararı için
// gereksiz — sadece token maliyeti. Bu, token hacmini ~4 kat azaltır.
const PRICE_CONTEXT_MAX = 3000;
function extractPriceContext(content) {
    const text = String(content);
    if (text.length <= PRICE_CONTEXT_MAX) return text;

    const keywords = ['tl', '₺', 'fiyat', 'price', 'stok', 'sepet', 'satın', 'tükendi', 'bulunamadı'];
    const lower = text.toLowerCase();
    let bestIdx = -1;
    for (const kw of keywords) {
        const idx = lower.indexOf(kw);
        if (idx >= 0 && (bestIdx === -1 || idx < bestIdx)) bestIdx = idx;
    }
    if (bestIdx === -1) return text.substring(0, PRICE_CONTEXT_MAX);

    const start = Math.max(0, bestIdx - 500);
    return text.substring(start, start + PRICE_CONTEXT_MAX);
}

// ─── İçerik Güvenilirlik Kontrolü ─────────────────────────────────────────────
// Bot-engeli / captcha / boş sayfa → "güvenilmez". Bu durumda ASLA "bitti" demeyiz
// (yanlış-pozitifin en büyük kaynağı budur); ilanı dokunmadan bırakırız.
function contentLooksUsable(content) {
    if (!content || content.length < 800) return false;
    const l = content.toLowerCase();
    const blockMarkers = [
        'captcha', 'robot check', 'are you a human', 'are you human',
        'access denied', 'forbidden', 'cloudflare', 'unusual traffic',
        'erişim engellendi', 'güvenlik doğrulaması',
    ];
    return !blockMarkers.some(m => l.includes(m));
}

// Firestore Timestamp / Date / number → ms
function tsToMs(dt) {
    if (!dt) return 0;
    if (typeof dt.toMillis === 'function') return dt.toMillis();
    if (typeof dt._seconds === 'number') return dt._seconds * 1000;
    if (dt instanceof Date) return dt.getTime();
    const n = new Date(dt).getTime();
    return isNaN(n) ? 0 : n;
}

// ─── HTML Tabanlı Doğrulama (AI anahtarı yoksa yedek) ─────────────────────────
// ÇOK TEMKİNLİ: fiyat-bazlı "bitti" kararı VERMEZ (ham regex ile fiyat okumak
// güvenilmez ve yanlış-pozitifin baş sebebiydi). Sadece kesin "ürün kaldırıldı /
// stok yok" yapısal sinyalinde 'expired' döner.
// Döndürür: { decision: 'expired'|'active'|'unknown', reason }
function verifyWithHTML(product, html) {
    if (!contentLooksUsable(html)) return { decision: 'unknown', reason: 'İçerik güvenilmez (bot/boş)' };
    const lower = html.toLowerCase();
    const stockPhrases = [
        'bu ürün artık satılmıyor',
        'bu ürün mevcut değil',
        'bu fırsat sonlandı',
        'kampanya sona erdi',
        'ürün kaldırıldı',
        'ürün bulunamadı',
        '"discontinued"',
        'availability":"outofstock',
        'availability": "outofstock',
        'availability":"http://schema.org/outofstock',
        'availability":"https://schema.org/outofstock',
    ];
    if (stockPhrases.some(kw => lower.includes(kw))) {
        return { decision: 'expired', reason: 'Ürün kaldırıldı/stok yok (yapısal sinyal)' };
    }
    // Fiyat-bazlı karar YOK → aktif kabul (süreyi 24 saat kuralı yönetir).
    return { decision: 'active', reason: 'Aktif (kaldırma sinyali yok)' };
}

// ─── AI Doğrulama (Gemini) — birincil yöntem ──────────────────────────────────
// Jina'nın temiz metnini okur; üstü çizili liste fiyatı ile güncel satış fiyatını
// ayırt eder. ÇOK TEMKİNLİ: güven düşükse / içerik güvenilmezse 'unknown' döner
// (hiçbir şey silinmez). Karar SADECE somut sinyalle ('stok yok' veya fiyat net
// %25+ yüksek) verilir; AI'nın kendi "expired" tahminine körü körüne güvenilmez.
// Döndürür: { decision: 'expired'|'active'|'unknown', currentPrice, reason }
async function verifyWithAI(product, content, db) {
    const apiKey = process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_API_KEY;
    if (!apiKey) return { decision: 'unknown', reason: 'Gemini API Key yok' };
    if (!contentLooksUsable(content)) return { decision: 'unknown', reason: 'İçerik güvenilmez (bot/boş)' };

    const originalPrice = product.newPrice || 0;
    const originalOldPrice = product.oldPrice || 0;

    const prompt = `Sen titiz bir e-ticaret fiyat denetçisisin. Görevin: bir indirim ilanının HÂLÂ GEÇERLİ olup olmadığını, YANLIŞLIKLA "bitti" demekten kaçınarak belirlemek. Emin olmadığın HER durumda ilanı GEÇERLİ (aktif) say ve confidence'i düşük ver.

KAYITLI İLAN:
- Başlık: "${product.title}"
- Kaydedilen güncel (ödenecek) fiyat: ${originalPrice} TL
- Liste/eski fiyat: ${originalOldPrice} TL

SAYFA İÇERİĞİ (temizlenmiş):
${extractPriceContext(content)}

KURALLAR:
- "currentPrice": Şu an GERÇEKTE ÖDENECEK satış fiyatı (TL, sayı). Üstü çizili liste/eski fiyatı DEĞİL. Net göremiyorsan 0 yaz.
- "inStock": ürün şu an satın alınabilir mi (true/false).
- "confidence": 0-100. İçerik bu ürünün gerçek sayfası değilse, bot/captcha/eksikse veya fiyat net değilse DÜŞÜK ver.
- "expired": SADECE şunlarda true: ürün açıkça stokta yok / satıştan kalkmış / sayfa bulunamadı (404) VEYA güncel satış fiyatı ${originalPrice} TL'den net biçimde %25'ten fazla YÜKSEK. Emin değilsen false.
- "reason": kısa Türkçe açıklama (max 50 karakter).

YALNIZCA JSON: {"currentPrice":0,"inStock":true,"expired":false,"confidence":0,"reason":""}`;

    try {
        const response = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{ role: 'user', parts: [{ text: prompt }] }],
                    generationConfig: { temperature: 0.1, responseMimeType: 'application/json' }
                }),
                signal: AbortSignal.timeout(30000)
            }
        );
        if (!response.ok) return { decision: 'unknown', reason: `Gemini HTTP ${response.status}` };

        const data = await response.json();
        await trackGeminiUsage(db, data, 'gemini-2.5-flash');
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (!jsonMatch) return { decision: 'unknown', reason: 'AI JSON döndürmedi' };
        const r = JSON.parse(jsonMatch[0]);

        const conf = Number(r.confidence) || 0;
        const cp = Number(r.currentPrice) || 0;

        // Düşük güven → karar verme (silme yok)
        if (conf < 70) return { decision: 'unknown', currentPrice: cp, reason: `belirsiz (güven %${conf})` };

        // Karar SADECE somut sinyalle:
        let expired = false;
        let reason = (r.reason || '').toString().substring(0, 60);

        if (r.inStock === false) { expired = true; reason = 'Stok yok / ürün kaldırıldı'; }

        if (cp > 0 && originalPrice > 0) {
            const ratio = (cp - originalPrice) / originalPrice;
            if (ratio > 0.25) {
                expired = true;
                reason = `Fiyat: ${originalPrice}₺ → ${cp}₺ (+%${Math.round(ratio * 100)})`;
            } else if (r.inStock !== false) {
                // Fiyat uygun + stok var → KESİN aktif (AI yanlışlıkla expired dese bile)
                return { decision: 'active', currentPrice: cp, reason: reason || 'Aktif (fiyat uygun)' };
            }
        }

        return { decision: expired ? 'expired' : 'active', currentPrice: cp, reason: reason || 'Aktif' };
    } catch (e) {
        return { decision: 'unknown', reason: 'AI bağlantı hatası' };
    }
}

// ─── Main Controller ─────────────────────────────────────────────────────────
async function checkPrices() {
    process.stdout.write('\x1Bc'); // Terminali temizle
    console.log(`\n🚀 INDIVA AKILLI TAKİP SİSTEMİ: ${new Date().toLocaleString('tr-TR')}`);

    // ── Çalışma penceresi: Türkiye 08:00–02:00 (UTC+3, DST yok) ──────────────────
    // Zamanlanmış (cron) çalıştırmada pencere dışındaysa atla. Manuel tetikleme
    // (workflow_dispatch — paneldeki "Şimdi Kontrol Et") her zaman çalışır.
    const isManual = process.env.GITHUB_EVENT_NAME === 'workflow_dispatch';
    const turkeyHour = (new Date().getUTCHours() + 3) % 24;
    const inWindow = turkeyHour >= 8 || turkeyHour < 2; // 08:00–01:59 aktif, 02:00'da durur
    if (!isManual && !inWindow) {
        console.log(`⏸️  Çalışma penceresi dışında (TR ~${turkeyHour}:00, aktif 08:00–02:00). Atlanıyor.`);
        return;
    }

    const db = initFirebase();
    const runStartTime = Date.now();

    try {
        // --- AŞAMA 1: 12 SAAT KURALI İLE OTOMATİK TEMİZLİK ---
        // Bu aşamada TÜM aktif ilanları çekip 12 saati geçenleri anında pasife alıyoruz.
        // İndeks hatası almamak için orderBy kullanmıyoruz (Zaten tüm aktifleri kontrol ediyoruz).
        const activeSnapshot = await db.collection('discounts')
            .where('status', '==', 'aktif')
            .get();

        const activeDocs = activeSnapshot.docs;
        const now = Date.now();
        const ONE_HOUR_MS           =  3 * 60 * 60 * 1000; // adı ONE_HOUR ama maliyet icin 3 saate cikarildi (bkz asagidaki filtre)
        const TWELVE_HOURS_MS       = 12 * 60 * 60 * 1000;
        const TWENTY_FOUR_HOURS_MS  = 24 * 60 * 60 * 1000;

        console.log(`📊 Toplam ${activeDocs.length} aktif ilan kontrol ediliyor...\n`);

        let autoExpiredCount = 0;
        const autoExpiredIds  = new Set();
        const earlyWarningIds = new Set(); // 12-24 saat arası, öncelikli AI taraması

        for (const doc of activeDocs) {
            const deal = doc.data();
            let createdAtMs = 0;

            if (deal.createdAt && typeof deal.createdAt.toMillis === 'function') {
                createdAtMs = deal.createdAt.toMillis();
            } else if (deal.createdAt && deal.createdAt._seconds) {
                createdAtMs = deal.createdAt._seconds * 1000;
            } else if (typeof deal.createdAt === 'number') {
                createdAtMs = deal.createdAt;
            } else if (typeof deal.createdAt === 'string') {
                createdAtMs = new Date(deal.createdAt).getTime();
            }

            const ageMs = createdAtMs > 0 ? (now - createdAtMs) : 0;

            if (ageMs > TWENTY_FOUR_HOURS_MS) {
                // 24 saati geçmiş → anında pasife al
                autoExpiredCount++;
                autoExpiredIds.add(doc.id);
                const deleteDate = new Date(now + 60 * 60 * 1000);
                await doc.ref.update({
                    status: 'İndirim Bitti',
                    expiredAt: FieldValue.serverTimestamp(),
                    expiresAt: FieldValue.serverTimestamp(),
                    deleteAt: deleteDate,
                    errorReason: '24 saatlik yayın süresi dolmuştur (Otomatik).'
                });
                await sendSilentExpiredNotification(doc.id, deal.title);
                console.log(`   ⏰ OTOMATİK PASİF (24sa): ${deal.title.substring(0, 30)}... (${(ageMs / 3600000).toFixed(1)} sa)`);
            } else if (ageMs > TWELVE_HOURS_MS) {
                // 12-24 saat arası → erken uyarı, AI ile öncelikli tara
                earlyWarningIds.add(doc.id);
            }
        }

        if (autoExpiredCount > 0) {
            console.log(`\n✅ ${autoExpiredCount} adet 24 saati geçmiş ilan pasife alındı.`);
        }

        // --- AŞAMA 2: TÜM KALAN İLANLAR İÇİN AI KONTROLÜ ---
        // 1 saatten yeni ilanlar atlanır — yeni yayınlanan ilan dakikalar içinde
        // false-positive almasın. Price-check için minimum olgunlaşma süresi gerekli.
        const adsToInspect = activeDocs
            .filter(d => {
                if (autoExpiredIds.has(d.id)) return false;
                const deal = d.data();
                let createdAtMs = 0;
                if (deal.createdAt?.toMillis) createdAtMs = deal.createdAt.toMillis();
                else if (deal.createdAt?._seconds) createdAtMs = deal.createdAt._seconds * 1000;
                else if (typeof deal.createdAt === 'number') createdAtMs = deal.createdAt;
                const ageMs = createdAtMs > 0 ? (now - createdAtMs) : ONE_HOUR_MS + 1;
                if (ageMs < ONE_HOUR_MS) {
                    console.log(`   ⏳ Yeni ilan atlandı (${Math.round(ageMs / 60000)} dk): ${deal.title?.substring(0, 30)}...`);
                    return false;
                }
                return true;
            })
            .sort((a, b) => {
                const aW = earlyWarningIds.has(a.id) ? 0 : 1;
                const bW = earlyWarningIds.has(b.id) ? 0 : 1;
                return aW - bW;
            });

        if (adsToInspect.length > 0) {
            console.log(`\n🔍 ${adsToInspect.length} ilan AI kontrole alınıyor (${earlyWarningIds.size} adet 6+ saatlik öncelikli)...\n`);
        }

        const processDeal = async (doc) => {
            const deal = doc.data();
            const id = doc.id;

            // Zaten bitmişse veya link yoksa atla
            if (deal.status === 'İndirim Bitti' || !deal.link) return;

            const url = deal.originalStoreLink || deal.link;
            console.log(`📦 [${deal.brand || 'Mağaza'}] ${deal.title.substring(0, 40)}...`);

            try {
                const isHardSite = /trendyol|amazon|hepsiburada|n11/.test(url.toLowerCase());
                let html = await fetchHtml(url, isHardSite);

                if (isHardSite) await new Promise(r => setTimeout(r, 2000)); // Rate limit bekleme

                if (!html) {
                    await doc.ref.update({ lastPriceCheck: FieldValue.serverTimestamp() });
                    return;
                }

                // GEMINI_API_KEY varsa AI birincil (Jina metnini okur, zor sitelerde
                // fiyatı ancak AI okuyabilir). Yoksa temkinli HTML yedeği.
                const hasKey = !!(process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_API_KEY);
                const verdict = hasKey ? await verifyWithAI(deal, html, db) : verifyWithHTML(deal, html);

                if (verdict.decision === 'unknown') {
                    // Karar verilemedi (bot-engeli/belirsiz) → DOKUNMA. Strike değişmez.
                    console.log(`   ❔ Belirsiz, dokunulmadı: ${verdict.reason} (${id})`);
                    await doc.ref.update({ lastPriceCheck: FieldValue.serverTimestamp() });
                    return;
                }

                if (verdict.decision === 'expired') {
                    const prevStrike = typeof deal.expireStrike === 'number' ? deal.expireStrike : 0;

                    if (prevStrike < 1) {
                        // ── 1. VURUŞ: henüz SİLME. Şüpheli işaretle; sonraki turda da
                        // "bitti" derse kesinleşir. Anlık hata kaynaklı yanlış-pozitifleri eler.
                        console.log(`   ⚠️  1. UYARI (silinmedi, 2. onay bekleniyor): ${verdict.reason} (${id})`);
                        await doc.ref.update({
                            expireStrike: 1,
                            lastStrikeReason: verdict.reason,
                            lastStrikeAt: FieldValue.serverTimestamp(),
                            lastCheckedPrice: verdict.currentPrice || 0,
                            lastPriceCheck: FieldValue.serverTimestamp(),
                        });
                        return;
                    }

                    // ── 2. ARDIŞIK VURUŞ: KESİNLEŞTİR ──
                    console.log(`   🚩 İNDİRİM BİTTİ (2. onay): ${verdict.reason} (${id})`);
                    const deleteDate = new Date(Date.now() + 60 * 60 * 1000);

                    const updateData = {
                        status: 'İndirim Bitti',
                        expiredAt: FieldValue.serverTimestamp(),
                        expiresAt: FieldValue.serverTimestamp(),
                        deleteAt: deleteDate,
                        lastCheckedPrice: verdict.currentPrice || 0,
                        lastPriceCheck: FieldValue.serverTimestamp(),
                        errorReason: verdict.reason,
                        expireStrike: 2,
                    };
                    await doc.ref.update(updateData);
                    // Mobil uygulamayı gerçek zamanlı bilgilendirmek için sessiz FCM gönder
                    await sendSilentExpiredNotification(id, deal.title);

                    // Bildirim
                    await db.collection('notifications').add({
                        title: `🏷️ İndirim Bitti: ${deal.brand || 'İNDİVA'}`,
                        body: `${deal.title} indirimi sona erdi.`,
                        image: deal.imageUrl || "",
                        url: `https://indiva.app/detay/${id}`,
                        target: 'all',
                        status: 'pending',
                        createdAt: FieldValue.serverTimestamp()
                    });
                } else {
                    // decision === 'active'
                    console.log(`   ✅ Aktif: ${deal.title.substring(0, 20)}...`);
                    const updates = {
                        lastPriceCheck: FieldValue.serverTimestamp(),
                        lastCheckedPrice: verdict.currentPrice || deal.newPrice,
                        status: 'aktif',
                        expireStrike: 0, // aktif çıktı → şüphe işaretini sıfırla
                    };
                    // Gerçek fiyat gözlemi varsa geçmişe ekle (sahte/şişirilmiş indirim
                    // tespiti için ileride kullanılacak veri — arrayUnion sadece EKLER,
                    // mevcut alanlara dokunmaz).
                    if (verdict.currentPrice > 0) {
                        updates.priceHistory = FieldValue.arrayUnion({ price: verdict.currentPrice, at: Timestamp.now() });
                    }
                    await doc.ref.update(updates);
                }
            } catch (e) {
                console.error(`   ❌ Hata (${id}): ${e.message}`);
            }
        };

        // 5'erli paketler halinde paralel işle (Sunucuyu ve kotaları yormadan)
        const batchSize = 5;
        for (let i = 0; i < adsToInspect.length; i += batchSize) {
            const batch = adsToInspect.slice(i, i + batchSize);
            await Promise.all(batch.map(doc => processDeal(doc)));
        }

        // --- AŞAMA 2.5: YANLIŞ İŞARETLENENLERİ KURTAR (self-healing) ---
        // Silme penceresindeki ('İndirim Bitti' + deleteAt henüz dolmamış) ve
        // 24-saat kuralıyla DEĞİL, fiyat/stok kontrolüyle pasife alınmış ilanları
        // yeniden doğrula; güvenle "aktif" çıkanları geri canlandır. Böylece olası
        // yanlış-pozitifler 1 saatlik gri+sayaç penceresi içinde kendiliğinden düzelir.
        let reactivatable = [];
        try {
            const hasKey = !!(process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_API_KEY);
            const pendingSnap = await db.collection('discounts').where('status', '==', 'İndirim Bitti').get();
            reactivatable = pendingSnap.docs.filter(d => {
                const x = d.data();
                if (!x.link) return false;
                if (/24 saat/i.test(x.errorReason || '')) return false; // yaş kuralı → kurtarma yok
                const dMs = tsToMs(x.deleteAt);
                return dMs === 0 || dMs > Date.now(); // henüz silinmemiş (pencere içinde)
            });

            if (reactivatable.length > 0) {
                console.log(`\n🔁 ${reactivatable.length} 'bitti' ilan yeniden doğrulanıyor (kurtarma)...`);
            }

            const recheck = async (doc) => {
                const deal = doc.data();
                const url = deal.originalStoreLink || deal.link;
                try {
                    const isHardSite = /trendyol|amazon|hepsiburada|n11/.test(url.toLowerCase());
                    const html = await fetchHtml(url, isHardSite);
                    if (!html) return;
                    const verdict = hasKey ? await verifyWithAI(deal, html, db) : verifyWithHTML(deal, html);
                    if (verdict.decision === 'active') {
                        await doc.ref.update({
                            status: 'aktif',
                            expireStrike: 0,
                            deleteAt: FieldValue.delete(),
                            expiredAt: FieldValue.delete(),
                            errorReason: FieldValue.delete(),
                            lastPriceCheck: FieldValue.serverTimestamp(),
                            lastCheckedPrice: verdict.currentPrice || deal.newPrice || 0,
                        });
                        console.log(`   💚 GERİ CANLANDIRILDI (yanlış-pozitif): ${(deal.title || '').substring(0, 30)}...`);
                    }
                } catch { /* sessiz */ }
            };

            const rb = 5;
            for (let i = 0; i < reactivatable.length; i += rb) {
                await Promise.all(reactivatable.slice(i, i + rb).map(recheck));
            }
        } catch (e) {
            console.warn(`   ⚠️ Kurtarma aşaması hatası: ${e.message}`);
        }

        // --- AŞAMA 3: KESİN SİLME (deleteAt dolanlar) ---
        console.log(`\n🗑️  Kesin silme kontrolü yapılıyor...`);
        const toDeleteSnapshot = await db.collection('discounts')
            .where('deleteAt', '<=', new Date())
            .get();

        if (toDeleteSnapshot.size > 0) {
            const deleteBatch = db.batch();
            toDeleteSnapshot.docs.forEach(doc => {
                deleteBatch.delete(doc.ref);
                console.log(`   🚮 SİLİNDİ: ${doc.data().title.substring(0, 30)}...`);
            });
            await deleteBatch.commit();
            console.log(`✅ ${toDeleteSnapshot.size} adet süresi dolan ilan kalıcı olarak silindi.`);
        } else {
            console.log('✅ Silinecek süresi dolmuş ilan yok.');
        }

        console.log(`\n✨ Tarama tamamlandı. 10 dakika sonra tekrar çalışacak.`);

        await logPipelineRun(db, {
            script: 'price-checker',
            fetched: activeDocs.length,
            approved: activeDocs.length - autoExpiredCount,
            rejected: autoExpiredCount,
            skipped: 0,
            failed: 0,
            durationMs: Date.now() - runStartTime,
            note: `AI kontrole alınan: ${adsToInspect.length}, kurtarılan: ${reactivatable.length}, kalıcı silinen: ${toDeleteSnapshot.size}`,
        });

    } catch (err) {
        console.error(`💥 Kritik Hata: ${err.message}`);
        await logPipelineRun(db, {
            script: 'price-checker', fetched: 0, approved: 0, rejected: 0, skipped: 0, failed: 1,
            durationMs: Date.now() - runStartTime, note: `Kritik hata: ${err.message}`,
        }).catch(() => {});
        await sendAdminAlert('Kritik Sistem Hatası', `price-checker.js durdu: ${err.message}`);
    }
}

/**
 * GitHub Actions cron ile 10 dakikada bir tek seferlik çalıştır.
 * while(true) döngüsü kaldırıldı — Actions zaten cron ile tetikliyor.
 */
checkPrices()
    .then(() => {
        console.log('\n✅ Price Checker başarıyla tamamlandı.');
        process.exit(0);
    })
    .catch(async (err) => {
        console.error(`\n💥 KRİTİK HATA: ${err.message}`);
        try { await sendAdminAlert('Price Checker Kritik Hata', err.message); } catch {}
        process.exit(1);
    });
