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
 * Resolve short links to final URL
 */
async function resolveUrl(url: string): Promise<string> {
    if (!url.includes('ty.gl') && !url.includes('amzn.to') && !url.includes('hb.biz') && !url.includes('onu.al')) {
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
            // Analyze product URL - extract price and image
            let targetUrl = Array.isArray(url) ? url[0] : url;
            console.log(`Analyzing product URL: ${targetUrl}`);

            // 1. Resolve short links
            targetUrl = await resolveUrl(targetUrl);

            const html = await fetchWithTimeout(targetUrl);

            // 2. Content validity check - prevent hallucination
            if (html.length < 500 || html.includes('captcha') || html.includes('robot') || html.includes('forbidden')) {
                res.status(400).json({
                    success: false,
                    error: 'Sayfa içeriğine erişilemedi veya site bot tespit etti.'
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
                // Title
                title = $('h1.pr-new-br span').text().trim() ||
                    $('h1.product-name').text().trim() ||
                    $('h1').first().text().trim() ||
                    $('meta[property="og:title"]').attr('content') || '';

                // Prices - from JSON-LD script
                const scriptTags = $('script[type="application/ld+json"]').toArray();
                for (const script of scriptTags) {
                    try {
                        const json = JSON.parse($(script).html() || '{}');
                        if (json['@type'] === 'Product' && json.offers) {
                            const offers = Array.isArray(json.offers) ? json.offers[0] : json.offers;
                            newPrice = parseFloat(offers.price) || 0;
                            if (offers.priceSpecification?.price) {
                                oldPrice = parseFloat(offers.priceSpecification.price) || 0;
                            }
                        }
                    } catch (e) { }
                }

                // Fallback prices from HTML
                if (!newPrice) {
                    const priceMatch = html.match(/"price":\s*([\d.]+)/);
                    if (priceMatch) newPrice = parseFloat(priceMatch[1]);
                }
                if (!oldPrice) {
                    const origMatch = html.match(/"originalPrice":\s*([\d.]+)/);
                    if (origMatch) oldPrice = parseFloat(origMatch[1]);
                }

                // Fallback: text content
                if (!newPrice) {
                    const priceEl = $('.prc-dsc, .product-price-container .discounted-price').first();
                    const priceText = priceEl.text().replace(/[^\d,]/g, '').replace(',', '.');
                    newPrice = parseFloat(priceText) || 0;
                }
                if (!oldPrice) {
                    const oldEl = $('.prc-org, .product-price-container .original-price').first();
                    const oldText = oldEl.text().replace(/[^\d,]/g, '').replace(',', '.');
                    oldPrice = parseFloat(oldText) || 0;
                }

                // Image
                imageUrl = $('meta[property="og:image"]').attr('content') ||
                    $('img.detail-section-img').attr('src') ||
                    $('img[src*="cdn.dsmcdn"]').first().attr('src') || '';

                // Brand
                brand = $('h1.pr-new-br a').first().text().trim() ||
                    $('.pr-new-br a').first().text().trim() || '';
            }

            // Hepsiburada - Gelişmiş scraping (Browser analizi sonucunda güncellendi)
            else if (targetUrl.includes('hepsiburada')) {
                // Title
                title = $('h1#product-name').text().trim() ||
                    $('h1[data-test-id="product-name"]').text().trim() ||
                    $('span[data-test-id="product-name"]').text().trim() ||
                    $('h1.product-name').text().trim() ||
                    $('meta[property="og:title"]').attr('content') || '';

                // JSON-LD Schema.org - @graph dizisi içinden Product bul (EN GÜVENİLİR)
                const scriptTags = $('script[type="application/ld+json"]').toArray();
                for (const script of scriptTags) {
                    try {
                        const json = JSON.parse($(script).html() || '{}');

                        // @graph dizisi varsa içinden Product bul
                        const graph = json['@graph'] || [json];
                        for (const item of graph) {
                            if (item['@type'] === 'Product') {
                                // Görsel
                                if (item.image && !imageUrl) {
                                    imageUrl = Array.isArray(item.image) ? item.image[0] : item.image;
                                }
                                // Fiyat
                                if (item.offers && !newPrice) {
                                    const offers = Array.isArray(item.offers) ? item.offers[0] : item.offers;
                                    if (offers.price) newPrice = parseFloat(offers.price) || 0;
                                    if (offers.highPrice) oldPrice = parseFloat(offers.highPrice) || 0;
                                }
                                // Marka
                                if (item.brand && !brand) {
                                    brand = item.brand.name || item.brand || '';
                                }
                            }
                        }

                        // Eski format kontrolü (düz @type: Product)
                        if (json['@type'] === 'Product' && json.offers && !newPrice) {
                            const offers = Array.isArray(json.offers) ? json.offers[0] : json.offers;
                            if (offers.price) newPrice = parseFloat(offers.price) || 0;
                            if (offers.highPrice) oldPrice = parseFloat(offers.highPrice) || 0;
                            if (json.image && !imageUrl) {
                                imageUrl = Array.isArray(json.image) ? json.image[0] : json.image;
                            }
                        }
                    } catch (e) { }
                }

                // Fallback - Regex patterns for price
                if (!newPrice) {
                    const patterns = [
                        /"price":\s*([\d.]+)/,
                        /"discountedPrice":\s*([\d.]+)/,
                        /data-price="([\d.]+)"/,
                        /"currentPrice":\s*([\d.]+)/
                    ];
                    for (const pattern of patterns) {
                        const match = html.match(pattern);
                        if (match) {
                            newPrice = parseFloat(match[1]);
                            break;
                        }
                    }
                }
                if (!oldPrice) {
                    const patterns = [
                        /"originalPrice":\s*([\d.]+)/,
                        /"listPrice":\s*([\d.]+)/,
                        /data-original-price="([\d.]+)"/
                    ];
                    for (const pattern of patterns) {
                        const match = html.match(pattern);
                        if (match) {
                            oldPrice = parseFloat(match[1]);
                            break;
                        }
                    }
                }

                // Price from visible elements
                if (!newPrice) {
                    const priceEl = $('[data-test-id="price-current-price"]').first();
                    const priceText = priceEl.text().replace(/[^\d,]/g, '').replace(',', '.');
                    newPrice = parseFloat(priceText) || 0;
                }

                // Image fallback - .hb-HbImage-view__image (browser analizinden)
                if (!imageUrl) {
                    imageUrl = $('.hb-HbImage-view__image').first().attr('src') ||
                        $('picture img').first().attr('src') ||
                        $('meta[property="og:image"]').attr('content') ||
                        $('img[data-test-id="product-image"]').attr('src') ||
                        $('img.product-image').first().attr('src') ||
                        $('img[src*="productimages.hepsiburada.net"]').first().attr('src') || '';
                }

                // Brand fallback
                if (!brand) {
                    brand = $('a[data-test-id="brand-link"]').text().trim() ||
                        $('span[data-test-id="brand"]').text().trim() ||
                        $('a.brand').text().trim() || '';
                }
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

            // N11
            else if (targetUrl.includes('n11')) {
                title = $('h1.proName').text().trim() ||
                    $('meta[property="og:title"]').attr('content') || '';

                const priceMatch = html.match(/"price":\s*"?([\d.]+)"?/);
                if (priceMatch) newPrice = parseFloat(priceMatch[1]);

                imageUrl = $('meta[property="og:image"]').attr('content') || '';
            }

            // Generic fallback
            if (!title) {
                title = $('meta[property="og:title"]').attr('content') ||
                    $('title').text().trim() || '';
            }
            if (!imageUrl) {
                imageUrl = $('meta[property="og:image"]').attr('content') || '';
            }

            // If no old price, use 30% markup
            if (!oldPrice && newPrice > 0) {
                oldPrice = Math.round(newPrice * 1.3);
            }

            // Extract brand from title if not found
            if (!brand && title) {
                brand = extractBrand(title);
            }

            console.log(`Analyzed: title="${title.substring(0, 50)}...", price=${newPrice}, oldPrice=${oldPrice}`);

            res.status(200).json({
                success: true,
                data: {
                    title: cleanTitle(title),
                    brand,
                    newPrice,
                    oldPrice,
                    imageUrl,
                    url: targetUrl
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
                error: 'Invalid action. Use ?action=list, ?action=detail&url=..., ?action=brochures&market=bim, ?action=analyze&url=..., or ?action=proxy&url=...',
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
