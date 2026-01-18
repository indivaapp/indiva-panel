/**
 * INDIVA Auto-Fetch Script with Puppeteer
 * 
 * Telegram @onual_firsat kanalından indirimleri çeker,
 * onu.al linklerini Puppeteer ile gerçek mağaza linklerine çözümler
 * ve Firebase'e kaydeder.
 */

const admin = require('firebase-admin');
const puppeteer = require('puppeteer');

// ===== CONFIGURATION =====
const TELEGRAM_URL = 'https://t.me/s/onual_firsat';
const MAX_DEALS_PER_RUN = 10;
const LINK_RESOLVE_TIMEOUT = 20000; // 20 saniye

// CORS Proxy'ler (Telegram için)
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

// ===== PUPPETEER LINK RESOLVER =====
let browser = null;

async function initBrowser() {
    if (!browser) {
        console.log('🚀 Puppeteer başlatılıyor...');
        browser = await puppeteer.launch({
            headless: 'new',
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-accelerated-2d-canvas',
                '--no-first-run',
                '--no-zygote',
                '--disable-gpu'
            ]
        });
        console.log('✅ Puppeteer hazır');
    }
    return browser;
}

async function closeBrowser() {
    if (browser) {
        await browser.close();
        browser = null;
        console.log('🛑 Puppeteer kapatıldı');
    }
}

async function resolveOnuAlLink(shortLink) {
    if (!shortLink || !shortLink.includes('onu.al')) return shortLink;
    console.log(`🔗 Link çözümleniyor: ${shortLink}`);

    try {
        const browserInstance = await initBrowser();
        const page = await browserInstance.newPage();

        // Gereksiz kaynakları engelle (hızlandırma)
        await page.setRequestInterception(true);
        page.on('request', (req) => {
            const resourceType = req.resourceType();
            if (['image', 'stylesheet', 'font', 'media'].includes(resourceType)) {
                req.abort();
            } else {
                req.continue();
            }
        });

        // User agent ayarla
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36');

        // Sayfaya git
        await page.goto(shortLink, {
            waitUntil: 'networkidle2',
            timeout: LINK_RESOLVE_TIMEOUT
        });

        // Biraz bekle (JS'nin çalışması için)
        await new Promise(r => setTimeout(r, 2000));

        // #buton elementinden href al
        let rawLink = null;
        try {
            rawLink = await page.$eval('#buton', el => el.href);
            console.log(`✅ #buton linki bulundu: ${rawLink}`);
        } catch (e) {
            console.log(`⚠️ #buton bulunamadı, alternatif yöntemler deneniyor...`);
        }

        // Alternatif: data-url veya onclick içinden
        if (!rawLink) {
            try {
                rawLink = await page.$eval('[data-url]', el => el.getAttribute('data-url'));
                console.log(`✅ data-url linki: ${rawLink}`);
            } catch (e) { }
        }

        // Alternatif: Sayfa içindeki zxro.com veya mağaza linklerini tara
        if (!rawLink) {
            const allLinks = await page.$$eval('a[href]', links =>
                links.map(a => a.href).filter(href =>
                    href.includes('zxro.com') ||
                    href.includes('trendyol.com') ||
                    href.includes('hepsiburada.com') ||
                    href.includes('amazon.com.tr') ||
                    href.includes('n11.com') ||
                    href.includes('ty.gl') ||
                    href.includes('app.hb.biz')
                )
            );
            if (allLinks.length > 0) {
                rawLink = allLinks[0];
                console.log(`✅ Sayfa içi link: ${rawLink}`);
            }
        }

        // Alternatif: Mevcut URL'i kontrol et (redirect olmuştur)
        if (!rawLink) {
            const currentUrl = page.url();
            if (!currentUrl.includes('onu.al') && !currentUrl.includes('onual.com')) {
                rawLink = currentUrl;
                console.log(`✅ Redirect URL: ${rawLink}`);
            }
        }

        await page.close();

        // Link bulunduysa, hemen extractFinalUrl ile gerçek mağaza linkini çıkar
        if (rawLink) {
            const storeLink = extractFinalUrl(rawLink);
            if (isRealStoreLink(storeLink)) {
                console.log(`✅ Gerçek mağaza linki: ${storeLink}`);
                return storeLink;
            }
            // extractFinalUrl işe yaramadı, ara link olarak takip et
            if (isIntermediateRedirect(rawLink)) {
                console.log(`🔄 Ara link tespit edildi, takip ediliyor: ${rawLink}`);
                const finalLink = await followRedirectChain(rawLink);
                if (finalLink && isRealStoreLink(finalLink)) {
                    console.log(`✅ Gerçek mağaza linki (redirect sonrası): ${finalLink}`);
                    return finalLink;
                }
            }
            // En azından bulunan linki döndür
            if (!rawLink.includes('onu.al') && !rawLink.includes('onual.com')) {
                return rawLink;
            }
        }

        // Son çare: orijinal link
        console.log(`⚠️ Gerçek link bulunamadı, orijinal kullanılıyor`);
        return shortLink;

    } catch (error) {
        console.log(`❌ Puppeteer hatası: ${error.message}`);
        return shortLink;
    }
}

