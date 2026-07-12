
const functions = require('firebase-functions/v1');
const admin = require('firebase-admin');
const https = require('https');
const http = require('http');
admin.initializeApp();

// ─── AI Kullanım/Maliyet Takibi ───────────────────────────────────────────────
// gemini-2.5-flash-lite tahmini fiyatlandırması (USD / 1M token). Google'ın
// güncel fiyat sayfasından kontrol edin: https://ai.google.dev/pricing
const AI_PRICE_INPUT_PER_1M_USD = 0.10;
const AI_PRICE_OUTPUT_PER_1M_USD = 0.40;

async function trackAiUsage(geminiData) {
    try {
        const usage = geminiData?.usageMetadata;
        if (!usage) return;
        const inputTokens = usage.promptTokenCount || 0;
        const outputTokens = usage.candidatesTokenCount || 0;
        const costUsd = (inputTokens / 1e6) * AI_PRICE_INPUT_PER_1M_USD + (outputTokens / 1e6) * AI_PRICE_OUTPUT_PER_1M_USD;

        const db = admin.firestore();
        const now = new Date();
        const dayId = now.toISOString().slice(0, 10);
        const monthId = now.toISOString().slice(0, 7);
        const fields = {
            calls: admin.firestore.FieldValue.increment(1),
            inputTokens: admin.firestore.FieldValue.increment(inputTokens),
            outputTokens: admin.firestore.FieldValue.increment(outputTokens),
            costUsd: admin.firestore.FieldValue.increment(costUsd),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        };
        await Promise.all([
            db.collection('aiUsage').doc(`daily_${dayId}`).set(fields, { merge: true }),
            db.collection('aiUsage').doc(`monthly_${monthId}`).set(fields, { merge: true }),
        ]);
    } catch { /* takip hatası ana akışı bozmasın */ }
}

// Geçerli kategori listesi — D:\INDIVAAPP2026\constants\categories.ts ile birebir aynı olmalı
const VALID_CATEGORIES = [
    'Teknoloji',
    'Beyaz Eşya',
    'Giyim & Moda',
    'Ayakkabı & Çanta',
    'Ev & Yaşam',
    'Mobilya & Dekorasyon',
    'Spor & Outdoor',
    'Kozmetik & Bakım',
    'Süpermarket',
    'Anne & Bebek',
    'Kitap & Kırtasiye',
    'Oyun & Oyuncak',
    'Seyahat',
    'Yemek & İçecek',
    'Sağlık',
    'Otomotiv',
    'Pet Shop',
    'Bahçe & Yapı',
    'Diğer',
];

// ─────────────────────────────────────────────────────────────────────────────
// Yardımcı: HTTP GET (Node built-in, fetch yoksa)
// ─────────────────────────────────────────────────────────────────────────────
function httpGet(url, headersObj = {}, timeoutMs = 25000) {
    return new Promise((resolve, reject) => {
        const lib = url.startsWith('https') ? https : http;
        const req = lib.get(url, { headers: headersObj }, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => resolve({ ok: res.statusCode < 400, status: res.statusCode, text: () => data, json: () => JSON.parse(data) }));
        });
        req.setTimeout(timeoutMs, () => { req.destroy(); reject(new Error('Timeout')); });
        req.on('error', reject);
    });
}

// Mağaza tespiti
function detectStore(url) {
    const l = url.toLowerCase();
    if (l.includes('trendyol') || l.includes('ty.gl')) return 'Trendyol';
    if (l.includes('hepsiburada') || l.includes('hb.biz')) return 'Hepsiburada';
    if (l.includes('n11.com') || l.includes('sl.n11')) return 'N11';
    if (l.includes('amazon') || l.includes('amzn.to')) return 'Amazon';
    if (l.includes('ciceksepeti')) return 'Çiçeksepeti';
    if (l.includes('temu.com')) return 'Temu';
    return 'Online Mağaza';
}

