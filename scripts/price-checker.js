/**
 * price-checker.js — INDIVA Fiyat Takip ve Otomatik Pasife Alma
 * 
 * Firestore'daki aktif ilanları tarar, mağaza sitesindeki güncel fiyatı kontrol eder.
 * Fiyat artmışsa veya ürün tükenmişse durumu "İndirim Bitti" olarak günceller ve bildirim gönderir.
 * 
 * Çalıştırma: node scripts/price-checker.js
 */

import * as cheerio from 'cheerio';
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { getMessaging } from 'firebase-admin/messaging';
import * as fs from 'fs';
import * as path from 'path';

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
        if (!process.env[key]) process.env[key] = val;
    }
}

// ─── Firebase ────────────────────────────────────────────────────────────────
function initFirebase() {
    if (getApps().length > 0) return getFirestore();
    let serviceAccount;
    const envJson = process.env.FIREBASE_SERVICE_ACCOUNT;
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
    initializeApp({ credential: cert(serviceAccount) });
    return getFirestore();
}

// ─── HTTP Utilities ──────────────────────────────────────────────────────────
const USER_AGENTS = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36'
];

async function fetchHtml(url, timeoutMs = 15000) {
    const ua = USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
    try {
        const res = await fetch(url, {
            headers: {
                'User-Agent': ua,
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
                'Accept-Language': 'tr-TR,tr;q=0.9,en-US;q=0.8,en;q=0.7',
                'Cache-Control': 'no-cache',
                'Pragma': 'no-cache'
            },
            signal: AbortSignal.timeout(timeoutMs)
        });
        if (!res.ok) {
            console.log(`      ⚠️ HTTP ${res.status} hatası (${url.substring(0, 40)}...)`);
            return null;
        }
        return await res.text();
    } catch (e) {
        console.log(`      ⚠️ Bağlantı hatası: ${e.message}`);
        return null;
    }
}

function parseTurkishPrice(text) {
    if (!text) return 0;
    // Türk sitelerinde genellikle: 1.234,56 TL veya 1,234.56 (nadir)
    // Temizlik: Sadece rakam, virgül ve nokta kalsın
    let cleaned = text.replace(/[^\d.,]/g, '').trim();

    // Eğer hem nokta hem virgül varsa:
    // "1.234,56" -> Nokta binlik, virgül ondalıktır.
    if (cleaned.includes('.') && cleaned.includes(',')) {
        cleaned = cleaned.replace(/\./g, '').replace(',', '.');
    }
    // Sadece virgül varsa ve sonda ise (ondalık)
    else if (cleaned.includes(',') && cleaned.indexOf(',') > cleaned.length - 4) {
        cleaned = cleaned.replace(',', '.');
    }
    // Sadece nokta varsa ve sonda değilse (binlik olabilir)
    // Ama "12.50" gibi bir şeyse ondalıktır. 
    // Kural: Son 3 karakterden önceyse binliktir.
    else if (cleaned.includes('.') && cleaned.indexOf('.') <= cleaned.length - 4) {
        cleaned = cleaned.replace(/\./g, '');
    }

    const price = parseFloat(cleaned);
    return isNaN(price) ? 0 : price;
}