// Ara redirect linklerini tespit et
function isIntermediateRedirect(url) {
    if (!url) return false;
    const intermediates = ['zxro.com', 'bit.ly', 'tinyurl.com', 'ow.ly', 'goo.gl'];
    return intermediates.some(domain => url.includes(domain));
}

// Gerçek mağaza linki mi kontrol et
function isRealStoreLink(url) {
    if (!url) return false;
    const stores = [
        'trendyol.com', 'hepsiburada.com', 'amazon.com.tr', 'n11.com',
        'ty.gl', 'app.hb.biz', 'amzn.to', 'gittigidiyor.com', 'sl.n11.com'
    ];
    return stores.some(store => url.includes(store));
}

// ===== ÇALIŞAN KOD: zxro.com/u/?url= formatından gerçek linki çıkar =====
function extractFinalUrl(url) {
    if (!url) return url;

    try {
        // zxro.com/u/?redirect=1&url=ENCODED_URL formatı
        if (url.includes('zxro.com')) {
            const urlObj = new URL(url);
            const encodedUrl = urlObj.searchParams.get('url');
            if (encodedUrl) {
                const decoded = decodeURIComponent(encodedUrl);
                console.log(`🔓 zxro.com URL decode edildi: ${decoded.substring(0, 50)}...`);
                return decoded;
            }
        }

        // Genel redirect pattern: ?url= veya ?redirect_url=
        if (url.includes('url=')) {
            const match = url.match(/[?&](?:url|redirect_url|goto)=([^&]+)/i);
            if (match) {
                const decoded = decodeURIComponent(match[1]);
                if (isRealStoreLink(decoded)) {
                    console.log(`🔓 URL parametresinden decode edildi: ${decoded.substring(0, 50)}...`);
                    return decoded;
                }
            }
        }
    } catch (e) {
        console.log(`⚠️ URL decode hatası: ${e.message}`);
    }

    return url;
}

// Redirect zincirini takip et veya URL parametresinden parse et
async function followRedirectChain(url) {
    console.log(`🔗 Redirect zinciri çözümleniyor: ${url}`);

    // HIZLI YOL: zxro.com/u/?...url=... formatını direkt parse et
    if (url.includes('zxro.com/u/') && url.includes('url=')) {
        try {
            const urlObj = new URL(url);
            let encodedStoreUrl = urlObj.searchParams.get('url');
            if (encodedStoreUrl) {
                const decodedUrl = decodeURIComponent(encodedStoreUrl);
                console.log(`✅ URL parametresinden parse edildi: ${decodedUrl}`);
                return decodedUrl;
            }
        } catch (e) {
            console.log(`⚠️ URL parse hatası: ${e.message}`);
        }
    }

    // YAVAŞ YOL: zxro.com kısa linkini (#buton içinden) Puppeteer ile takip et
    try {
        const browserInstance = await initBrowser();
        const page = await browserInstance.newPage();

        // Request interception
        let finalUrl = url;

        await page.setRequestInterception(true);
        page.on('request', (req) => {
            const resourceType = req.resourceType();
            if (['image', 'stylesheet', 'font', 'media'].includes(resourceType)) {
                req.abort();
            } else {
                req.continue();
            }
        });

        // Response'ları izle - gerçek mağaza linkini yakala
        page.on('response', (response) => {
            const responseUrl = response.url();
            if (isRealStoreLink(responseUrl)) {
                finalUrl = responseUrl;
            }
        });

        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36');

        await page.goto(url, {
            waitUntil: 'networkidle2',
            timeout: LINK_RESOLVE_TIMEOUT
        });

        // Sayfa yüklendikten sonra URL'i kontrol et (belki yönlendi)
        const pageUrl = page.url();
        if (isRealStoreLink(pageUrl)) {
            finalUrl = pageUrl;
        }

        // Eğer onual.com'a yönlendiyse, #buton'dan URL al
        if (pageUrl.includes('onual.com/fiyat/')) {
            console.log(`🔄 onual.com sayfasına yönlenildi, #buton aranıyor...`);
            try {
                const butonHref = await page.$eval('#buton', el => el.href);
                if (butonHref && butonHref.includes('url=')) {
                    // zxro.com/u/?...url=... formatından URL parse et
                    const butonUrl = new URL(butonHref);
                    const encodedStoreUrl = butonUrl.searchParams.get('url');
                    if (encodedStoreUrl) {
                        finalUrl = decodeURIComponent(encodedStoreUrl);
                        console.log(`✅ #buton'dan URL parse edildi: ${finalUrl}`);
                    }
                } else if (isRealStoreLink(butonHref)) {
                    finalUrl = butonHref;
                }
            } catch (e) {
                console.log(`⚠️ #buton bulunamadı: ${e.message}`);
            }
        }

        await page.close();

        console.log(`✅ Final URL: ${finalUrl}`);
        return finalUrl;

    } catch (error) {
        console.log(`⚠️ Redirect takip hatası: ${error.message}`);
        return url;
    }
}

