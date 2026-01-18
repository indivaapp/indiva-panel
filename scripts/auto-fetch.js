// ===== INDIVA AUTO-FETCH WITH GEMINI AI =====
// GitHub Actions'da çalışan AI destekli script
// Telegram'dan fırsatları çeker, Gemini ile zenginleştirir

const admin = require('firebase-admin');

// ===== CONFIG =====
const TELEGRAM_URL = 'https://t.me/s/onual_firsat';
const MAX_DEALS_PER_RUN = 15;
const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent';

// ===== FIREBASE =====
function initFirebase() {
    if (!admin.apps.length) {
        const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
        admin.initializeApp({
            credential: admin.credential.cert(serviceAccount)
        });
    }
    return admin.firestore();
}

// ===== HTTP FETCH =====
async function fetchWithTimeout(url, timeout = 15000) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
        const response = await fetch(url, {
            signal: controller.signal,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
            }
        });
        return response;
    } finally {
        clearTimeout(timeoutId);
    }
}

// ===== CORS PROXY İLE FETCH (ÇOKLU PROXY DESTEĞİ) =====
const CORS_PROXIES = [
    { name: 'allorigins', fn: (url) => `https://api.allorigins.win/get?url=${encodeURIComponent(url)}&_t=${Date.now()}` },
    { name: 'corsproxy.io', fn: (url) => `https://corsproxy.io/?${encodeURIComponent(url)}` },
    { name: 'cors.lol', fn: (url) => `https://api.cors.lol/?url=${encodeURIComponent(url)}` },
    { name: 'thingproxy', fn: (url) => `https://thingproxy.freeboard.io/fetch/${url}` },
];

async function fetchWithProxy(targetUrl) {
    for (const proxy of CORS_PROXIES) {
        try {
            console.log(`🔄 Proxy deneniyor: ${proxy.name}...`);
            const proxyUrl = proxy.fn(targetUrl);
            const response = await fetchWithTimeout(proxyUrl, 12000);

            if (!response.ok) {
                console.log(`⚠️ ${proxy.name}: HTTP ${response.status}`);
                continue;
            }

            const contentType = response.headers.get('content-type') || '';
            let html = '';

            if (contentType.includes('application/json')) {
                const json = await response.json();
                html = json.contents || json.body || '';
            } else {
                html = await response.text();
            }

            if (html && html.length > 500) {
                console.log(`✅ ${proxy.name} başarılı: ${html.length} karakter`);
                return html;
            } else {
                console.log(`⚠️ ${proxy.name}: İçerik çok kısa (${html?.length || 0})`);
            }
        } catch (error) {
            console.log(`❌ ${proxy.name}: ${error.message}`);
            continue;
        }
    }

    console.log('❌ Tüm proxy\'ler başarısız oldu');
    return '';
}

// ===== GEMINI AI =====
// Free tier: 15 requests per minute (RPM) = 4 saniye minimum bekleme
const GEMINI_DELAY_MS = 5000; // 5 saniye (güvenli limit)
const MAX_RETRIES = 3;

