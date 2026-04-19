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
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { getMessaging } from 'firebase-admin/messaging';
import * as fs from 'fs';
import * as path from 'path';
import { fetchWithFallback } from './scraperService.js';
import { sendAdminAlert } from './alertService.js';

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

// ─── HTML Tabanlı Doğrulama (AI olmadan) ─────────────────────────────────────
// AI_ENABLED=true değilse bu fonksiyon kullanılır. Sayfa HTML'ini tarayarak
// stok durumu ve fiyat değişikliğini tespit eder.
function verifyWithHTML(product, html) {
    const lower = html.toLowerCase();

    // Stok bitti / ürün kaldırıldı sinyalleri
    // ÖNEMLİ: includes() yerine daha spesifik kontrol — Trendyol/Amazon gibi sayfalarda
    // diğer ürünlerin "tükendi" badge'leri false-positive üretmesin.
    // Sadece özellikle yazılmış tam cümleleri veya yapısal sinyalleri kabul et.
    const stockPhrases = [
        'bu ürün artık satılmıyor',
        'bu ürün mevcut değil',
        'bu fırsat sonlandı',
        'kampanya sona erdi',
        'ürün kaldırıldı',
        '"out of stock"',         // JSON-LD availability
        '"discontinued"',
        'availability":"outofstock',
        'availability: "outofstock',
    ];
    const isOutOfStock = stockPhrases.some(kw => lower.includes(kw));
    if (isOutOfStock) {
        return { expired: true, reason: 'Stok tükendi (HTML kontrolü)' };
    }

    // Fiyat çıkarma: sayfadan basit regex ile mevcut fiyatı bul
    const pricePatterns = [
        /"price"\s*:\s*"?([\d.,]+)"?/i,
        /itemprop="price"[^>]*content="([\d.,]+)"/i,
        /"priceAmount"\s*:\s*([\d.,]+)/i,
        /<span[^>]*class="[^"]*price[^"]*"[^>]*>([\d.,\s]+)\s*TL/i,
    ];
    let currentPrice = 0;
    for (const pattern of pricePatterns) {
        const match = html.match(pattern);
        if (match) {
            const raw = match[1].replace(/\./g, '').replace(',', '.');
            const parsed = parseFloat(raw);
            if (parsed > 0 && parsed < 1000000) { currentPrice = parsed; break; }
        }
    }

    const savedPrice = product.newPrice || 0;
    if (currentPrice > 0 && savedPrice > 0) {
        const ratio = (currentPrice - savedPrice) / savedPrice;
        if (ratio > 0.15) {
            return {
                expired: true,
                currentPrice,
                reason: `Fiyat: ${savedPrice}₺ → ${currentPrice}₺ (+%${Math.round(ratio * 100)})`
            };
        }
        return { expired: false, currentPrice, reason: 'Aktif' };
    }

    return { expired: false, reason: 'HTML kontrolü: aktif görünüyor' };
}

