/**
 * price-checker.js — INDIVA Fiyat Takip ve Otomatik Pasife Alma
 * 
 * Firestore'daki aktif ilanları tarar, mağaza sitesindeki güncel fiyatı kontrol eder.
 * Fiyat artmışsa veya ürün tükenmişse durumu "İndirim Bitti" olarak günceller ve bildirim gönderir.
 * 
 * Çalıştırma: node scripts/price-checker.js
 */

import { GoogleGenAI } from '@google/genai';
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
    let cleaned = text.replace(/[^\d.,]/g, '').trim();

    if (cleaned.includes('.') && cleaned.includes(',')) {
        cleaned = cleaned.replace(/\./g, '').replace(',', '.');
    }
    else if (cleaned.includes(',') && cleaned.indexOf(',') > cleaned.length - 4) {
        cleaned = cleaned.replace(',', '.');
    }
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

    const stockTextFound = stockKeywords.some(kw => lowerHtml.includes(kw));
    if (stockTextFound) return true;

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

const MODEL = 'gemini-2.5-flash-lite';

async function verifyWithAI(url, currentTitle, oldPrice, html) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return { expired: false, reason: 'Gemini API Key yok' };

    try {
        const genAI = new GoogleGenAI({ apiKey });
        const $ = cheerio.load(html);
        
        $('script, style, svg, path, footer, nav, header, iframe, noscript').remove();
        let bodyText = $('body').text().replace(/\s+/g, ' ').substring(0, 5000).trim();

        const prompt = `Ürün: "${currentTitle}" | Beklenen Fiyat: ${oldPrice} TL
        Şu sayfa verisine göre ürün stokta mı ve güncel fiyatı nedir?
        SADECE JSON döndür: {"expired": boolean, "currentPrice": number, "reason": "kısa açıklama"}
        
        SAYFA VERİSİ:
        ${bodyText}`;

        const response = await genAI.models.generateContent({
            model: MODEL,
            contents: [{ role: 'user', parts: [{ text: prompt }] }],
            config: { temperature: 0.1 }
        });

        const text = response.text || '';
        const match = text.match(/\{[\s\S]*\}/);
        const aiResponse = JSON.parse(match ? match[0] : text);

        if (!aiResponse.expired && aiResponse.currentPrice > oldPrice * 1.3) {
            return { expired: true, reason: 'Fiyat Çok Yüksek (AI tespiti)', price: aiResponse.currentPrice };
        }

        return { 
            expired: !!aiResponse.expired, 
            reason: aiResponse.reason || 'AI tespiti', 
            price: aiResponse.currentPrice || 0 
        };
    } catch (e) {
        console.error(`      ⚠️ AI Hatası: ${e.message}`);
        return { expired: false, reason: 'AI Hatası' };
    }
}

async function checkPrices() {
    console.log(`\n🔍 AI Destekli Fiyat Kontrolü Başlatıldı: ${new Date().toLocaleString('tr-TR')}`);
    const db = initFirebase();

    try {
        const snapshot = await db.collection('discounts')
            .where('status', 'in', ['aktif', 'active', null])
            .limit(300)
            .get();

        const allDocs = snapshot.docs;

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

        let toCheck = aktifDocs.filter(doc => !doc.data().lastPriceCheck);

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

            // 1. KURAL: 24 SAAT DOLDU MU?
            const createdAt = data.createdAt?.toDate?.() || new Date(data.createdAt);
            const ageInHours = (Date.now() - createdAt.getTime()) / (1000 * 60 * 60);

            if (ageInHours > 24) {
                console.log(`      ⏰ Süre Doldu (24s+): İndirim Bitti olarak işaretleniyor.`);
                const deleteDate = new Date(Date.now() + 60 * 60 * 1000); // 60 dakika sonra
                await doc.ref.update({
                    status: 'İndirim Bitti',
                    expiredAt: FieldValue.serverTimestamp(),
                    expiresAt: FieldValue.serverTimestamp(),
                    deleteAt: deleteDate, // Firestore TTL için
                    lastCheckedPrice: data.newPrice || 0,
                    errorReason: '24 Saatlik Yayın Süresi Doldu',
                    lastPriceCheck: FieldValue.serverTimestamp()
                });
                updatedCount++;
                continue;
            }

            // 2. KURAL: SAYFA KONTROLÜ (Hybrid AI)
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

                const deleteDate = new Date(Date.now() + 60 * 60 * 1000); // 60 dakika sonra
                await doc.ref.update({
                    status: 'İndirim Bitti',
                    expiredAt: FieldValue.serverTimestamp(),
                    expiresAt: FieldValue.serverTimestamp(),
                    deleteAt: deleteDate, // Firestore TTL için
                    lastCheckedPrice: currentPrice || 0,
                    lastPriceCheck: FieldValue.serverTimestamp()
                });

                await db.collection('notifications').add({
                    title: `🏷️ İndirim Bitti: ${data.brand || 'Mağaza'}`,
                    body: `${data.title} indirimi sona erdi.`,
                    image: data.imageUrl || "",
                    url: `https://indiva.app/discount/${doc.id}`,
                    target: 'all',
                    status: 'pending',
                    createdAt: FieldValue.serverTimestamp()
                });

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
                            expiresAt: nowIso,
                            silent: 'true'
                        },
                        android: {
                            priority: 'high'
                        }
                    };
                    await messaging.send(bridgePayload);
                    console.log(`      🔗 Köprü sinyali gönderildi (ID: ${doc.id})`);
                } catch (msgErr) {
                    console.warn(`      ⚠️ Köprü sinyali hatası: ${msgErr.message}`);
                }

                updatedCount++;
            } else {
                console.log(`      ✅ İndirim devam ediyor. (Güncel: ${currentPrice || data.newPrice} TL)`);
                await doc.ref.update({
                    lastPriceCheck: FieldValue.serverTimestamp(),
                    status: 'aktif'
                });
            }

            await new Promise(r => setTimeout(r, 600));
        }

        console.log(`\n✨ Kontrol tamamlandı. ${updatedCount} ürün pasife alındı.`);

    } catch (err) {
        console.error(`💥 HATA: ${err.message}`);
    }
}

checkPrices();
