/**
 * INDIVA Auto-Fetch Script (Simplified)
 * 
 * Telegram @onual_firsat kanalından indirimleri çeker ve Firebase'e kaydeder.
 */

const admin = require('firebase-admin');

// ===== CONFIGURATION =====
const TELEGRAM_URL = 'https://t.me/s/onual_firsat';
const MAX_DEALS_PER_RUN = 15;

// CORS Proxy'ler (cache busting ile)
const CORS_PROXIES = [
    (url) => `https://api.allorigins.win/get?url=${encodeURIComponent(url)}&_t=${Date.now()}`,
    (url) => `https://corsproxy.io/?${encodeURIComponent(url + (url.includes('?') ? '&' : '?') + '_t=' + Date.now())}`,
];

// ===== FIREBASE SETUP =====
function initFirebase() {
    if (admin.apps.length === 0) {
        const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || '{}');
        admin.initializeApp({
            credential: admin.credential.cert(serviceAccount)
        });
    }
    return admin.firestore();
}

// ===== FETCH HELPERS =====
async function fetchWithTimeout(url, timeout = 20000) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);
    try {
        const response = await fetch(url, {
            signal: controller.signal,
            headers: {
                'Accept': 'application/json, text/html, */*',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/121.0.0.0'
            }
        });
        return response;
    } finally {
        clearTimeout(timeoutId);
    }
}

async function fetchWithProxy(targetUrl) {
    for (const proxyFn of CORS_PROXIES) {
        try {
            const proxyUrl = proxyFn(targetUrl);
            console.log(`🔄 Proxy deneniyor...`);
            const response = await fetchWithTimeout(proxyUrl, 15000);
            if (!response.ok) continue;
            const contentType = response.headers.get('content-type') || '';
            let html = '';
            if (contentType.includes('application/json')) {
                const json = await response.json();
                html = json.contents || json.body || '';
            } else {
                html = await response.text();
            }
            if (html && html.length > 500) {
                console.log(`✅ Proxy başarılı: ${html.length} karakter`);
                return html;
            }
        } catch (e) {
            console.log(`⚠️ Proxy hatası: ${e.message}`);
        }
    }
    throw new Error('Tüm proxy\'ler başarısız');
}

// ===== HTML PARSING =====
function decodeHtmlEntities(text) {
    if (!text) return '';
    return text
        .replace(/&#(\d+);/g, (_, num) => String.fromCharCode(parseInt(num, 10)))
        .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
        .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&nbsp;/g, ' ');
}

function parseTelegramHtml(html) {
    const deals = [];
    const priceRegex = /(\d[\d.,]*)\s*TL/i;
    const allLinks = html.matchAll(/href="(https?:\/\/onu\.al\/[^"]+)"/g);
    const linkSet = new Set();
    for (const m of allLinks) linkSet.add(m[1]);
    console.log(`🔗 ${linkSet.size} benzersiz onu.al linki bulundu`);

    let msgIndex = 0;
    for (const link of linkSet) {
        const linkIndex = html.indexOf(`href="${link}"`);
        if (linkIndex === -1) continue;
        const start = Math.max(0, linkIndex - 3000);
        const end = Math.min(html.length, linkIndex + 500);
        const msgBlock = html.substring(start, end);

        const textMatch = msgBlock.match(/tgme_widget_message_text[^>]*>([\s\S]*?)<\/div>/);
        const rawText = textMatch ? textMatch[1] : '';
        const text = decodeHtmlEntities(rawText.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());

        const priceMatch = text.match(priceRegex);
        const price = priceMatch ? parseInt(priceMatch[1].replace(/[.,]/g, ''), 10) : 0;

        let imageUrl;
        const photoMatch = msgBlock.match(/background-image:\s*url\(['"]?(https?:\/\/[^'")\s]+)['"]?\)/i);
        if (photoMatch) imageUrl = photoMatch[1];

        const lines = text.split(/[.\n]/).filter(l => l.trim().length > 3);
        let title = lines[0]?.replace(/^[🔥🏷️📦🛍️⭐💥🎁🛒📢✨💰]+\s*/, '').trim() || '';
        if (!title || title.length < 5) continue;
        if (title.length > 150) title = title.substring(0, 147) + '...';

        let source = 'other';
        const textLower = text.toLowerCase();
        if (textLower.includes('amazon')) source = 'amazon';
        else if (textLower.includes('trendyol')) source = 'trendyol';
        else if (textLower.includes('hepsiburada')) source = 'hepsiburada';
        else if (textLower.includes('n11')) source = 'n11';

        deals.push({ id: `auto_${Date.now()}_${msgIndex++}`, title, price, source, onualLink: link, imageUrl });
    }
    console.log(`📦 ${deals.length} indirim parse edildi`);
    return deals.slice(0, MAX_DEALS_PER_RUN);
}