function extractPrice($, html) {
    let price = 0;

    // 1. JSON-LD denemesi
    $('script[type="application/ld+json"]').each((_, el) => {
        try {
            const data = JSON.parse($(el).html() || '{}');
            const searchData = (Array.isArray(data) ? data : [data]);
            for (const item of searchData) {
                const offers = item.offers || (item['@type'] === 'Product' ? item.offers : null);
                if (offers) {
                    const priceVal = Array.isArray(offers) ? offers[0].price : offers.price;
                    if (priceVal) {
                        price = parseTurkishPrice(String(priceVal));
                        if (price > 0) return false;
                    }
                }
            }
        } catch { }
    });

    if (price > 0) return price;

    // 2. Mağaza Özel Kurallar (Amazon vb.)
    if (html.includes('amazon.com')) {
        const whole = $('.a-price-whole').first().text().replace(/[^\d]/g, '');
        const fraction = $('.a-price-fraction').first().text().replace(/[^\d]/g, '');
        if (whole) {
            price = parseFloat(`${whole}.${fraction || '00'}`);
            if (price > 0) return price;
        }
    }

    // 3. Yaygın seçiciler
    const priceSelectors = [
        '.current-price', '.new-price', '.sale-price',
        '[itemprop="price"]', '.price-now', '.total-price',
        '.prc-dsc', '.prc-slg', // Trendyol
        '.product-price', '.original-price', // Hepsiburada
        '#price_inside_buybox', '.a-price-whole',
        '[data-test-id="price-current-price"]'
    ];

    for (const selector of priceSelectors) {
        const text = $(selector).first().text();
        if (text) {
            price = parseTurkishPrice(text);
            if (price > 0) break;
        }
    }

    return price;
}

function isOutOfStock($, html) {
    const stockKeywords = [
        'tükendi', 'stokta yok', 'gelince haber ver',
        'stokk_yok', 'sepete eklenemiyor',
        'out of stock', 'sold out', 'not available',
        'ürün temin edilemiyor', 'geçici olarak temin edilemiyor',
        'stokta bulunmamaktadır'
    ];
    const lowerHtml = html.toLowerCase();

    // Explicit keyword check
    const stockTextFound = stockKeywords.some(kw => lowerHtml.includes(kw));
    if (stockTextFound) return true;

    // Check for "passive" buttons or specific disabled attributes
    const passiveSelectors = [
        '.add-to-basket-button.passive',
        '.buy-now.passive',
        '.disabled-button',
        '.out-of-stock-button',
        'button[disabled]',
        '.btn-passive'
    ];
    
    for (const selector of passiveSelectors) {
        if ($(selector).length > 0) return true;
    }

    return false;
}

// ─── Main Logic ──────────────────────────────────────────────────────────────

const API_URL = 'https://openrouter.ai/api/v1/chat/completions';