// ─── AI Verification (Gemini 2.5 Flash) ───────────────────────────────────────
// AI_ENABLED=true olduğunda kullanılır. Daha yüksek doğruluk sağlar.
async function verifyWithAI(product, content) {
    const apiKey = process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_API_KEY;
    if (!apiKey) return { expired: false, reason: 'Gemini API Key bulunamadı' };

    const originalPrice = product.newPrice || 0;
    const originalOldPrice = product.oldPrice || 0;

    const prompt = `Sen bir e-ticaret fiyat kontrol uzmanısın. Aşağıdaki ürün sayfa içeriğine bak ve indirim durumunu değerlendir.

KAYDEDİLEN ÜRÜN BİLGİLERİ:
- Başlık: "${product.title}"
- İndirimli Fiyat (kaydedildiğinde): ${originalPrice} TL
- Liste Fiyatı (eski fiyat): ${originalOldPrice} TL

SAYFA İÇERİĞİ:
${content.substring(0, 12000)}

GÖREV: Sayfa içeriğine göre aşağıdakileri belirle ve SADECE JSON döndür:
1. "currentPrice": Şu an sayfada görünen fiyat (TL, sayı)
2. "inStock": stokta var mı? (true/false)
3. "expired": İndirim bitti mi? Kurallar:
   - Stok yoksa ("tükendi", "satışta değil", "out of stock"): true
   - Mevcut fiyat ${originalPrice} TL'den %15+ artmışsa: true
   - Ürün sayfası 404 veya ürün kaldırılmışsa: true
   - Aksi halde: false
4. "reason": kısa Türkçe açıklama (max 50 karakter)

YALNIZCA JSON: {"currentPrice": 0, "inStock": true, "expired": false, "reason": ""}`;

    try {
        const response = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${apiKey}`,
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

        if (!response.ok) {
            console.warn(`   ⚠️ Gemini API hatası: ${response.status}`);
            return { expired: false, reason: `Gemini HTTP ${response.status}` };
        }

        const data = await response.json();
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (!jsonMatch) return { expired: false, reason: 'AI JSON döndürmedi' };
        const result = JSON.parse(jsonMatch[0]);

        // Ek kontrol: Fiyat artışı %15'ten fazla ise zorla expired=true
        if (result.currentPrice > 0 && originalPrice > 0) {
            const ratio = (result.currentPrice - originalPrice) / originalPrice;
            if (ratio > 0.15) {
                result.expired = true;
                result.reason = `Fiyat: ${originalPrice}₺ → ${result.currentPrice}₺ (+%${Math.round(ratio * 100)})`;
            }
        }
        // Stok yoksa zorla expired=true
        if (result.inStock === false && !result.expired) {
            result.expired = true;
            result.reason = result.reason || 'Stok tükendi';
        }

        return result;
    } catch (e) {
        console.warn(`   ⚠️ Gemini analiz hatası: ${e.message}`);
        return { expired: false, reason: 'AI bağlantı hatası' };
    }
}

// ─── Main Controller ─────────────────────────────────────────────────────────
async function checkPrices() {
    process.stdout.write('\x1Bc'); // Terminali temizle
    console.log(`\n🚀 INDIVA AKILLI TAKİP SİSTEMİ: ${new Date().toLocaleString('tr-TR')}`);
    const db = initFirebase();

    try {
        // --- AŞAMA 1: 12 SAAT KURALI İLE OTOMATİK TEMİZLİK ---
        // Bu aşamada TÜM aktif ilanları çekip 12 saati geçenleri anında pasife alıyoruz.
        // İndeks hatası almamak için orderBy kullanmıyoruz (Zaten tüm aktifleri kontrol ediyoruz).
        const activeSnapshot = await db.collection('discounts')
            .where('status', '==', 'aktif')
            .get();

        const activeDocs = activeSnapshot.docs;
        const now = Date.now();
        const ONE_HOUR_MS           =  1 * 60 * 60 * 1000;
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

                const aiResult = process.env.AI_ENABLED === 'true'
                    ? await verifyWithAI(deal, html)
                    : verifyWithHTML(deal, html);

                if (aiResult.expired) {
                    console.log(`   🚩 İNDİRİM BİTTİ: ${aiResult.reason} (${id})`);
                    const deleteDate = new Date(Date.now() + 60 * 60 * 1000);

                    const updateData = {
                        status: 'İndirim Bitti',
                        expiredAt: FieldValue.serverTimestamp(),
                        expiresAt: FieldValue.serverTimestamp(),
                        deleteAt: deleteDate,
                        lastCheckedPrice: aiResult.currentPrice || 0,
                        lastPriceCheck: FieldValue.serverTimestamp(),
                        errorReason: aiResult.reason
                    };
                    await doc.ref.update(updateData);
                    // Mobil uygulamaı gerçek zamanlı bilgilendirmek için sessiz FCM gönder
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
                    console.log(`   ✅ Aktif: ${deal.title.substring(0, 20)}...`);
                    await doc.ref.update({
                        lastPriceCheck: FieldValue.serverTimestamp(),
                        lastCheckedPrice: aiResult.currentPrice || deal.newPrice,
                        status: 'aktif'
                    });
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

    } catch (err) {
        console.error(`💥 Kritik Hata: ${err.message}`);
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
