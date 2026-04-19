import type { VercelRequest, VercelResponse } from '@vercel/node';
import * as cheerio from 'cheerio';

// Types
interface ScrapedDeal {
    id: string;
    title: string;
    price: number;
    source: 'amazon' | 'trendyol' | 'hepsiburada' | 'n11' | 'other';
    onualLink: string;
    productLink?: string;
    couponCode?: string;
    imageUrl?: string;
}

interface DealDetails {
    productLink: string;
    imageUrl?: string;
    brand?: string;
}

// Common brands for extraction
const COMMON_BRANDS = [
    'Apple', 'Samsung', 'Xiaomi', 'Philips', 'Sony', 'LG', 'Bosch', 'Dyson',
    'Nike', 'Adidas', 'Puma', 'Reebok', 'New Balance', 'Skechers',
    'Loreal', 'Nivea', 'Dove', 'Garnier', 'Maybelline',
    'Nestle', 'Eti', 'Ülker', 'Torku', 'Pınar',
    'Lego', 'Mattel', 'Hasbro', 'Fisher-Price',
    'HP', 'Dell', 'Lenovo', 'Asus', 'Acer', 'MSI',
    'JBL', 'Bose', 'Sennheiser', 'Razer', 'Logitech',
    'Karaca', 'Emsan', 'Schafer', 'Korkmaz', 'Arzum'
];

// Extended User-Agent list for better rotation
const USER_AGENTS = [
    // Chrome on Windows
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
    // Chrome on Mac
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    // Firefox on Windows
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:122.0) Gecko/20100101 Firefox/122.0',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0',
    // Edge on Windows
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36 Edg/121.0.0.0',
    // Safari on Mac
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15',
    // Mobile browsers (for variety)
    'Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Mobile Safari/537.36',
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Mobile/15E148 Safari/604.1',
];

// Referrer sources to appear more natural
const REFERRERS = [
    'https://www.google.com/',
    'https://www.google.com.tr/',
    'https://www.google.com/search?q=indirim+firsatlari',
    'https://www.bing.com/',
    'https://yandex.com.tr/',
    '',  // Direct visit
];

/**
 * Random delay to simulate human behavior
 */
function randomDelay(min: number, max: number): Promise<void> {
    const delay = Math.floor(Math.random() * (max - min + 1)) + min;
    return new Promise(resolve => setTimeout(resolve, delay));
}

/**
 * Get random item from array
 */
function getRandomItem<T>(arr: T[]): T {
    return arr[Math.floor(Math.random() * arr.length)];
}

/**
 * Generate realistic browser headers
 */
function generateHeaders(): Record<string, string> {
    const userAgent = getRandomItem(USER_AGENTS);
    const isChrome = userAgent.includes('Chrome') && !userAgent.includes('Edg');
    const isFirefox = userAgent.includes('Firefox');
    const isSafari = userAgent.includes('Safari') && !userAgent.includes('Chrome');
    const isMobile = userAgent.includes('Mobile');

    const headers: Record<string, string> = {
        'User-Agent': userAgent,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
        'Accept-Language': 'tr-TR,tr;q=0.9,en-US;q=0.8,en;q=0.7',
        'Accept-Encoding': 'gzip, deflate, br',
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache',
        'Upgrade-Insecure-Requests': '1',
        'Referer': getRandomItem(REFERRERS),
    };

    // Add Chrome-specific headers
    if (isChrome) {
        headers['Sec-Ch-Ua'] = '"Not A(Brand";v="99", "Google Chrome";v="121", "Chromium";v="121"';
        headers['Sec-Ch-Ua-Mobile'] = isMobile ? '?1' : '?0';
        headers['Sec-Ch-Ua-Platform'] = isMobile ? '"Android"' : '"Windows"';
        headers['Sec-Fetch-Dest'] = 'document';
        headers['Sec-Fetch-Mode'] = 'navigate';
        headers['Sec-Fetch-Site'] = 'cross-site';
        headers['Sec-Fetch-User'] = '?1';
    }

    return headers;
}

/**
 * Extract brand from title
 */
function extractBrand(title: string): string {
    if (!title) return '';
    const words = title.split(/\s+/);

    for (const word of words.slice(0, 3)) {
        const cleanWord = word.replace(/[^a-zA-ZğüşıöçĞÜŞİÖÇ]/gi, '');
        const matchedBrand = COMMON_BRANDS.find(b =>
            b.toLowerCase() === cleanWord.toLowerCase()
        );
        if (matchedBrand) return matchedBrand;
    }

    const firstWord = words[0]?.replace(/[^a-zA-ZğüşıöçĞÜŞİÖÇ0-9]/gi, '') || '';
    return firstWord.length >= 2 ? firstWord : '';
}

/**
 * Clean title from emojis and extra whitespace
 */
function cleanTitle(title: string): string {
    return title
        .replace(/\s+/g, ' ')
        .replace(/🏷️.*$/g, '')
        .replace(/🤖/g, '')
        .replace(/🔻/g, '')
        // Trendyol/Hepsiburada sayfa başlığı suffix'leri
        .replace(/\s*[-–|]\s*(fiyatı|yorumları|fiyat|yorum|satın al|incele|özellikleri|fiyatları)[^-–|]*/gi, '')
        .replace(/\s*\(fiyatı,?\s*yorumları?\)/gi, '')
        .replace(/\s*-\s*fiyatı,?\s*yorumları?$/gi, '')
        .trim();
}

/**
 * Resolve short links to final URL
 */
async function resolveUrl(url: string): Promise<string> {
    if (!url.includes('ty.gl') && !url.includes('amzn.to') && !url.includes('hb.biz') && !url.includes('onu.al') && !url.includes('n11.gl') && !url.includes('pzrm.gl')) {
        return url;
    }

    console.log(`Resolving short link: ${url}`);
    try {
        const response = await fetch(url, {
            method: 'HEAD',
            redirect: 'follow',
            headers: generateHeaders()
        });
        console.log(`Resolved to: ${response.url}`);
        return response.url;
    } catch (e) {
        console.warn('Resolution failed, using original URL:', e);
        return url;
    }
}

/**
 * Fetch with timeout...
 */
async function fetchWithTimeout(url: string, timeout = 25000, retryCount = 0): Promise<string> {
    const maxRetries = 2;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    // Add random delay before request (1-3 seconds) to appear more human
    if (retryCount > 0) {
        await randomDelay(2000, 5000);
    } else {
        await randomDelay(500, 1500);
    }

    try {
        const response = await fetch(url, {
            signal: controller.signal,
            headers: generateHeaders(),
        });

        if (!response.ok) {
            // 403 için kısa bir retry (IP block ise retry faydası yok, hızlı fallback'e geç)
            if (response.status === 403 && retryCount < 1) {
                console.log(`Got 403, quick retry (${retryCount + 1}/1)...`);
                clearTimeout(timeoutId);
                await randomDelay(800, 1500);
                return fetchWithTimeout(url, timeout, retryCount + 1);
            }
            throw new Error(`HTTP ${response.status}`);
        }

        return await response.text();
    } catch (error: any) {
        // Retry on timeout or network errors
        if (retryCount < maxRetries && (error.name === 'AbortError' || error.message.includes('fetch'))) {
            console.log(`Request failed, retrying (attempt ${retryCount + 1}/${maxRetries})...`);
            clearTimeout(timeoutId);
            await randomDelay(2000, 5000);
            return fetchWithTimeout(url, timeout, retryCount + 1);
        }
        throw error;
    } finally {
        clearTimeout(timeoutId);
    }
}