async function verifyWithAI(url, currentTitle, oldPrice, html) {
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) return { expired: false, reason: 'API Key yok' };

    try {
        const $ = cheerio.load(html);
        
        // Gereksiz etiketleri temizle (token tasarrufu)
        $('script, style, svg, path, footer, nav, header').remove();
        
        // Sadece gövde metnini al ve temizle
        let bodyText = $('body').text()
            .replace(/\s+/g, ' ')
            .substring(0, 2000) // İlk 2000 karakter genellikle yeterlidir
            .trim();

        const prompt = `Aşağıdaki ürün sayfasından alınan metni analiz et. 
Ürün: "${currentTitle}"
Eski Fiyat: ${oldPrice} TL

Sorular:
1. Ürün stokta mı? (Sepete ekle butonu aktif mi, 'stokta yok' yazıyor mu?)
2. Güncel fiyat nedir? (Eski fiyattan çok yüksek mi?)

Yanıtını SADECE aşağıdaki JSON formatında ver:
{
  "expired": true/false,
  "currentPrice": 0,
  "reason": "kısa açıklama (stok yok/fiyat arttı/fiyat aynı)"
}`;

        const res = await fetch(API_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`,
                'HTTP-Referer': 'https://indiva.app',
                'X-Title': 'INDIVA Price Checker'
            },
            body: JSON.stringify({
                model: 'google/gemini-2.5-flash',
                messages: [
                    { role: 'system', content: 'Sen bir fiyat/stok kontrol uzmanısın. Sadece JSON formatında cevap verirsin.' },
                    { role: 'user', content: `SAYFA METNİ:\n${bodyText}\n\n${prompt}` }
                ],
                response_format: { type: 'json_object' }
            }),
            signal: AbortSignal.timeout(25000)
        });

        if (!res.ok) return { expired: false, reason: `AI Error: ${res.status}` };

        const data = await res.json();
        const aiResponse = JSON.parse(data.choices[0].message.content);
        
        // Eğer AI fiyatı bulmuşsa ama 'expired: false' demişse bile, 
        // manuel kontrol %30 fazlaysa expired sayalım (Güvenlik)
        if (!aiResponse.expired && aiResponse.currentPrice > oldPrice * 1.3) {
            return { expired: true, reason: 'Fiyat Çok Yüksek (AI price detect)', price: aiResponse.currentPrice };
        }

        return { 
            expired: !!aiResponse.expired, 
            reason: aiResponse.reason, 
            price: aiResponse.currentPrice || 0 
        };
    } catch (e) {
        console.error(`      ⚠️ AI Doğrulama Hatası: ${e.message}`);
        return { expired: false, reason: 'AI Hatası' };
    }
}

// ─── Main Logic ──────────────────────────────────────────────────────────────

async function checkPrices() {
    console.log(`\n🔍 AI Destekli Fiyat Kontrolü Başlatıldı: ${new Date().toLocaleString('tr-TR')}`);
    const db = initFirebase();

    try {
        // 1. Durumu 'İndirim Bitti' OLMAYANLARI çek
        const snapshot = await db.collection('discounts')
            .where('status', 'in', ['aktif', 'active', null])
            .limit(300)
            .get();

        const allDocs = snapshot.docs;

        // Ek filtre: status alanı hiç olmayanları (undefined) da dahil et
        const undefSnapshot = await db.collection('discounts')
            .orderBy('createdAt', 'desc')
            .limit(100)
            .get();

        const combinedDocs = [...allDocs];
        undefSnapshot.docs.forEach(d => {
            if (!combinedDocs.find(cd => cd.id === d.id) && d.data().status === undefined) {
                combinedDocs.push(d);
            }
        });

        const aktifDocs = combinedDocs.filter(doc => doc.data().status !== 'İndirim Bitti');

        // 2. Bunlar arasından lastPriceCheck alanı olmayanlar (öncelikli)
        let toCheck = aktifDocs.filter(doc => !doc.data().lastPriceCheck);

        // 3. Eğer 100 limitine ulaşmadıysak, en eski kontrol edilenlerden ekle
        if (toCheck.length < 100) {
            const alreadyChecked = aktifDocs
                .filter(doc => doc.data().lastPriceCheck)
                .sort((a, b) => {
                    const at = a.data().lastPriceCheck?.toDate?.() || 0;
                    const bt = b.data().lastPriceCheck?.toDate?.() || 0;
                    return at - bt;
                });

            toCheck = [...toCheck, ...alreadyChecked.slice(0, 100 - toCheck.length)];
        }

        console.log(`📊 Toplam ${toCheck.length} ilan kontrol edilecek.\n`);

        let updatedCount = 0;

        for (const doc of toCheck) {
            const data = doc.data();
            const url = data.originalStoreLink || data.link;

            if (!url) continue;

            console.log(`   📦 Kontrol ediliyor: ${data.title.substring(0, 50)}...`);

            // ── 1. KURAL: 24 SAAT DOLDU MU? ──
            const createdAt = data.createdAt?.toDate?.() || new Date(data.createdAt);
            const ageInHours = (Date.now() - createdAt.getTime()) / (1000 * 60 * 60);

            if (ageInHours > 24) {
                console.log(`      ⏰ Süre Doldu (24s+): İndirim Bitti olarak işaretleniyor.`);
                await doc.ref.update({
                    status: 'İndirim Bitti',
                    expiredAt: FieldValue.serverTimestamp(),
                    expiresAt: FieldValue.serverTimestamp(), // UI expects expiresAt
                    lastCheckedPrice: data.newPrice || 0,
                    errorReason: '24 Saatlik Yayın Süresi Doldu',
                    lastPriceCheck: FieldValue.serverTimestamp()
                });
                updatedCount++;
                continue;
            }

            // ── 2. KURAL: SAYFA KONTROLÜ (Hybrid AI) ──
            const html = await fetchHtml(url);

            if (!html) {
                console.log(`      ⚠️ Hata (404/Bot Engeli): Atlanıyor.`);
                await doc.ref.update({ lastPriceCheck: FieldValue.serverTimestamp() });
                continue;
            }

            const $ = cheerio.load(html);
            const currentPrice = extractPrice($, html);
            const outOfStock = isOutOfStock($, html);

            const tolerance = data.newPrice * 1.05;
            let shouldBeExpired = outOfStock || (currentPrice > 0 && currentPrice > tolerance);

            // Eğer klasik kural "Bitti" diyorsa AI ile doğrula (False Positive önlemek için)
            if (shouldBeExpired) {
                console.log(`      🤖 AI'ya soruluyor... (Klasik Kontrol: ${outOfStock ? 'Stok Yok' : 'Fiyat Artmış'})`);
                const aiResult = await verifyWithAI(url, data.title, data.newPrice, html);
                
                if (aiResult.expired) {
                    console.log(`      🚩 AI ONAYLADI: ${aiResult.reason}`);
                } else {
                    console.log(`      🛡️ AI İPTAL ETTİ: İlan hala aktif görünüyor. (${aiResult.reason})`);
                    shouldBeExpired = false; 
                }
            }

            if (shouldBeExpired) {
                console.log(`      🚩 İndirim Bitti! (Eski: ${data.newPrice}, Yeni: ${currentPrice || 'Stok Yok'})`);

                // Firestore Güncelle
                await doc.ref.update({
                    status: 'İndirim Bitti',
                    expiredAt: FieldValue.serverTimestamp(),
                    expiresAt: FieldValue.serverTimestamp(), // Eklendi (UI için)
                    lastCheckedPrice: currentPrice || 0,
                    lastPriceCheck: FieldValue.serverTimestamp()
                });

                // Bildirim Gönder (notifications koleksiyonuna ekleyerek - Panel Kaydı)
                await db.collection('notifications').add({
                    title: `🏷️ İndirim Bitti: ${data.brand || 'Mağaza'}`,
                    body: `${data.title} indirimi sona erdi.`,
                    image: data.imageUrl || "",
                    url: `https://indiva.app/discount/${doc.id}`,
                    target: 'all',
                    status: 'pending',
                    createdAt: FieldValue.serverTimestamp()
                });

                // ── SESSİZ KÖPRÜ (DATA BRIDGE) ──
                // INDIVA uygulamasına sessiz bir sinyal göndererek durumun güncellenmesini tetikler.
                try {
                    const messaging = getMessaging();
                    const nowIso = new Date().toISOString();
                    const bridgePayload = {
                        topic: 'all_users',
                        data: {
                            type: 'DISCOUNT_STATUS_UPDATE',
                            id: doc.id,
                            status: 'İndirim Bitti',
                            title: data.title || '',
                            expiresAt: nowIso, // Değiştirildi (UI için)
                            silent: 'true'
                        },
                        android: {
                            priority: 'high'
                        }
                    };
                    await messaging.send(bridgePayload);
                    console.log(`      🔗 Köprü sinyali gönderildi (ID: ${doc.id}, Durum: İndirim Bitti, Zaman: ${nowIso})`);
                } catch (msgErr) {
                    console.warn(`      ⚠️ Köprü sinyali hatası: ${msgErr.message}`);
                }

                updatedCount++;
            } else {
                console.log(`      ✅ İndirim devam ediyor. (Güncel: ${currentPrice || data.newPrice} TL)`);
                // Durumu 'aktif' olarak sabitle ve kontrol zamanını güncelle
                await doc.ref.update({
                    lastPriceCheck: FieldValue.serverTimestamp(),
                    status: 'aktif'
                });
            }

            // Mağaza sunucularını yormamak için kısa bekleme
            await new Promise(r => setTimeout(r, 600));
        }

        console.log(`\n✨ Kontrol tamamlandı. ${updatedCount} ürün pasife alındı.`);

    } catch (err) {
        console.error(`💥 HATA: ${err.message}`);
    }
}

checkPrices();
