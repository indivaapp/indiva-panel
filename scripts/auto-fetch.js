// ===== INDIVA AUTO-FETCH =====
// GitHub Actions'da çalışan basit script
// dealFinder.ts'den kopyalanan çalışan link çözümleme mantığı

const admin = require('firebase-admin');

// ===== CONFIG =====
const TELEGRAM_URL = 'https://t.me/s/onual_firsat';
const MAX_DEALS_PER_RUN = 15;
const LINK_RESOLVE_TIMEOUT = 15000;

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

// ===== CORS PROXY İLE FETCH =====
async function fetchWithProxy(targetUrl) {
    // allorigins.win proxy - dealFinder.ts'de çalışıyor
    const proxyUrl = `https://api.allorigins.win/get?url=${encodeURIComponent(targetUrl)}&_t=${Date.now()}`;

    try {
        const response = await fetchWithTimeout(proxyUrl);
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        const json = await response.json();
        return json.contents || '';
    } catch (error) {
        console.log(`⚠️ Proxy hatası: ${error.message}`);
        return '';
    }
}

// ===== TELEGRAM PARSE =====
function parseTelegramHtml(html) {
    const deals = [];

    // Mesaj bloklarını bul
    const messagePattern = /<div class="tgme_widget_message[^"]*"[^>]*data-post="[^"]*\/(\d+)"[^>]*>([\s\S]*?)<\/div>\s*<\/div>\s*<\/div>/gi;

    // Alternatif: Daha basit pattern
    const linkPattern = /href="(https?:\/\/onu\.al\/[^"]+)"/gi;
    const pricePattern = /(\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{2})?)\s*(?:TL|₺)/gi;
    const titlePattern = /<div class="tgme_widget_message_text[^"]*">([^<]+)/gi;
    const imagePattern = /background-image:url\('([^']+)'\)/gi;

    // Tüm onu.al linklerini bul
    const links = [...html.matchAll(linkPattern)];
    const prices = [...html.matchAll(pricePattern)];
    const titles = [...html.matchAll(titlePattern)];
    const images = [...html.matchAll(imagePattern)];

    let msgIndex = 0;
    for (const linkMatch of links) {
        const link = linkMatch[1];

        // Fiyat bul
        let price = 0;
        if (prices[msgIndex]) {
            const priceStr = prices[msgIndex][1].replace(/[.,]/g, '').replace(',', '.');
            price = parseFloat(priceStr) || 0;
            if (price > 10000) price = price / 100; // TL kuruş düzeltme
        }

        // Başlık
        let title = 'İndirim Fırsatı';
        if (titles[msgIndex]) {
            title = titles[msgIndex][1].trim().substring(0, 200);
        }

        // Görsel
        let imageUrl = '';
        if (images[msgIndex]) {
            imageUrl = images[msgIndex][1];
        }

        // Mağaza tespiti
        let source = 'other';
        const lowerText = html.toLowerCase();
        if (lowerText.includes('trendyol')) source = 'trendyol';
        else if (lowerText.includes('hepsiburada')) source = 'hepsiburada';
        else if (lowerText.includes('amazon')) source = 'amazon';
        else if (lowerText.includes('n11')) source = 'n11';

        deals.push({
            id: `auto_${Date.now()}_${msgIndex}`,
            title,
            price,
            source,
            onualLink: link,
            imageUrl
        });

        msgIndex++;
    }

    console.log(`📦 ${deals.length} indirim parse edildi`);
    return deals.slice(0, MAX_DEALS_PER_RUN);
}

// ===== ÇALIŞAN LINK ÇÖZÜMLEME (dealFinder.ts'den kopyalandı) =====