// ===== LINK RESOLVER (HTML PARSING) =====
async function resolveOnuAlLink(shortLink) {
    if (!shortLink || !shortLink.includes('onu.al')) return shortLink;
    console.log(`🔗 Link çözümleniyor: ${shortLink}`);

    try {
        // onu.al sayfasını proxy ile çek
        const proxyUrl = `https://api.allorigins.win/get?url=${encodeURIComponent(shortLink)}&_t=${Date.now()}`;
        const response = await fetchWithTimeout(proxyUrl, 20000);

        if (!response.ok) {
            console.log(`⚠️ Proxy yanıt vermedi`);
            return shortLink;
        }

        const json = await response.json();
        const html = json.contents || '';

        if (html.length < 100) {
            console.log(`⚠️ HTML içeriği çok kısa`);
            return shortLink;
        }

        // zxro.com/u/?...url=... linkini bul
        const zxroMatch = html.match(/href=['"]?(https?:\/\/zxro\.com\/u\/\?[^'">\s]+)/i);
        if (zxroMatch && zxroMatch[1]) {
            try {
                // HTML entities decode et
                const zxroLink = zxroMatch[1].replace(/&amp;/g, '&');
                const zxroUrl = new URL(zxroLink);
                const encodedUrl = zxroUrl.searchParams.get('url');

                if (encodedUrl) {
                    const decodedUrl = decodeURIComponent(encodedUrl);
                    console.log(`✅ Gerçek mağaza linki: ${decodedUrl.substring(0, 70)}...`);
                    return decodedUrl;
                }
            } catch (e) {
                console.log(`⚠️ URL parse hatası: ${e.message}`);
            }
        }

        // Alternatif: Direkt mağaza linkleri ara
        const storePatterns = [
            /href=['"]?(https?:\/\/ty\.gl\/[A-Za-z0-9]+)/i,
            /href=['"]?(https?:\/\/(?:www\.)?trendyol\.com\/[^'">\s]+)/i,
            /href=['"]?(https?:\/\/(?:www\.)?n11\.com\/[^'">\s]+)/i,
            /href=['"]?(https?:\/\/(?:www\.)?hepsiburada\.com\/[^'">\s]+)/i,
            /href=['"]?(https?:\/\/(?:www\.)?amazon\.com\.tr\/[^'">\s]+)/i,
        ];

        for (const pattern of storePatterns) {
            const match = html.match(pattern);
            if (match && match[1]) {
                console.log(`✅ Mağaza linki bulundu: ${match[1].substring(0, 60)}...`);
                return match[1];
            }
        }

        console.log(`⚠️ zxro.com linki bulunamadı`);
    } catch (error) {
        console.log(`⚠️ Link hatası: ${error.message}`);
    }

    console.log(`⚠️ Çözümlenemedi, orijinal kullanılıyor`);
    return shortLink;
}

// ===== MAIN =====
async function main() {
    console.log('🚀 INDIVA Auto-Fetch başlatıldı');
    console.log(`⏰ ${new Date().toISOString()}`);

    const db = initFirebase();

    try {
        console.log('\n📱 Telegram verisi çekiliyor...');
        const html = await fetchWithProxy(TELEGRAM_URL);
        const deals = parseTelegramHtml(html);

        if (deals.length === 0) {
            console.log('❌ İndirim bulunamadı');
            return;
        }

        // Duplicate kontrolü
        const existingSnapshot = await db.collection('discounts')
            .orderBy('createdAt', 'desc').limit(100).select('link').get();
        const existingLinks = new Set();
        existingSnapshot.docs.forEach(doc => {
            const link = doc.data().link;
            if (link) existingLinks.add(link);
        });

        let savedCount = 0;
        for (const deal of deals) {
            if (existingLinks.has(deal.onualLink)) {
                console.log(`⏭️ Zaten var: ${deal.title.substring(0, 30)}...`);
                continue;
            }

            // Link çözümle
            let productLink = await resolveOnuAlLink(deal.onualLink);

            if (existingLinks.has(productLink)) {
                console.log(`⏭️ Zaten var: ${deal.title.substring(0, 30)}...`);
                continue;
            }

            const cleanTitle = deal.title
                .replace(/[🔥🏷️📦🛍️⭐💥🎁🛒📢✨💰]+/g, '')
                .replace(/\b(FIRSAT|SÜPER|KAÇIRMA)\b/gi, '')
                .replace(/\s+/g, ' ').trim();

            await db.collection('discounts').add({
                title: cleanTitle,
                description: 'Bu ürün için özel indirim fırsatı!',
                brand: '', category: 'Diğer',
                link: productLink,
                oldPrice: 0, newPrice: deal.price || 0,
                imageUrl: deal.imageUrl || '',
                submittedBy: 'AutoPublish',
                originalSource: 'AutoPublish',
                affiliateLinkUpdated: false,
                needsReview: !deal.imageUrl,
                createdAt: admin.firestore.FieldValue.serverTimestamp()
            });

            existingLinks.add(deal.onualLink);
            existingLinks.add(productLink);
            savedCount++;
            console.log(`✅ Kaydedildi: ${cleanTitle.substring(0, 40)}...`);
            await new Promise(r => setTimeout(r, 500));
        }

        console.log(`\n🎉 ${savedCount} yeni indirim kaydedildi.`);
    } catch (error) {
        console.error('❌ Hata:', error.message);
        process.exit(1);
    }
}

main();