// ─────────────────────────────────────────────────────────────────────────────
// Cloud Function: analyzeQueueItem
// analyzeQueue/{docId} oluşturulunca tetiklenir, URL'yi analiz edip
// discounts koleksiyonuna yazar
// ─────────────────────────────────────────────────────────────────────────────
exports.analyzeQueueItem = functions
    .runWith({ timeoutSeconds: 120, memory: '256MB' })
    .firestore
    .document('analyzeQueue/{docId}')
    .onCreate(async (snap, context) => {
        const data = snap.data();
        const url = data.url;
        if (!url) {
            await snap.ref.update({ status: 'error', errorMessage: 'URL bulunamadı.' });
            return;
        }

        // İşleniyor olarak işaretle
        await snap.ref.update({ status: 'processing', startedAt: admin.firestore.FieldValue.serverTimestamp() });

        try {
            const storeName = detectStore(url);
            const GEMINI_KEY = process.env.GEMINI_API_KEY || '';

            if (!GEMINI_KEY) throw new Error('Gemini API key tanımlı değil. firebase functions:config:set gemini.key=YOUR_KEY komutunu çalıştırın.');

            // 1. Jina Reader ile sayfa içeriği çek
            console.log(`📖 Jina ile sayfa çekiliyor: ${url.substring(0, 60)}`);
            let pageContent = '';
            let imageUrl = '';

            try {
                const jinaRes = await httpGet(`https://r.jina.ai/${url}`, { Accept: 'text/plain' }, 30000);
                if (jinaRes.ok) {
                    pageContent = jinaRes.text().substring(0, 10000);
                    console.log(`✅ Sayfa okundu: ${pageContent.length} karakter`);
                }
            } catch (e) {
                console.warn('Jina hatası:', e.message);
                pageContent = `URL: ${url}\nMağaza: ${storeName}`;
            }

            // 2. Jina JSON ile og:image çek
            try {
                const ogRes = await httpGet(`https://r.jina.ai/${url}`, { Accept: 'application/json' }, 10000);
                if (ogRes.ok) {
                    const json = ogRes.json();
                    imageUrl = json?.data?.ogImage || json?.data?.image || '';
                }
            } catch {}

            // 3. Gemini ile analiz et
            console.log('🤖 Gemini ile analiz ediliyor...');
            const categoryList = VALID_CATEGORIES.filter(c => c !== 'Diğer').join(' | ');
            const prompt = `Sen bir e-ticaret ürün analistisisin. Aşağıdaki URL ve sayfa içeriğini analiz et:

URL: ${url}
Mağaza: ${storeName}

SAYFA İÇERİĞİ:
${pageContent}

Bu ürünü analiz et ve SADECE aşağıdaki JSON formatında yanıt ver (başka hiçbir şey yazma):
{
  "title": "ürün başlığı (temiz, max 80 karakter)",
  "cleanTitle": "kısa başlık (max 50 karakter)",
  "newPrice": indirimli fiyat (sayı, TL),
  "oldPrice": normal fiyat (sayı, TL, yoksa 0),
  "discountPercent": indirim yüzdesi (sayı),
  "category": "SADECE şu seçeneklerden birini yaz: ${categoryList}",
  "storeName": "${storeName}"
}`;

            const geminiRes = await httpGet(
                `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${GEMINI_KEY}`,
                { 'Content-Type': 'application/json' },
                60000
            );

            // Not: httpGet GET yapar ama Gemini POST ister. POST için başka yol:
            const geminiData = await postJson(
                `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${GEMINI_KEY}`,
                {
                    contents: [{ role: 'user', parts: [{ text: prompt }] }],
                    generationConfig: { temperature: 0.2, responseMimeType: 'application/json' }
                },
                60000
            );
            await trackAiUsage(geminiData);

            const aiText = geminiData?.candidates?.[0]?.content?.parts?.[0]?.text || '';
            let result = {};
            try {
                const jsonMatch = aiText.match(/\{[\s\S]*\}/);
                if (jsonMatch) result = JSON.parse(jsonMatch[0]);
            } catch (e) {
                throw new Error('AI geçerli JSON döndürmedi: ' + aiText.substring(0, 200));
            }

            // Fiyat kontrolü
            const newPrice = parseFloat(String(result.newPrice || 0).replace(/[^\d.]/g, '')) || 0;
            let oldPrice = parseFloat(String(result.oldPrice || 0).replace(/[^\d.]/g, '')) || 0;
            if (oldPrice === 0 && newPrice > 0) oldPrice = Math.round(newPrice * 1.3);
            const discountPercent = result.discountPercent || (oldPrice > 0 ? Math.round(((oldPrice - newPrice) / oldPrice) * 100) : 0);

            const finalImageUrl = imageUrl || result.imageUrl || '';

            // 4. discounts koleksiyonuna yaz
            const docData = {
                title: result.title || 'Ürün',
                cleanTitle: result.cleanTitle || result.title || 'Ürün',
                newPrice: newPrice,
                oldPrice: oldPrice,
                discountPercent: discountPercent,
                category: VALID_CATEGORIES.includes(result.category) ? result.category : 'Diğer',
                imageUrl: finalImageUrl,
                link: url,
                originalStoreLink: url,
                storeName: storeName,
                brand: storeName,
                status: 'aktif',
                source: 'queue_analyzer',
                createdAt: admin.firestore.FieldValue.serverTimestamp(),
                queueId: context.params.docId,
            };

            const discountRef = await admin.firestore().collection('discounts').add(docData);
            console.log(`✅ İndirim yayınlandı: ${discountRef.id}`);

            // 5. Kuyruk girdisini güncelle
            await snap.ref.update({
                status: 'done',
                discountId: discountRef.id,
                completedAt: admin.firestore.FieldValue.serverTimestamp(),
            });

        } catch (err) {
            console.error('❌ Analiz hatası:', err.message);
            await snap.ref.update({
                status: 'error',
                errorMessage: err.message,
                failedAt: admin.firestore.FieldValue.serverTimestamp(),
            });
        }
    });