// ===== MAIN =====
async function main() {
    console.log('🚀 INDIVA Auto-Fetch başlatıldı (Puppeteer ile)');
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
        let resolvedLinksCount = 0;

        for (const deal of deals) {
            if (existingLinks.has(deal.onualLink)) {
                console.log(`⏭️ Zaten var: ${deal.title.substring(0, 30)}...`);
                continue;
            }

            // Puppeteer ile link çözümle
            let productLink = await resolveOnuAlLink(deal.onualLink);

            // Çözümleme başarılı mı kontrol et - SADECE gerçek mağaza linkleri
            const wasResolved = isRealStoreLink(productLink);
            if (wasResolved) {
                resolvedLinksCount++;
            }

            if (existingLinks.has(productLink)) {
                console.log(`⏭️ Zaten var: ${deal.title.substring(0, 30)}...`);
                continue;
            }

            const cleanTitle = deal.title
                .replace(/[🔥🏷️📦🛍️⭐💥🎁🛒📢✨💰]+/g, '')
                .replace(/\b(FIRSAT|SÜPER|KAÇIRMA)\b/gi, '')
                .replace(/\s+/g, ' ').trim();

            // Mağaza adını belirle
            const storeName = deal.source === 'trendyol' ? 'Trendyol' :
                deal.source === 'hepsiburada' ? 'Hepsiburada' :
                    deal.source === 'amazon' ? 'Amazon' :
                        deal.source === 'n11' ? 'N11' : 'Mağaza';

            await db.collection('discounts').add({
                title: cleanTitle,
                description: `🔥 ${storeName}'da bu ürün için özel indirim fırsatı! Stoklar sınırlı.`,
                brand: '',
                category: 'Diğer',
                link: productLink,
                originalStoreLink: productLink,
                oldPrice: 0,
                newPrice: deal.price || 0,
                imageUrl: deal.imageUrl || '',
                submittedBy: 'AutoPublish',
                originalSource: 'AutoPublish',
                storeName,
                affiliateLinkUpdated: wasResolved, // Çözümlendiyse true
                needsReview: !wasResolved, // Çözümlenemzse review gerekir
                createdAt: admin.firestore.FieldValue.serverTimestamp()
            });

            existingLinks.add(deal.onualLink);
            existingLinks.add(productLink);
            savedCount++;
            console.log(`✅ Kaydedildi: ${cleanTitle.substring(0, 40)}... [Link: ${wasResolved ? 'Çözümlendi' : 'Orijinal'}]`);

            // Rate limiting - Puppeteer yormasın diye bekle
            await new Promise(r => setTimeout(r, 1000));
        }

        // Browser'ı kapat
        await closeBrowser();

        console.log(`\n🎉 SONUÇ:`);
        console.log(`   📦 ${savedCount} yeni indirim kaydedildi`);
        console.log(`   🔗 ${resolvedLinksCount} link başarıyla çözümlendi`);
        console.log(`   ⚠️ ${savedCount - resolvedLinksCount} link çözümlenemedi (manuel güncelleme gerekebilir)`);

    } catch (error) {
        console.error('❌ Hata:', error.message);
        await closeBrowser();
        process.exit(1);
    }
}

main();