/**
 * Parse OnuAl main page HTML
 */
function parseOnualHtml(html: string): ScrapedDeal[] {
    const $ = cheerio.load(html);
    const deals: ScrapedDeal[] = [];
    const seenIds = new Set<string>();

    // Find product cards - article.post
    $('article.post').each((_, card) => {
        const $card = $(card);

        // Title and link
        const titleLink = $card.find('h3.entry-title a, h3 a').first();
        const href = titleLink.attr('href') || '';
        const title = titleLink.text().trim();

        if (!title || title.length < 5) return;

        // Product ID from URL
        const idMatch = href.match(/-p-(\d+)/);
        if (!idMatch) return;

        const productId = idMatch[1];
        if (seenIds.has(productId)) return;
        seenIds.add(productId);

        // Price from h4
        let price = 0;
        const priceElement = $card.find('h4').first();
        if (priceElement.length) {
            const priceText = priceElement.text();
            const priceMatch = priceText.match(/(\d[\d.,]*)\s*TL/i);
            if (priceMatch) {
                price = parseInt(priceMatch[1].replace(/[.,]/g, ''), 10);
            }
        }

        // Fallback: price from URL hash
        if (price === 0) {
            const hashMatch = href.match(/fiyat=(\d+)/);
            if (hashMatch) {
                price = parseInt(hashMatch[1], 10);
            }
        }

        // Coupon code
        const couponMatch = href.match(/kupon=([^&]+)/);
        const couponCode = couponMatch ? decodeURIComponent(couponMatch[1]) : undefined;

        // Source site
        const sourceElement = $card.find('span.category a, .entry-meta a').first();
        const sourceText = (sourceElement.text() || $card.text()).toLowerCase();

        let source: ScrapedDeal['source'] = 'other';
        if (sourceText.includes('amazon')) source = 'amazon';
        else if (sourceText.includes('trendyol')) source = 'trendyol';
        else if (sourceText.includes('hepsiburada')) source = 'hepsiburada';
        else if (sourceText.includes('n11')) source = 'n11';

        // Image URL
        const img = $card.find('figure.post-thumbnail img, .post-thumbnail img, img').first();
        const imageUrl = img.attr('src') || img.attr('data-src') || undefined;

        // Full URL
        const fullLink = href.startsWith('http') ? href : `https://onual.com${href}`;

        deals.push({
            id: productId,
            title: cleanTitle(title),
            price,
            source,
            onualLink: fullLink.split('#')[0],
            couponCode,
            imageUrl,
        });
    });

    // Fallback method if no article.post found
    if (deals.length === 0) {
        $('a[href*="/fiyat/"][href*="-p-"]').each((_, link) => {
            const $link = $(link);
            const href = $link.attr('href') || '';
            const title = $link.text().trim();

            if (!title || title.length < 5) return;

            const idMatch = href.match(/-p-(\d+)/);
            if (!idMatch) return;

            const productId = idMatch[1];
            if (seenIds.has(productId)) return;
            seenIds.add(productId);

            const priceMatch = href.match(/fiyat=(\d+)/);
            const price = priceMatch ? parseInt(priceMatch[1], 10) : 0;

            const parent = $link.closest('article, div, section');
            const sourceText = parent.text().toLowerCase();

            let source: ScrapedDeal['source'] = 'other';
            if (sourceText.includes('amazon')) source = 'amazon';
            else if (sourceText.includes('trendyol')) source = 'trendyol';
            else if (sourceText.includes('hepsiburada')) source = 'hepsiburada';
            else if (sourceText.includes('n11')) source = 'n11';

            const img = parent.find('img').first();
            const imageUrl = img.attr('src') || img.attr('data-src') || undefined;

            const fullLink = href.startsWith('http') ? href : `https://onual.com${href}`;

            deals.push({
                id: productId,
                title: cleanTitle(title),
                price,
                source,
                onualLink: fullLink.split('#')[0],
                couponCode: undefined,
                imageUrl,
            });
        });
    }

    return deals;
}

/**
 * Parse OnuAl detail page for product info
 */
function parseDetailHtml(html: string): DealDetails {
    const $ = cheerio.load(html);

    // Find product link
    const productLinkEl = $('a[href*="trendyol.com"], a[href*="amazon.com.tr"], a[href*="hepsiburada.com"], a[href*="n11.com"]').first();
    const productLink = productLinkEl.attr('href') || '';

    // Find high-quality image
    const imgEl = $('img[src*="cdn"], img[src*="product"], img.product-image, article img, .product img').first();
    let imageUrl = imgEl.attr('src') || imgEl.attr('data-src') || undefined;

    if (imageUrl && !imageUrl.startsWith('http')) {
        imageUrl = `https://onual.com${imageUrl}`;
    }


    const pageTitle = $('h1').first().text().trim();
    const brand = extractBrand(pageTitle);

    return { productLink, imageUrl, brand };
}

/**
 * Parse Akakce brochure list page to get latest brochure links
 */
function parseAkakceBrochureList(html: string, marketName: string): string[] {
    const $ = cheerio.load(html);
    const brochureLinks: string[] = [];

    // Find brochure links on the market page
    $('a[href*="/brosurler/"][href*="aktuel"]').each((_, el) => {
        const href = $(el).attr('href');
        if (href && href.includes(marketName.toLowerCase())) {
            const fullUrl = href.startsWith('http') ? href : `https://www.akakce.com${href}`;
            if (!brochureLinks.includes(fullUrl)) {
                brochureLinks.push(fullUrl);
            }
        }
    });

    // Alternative: Find in the .bl (brochure list) container
    if (brochureLinks.length === 0) {
        $('.bl a, .brochure-list a, article a').each((_, el) => {
            const href = $(el).attr('href');
            if (href && href.includes('/brosurler/') && href.includes('aktuel')) {
                const fullUrl = href.startsWith('http') ? href : `https://www.akakce.com${href}`;
                if (!brochureLinks.includes(fullUrl)) {
                    brochureLinks.push(fullUrl);
                }
            }
        });
    }

    return brochureLinks.slice(0, 5); // Limit to latest 5
}

/**
 * Parse Akakce brochure detail page to get image URLs
 */