async function callGeminiAPI(prompt, retryCount = 0) {
    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {
        console.log('⚠️ GEMINI_API_KEY tanımlı değil, AI atlanıyor');
        return null;
    }

    try {
        const response = await fetch(`${GEMINI_API_URL}?key=${apiKey}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ parts: [{ text: prompt }] }],
                generationConfig: {
                    temperature: 0.8,
                    maxOutputTokens: 500
                }
            })
        });

        // Rate limit hatası - retry with backoff
        if (response.status === 429) {
            if (retryCount < MAX_RETRIES) {
                const waitTime = (retryCount + 1) * 10000; // 10, 20, 30 saniye
                console.log(`⏳ Rate limit - ${waitTime / 1000}s bekleniyor... (Deneme ${retryCount + 1}/${MAX_RETRIES})`);
                await new Promise(r => setTimeout(r, waitTime));
                return callGeminiAPI(prompt, retryCount + 1);
            }
            console.log('❌ Rate limit aşıldı, AI atlanıyor');
            return null;
        }

        if (!response.ok) {
            const errorText = await response.text();
            console.log(`❌ Gemini HTTP ${response.status}: ${errorText.substring(0, 100)}`);
            return null;
        }

        const data = await response.json();
        return data.candidates?.[0]?.content?.parts?.[0]?.text || null;
    } catch (error) {
        console.log(`❌ Gemini hatası: ${error.message}`);
        return null;
    }
}

// ===== AI İLE LİNK ÇÖZÜMLEME =====
async function resolveOnuAlLinkWithAI(shortLink) {
    if (!shortLink || !shortLink.includes('onu.al')) {
        return shortLink;
    }

    console.log(`🔗 AI ile link çözümleniyor: ${shortLink}`);

    try {
        // HTML'i al
        const html = await fetchWithProxy(shortLink);

        if (!html || html.length < 100) {
            console.log(`⚠️ HTML içeriği çok kısa`);
            return shortLink;
        }

        // Önce klasik yöntemlerle dene
        const classicResult = extractLinkFromHtml(html);
        if (classicResult && isRealStoreLink(classicResult)) {
            console.log(`✅ Klasik yöntem başarılı: ${classicResult.substring(0, 60)}...`);
            return classicResult;
        }

        // Klasik yöntem başarısızsa AI'a gönder
        // HTML'i kısalt (token tasarrufu için)
        const truncatedHtml = html.substring(0, 8000);

        const prompt = `Bu HTML içeriğinden gerçek mağaza linkini bul ve SADECE linki döndür.

Aradığım linkler:
- id="buton" elementindeki href
- app.hb.biz (Hepsiburada)
- ty.gl (Trendyol)
- amazon.com.tr
- n11.com, sl.n11.com
- trendyol.com
- hepsiburada.com

Eğer zxro.com/u/?url= formatında link varsa, url parametresini decode et.

SADECE LİNKİ DÖNDÜR, BAŞKA BİR ŞEY YAZMA.
Bulamazsan "BULUNAMADI" yaz.

HTML:
${truncatedHtml}`;

        const aiResult = await callGeminiAPI(prompt);

        if (aiResult && !aiResult.includes('BULUNAMADI') && aiResult.startsWith('http')) {
            const cleanLink = aiResult.trim().split('\n')[0];
            if (isRealStoreLink(cleanLink)) {
                console.log(`✅ AI link buldu: ${cleanLink.substring(0, 60)}...`);
                return cleanLink;
            }
        }

        console.log(`⚠️ Link çözümlenemedi, orijinal kullanılıyor`);
        return shortLink;

    } catch (error) {
        console.log(`❌ Link çözümleme hatası: ${error.message}`);
        return shortLink;
    }
}

// ===== KLASİK LİNK ÇIKARMA =====
function extractLinkFromHtml(html) {
    // Pattern 1: id="buton"
    const butonMatch = html.match(/id=["']buton["'][^>]*href=["']([^"']+)["']/i) ||
        html.match(/href=["']([^"']+)["'][^>]*id=["']buton["']/i);

    if (butonMatch) {
        return extractFinalUrl(butonMatch[1]);
    }

    // Pattern 2: Mağaza domain'leri
    const storePatterns = [
        /href=["'](https?:\/\/[^"']*(?:ty\.gl|trendyol\.com\/[^"']*-p-)[^"']*)["']/i,
        /href=["'](https?:\/\/[^"']*(?:app\.hb\.biz|hepsiburada\.com)[^"']*)["']/i,
        /href=["'](https?:\/\/[^"']*(?:sl\.n11\.com|n11\.com\/urun)[^"']*)["']/i,
        /href=["'](https?:\/\/[^"']*amazon\.com\.tr[^"']*)["']/i,
        /href=["'](https?:\/\/zxro\.com\/u\/\?[^"']+)["']/i
    ];

    for (const pattern of storePatterns) {
        const match = html.match(pattern);
        if (match && !match[1].includes('onu.al')) {
            return extractFinalUrl(match[1]);
        }
    }

    return null;
}

function extractFinalUrl(url) {
    if (!url) return url;

    try {
        if (url.includes('zxro.com')) {
            const urlObj = new URL(url);
            const encodedUrl = urlObj.searchParams.get('url');
            if (encodedUrl) {
                return decodeURIComponent(encodedUrl);
            }
        }

        if (url.includes('url=')) {
            const match = url.match(/[?&](?:url|redirect_url|goto)=([^&]+)/i);
            if (match) {
                return decodeURIComponent(match[1]);
            }
        }
    } catch (e) {
        console.log(`⚠️ URL decode hatası: ${e.message}`);
    }

    return url;
}

function isRealStoreLink(url) {
    if (!url) return false;
    const stores = [
        'trendyol.com', 'hepsiburada.com', 'amazon.com.tr', 'n11.com',
        'ty.gl', 'app.hb.biz', 'amzn.to', 'sl.n11.com'
    ];
    return stores.some(store => url.includes(store));
}

// ===== AI İLE İÇERİK ZENGİNLEŞTİRME =====
async function enrichDealWithAI(deal) {
    // Ürün hakkında daha fazla bilgi topla
    const storeName = deal.source === 'trendyol' ? 'Trendyol' :
        deal.source === 'hepsiburada' ? 'Hepsiburada' :
            deal.source === 'amazon' ? 'Amazon' :
                deal.source === 'n11' ? 'N11' : 'Online Mağaza';

    const prompt = `Sen profesyonel bir Türk e-ticaret pazarlamacısısın. Her ürünü benzersiz ve çekici bir şekilde tanıtıyorsun.

ÜRÜN BİLGİLERİ:
- Orijinal Başlık: "${deal.title}"
- Fiyat: ${deal.price} TL
- Mağaza: ${storeName}

GÖREVLER:

1. BAŞLIK TEMİZLE:
   - Emoji, FIRSAT, SÜPER, KAÇIRMA, MEGA, İNANILMAZ gibi pazarlama kelimelerini SİL
   - Sadece ürün adını ve markasını bırak
   - SADECE TÜRKÇE KARAKTERLER KULLAN (ş, ğ, ü, ö, ç, ı, İ)
   - Yabancı karakter veya garip sembol EKLEME

2. KATEGORİ (sadece biri):
   Gıda, Elektronik, Giyim, Kozmetik, Ev & Yaşam, Anne & Bebek, Spor, Kitap, Oyuncak, Diğer

3. MARKA:
   Başlıktaki markayı bul (yoksa boş bırak)

4. AÇIKLAMA (ÇOK ÖNEMLİ - 60-90 KELİME):
   Bu açıklama HER ÜRÜN İÇİN BENZERSİZ olmalı! 
   
   Açıklamada şunları yap:
   - Bu ÖZEL ürünün faydalarını anlat (örn: kulaklık ise ses kalitesi, telefon ise kamera özellikleri)
   - ${deal.price} TL fiyatın neden iyi bir fırsat olduğunu vurgula
   - ${storeName}'dan alışverişin güvenilirliğini belirt
   - Ürüne özel özellikler ekle (tahmini de olabilir)
   - Aciliyet hissi yarat
   - 2-3 emoji kullan (🔥 💰 ⭐ ✨ 🎁 🛒)
   
   YASAK: 
   - "Bu ürün için özel indirim" gibi genel cümleler KULLANMA
   - Her üründe aynı açıklamayı yazma
   - Kopyala-yapıştır açıklamalar YASAK
   
   ÖRNEK İYİ AÇIKLAMA (Kulaklık için):
   "🎧 Bu kablosuz kulaklık, aktif gürültü engelleme teknolojisiyle müzik deneyiminizi üst seviyeye taşıyor! 40 saate varan pil ömrü sayesinde gün boyu kesintisiz kullanabilirsiniz. Ergonomik tasarımı uzun süreli kullanımda bile maksimum konfor sağlıyor. ${deal.price} TL'ye bu kalitede kulaklık bulmak gerçekten zor! 🔥 Stoklar sınırlı, fırsatı kaçırmayın!"
   
   ÖRNEK İYİ AÇIKLAMA (Çanta için):
   "👜 Şık tasarımı ve geniş iç hacmiyle günlük kullanım için ideal! Premium malzeme kalitesi sayesinde uzun ömürlü ve dayanıklı. Hem iş hem günlük hayat için mükemmel bir tercih. ${storeName} güvencesiyle ${deal.price} TL'ye kendinize harika bir hediye alın! ✨"

SADECE JSON DÖNDÜR (BAŞKA HİÇBİR ŞEY YAZMA):
{"title":"temizlenmiş türkçe başlık","category":"kategori","brand":"marka","description":"bu ürüne özel 60-90 kelimelik benzersiz açıklama"}`;

    const result = await callGeminiAPI(prompt);

    if (!result) {
        return getDefaultEnrichment(deal);
    }

    try {
        // JSON parse
        let jsonStr = result.trim();
        if (jsonStr.startsWith('```json')) jsonStr = jsonStr.slice(7);
        if (jsonStr.startsWith('```')) jsonStr = jsonStr.slice(3);
        if (jsonStr.endsWith('```')) jsonStr = jsonStr.slice(0, -3);
        jsonStr = jsonStr.trim();

        const parsed = JSON.parse(jsonStr);

        return {
            title: parsed.title || deal.title,
            category: parsed.category || 'Diğer',
            brand: parsed.brand || '',
            description: parsed.description || getDefaultDescription(deal)
        };
    } catch (e) {
        console.log(`⚠️ JSON parse hatası: ${e.message}`);
        return getDefaultEnrichment(deal);
    }
}

function getDefaultEnrichment(deal) {
    return {
        title: deal.title.replace(/[🔥🏷️📦🛍️⭐💥🎁🛒📢✨💰]+/g, '').replace(/\s+/g, ' ').trim(),
        category: 'Diğer',
        brand: '',
        description: getDefaultDescription(deal)
    };
}

function getDefaultDescription(deal) {
    const storeName = deal.source === 'trendyol' ? 'Trendyol' :
        deal.source === 'hepsiburada' ? 'Hepsiburada' :
            deal.source === 'amazon' ? 'Amazon' :
                deal.source === 'n11' ? 'N11' : 'Online Mağaza';

    return `🔥 ${storeName}'da bu ürün için özel indirim fırsatı! Bu fiyat gerçekten kaçırılmayacak bir fırsat. Stoklar sınırlı olabilir, acele edin! ✨`;
}

// ===== TELEGRAM PARSE =====
function parseTelegramHtml(html) {
    const deals = [];
    const linkPattern = /href="(https?:\/\/onu\.al\/[^"]+)"/gi;
    const pricePattern = /(\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{2})?)\s*(?:TL|₺)/gi;

    const links = [...html.matchAll(linkPattern)];
    const uniqueLinks = [...new Set(links.map(m => m[1]))];

    let msgIndex = 0;
    for (const link of uniqueLinks) {
        // Linki içeren bloğu bul
        const linkIndex = html.indexOf(`href="${link}"`);
        if (linkIndex === -1) continue;

        const start = Math.max(0, linkIndex - 2000);
        const end = Math.min(html.length, linkIndex + 500);
        const block = html.substring(start, end);

        // Metin
        const textMatch = block.match(/tgme_widget_message_text[^>]*>([^<]+)/);
        let title = textMatch ? textMatch[1].trim() : 'İndirim Fırsatı';
        title = title.substring(0, 200);

        // Fiyat
        let price = 0;
        const priceMatch = block.match(pricePattern);
        if (priceMatch) {
            const priceStr = priceMatch[0].replace(/[^\d]/g, '');
            price = parseInt(priceStr) || 0;
            if (price > 100000) price = Math.round(price / 100);
        }

        // Görsel
        let imageUrl = '';
        const imgMatch = block.match(/background-image:url\('([^']+)'\)/);
        if (imgMatch) imageUrl = imgMatch[1];

        // Mağaza
        let source = 'other';
        const lowerBlock = block.toLowerCase();
        if (lowerBlock.includes('trendyol')) source = 'trendyol';
        else if (lowerBlock.includes('hepsiburada')) source = 'hepsiburada';
        else if (lowerBlock.includes('amazon')) source = 'amazon';
        else if (lowerBlock.includes('n11')) source = 'n11';

        deals.push({
            id: `auto_${Date.now()}_${msgIndex}`,
            title,
            price,
            source,
            onualLink: link,
            imageUrl
        });

        msgIndex++;
        if (msgIndex >= MAX_DEALS_PER_RUN) break;
    }

    console.log(`📦 ${deals.length} indirim parse edildi`);
    return deals;
}