// POST helper (httpGet sadece GET yapıyor)
function postJson(url, body, timeoutMs = 60000) {
    return new Promise((resolve, reject) => {
        const bodyStr = JSON.stringify(body);
        const urlObj = new URL(url);
        const options = {
            hostname: urlObj.hostname,
            path: urlObj.pathname + urlObj.search,
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(bodyStr) },
        };
        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try { resolve(JSON.parse(data)); } catch { reject(new Error('JSON parse hatası: ' + data.substring(0, 200))); }
            });
        });
        req.setTimeout(timeoutMs, () => { req.destroy(); reject(new Error('Gemini timeout')); });
        req.on('error', reject);
        req.write(bodyStr);
        req.end();
    });
}

/**
 * Trigger: When a new document is created in 'notifications' collection.
 * Action: Sends FCM multicast message to all tokens in 'fcmTokens'.
 */
exports.sendPushNotification = functions.firestore
    .document('notifications/{docId}')
    .onCreate(async (snap, context) => {
        const data = snap.data();
        console.log(`[sendPushNotification] Tetiklendi. title="${data.title}"`);

        // 1. Token'ları al
        const tokensSnap = await admin.firestore().collection('fcmTokens').get();
        const tokens = tokensSnap.docs.map(doc => doc.id).filter(t => !!t);

        console.log(`[sendPushNotification] Bulunan token sayısı: ${tokens.length}`);

        if (tokens.length === 0) {
            console.warn('[sendPushNotification] fcmTokens koleksiyonu boş. Bildirim gönderilemedi.');
            return snap.ref.update({ status: 'failed', error: 'No tokens found' });
        }

        // 2. Mesajları tek tek oluştur (firebase-admin v12 sendEachForMulticast)
        const message = {
            notification: {
                title: data.title,
                body: data.body,
                ...(data.image ? { imageUrl: data.image } : {}),
            },
            data: {
                url: data.url || '',
                image: data.image || '',
                discountId: data.discountId || '',
                storyId: data.storyId || '',
            },
            android: {
                priority: 'high',
                notification: {
                    channelId: 'indiva_default_channel',
                    sound: 'default',
                    ...(data.image ? { imageUrl: data.image } : {}),
                },
            },
            tokens,
        };

        try {
            // 3. Gönder (v12 uyumlu)
            const response = await admin.messaging().sendEachForMulticast(message);

            console.log(`[sendPushNotification] Başarılı: ${response.successCount}, Başarısız: ${response.failureCount}`);

            // 4. Geçersiz token'ları temizle
            if (response.failureCount > 0) {
                const invalidTokens = [];
                response.responses.forEach((resp, idx) => {
                    if (!resp.success) {
                        const code = resp.error?.code || '';
                        console.warn(`Token başarısız [${code}]: ${tokens[idx].substring(0, 20)}...`);
                        if (
                            code === 'messaging/invalid-registration-token' ||
                            code === 'messaging/registration-token-not-registered'
                        ) {
                            invalidTokens.push(tokens[idx]);
                        }
                    }
                });
                if (invalidTokens.length > 0) {
                    const batch = admin.firestore().batch();
                    invalidTokens.forEach(t => batch.delete(admin.firestore().collection('fcmTokens').doc(t)));
                    await batch.commit();
                    console.log(`${invalidTokens.length} geçersiz token silindi.`);
                }
            }

            return snap.ref.update({ status: 'sent', sentAt: admin.firestore.FieldValue.serverTimestamp() });

        } catch (error) {
            console.error('[sendPushNotification] Hata:', error);
            return snap.ref.update({ status: 'failed', error: error.message });
        }
    });