function parseAkakceBrochureImages(html: string): string[] {
    const $ = cheerio.load(html);
    const imageUrls: string[] = [];

    // Primary selector: .bpg .p img (high quality)
    $('.bpg .p img').each((_, el) => {
        const src = $(el).attr('src');
        if (src && src.includes('cdn.akakce.com')) {
            if (!imageUrls.includes(src)) {
                imageUrls.push(src);
            }
        }
    });

    // Fallback: Any img with akakce CDN
    if (imageUrls.length === 0) {
        $('img[src*="cdn.akakce.com/_bro"]').each((_, el) => {
            const src = $(el).attr('src');
            if (src && !imageUrls.includes(src)) {
                imageUrls.push(src);
            }
        });
    }

    return imageUrls;
}

/**
 * Akakce market URL mapping
 */
const AKAKCE_MARKETS: Record<string, string> = {
    'bim': 'https://www.akakce.com/brosurler/bim',
    'a101': 'https://www.akakce.com/brosurler/a101',
    'sok': 'https://www.akakce.com/brosurler/sok',
};

/**
 * Fiyat metnini parse eder: "447,36 TL", "1.299,00 ₺", 447 vb.
 */
function parsePriceText(val: any): number {
    if (!val && val !== 0) return 0;
    const str = String(val)
        .replace(/[TL₺\s]/gi, '')
        .replace(/\./g, '')
        .replace(',', '.');
    return parseFloat(str) || 0;
}

function parseAIPriceResponse(text: string): { newPrice: number; oldPrice: number } {
    try {
        const jsonMatch = text.match(/\{[^{}]*"newPrice"[^{}]*\}/s);
        if (!jsonMatch) return { newPrice: 0, oldPrice: 0 };
        const parsed = JSON.parse(jsonMatch[0]);
        return {
            newPrice: parsePriceText(parsed.newPrice),
            oldPrice: parsePriceText(parsed.oldPrice),
        };
    } catch {
        return { newPrice: 0, oldPrice: 0 };
    }
}

/**
 * OpenRouter minimax-m2.7 ile HTML içinden fiyat çıkarır.
 * Trendyol gibi sitelerde HTML'de fiyat yoksa 0 döner → fiyat modalı açılır.
 */
async function openrouterPriceFallback(html: string): Promise<{ newPrice: number; oldPrice: number }> {
    const apiKey = process.env.OPENROUTER_API_KEY || '';
    if (!apiKey || !html) return { newPrice: 0, oldPrice: 0 };

    // HTML'den fiyat içerebilecek bağlamı çıkar
    const $ = cheerio.load(html);
    $('style, script, nav, header, footer, aside, iframe, noscript').remove();

    // Önce JSON-LD içinde fiyat ara
    const jsonLdText = $('script[type="application/ld+json"]').map((_, el) => $(el).html()).get().join('\n');

    // Body metni — fiyat içeren kısmı bul
    const bodyText = $('body').text().replace(/\s+/g, ' ').trim();
    const priceIdx = bodyText.search(/[\d.,]+\s*(?:TL|₺)/i);
    const bodyContext = priceIdx >= 0
        ? bodyText.substring(Math.max(0, priceIdx - 150), priceIdx + 500)
        : bodyText.substring(0, 400);

    const context = (jsonLdText.substring(0, 800) + '\n' + bodyContext).trim();
    if (context.length < 20) return { newPrice: 0, oldPrice: 0 };

    try {
        const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                model: 'minimax/minimax-m2.7',
                messages: [{
                    role: 'user',
                    content: `Aşağıdaki içerikten ürünün güncel satış fiyatını (newPrice) ve üzeri çizili eski fiyatını (oldPrice) çıkar. Fiyat yoksa 0 yaz. SADECE JSON yaz, başka hiçbir şey yazma:\n{"newPrice":X,"oldPrice":Y}\n\n${context}`,
                }],
                max_tokens: 60,
                temperature: 0,
                include_reasoning: false,
            }),
        });

        if (!res.ok) return { newPrice: 0, oldPrice: 0 };

        const data = await res.json();
        const text = data.choices?.[0]?.message?.content || '';
        const result = parseAIPriceResponse(text);
        if (result.newPrice > 0) {
            console.log(`OpenRouter fiyat başarılı: newPrice=${result.newPrice}, oldPrice=${result.oldPrice}`);
        }
        return result;
    } catch (err) {
        console.warn('OpenRouter fiyat hatası:', err);
        return { newPrice: 0, oldPrice: 0 };
    }
}

/**
 * URL'den ürün adını çıkar (HB/N11/Amazon slug → temiz ürün adı)
 */
function extractProductNameFromUrl(productUrl: string): string {
    try {
        const pathParts = new URL(productUrl).pathname.split('/').filter(Boolean);
        const lastPart = pathParts[pathParts.length - 1] || '';
        let rawName = '';

        if (productUrl.includes('hepsiburada')) {
            rawName = lastPart.replace(/-pm-HB[A-Z0-9]+$/i, '');
        } else if (productUrl.includes('n11.com')) {
            rawName = lastPart
                .replace(/-p-\d+(\.\w+)?$/, '')   // eski format: -p-12345.html
                .replace(/-\d{5,}$/, '')            // yeni format: -1063941525
                .replace(/W\d+\.html$/, '')
                .replace(/\.html$/, '');
        } else if (productUrl.includes('amazon.com.tr')) {
            const dpIdx = pathParts.indexOf('dp');
            rawName = dpIdx > 0 ? pathParts[dpIdx - 1] : lastPart;
        }
        return rawName.replace(/-/g, ' ').trim();
    } catch { return ''; }
}

/**
 * Fiyat içeren HTML metninden TL fiyatlarını çıkarır
 */
function extractPricesFromHtml(html: string): number[] {
    const priceRegex = /([\d]{1,3}(?:[.,]\d{3})*(?:[.,]\d{1,2})?)\s*(?:TL|₺)/g;
    const prices: number[] = [];
    let m;
    while ((m = priceRegex.exec(html)) !== null) {
        const p = parsePriceText(m[1]);
        if (p > 50) prices.push(p);
    }
    return prices;
}

/**
 * Perplexity online model ile ürün fiyatı bul.
 * Perplexity kendi arama altyapısından HB/N11/Amazon sayfalarına erişir.
 */