// ===== MAIN =====
async function main() {
    console.log('🚀 INDIVA Auto-Fetch + Gemini AI başlatıldı');
    console.log(`⏰ ${new Date().toISOString()}`);

    const hasGemini = !!process.env.GEMINI_API_KEY;
    console.log(`🤖 Gemini AI: ${hasGemini ? 'AKTİF' : 'DEVRE DIŞI'}`);

    const db = initFirebase();

    try {
        console.log('\n📱 Telegram verisi çekiliyor...');
        const html = await fetchWithProxy(TELEGRAM_URL);

        if (!html || html.length < 1000) {
            console.log('❌ Telegram verisi alınamadı');
            return;
        }

        const deals = parseTelegramHtml(html);

        if (deals.length === 0) {
            console.log('❌ İndirim bulunamadı');
            return;
        }

        // Duplicate kontrolü
        const existingSnapshot = await db.collection('discounts')
            .orderBy('createdAt', 'desc').limit(200).select('link').get();
        const existingLinks = new Set();
        existingSnapshot.docs.forEach(doc => {
            const link = doc.data().link;
            if (link) existingLinks.add(link);
        });

        let savedCount = 0;
        let aiEnrichedCount = 0;
        let resolvedLinksCount = 0;

        for (const deal of deals) {
            if (existingLinks.has(deal.onualLink)) {
                console.log(`⏭️ Zaten var (onualLink): ${deal.title.substring(0, 30)}...`);
                continue;
            }

            // 1. Link çözümle (AI destekli)
            const productLink = await resolveOnuAlLinkWithAI(deal.onualLink);
            const wasResolved = isRealStoreLink(productLink);

            // ⚠️ ÖNEMLI: Eğer hala onu.al/onual.com linkiyse KAYDETME
            if (!wasResolved || productLink.includes('onu.al') || productLink.includes('onual.com')) {
                console.log(`⏭️ Link çözümlenemedi, atlanıyor: ${deal.title.substring(0, 30)}...`);
                console.log(`   Çözümlenen link: ${productLink.substring(0, 50)}...`);
                continue;
            }

            resolvedLinksCount++;

            if (existingLinks.has(productLink)) {
                console.log(`⏭️ Zaten var (productLink): ${deal.title.substring(0, 30)}...`);
                continue;
            }

            // 2. AI ile içerik zenginleştir
            console.log(`🤖 AI zenginleştirme: ${deal.title.substring(0, 40)}...`);
            const enriched = await enrichDealWithAI(deal);

            if (enriched.description !== getDefaultDescription(deal)) {
                aiEnrichedCount++;
            }

            // Mağaza adı
            const storeName = deal.source === 'trendyol' ? 'Trendyol' :
                deal.source === 'hepsiburada' ? 'Hepsiburada' :
                    deal.source === 'amazon' ? 'Amazon' :
                        deal.source === 'n11' ? 'N11' : 'Mağaza';

            // 3. Firebase'e kaydet
            await db.collection('discounts').add({
                title: enriched.title,
                description: enriched.description,
                brand: enriched.brand,
                category: enriched.category,
                link: productLink,
                originalStoreLink: productLink,
                newPrice: deal.price || 0,
                oldPrice: 0,
                imageUrl: deal.imageUrl || '',
                storeName,
                createdAt: admin.firestore.FieldValue.serverTimestamp(),
                originalSource: 'AutoPublish',
                submittedBy: 'AutoPublish',
                needsReview: !wasResolved,
                affiliateLinkUpdated: wasResolved,
                aiEnriched: aiEnrichedCount > 0
            });

            existingLinks.add(productLink);
            savedCount++;

            const status = wasResolved ? '✓Link' : '⚠️Link';
            const aiStatus = enriched.description !== getDefaultDescription(deal) ? '✓AI' : '⚠️AI';
            console.log(`✅ Kaydedildi: ${enriched.title.substring(0, 40)}... [${status}] [${aiStatus}]`);

            // Rate limiting - API quota koruma (Gemini free tier: 15 RPM)
            await new Promise(r => setTimeout(r, GEMINI_DELAY_MS));
        }

        console.log(`\n🎉 SONUÇ:`);
        console.log(`   📦 ${savedCount} yeni indirim kaydedildi`);
        console.log(`   🔗 ${resolvedLinksCount} link çözümlendi`);
        console.log(`   🤖 ${aiEnrichedCount} AI ile zenginleştirildi`);

    } catch (error) {
        console.error('❌ Hata:', error);
        process.exit(1);
    }
}

main();