// zxro.com/u/?url= formatından gerçek linki çıkar
function extractFinalUrl(url) {
    if (!url) return url;

    try {
        // zxro.com/u/?redirect=1&url=ENCODED_URL formatı
        if (url.includes('zxro.com')) {
            const urlObj = new URL(url);
            const encodedUrl = urlObj.searchParams.get('url');
            if (encodedUrl) {
                const decoded = decodeURIComponent(encodedUrl);
                console.log(`🔓 zxro.com decode: ${decoded.substring(0, 60)}...`);
                return decoded;
            }
        }

        // Genel ?url= pattern
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

// URL'in gerçek mağaza linki olup olmadığını kontrol et
function isProductUrl(url) {
    if (!url || url.length < 10) return false;

    const productDomains = ['amazon', 'trendyol', 'hepsiburada', 'n11.com', 'hb.biz', 'ty.gl', 'sl.n11'];
    const redirectServices = ['zxro.com'];

    const lowerUrl = url.toLowerCase();

    // Direkt ürün linki mi?
    if (productDomains.some(domain => lowerUrl.includes(domain))) {
        return true;
    }

    // Redirect servisi mi? (içinde gerçek ürün linki var mı kontrol et)
    if (redirectServices.some(service => lowerUrl.includes(service))) {
        const finalUrl = extractFinalUrl(url);
        return productDomains.some(domain => finalUrl.toLowerCase().includes(domain));
    }

    return false;
}

// Gerçek mağaza linki mi
function isRealStoreLink(url) {
    if (!url) return false;
    const stores = [
        'trendyol.com', 'hepsiburada.com', 'amazon.com.tr', 'n11.com',
        'ty.gl', 'app.hb.biz', 'amzn.to', 'gittigidiyor.com', 'sl.n11.com'
    ];
    return stores.some(store => url.includes(store));
}

// ===== ANA LINK ÇÖZÜMLEME FONKSİYONU =====
async function resolveOnuAlLink(shortLink) {
    if (!shortLink || !shortLink.includes('onu.al')) {
        return shortLink;
    }

    console.log(`🔗 Link çözümleniyor: ${shortLink}`);

    try {
        // ADIM 1: onu.al kısa linkini fetch et (proxy ile)
        const html = await fetchWithProxy(shortLink);

        if (!html || html.length < 100) {
            console.log(`⚠️ HTML içeriği çok kısa veya boş`);
            return shortLink;
        }

        // ADIM 2: id="buton" elementinden href çıkar (EN GÜVENİLİR)
        const butonIdMatch = html.match(/id=["']buton["'][^>]*href=["']([^"']+)["']/i) ||
            html.match(/href=["']([^"']+)["'][^>]*id=["']buton["']/i);

        if (butonIdMatch) {
            const rawUrl = butonIdMatch[1];
            const storeUrl = extractFinalUrl(rawUrl);

            if (isRealStoreLink(storeUrl)) {
                console.log(`✅ #buton + extractFinalUrl: ${storeUrl.substring(0, 60)}...`);
                return storeUrl;
            }

            if (isRealStoreLink(rawUrl)) {
                console.log(`✅ #buton direkt: ${rawUrl.substring(0, 60)}...`);
                return rawUrl;
            }
        }

        // ADIM 3: class="btn" içeren mağaza linklerini ara
        const btnClassMatch = html.match(/class=["'][^"']*btn[^"']*["'][^>]*href=["']([^"']+)["']/gi);
        if (btnClassMatch) {
            for (const match of btnClassMatch) {
                const hrefMatch = match.match(/href=["']([^"']+)["']/i);
                if (hrefMatch && isProductUrl(hrefMatch[1])) {
                    const storeUrl = extractFinalUrl(hrefMatch[1]);
                    console.log(`✅ class="btn": ${storeUrl.substring(0, 60)}...`);
                    return storeUrl;
                }
            }
        }

        // ADIM 4: Bilinen mağaza domain'lerini içeren href
        const storePatterns = [
            /href=["'](https?:\/\/[^"']*(?:sl\.n11\.com|n11\.com\/urun)[^"']*)[" ']/gi,
            /href=["'](https?:\/\/[^"']*(?:ty\.gl|trendyol\.com\/[^"']*-p-)[^"']*)[" ']/gi,
            /href=["'](https?:\/\/[^"']*(?:app\.hb\.biz|hepsiburada\.com)[^"']*)[" ']/gi,
            /href=["'](https?:\/\/[^"']*amazon\.com\.tr[^"']*)[" ']/gi,
            /href=["'](https?:\/\/zxro\.com\/u\/\?[^"']+)["']/gi  // zxro.com/u/?url=... formatı
        ];

        for (const pattern of storePatterns) {
            const matches = [...html.matchAll(pattern)];
            for (const match of matches) {
                const rawUrl = match[1];
                // onu.al/onual.com linklerini atla
                if (rawUrl.includes('onu.al') || rawUrl.includes('onual.com')) continue;

                const storeUrl = extractFinalUrl(rawUrl);
                if (isRealStoreLink(storeUrl)) {
                    console.log(`✅ Pattern match: ${storeUrl.substring(0, 60)}...`);
                    return storeUrl;
                }
            }
        }

        // ADIM 5: Eğer onual.com/fiyat/ sayfasına yönlendiyse, onu da dene
        const onualLinkMatch = html.match(/href=["'](https?:\/\/onual\.com\/fiyat\/[^"']+)["']/i);
        if (onualLinkMatch) {
            console.log(`🔄 onual.com sayfası fetch ediliyor...`);
            const onualHtml = await fetchWithProxy(onualLinkMatch[1]);

            if (onualHtml && onualHtml.length > 100) {
                // Bu sayfadan #buton ara
                const butonMatch2 = onualHtml.match(/id=["']buton["'][^>]*href=["']([^"']+)["']/i) ||
                    onualHtml.match(/href=["']([^"']+)["'][^>]*id=["']buton["']/i);

                if (butonMatch2) {
                    const storeUrl = extractFinalUrl(butonMatch2[1]);
                    if (isRealStoreLink(storeUrl)) {
                        console.log(`✅ onual.com #buton: ${storeUrl.substring(0, 60)}...`);
                        return storeUrl;
                    }
                }
            }
        }

        console.log(`⚠️ Link çözümlenemedi, orijinal kullanılıyor`);
        return shortLink;

    } catch (error) {
        console.log(`❌ Link çözümleme hatası: ${error.message}`);
        return shortLink;
    }
}

// ===== MAIN =====
async function main() {
    console.log('🚀 INDIVA Auto-Fetch başlatıldı (HTTP + allorigins)');
    console.log(`⏰ ${new Date().toISOString()}`);

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

            // Link çözümle
            let productLink = await resolveOnuAlLink(deal.onualLink);

            // Çözümleme başarılı mı?
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

            // Mağaza adı
            const storeName = deal.source === 'trendyol' ? 'Trendyol' :
                deal.source === 'hepsiburada' ? 'Hepsiburada' :
                    deal.source === 'amazon' ? 'Amazon' :
                        deal.source === 'n11' ? 'N11' : 'Mağaza';

            await db.collection('discounts').add({
                title: cleanTitle,
                description: `🔥 ${storeName}'da bu ürün için özel indirim fırsatı! Stoklar sınırlı.`,
                brand: '',
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
                affiliateLinkUpdated: wasResolved
            });

            existingLinks.add(productLink);
            savedCount++;

            const status = wasResolved ? 'Çözümlendi' : 'Orijinal';
            console.log(`✅ Kaydedildi: ${cleanTitle.substring(0, 40)}... [${status}]`);

            // Rate limiting
            await new Promise(r => setTimeout(r, 1500));
        }

        console.log(`\n🎉 SONUÇ:`);
        console.log(`   📦 ${savedCount} yeni indirim kaydedildi`);
        console.log(`   🔗 ${resolvedLinksCount} link çözümlendi`);
        console.log(`   ⚠️ ${savedCount - resolvedLinksCount} link çözümlenemedi`);

    } catch (error) {
        console.error('❌ Hata:', error);
        process.exit(1);
    }
}

main();