async function searchPriceViaPerplexity(productUrl: string): Promise<{
    newPrice: number; title: string; brand: string;
}> {
    const empty = { newPrice: 0, title: '', brand: '' };
    const apiKey = process.env.OPENROUTER_API_KEY || '';
    if (!apiKey) return empty;

    try {
        console.log(`Perplexity online search: ${productUrl}`);
        // Ürün adını URL'den çıkar
        const productName = extractProductNameFromUrl(productUrl);
        const storeName = productUrl.includes('hepsiburada') ? 'Hepsiburada' :
                          productUrl.includes('n11') ? 'N11' : 'Amazon Türkiye';

        const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                model: 'perplexity/sonar',
                messages: [{
                    role: 'user',
                    content: `${storeName} sitesindeki "${productName}" ürününün güncel Türk lirası (TL) satış fiyatı nedir? Fiyatı bulduktan sonra YALNIZCA şu JSON formatında yaz, başka hiçbir şey ekleme:\n{"newPrice": FIYAT_RAKAM, "title": "URUN_ADI_METIN"}`,
                }],
                max_tokens: 150,
                temperature: 0,
            }),
            signal: AbortSignal.timeout(25000),
        });

        if (!res.ok) {
            console.warn(`Perplexity HTTP ${res.status}`);
            return empty;
        }

        const data = await res.json();
        const text = data.choices?.[0]?.message?.content || '';
        console.log(`Perplexity yanıtı: ${text.substring(0, 300)}`);

        // JSON parse dene
        const jsonMatch = text.match(/\{[^{}]*"newPrice"[^{}]*\}/s);
        if (jsonMatch) {
            try {
                const parsed = JSON.parse(jsonMatch[0]);
                const newPrice = parsePriceText(parsed.newPrice);
                if (newPrice > 0) {
                    const title = parsed.title || productName;
                    return { newPrice, title, brand: extractBrand(title) };
                }
            } catch { }
        }

        // JSON parse başarısız → metinden fiyat çıkar
        const priceRegex = /([\d]{1,3}(?:[.,]\d{3})*(?:[.,]\d{1,2})?)\s*(?:TL|₺)/g;
        const prices: number[] = [];
        let m;
        while ((m = priceRegex.exec(text)) !== null) {
            const p = parsePriceText(m[1]);
            if (p > 50) prices.push(p);
        }
        if (prices.length > 0) {
            prices.sort((a, b) => a - b);
            const newPrice = prices[Math.floor(prices.length / 2)] || prices[0];
            return { newPrice, title: productName, brand: extractBrand(productName) };
        }
        console.warn('Perplexity: JSON parse ve regex her ikisi de başarısız');
        return empty;
    } catch (e) {
        console.warn('Perplexity hatası:', e);
        return empty;
    }
}

async function searchImageViaBing(title: string): Promise<string> {
    try {
        const query = title.split(/\s+/).slice(0, 6).join(' ');
        const bingUrl = `https://www.bing.com/images/search?q=${encodeURIComponent(query)}&first=1&count=1&mkt=tr-TR`;
        const resp = await fetch(bingUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
                'Accept': 'text/html',
                'Accept-Language': 'tr-TR,tr;q=0.9',
            },
            signal: AbortSignal.timeout(10000),
        });
        if (!resp.ok) return '';
        const html = await resp.text();
        const $b = cheerio.load(html);
        const mAttr = $b('a.iusc').first().attr('m');
        if (mAttr) {
            const m = JSON.parse(mAttr);
            return m.murl || '';
        }
        return $b('meta[property="og:image"]').attr('content') || '';
    } catch {
        return '';
    }
}

/**
 * Engellenen mağazalar için Bing arama ile fiyat bul.
 * Bing, cloud/AI altyapısından erişilebilir (Copilot/ChatGPT da kullanır).
 * Arama sonuçlarında ürün fiyatı rich snippet olarak yer alır.
 */
async function searchPriceViaDDG(productUrl: string): Promise<{
    newPrice: number; title: string; imageUrl: string; brand: string;
}> {
    const empty = { newPrice: 0, title: '', imageUrl: '', brand: '' };
    try {
        const productName = extractProductNameFromUrl(productUrl);
        if (productName.length < 3) return empty;

        const storeName = productUrl.includes('hepsiburada') ? 'hepsiburada' :
                          productUrl.includes('n11') ? 'n11' : 'amazon';
        // İlk 4-5 kelimeyi al (URL slug'daki renk/özellik gibi gürültü sözcüklerini at)
        const shortName = productName.split(/\s+/).slice(0, 5).join(' ');
        const query = `${shortName} ${storeName} fiyat`;
        console.log(`Bing fiyat araması: "${query}"`);

        // Basit Bing URL - setlang/cc eklentileri bazen redirect'e yol açıyor
        const bingUrl = `https://www.bing.com/search?q=${encodeURIComponent(query)}&mkt=tr-TR`;
        let bingHtml = '';
        try {
            const controller = new AbortController();
            const tid = setTimeout(() => controller.abort(), 18000);
            const resp = await fetch(bingUrl, {
                signal: controller.signal,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                    'Accept-Language': 'tr-TR,tr;q=0.9,en;q=0.8',
                },
            });
            clearTimeout(tid);
            if (resp.ok) bingHtml = await resp.text();
            else console.warn(`Bing HTTP ${resp.status}`);
        } catch (fetchE) {
            console.warn('Bing fetch hatası:', fetchE);
        }

        if (bingHtml.length < 1000) {
            console.warn(`Bing HTML çok kısa: ${bingHtml.length} bytes, Perplexity deneniyor...`);
            const ppResult = await searchPriceViaPerplexity(productUrl);
            if (ppResult && ppResult.newPrice > 0) {
                return { newPrice: ppResult.newPrice, title: ppResult.title, imageUrl: '', brand: ppResult.brand };
            }
            return empty;
        }

        const prices = extractPricesFromHtml(bingHtml);
        if (prices.length === 0) {
            // Bing US sunucularından TL fiyatı gelmiyor; Perplexity ile dene
            console.log('Bing\'de TL fiyatı yok, Perplexity online arama deneniyor...');
            const ppResult = await searchPriceViaPerplexity(productUrl);
            if (ppResult.newPrice > 0) {
                console.log(`Perplexity fiyat: ${ppResult.newPrice}, başlık: ${ppResult.title.substring(0, 50)}`);
                return { newPrice: ppResult.newPrice, title: ppResult.title, imageUrl: '', brand: ppResult.brand };
            }
            return empty;
        }

        // Medyan fiyat (outlier'ları temizle)
        prices.sort((a, b) => a - b);
        const newPrice = prices[Math.floor(prices.length / 2)] || prices[0];

        // Başlık: mağazaya ait result başlığını bul
        const titleRe = new RegExp(`<h2[^>]*>\\s*<a[^>]*href="[^"]*${storeName}[^"]*"[^>]*>([^<]+)<`, 'i');
        let title = (bingHtml.match(titleRe)?.[1] || '').trim();
        if (!title) {
            title = (bingHtml.match(/<h2[^>]*>\s*<a[^>]*>([^<]+)</)?.[1] || productName).trim();
        }
        title = title.replace(/\s*[\|–-]\s*(?:hepsiburada|n11|amazon).*$/i, '').trim();
        const brand = extractBrand(title);

        console.log(`Bing fiyat: ${newPrice} TL, başlık: ${title.substring(0, 50)}`);
        return { newPrice, title, imageUrl: '', brand };
    } catch (e) {
        console.warn('Bing arama hatası:', e);
        return empty;
    }
}

