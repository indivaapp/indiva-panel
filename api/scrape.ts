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
    description?: string;
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
        .trim();
}

/**
 * Fetch with timeout, retry logic and enhanced headers to bypass bot detection
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
            // If 403, wait longer and retry
            if (response.status === 403 && retryCount < maxRetries) {
                console.log(`Got 403, waiting and retrying (attempt ${retryCount + 1}/${maxRetries})...`);
                clearTimeout(timeoutId);
                await randomDelay(3000, 8000);
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

    // Get description
    const metaDesc = $('meta[name="description"]').attr('content') || '';
    const ogDesc = $('meta[property="og:description"]').attr('content') || '';
    const pageTitle = $('h1').first().text().trim();

    let description = ogDesc || metaDesc || '';
    description = description
        .replace(/En ucuz.*?OnuAl'da\./gi, '')
        .replace(/fiyatları.*?başlayan/gi, '')
        .replace(/kullanıcı yorumları okuyun.*$/gi, '')
        .trim();

    if (!description && pageTitle) {
        description = `${pageTitle} - Uygun fiyata alışveriş fırsatı`;
    }

    const brand = extractBrand(pageTitle);

    return { productLink, imageUrl, description, brand };
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

// ─── Ürün Sayfası: JSON-LD + OG Tag Çıkarma ──────────────────────────────────

interface ProductScraped {
    title: string;
    brand: string;
    newPrice: number;
    oldPrice: number;
    imageUrl: string;
    resolvedUrl: string;
}

function parseFloat2(val: unknown): number {
    if (!val) return 0;
    const s = String(val).replace(/[^\d.,]/g, '');
    // Turkish format: "1.299,00" → 1299
    if (s.includes(',')) return parseFloat(s.replace(/\./g, '').replace(',', '.')) || 0;
    return parseFloat(s) || 0;
}

function extractProductFromJsonLd(html: string): Partial<ProductScraped> {
    const $ = cheerio.load(html);
    let product: any = null;

    $('script[type="application/ld+json"]').each((_, el) => {
        if (product) return;
        try {
            const raw = $(el).html() || '';
            const json = JSON.parse(raw);
            const candidates = Array.isArray(json) ? json : json['@graph'] ? json['@graph'] : [json];
            for (const item of candidates) {
                if (item?.['@type'] === 'Product') { product = item; break; }
            }
        } catch {}
    });

    if (!product) return {};

    // Title
    const title: string = String(product.name || '').trim();

    // Brand
    let brand = '';
    if (typeof product.brand === 'string') brand = product.brand;
    else if (product.brand?.name) brand = String(product.brand.name);

    // Image
    let imageUrl = '';
    if (typeof product.image === 'string') imageUrl = product.image;
    else if (Array.isArray(product.image) && product.image.length > 0) imageUrl = String(product.image[0]);
    else if (product.image?.url) imageUrl = String(product.image.url);

    // Prices
    let newPrice = 0, oldPrice = 0;
    const offers = product.offers;
    if (offers) {
        if (offers['@type'] === 'AggregateOffer') {
            newPrice = parseFloat2(offers.lowPrice);
            oldPrice = parseFloat2(offers.highPrice);
        } else {
            newPrice = parseFloat2(offers.price);
            // priceSpecification for original price
            const specs: any[] = Array.isArray(offers.priceSpecification)
                ? offers.priceSpecification : offers.priceSpecification ? [offers.priceSpecification] : [];
            for (const spec of specs) {
                const t = String(spec['@type'] || spec.priceType || '').toLowerCase();
                if (t.includes('list') || t.includes('regular') || t.includes('suggested')) {
                    oldPrice = parseFloat2(spec.price);
                    break;
                }
            }
        }
    }

    // Old price from HTML (strikethrough) if JSON-LD didn't have it
    if (oldPrice === 0 && newPrice > 0) {
        const oldPriceSelectors = [
            'del', 's.price', '.old-price', '.original-price', '.crossed-price',
            '[class*="originalPrice"]', '[class*="oldPrice"]', '[class*="crossed"]',
            '.product-old-price', '.prc-org', '.price-box del',
        ];
        for (const sel of oldPriceSelectors) {
            const text = $(sel).first().text().replace(/[^\d.,]/g, '');
            const val = parseFloat2(text);
            if (val > newPrice) { oldPrice = val; break; }
        }
    }

    return { title, brand, newPrice, oldPrice, imageUrl };
}

function extractFromOgTags(html: string): Partial<ProductScraped> {
    const $ = cheerio.load(html);
    const title = ($('meta[property="og:title"]').attr('content') || $('title').text() || '').trim();
    const imageUrl = $('meta[property="og:image"]').attr('content') || '';
    const priceStr = $('meta[property="product:price:amount"]').attr('content')
        || $('meta[property="og:price:amount"]').attr('content') || '';
    const newPrice = parseFloat2(priceStr);
    // Clean title: remove " - Hepsiburada", " | Trendyol" etc.
    const cleanedTitle = title
        .replace(/\s*[-|·|–]\s*(hepsiburada|trendyol|amazon|n11|gittigidiyor|morhipo)[^-|·]*$/gi, '')
        .replace(/\s*[-–|]\s*(fiyatı|yorumları|fiyat|yorum|satın al|incele|özellikleri|fiyatları)[^-–|]*/gi, '')
        .replace(/\s*\(fiyatı,?\s*yorumları?\)/gi, '')
        .replace(/\s*-\s*fiyatı,?\s*yorumları?$/gi, '')
        .trim();
    return { title: cleanedTitle, imageUrl, newPrice };
}

async function scrapeProduct(targetUrl: string): Promise<ProductScraped> {
    const html = await fetchWithTimeout(targetUrl, 25000);
    const jsonLd = extractProductFromJsonLd(html);
    const og = extractFromOgTags(html);

    const title = jsonLd.title || og.title || '';
    const brand = jsonLd.brand || '';
    const imageUrl = jsonLd.imageUrl || og.imageUrl || '';
    const newPrice = jsonLd.newPrice || og.newPrice || 0;
    const oldPrice = jsonLd.oldPrice || 0;

    return { title, brand, newPrice, oldPrice, imageUrl, resolvedUrl: targetUrl };
}

/**
 * Main API Handler
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
    // Handle CORS preflight
    if (req.method === 'OPTIONS') {
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
        res.status(200).end();
        return;
    }

    res.setHeader('Access-Control-Allow-Origin', '*');

    const { action, url, market } = req.query;

    try {
        if (action === 'product' && url) {
            // ─── Ürün sayfasından JSON-LD ile veri çek ───────────────────────
            const targetUrl = Array.isArray(url) ? url[0] : url;
            const product = await scrapeProduct(targetUrl);
            res.status(200).json({ success: true, product });

        } else if (action === 'list' || !action) {
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
        } else {
            res.status(400).json({
                success: false,
                error: 'Invalid action. Use ?action=list, ?action=detail&url=..., or ?action=brochures&market=bim',
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