/**
 * Main API Handler
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
    // Handle CORS preflight
    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }

    const { action, url, market } = req.query;

    try {
        if (action === 'list' || !action) {
            // Fetch main deals list
            const html = await fetchWithTimeout('https://onual.com/fiyat/');
            const deals = parseOnualHtml(html);

            res.status(200).json({
                success: true,
                count: deals.length,
                deals,
            });
        } else if (action === 'detail' && url) {
            // Fetch deal details
            const targetUrl = Array.isArray(url) ? url[0] : url;
            const html = await fetchWithTimeout(targetUrl);
            const details = parseDetailHtml(html);

            res.status(200).json({
                success: true,
                details,
            });
        } else if (action === 'brochures' && market) {
            // Fetch brochures from Akakce
            const marketKey = (Array.isArray(market) ? market[0] : market).toLowerCase();
            const marketUrl = AKAKCE_MARKETS[marketKey];

            if (!marketUrl) {
                res.status(400).json({
                    success: false,
                    error: `Desteklenmeyen market: ${marketKey}. Desteklenen: ${Object.keys(AKAKCE_MARKETS).join(', ')}`,
                });
                return;
            }

            console.log(`Fetching brochures for ${marketKey} from ${marketUrl}...`);

            // Step 1: Get brochure list page
            const listHtml = await fetchWithTimeout(marketUrl);
            const brochureLinks = parseAkakceBrochureList(listHtml, marketKey);

            if (brochureLinks.length === 0) {
                res.status(404).json({
                    success: false,
                    error: `${marketKey} için broşür linki bulunamadı`,
                });
                return;
            }

            console.log(`Found ${brochureLinks.length} brochure links`);

            // Step 2: Fetch each brochure and collect images
            const allImages: string[] = [];

            for (const link of brochureLinks) {
                try {
                    await randomDelay(500, 1500);
                    const brochureHtml = await fetchWithTimeout(link);
                    const images = parseAkakceBrochureImages(brochureHtml);
                    allImages.push(...images);
                    console.log(`Brochure ${link}: ${images.length} images`);

                    // Limit images per brochure
                    if (allImages.length >= 30) break;
                } catch (e) {
                    console.warn(`Failed to fetch brochure: ${link}`);
                }
            }

            // Remove duplicates
            const uniqueImages = [...new Set(allImages)];

            res.status(200).json({
                success: true,
                market: marketKey,
                brochureCount: brochureLinks.length,
                imageCount: uniqueImages.length,
                brochureLinks,
                images: uniqueImages,
            });
        } else if ((action === 'product' || action === 'analyze') && url) {
            // Analyze product URL - extract price and image
            let targetUrl = Array.isArray(url) ? url[0] : url;
            console.log(`Analyzing product URL: ${targetUrl}`);

            // 1. Resolve short links
            targetUrl = await resolveUrl(targetUrl);

            // 2. Sayfayı çek
            let html = '';
            const isBlockedStore = targetUrl.includes('hepsiburada') || targetUrl.includes('n11.com') || targetUrl.includes('amazon.com.tr');

            try {
                html = await fetchWithTimeout(targetUrl);
            } catch (fetchErr: any) {
                console.warn(`Ana sayfa çekilemedi (${fetchErr.message})`);
                // Mobil site yedek
                const altUrl = targetUrl
                    .replace('www.hepsiburada.com', 'm.hepsiburada.com')
                    .replace('www.n11.com', 'm.n11.com')
                    .replace('urun.n11.com', 'm.n11.com');
                if (altUrl !== targetUrl) {
                    try {
                        html = await fetchWithTimeout(altUrl, 15000, 0);
                        console.log(`Mobil site HTML: ${html.length} bytes`);
                    } catch { }
                }
            }

            // Cloudflare/security sayfası geldi — bloklanmış sayılır
            const isCloudflareBlock = html.includes('Cloudflare') && html.includes('blocked');

            if (html.length < 500 || isCloudflareBlock) {
                // Engellenen mağazalar için Akakce fallback
                if (isBlockedStore) {
                    console.log('HTML çekilemedi, Akakce fallback deneniyor...');
                    const akResult = await searchPriceViaDDG(targetUrl);
                    if (akResult.newPrice > 0) {
                        // Görsel yoksa Bing image search dene
                        let fallbackImage = akResult.imageUrl;
                        if (!fallbackImage && akResult.title) {
                            fallbackImage = await searchImageViaBing(akResult.title);
                        }
                        res.status(200).json({
                            success: true,
                            product: {
                                title: cleanTitle(akResult.title),
                                brand: akResult.brand,
                                newPrice: akResult.newPrice,
                                oldPrice: Math.round(akResult.newPrice * 1.25),
                                imageUrl: fallbackImage,
                                resolvedUrl: targetUrl,
                                aiPriceFallback: true,
                            }
                        });
                        return;
                    }
                }
                console.warn(`HTML çok kısa (${html.length} byte), priceNotFound`);
                res.status(200).json({
                    success: true,
                    product: { title: '', brand: '', newPrice: 0, oldPrice: 0, imageUrl: '', resolvedUrl: targetUrl, priceNotFound: true }
                });
                return;
            }

            const $ = cheerio.load(html);

            let title = '';
            let newPrice = 0;
            let oldPrice = 0;
            let imageUrl = '';
            let brand = '';

            // Trendyol
            if (targetUrl.includes('trendyol')) {
                // ── Öncelikli: __PRODUCT_DETAIL__DATALAYER GTM değişkeni ─────────
                // Trendyol bu veriyi server-side render ediyor, cloud IP'lerden erişilebilir
                const dataLayerMatch = html.match(/__PRODUCT_DETAIL__DATALAYER[^,]*,\s*(\{[^)]+\})\)/);
                if (dataLayerMatch) {
                    try {
                        const dlData = JSON.parse(dataLayerMatch[1]);
                        newPrice = parseFloat(dlData.product_discounted_price) || parseFloat(dlData.product_price) || 0;
                        oldPrice = parseFloat(dlData.product_original_price) || parseFloat(dlData.product_price) || 0;
                        title = dlData.product_pname || '';
                        brand = dlData.product_brand || dlData.product_merchant || '';
                        console.log(`Trendyol dataLayer: price=${newPrice}, old=${oldPrice}, title=${title}`);
                    } catch (e) { console.warn('dataLayer parse hatası:', e); }
                }

                // ── Fallback: JSON-LD ──────────────────────────────────────────
                if (!newPrice) {
                    const scriptTags = $('script[type="application/ld+json"]').toArray();
                    for (const script of scriptTags) {
                        try {
                            const json = JSON.parse($(script).html() || '{}');
                            if (json['@type'] === 'Product' && json.offers) {
                                const offers = Array.isArray(json.offers) ? json.offers[0] : json.offers;
                                newPrice = parseFloat(offers.price) || 0;
                                if (offers.priceSpecification?.price) oldPrice = parseFloat(offers.priceSpecification.price) || 0;
                            }
                        } catch (e) { }
                    }
                }

                // ── Fallback: regex ────────────────────────────────────────────
                if (!newPrice) {
                    const m = html.match(/"product_discounted_price":([\d.]+)/);
                    if (m) newPrice = parseFloat(m[1]);
                }
                if (!newPrice) {
                    const m = html.match(/"price":([\d.]+)/);
                    if (m) newPrice = parseFloat(m[1]);
                }
                if (!oldPrice) {
                    const m = html.match(/"product_original_price":([\d.]+)/);
                    if (m) oldPrice = parseFloat(m[1]);
                }

                // ── Title / Image / Brand fallback ─────────────────────────────
                if (!title) {
                    title = $('meta[property="og:title"]').attr('content') ||
                        $('h1').first().text().trim() || '';
                }
                imageUrl = $('meta[property="og:image"]').attr('content') ||
                    $('img[src*="cdn.dsmcdn"]').first().attr('src') || '';

                if (!brand) {
                    brand = $('h1.pr-new-br a').first().text().trim() || '';
                }
            }

            // Hepsiburada - API + HTML scraping (ana site 403 olabilir)
            else if (targetUrl.includes('hepsiburada')) {
                // Strategy 1: Ürün API (main site 403 olsa da product.hepsiburada.com açık olabilir)
                const hbSkuMatch = targetUrl.match(/pm-(HB[A-Z0-9]+)/i);
                if (hbSkuMatch) {
                    const sku = hbSkuMatch[1];
                    try {
                        const apiRes = await fetch(
                            `https://product.hepsiburada.com/api/product-summary?listing=${sku}`,
                            {
                                headers: {
                                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
                                    'Accept': 'application/json, text/plain, */*',
                                    'Accept-Language': 'tr-TR,tr;q=0.9',
                                    'Referer': 'https://www.hepsiburada.com/',
                                    'Origin': 'https://www.hepsiburada.com',
                                },
                                signal: AbortSignal.timeout(10000),
                            }
                        );
                        if (apiRes.ok) {
                            const apiData = await apiRes.json();
                            title = apiData.name || apiData.displayName || apiData.title || '';
                            newPrice = parsePriceText(apiData.finalPrice ?? apiData.price ?? apiData.salePrice);
                            oldPrice = parsePriceText(apiData.originalPrice ?? apiData.priceBeforeDiscount ?? apiData.listPrice);
                            const imgArr = apiData.images || apiData.imageList;
                            imageUrl = (Array.isArray(imgArr) ? imgArr[0] : imgArr) || apiData.image || '';
                            brand = apiData.brand?.name || (typeof apiData.brand === 'string' ? apiData.brand : '') || '';
                            console.log(`HB API başarılı: price=${newPrice}, sku=${sku}`);
                        } else {
                            console.warn(`HB API ${apiRes.status}: ${sku}`);
                        }
                    } catch (e) {
                        console.warn('HB API hatası:', e);
                    }
                }

                // Strategy 2: HTML scraping (HTML başarıyla çekilebildiyse)
                if (!newPrice) {
                    // Title
                    if (!title) {
                        title = $('h1#product-name').text().trim() ||
                            $('h1[data-test-id="product-name"]').text().trim() ||
                            $('span[data-test-id="product-name"]').text().trim() ||
                            $('h1.product-name').text().trim() ||
                            $('meta[property="og:title"]').attr('content') || '';
                    }

                    // JSON-LD Schema.org - @graph dizisi içinden Product bul (EN GÜVENİLİR)
                    const scriptTags = $('script[type="application/ld+json"]').toArray();
                    for (const script of scriptTags) {
                        try {
                            const json = JSON.parse($(script).html() || '{}');
                            const graph = json['@graph'] || [json];
                            for (const item of graph) {
                                if (item['@type'] === 'Product') {
                                    if (item.image && !imageUrl) imageUrl = Array.isArray(item.image) ? item.image[0] : item.image;
                                    if (item.offers && !newPrice) {
                                        const offers = Array.isArray(item.offers) ? item.offers[0] : item.offers;
                                        if (offers.price) newPrice = parsePriceText(offers.price);
                                        if (offers.highPrice) oldPrice = parsePriceText(offers.highPrice);
                                    }
                                    if (item.brand && !brand) brand = item.brand.name || item.brand || '';
                                }
                            }
                        } catch (e) { }
                    }

                    // Regex fallback
                    if (!newPrice) {
                        const patterns = [/"discountedPrice":\s*([\d.]+)/, /"price":\s*([\d.]+)/, /data-price="([\d.]+)"/, /"currentPrice":\s*([\d.]+)/];
                        for (const p of patterns) { const m = html.match(p); if (m) { newPrice = parseFloat(m[1]); break; } }
                    }
                    if (!oldPrice) {
                        const patterns = [/"originalPrice":\s*([\d.]+)/, /"listPrice":\s*([\d.]+)/, /data-original-price="([\d.]+)"/];
                        for (const p of patterns) { const m = html.match(p); if (m) { oldPrice = parseFloat(m[1]); break; } }
                    }
                    if (!newPrice) {
                        const priceEl = $('[data-test-id="price-current-price"]').first();
                        newPrice = parsePriceText(priceEl.text());
                    }
                }

                // Image fallback
                if (!imageUrl) {
                    imageUrl = $('meta[property="og:image"]').attr('content') ||
                        $('img[src*="productimages.hepsiburada.net"]').first().attr('src') ||
                        $('.hb-HbImage-view__image').first().attr('src') ||
                        $('img[data-test-id="product-image"]').attr('src') || '';
                }
                if (!brand) {
                    brand = $('a[data-test-id="brand-link"]').text().trim() ||
                        $('span[data-test-id="brand"]').text().trim() || '';
                }
                if (!title) title = $('meta[property="og:title"]').attr('content') || '';
            }

            // Amazon TR - Gelişmiş scraping (Browser analizi sonucunda güncellendi)
            else if (targetUrl.includes('amazon')) {
                // Title
                title = $('#productTitle').text().trim() ||
                    $('#title').text().trim() ||
                    $('meta[property="og:title"]').attr('content') || '';

                // Helper: Türkçe fiyat formatını parse et (8.699,00TL -> 8699.00)
                const parseTurkishPrice = (text: string): number => {
                    if (!text) return 0;
                    // "8.699,00TL" veya "8.699,00 TL" formatı
                    const cleaned = text
                        .replace(/TL/gi, '')
                        .replace(/₺/g, '')
                        .replace(/\s/g, '')
                        .replace(/\./g, '')  // Binlik ayracı kaldır
                        .replace(',', '.');   // Virgülü noktaya çevir
                    return parseFloat(cleaned) || 0;
                };

                // Pattern 1: .a-price .a-offscreen (EN GÜVENİLİR - browser analizinden)
                if (!newPrice) {
                    const priceEl = $('.a-price .a-offscreen').first();
                    const priceText = priceEl.text().trim();
                    newPrice = parseTurkishPrice(priceText);
                }

                // Pattern 2: #corePrice_desktop
                if (!newPrice) {
                    const priceEl = $('#corePrice_desktop .a-price .a-offscreen').first();
                    const priceText = priceEl.text().trim();
                    newPrice = parseTurkishPrice(priceText);
                }

                // Pattern 3: #corePriceDisplay_desktop_feature_div (fırsat/kampanya)
                if (!newPrice) {
                    const priceEl = $('#corePriceDisplay_desktop_feature_div .a-price .a-offscreen').first();
                    const priceText = priceEl.text().trim();
                    newPrice = parseTurkishPrice(priceText);
                }

                // Pattern 4: a-price-whole + a-price-fraction
                if (!newPrice) {
                    const priceWhole = $('.a-price-whole').first().text().replace(/[^\d]/g, '');
                    const priceFraction = $('.a-price-fraction').first().text().replace(/[^\d]/g, '');
                    if (priceWhole) {
                        newPrice = parseFloat(`${priceWhole}.${priceFraction || '00'}`);
                    }
                }

                // Pattern 5: JSON-LD
                if (!newPrice) {
                    const scriptTags = $('script[type="application/ld+json"]').toArray();
                    for (const script of scriptTags) {
                        try {
                            const json = JSON.parse($(script).html() || '{}');
                            if (json['@type'] === 'Product' && json.offers) {
                                const offers = Array.isArray(json.offers) ? json.offers[0] : json.offers;
                                if (offers.price) newPrice = parseFloat(offers.price) || 0;
                            }
                        } catch (e) { }
                    }
                }

                // Pattern 6: Regex fallback
                if (!newPrice) {
                    const priceMatch = html.match(/"priceAmount":\s*([\d.]+)/) ||
                        html.match(/"price":\s*"?([\d.]+)"?/);
                    if (priceMatch) newPrice = parseFloat(priceMatch[1]);
                }

                // Old price - .basisPrice .a-offscreen
                if (!oldPrice) {
                    const oldEl = $('.basisPrice .a-offscreen').first();
                    const oldText = oldEl.text().trim();
                    oldPrice = parseTurkishPrice(oldText);
                }
                if (!oldPrice) {
                    const oldEl = $('.a-price.a-text-price .a-offscreen').first();
                    const oldText = oldEl.text().trim();
                    oldPrice = parseTurkishPrice(oldText);
                }

                // Image - Multiple sources (öncelik sırası güncellendi)
                imageUrl = $('#landingImage').attr('src') ||
                    $('meta[property="og:image"]').attr('content') ||
                    $('#imgBlkFront').attr('src') ||
                    $('#main-image').attr('src') ||
                    $('img[data-old-hires]').first().attr('data-old-hires') ||
                    $('img[src*="images-amazon.com"]').first().attr('src') || '';

                // data-a-dynamic-image içinden yüksek çözünürlüklü görsel al
                if (!imageUrl || imageUrl.includes('placeholder')) {
                    const dynamicImgAttr = $('#landingImage').attr('data-a-dynamic-image');
                    if (dynamicImgAttr) {
                        try {
                            const imgObj = JSON.parse(dynamicImgAttr);
                            const urls = Object.keys(imgObj);
                            if (urls.length > 0) {
                                // En yüksek çözünürlüğü al (son eleman genelde en büyük)
                                imageUrl = urls[urls.length - 1] || urls[0];
                            }
                        } catch (e) { }
                    }
                }

                // Brand
                brand = $('#bylineInfo').text().replace(/Marka:|Brand:|Visit the|Store|tarafından/gi, '').trim() ||
                    $('a#bylineInfo').text().trim() || '';
            }

            // N11 - Gelişmiş scraping (www.n11.com veya m.n11.com veya urun.n11.com)
            else if (targetUrl.includes('n11.com')) {
                title = $('h1.proName, h1.product-title, h1[itemprop="name"]').first().text().trim() ||
                    $('meta[property="og:title"]').attr('content') || '';

                // JSON-LD (en güvenilir)
                const n11Scripts = $('script[type="application/ld+json"]').toArray();
                for (const script of n11Scripts) {
                    try {
                        const json = JSON.parse($(script).html() || '{}');
                        const items = json['@graph'] ? json['@graph'] : [json];
                        for (const item of items) {
                            if (item['@type'] === 'Product') {
                                if (!title && item.name) title = item.name;
                                if (!imageUrl && item.image) imageUrl = Array.isArray(item.image) ? item.image[0] : item.image;
                                if (!brand && item.brand) brand = item.brand.name || item.brand || '';
                                if (item.offers && !newPrice) {
                                    const offers = Array.isArray(item.offers) ? item.offers[0] : item.offers;
                                    newPrice = parsePriceText(offers.price);
                                    oldPrice = parsePriceText(offers.highPrice || offers.priceSpecification?.price);
                                }
                            }
                        }
                    } catch { }
                }

                // window.dataLayer / pageDataLayer regex
                if (!newPrice) {
                    const m = html.match(/"discountedPrice"[:\s]+"?([\d.,]+)"?/) ||
                        html.match(/"salePrice"[:\s]+"?([\d.,]+)"?/) ||
                        html.match(/"finalPrice"[:\s]+"?([\d.,]+)"?/) ||
                        html.match(/"price"[:\s]+"?([\d.,]+)"?/);
                    if (m) newPrice = parsePriceText(m[1]);
                }
                if (!oldPrice) {
                    const m = html.match(/"originalPrice"[:\s]+"?([\d.,]+)"?/) ||
                        html.match(/"listPrice"[:\s]+"?([\d.,]+)"?/);
                    if (m) oldPrice = parsePriceText(m[1]);
                }

                // CSS selectors fallback
                if (!newPrice) {
                    const priceEl = $('.price-display, .js-price-value, #priceNew, .priceCurrent, .price.newPrice, .priceValue').first();
                    newPrice = parsePriceText(priceEl.text().trim());
                }
                if (!oldPrice) {
                    const oldEl = $('.oldPrice, .price-old, .price.oldPrice').first();
                    oldPrice = parsePriceText(oldEl.text().trim());
                }

                if (!imageUrl) imageUrl = $('meta[property="og:image"]').attr('content') || '';
            }

            // Pazarama - Nuxt.js tabanlı (window.__NUXT__ + JSON-LD)
            else if (targetUrl.includes('pazarama')) {
                // Title: h1 önce dene, og:title'dan site adını temizle
                title = $('h1.product-title, h1.name, h1[class*="product"], h1[class*="title"]').first().text().trim() ||
                    $('h1').first().text().trim() || '';
                if (!title) {
                    const ogTitle = $('meta[property="og:title"]').attr('content') || '';
                    // "Ürün Adı | Pazarama" → "Ürün Adı"
                    title = ogTitle.replace(/\s*[\|–-]\s*pazarama.*$/i, '').trim() || ogTitle;
                }

                // JSON-LD (Pazarama Product schema içeriyor)
                const pzScripts = $('script[type="application/ld+json"]').toArray();
                for (const script of pzScripts) {
                    try {
                        const json = JSON.parse($(script).html() || '{}');
                        const items = json['@graph'] ? json['@graph'] : [json];
                        for (const item of items) {
                            if (item['@type'] === 'Product') {
                                if (!title && item.name) title = item.name;
                                if (!imageUrl && item.image) imageUrl = Array.isArray(item.image) ? item.image[0] : item.image;
                                if (!brand && item.brand) brand = item.brand.name || item.brand || '';
                                if (item.offers && !newPrice) {
                                    const offers = Array.isArray(item.offers) ? item.offers[0] : item.offers;
                                    newPrice = parsePriceText(offers.price);
                                    oldPrice = parsePriceText(offers.highPrice);
                                }
                            }
                        }
                    } catch { }
                }

                // window.__NUXT__ parse (JSON-LD yoksa veya eksikse)
                if (!newPrice) {
                    const nuxtMatch = html.match(/window\.__NUXT__\s*=\s*(\{[\s\S]+?\})\s*<\/script>/);
                    if (nuxtMatch) {
                        try {
                            const nuxt = JSON.parse(nuxtMatch[1]);
                            const findPriceInObj = (obj: any, depth = 0): number => {
                                if (depth > 8 || !obj || typeof obj !== 'object') return 0;
                                for (const key of ['salePrice', 'price', 'listPrice', 'discountedPrice', 'currentPrice', 'sellPrice', 'finalPrice']) {
                                    if (obj[key] != null && !isNaN(parseFloat(obj[key]))) return parsePriceText(obj[key]);
                                }
                                for (const val of Object.values(obj)) {
                                    const found = findPriceInObj(val, depth + 1);
                                    if (found > 0) return found;
                                }
                                return 0;
                            };
                            newPrice = findPriceInObj(nuxt);
                        } catch (e) { console.warn('Pazarama __NUXT__ parse hatası:', e); }
                    }
                }

                // Regex fallback
                if (!newPrice) {
                    const m = html.match(/"salePrice"[:\s]+"?([\d.,]+)"?/) ||
                        html.match(/"price"[:\s]+"?([\d.,]+)"?/);
                    if (m) newPrice = parsePriceText(m[1]);
                }
                if (!oldPrice) {
                    const m = html.match(/"listPrice"[:\s]+"?([\d.,]+)"?/) ||
                        html.match(/"originalPrice"[:\s]+"?([\d.,]+)"?/);
                    if (m) oldPrice = parsePriceText(m[1]);
                }

                // CSS selectors
                if (!newPrice) {
                    const priceEl = $('.price-new, .product-price, .sale-price, .current-price, [class*="price"]').first();
                    newPrice = parsePriceText(priceEl.text().trim());
                }
                if (!imageUrl) {
                    imageUrl = $('meta[property="og:image"]').attr('content') ||
                        $('img.product-image, img[src*="pazarama"], img[src*="cdn"]').first().attr('src') || '';
                }
            }

            // Generic fallback
            if (!title) {
                title = $('meta[property="og:title"]').attr('content') ||
                    $('title').text().trim() || '';
            }
            if (!imageUrl) {
                imageUrl = $('meta[property="og:image"]').attr('content') || '';
            }

            // Fiyat bulunamadıysa: önce Akakce (HB/N11/Amazon için), sonra OpenRouter
            let aiPriceFallback = false;
            if (!newPrice) {
                // Engellenen mağazalar → Akakce üzerinden fiyat ara
                if (isBlockedStore) {
                    console.log('HTML alındı ama fiyat yok, Akakce fallback deneniyor...');
                    const akResult = await searchPriceViaDDG(targetUrl);
                    if (akResult.newPrice > 0) {
                        newPrice = akResult.newPrice;
                        if (!title) title = akResult.title;
                        if (!brand) brand = akResult.brand;
                        aiPriceFallback = true;
                        console.log(`Akakce fallback başarılı: price=${newPrice}`);
                    }
                    // Görsel hâlâ yoksa Bing image search dene
                    if (!imageUrl && title) {
                        imageUrl = await searchImageViaBing(title);
                    }
                }

                // Hâlâ fiyat yoksa OpenRouter ile HTML'den çıkar
                if (!newPrice) {
                    console.log('Fiyat bulunamadı, OpenRouter fallback deneniyor...');
                    const aiPrices = await openrouterPriceFallback(html);
                    if (aiPrices.newPrice > 0) {
                        newPrice = aiPrices.newPrice;
                        if (!oldPrice && aiPrices.oldPrice > 0) oldPrice = aiPrices.oldPrice;
                        aiPriceFallback = true;
                        console.log(`OpenRouter fallback başarılı: newPrice=${newPrice}`);
                    }
                }
            }

            // If no old price, use 30% markup
            if (!oldPrice && newPrice > 0) {
                oldPrice = Math.round(newPrice * 1.3);
            }

            // Extract brand from title if not found
            if (!brand && title) {
                brand = extractBrand(title);
            }

            console.log(`Analyzed: title="${title.substring(0, 50)}...", price=${newPrice}, oldPrice=${oldPrice}, aiPriceFallback=${aiPriceFallback}`);

            res.status(200).json({
                success: true,
                product: {
                    title: cleanTitle(title),
                    brand,
                    newPrice,
                    oldPrice,
                    imageUrl,
                    resolvedUrl: targetUrl,
                    aiPriceFallback,
                }
            });
        } else if (action === 'proxy' && url) {
            // Lightweight proxy: fetch URL and return raw HTML
            // Used by Cloudflare Worker to bypass onual.com's datacenter IP blocking
            const targetUrl = Array.isArray(url) ? url[0] : url;

            // Only allow onual.com domains for security
            const parsedUrl = new URL(targetUrl);
            if (!parsedUrl.hostname.endsWith('onual.com')) {
                res.status(403).json({
                    success: false,
                    error: 'Bu proxy sadece onual.com domainleri için kullanılabilir',
                });
                return;
            }

            const html = await fetchWithTimeout(targetUrl);
            res.setHeader('Content-Type', 'text/html; charset=utf-8');
            res.status(200).send(html);
        } else {
            res.status(400).json({
                success: false,
                error: 'Invalid action. Use ?action=list, ?action=detail&url=..., ?action=brochures&market=bim, ?action=product&url=..., or ?action=proxy&url=...',
            });
        }
    } catch (error: any) {
        console.error('Scrape error:', error);
        res.status(500).json({
            success: false,
            error: error.message || 'Veri çekilirken hata oluştu',
        });
    }
}
