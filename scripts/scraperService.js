/**
 * scraperService.js - Modular and Robust Web Scraper
 * 
 * This service provides a unified interface for scraping web pages using 
 * multiple stages: direct fetch, proxy fetch, and fallback services like Jina Reader.
 */

import * as cheerio from 'cheerio';
import { sendAdminAlert } from './alertService.js';

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

// Gerçek tarayıcıya benzer tam header seti — Cloudflare/WAF bot tespitini atlatır
const BROWSER_HEADERS = {
    'User-Agent': USER_AGENT,
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
    'Accept-Language': 'tr-TR,tr;q=0.9,en-US;q=0.8,en;q=0.7',
    'Accept-Encoding': 'gzip, deflate, br',
    'Cache-Control': 'no-cache',
    'Pragma': 'no-cache',
    'Sec-Ch-Ua': '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"',
    'Sec-Ch-Ua-Mobile': '?0',
    'Sec-Ch-Ua-Platform': '"Windows"',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'none',
    'Sec-Fetch-User': '?1',
    'Upgrade-Insecure-Requests': '1',
};

/**
 * Robust fetch with multiple fallback stages
 * @param {string} url The target URL
 * @param {object} options Configuration options
 * @returns {Promise<{html: string, source: string}>}
 */
export async function fetchWithFallback(url, options = {}) {
    const {
        useProxy = true,
        useJina = true,
        timeout = 20000,
        retries = 2
    } = options;

    // Stage 1: Direct Fetch (tam tarayıcı header'larıyla)
    try {
        console.log(`📡 [Scraper] Stage 1: Direct fetch for ${url}`);
        const response = await fetch(url, {
            headers: BROWSER_HEADERS,
            signal: AbortSignal.timeout(timeout)
        });
        
        if (response.ok) {
            const html = await response.text();
            if (isValidHtml(html)) {
                return { html, source: 'direct' };
            }
        }
        console.warn(`   ⚠️ Direct fetch failed or returned invalid content (Status: ${response.status})`);
    } catch (err) {
        console.warn(`   ❌ Direct fetch error: ${err.message}`);
    }

    // Stage 2: Jina Reader (Güvenilir Fallback — onual.com'u residential proxy üzerinden çeker)
    if (useJina) {
        try {
            const jinaUrl = `https://r.jina.ai/${url}`;
            console.log(`📡 [Scraper] Stage 2: Jina Reader → ${jinaUrl}`);
            const response = await fetch(jinaUrl, {
                headers: {
                    // Jina'dan HTML formatı iste; varsayılan Markdown'dır ve cheerio parse edemez
                    'X-Return-Format': 'html',
                    'Accept': 'text/html',
                    'X-Locale': 'tr-TR',
                },
                signal: AbortSignal.timeout(timeout + 10000)
            });

            if (response.ok) {
                const html = await response.text();
                if (html && html.length > 500) {
                    console.log(`   ✅ Jina HTML döndü: ${html.length} byte`);
                    return { html, source: 'jina' };
                }
                console.warn(`   ⚠️ Jina yanıtı çok kısa: ${html.length} byte`);
            } else {
                console.warn(`   ⚠️ Jina HTTP ${response.status}`);
            }
        } catch (err) {
            console.warn(`   ❌ Jina fetch error: ${err.message}`);
        }
    }

    const errorMsg = `Failed to fetch content from ${url} after all stages.`;
    await sendAdminAlert('Scraping Başarısız', `Mağaza linki çekilemedi: ${url.substring(0, 50)}...`, { url });
    throw new Error(errorMsg);
}

/**
 * Basic HTML validity check to skip captcha/error pages and Cloudflare challenges
 */
function isValidHtml(html) {
    if (!html || html.length < 500) return false;
    const lower = html.toLowerCase();
    if (lower.includes('captcha') || lower.includes('robot check') || lower.includes('forbidden')) return false;
    // Cloudflare JS challenge sayfası — data center IP'lerinden gelince oluşur
    // Bu durumda Jina Reader fallback'i devreye girmeli
    if (html.includes('/cdn-cgi/challenge-platform/') || html.includes('window._cf_chl_opt')) return false;
    return true;
}

/**
 * Resolve short links to final store URLs
 */
export async function resolveUrl(url, timeout = 10000) {
    if (!url.includes('zxro.com') && !url.includes('onu.al') && !url.includes('knv.al')) {
        return url;
    }

    try {
        const response = await fetch(url, {
            method: 'HEAD',
            redirect: 'follow',
            headers: { 'User-Agent': USER_AGENT },
            signal: AbortSignal.timeout(timeout)
        });
        return response.url;
    } catch (err) {
        console.warn(`[Scraper] URL resolution failed: ${err.message}`);
        return url;
    }
}

/**
 * Bazı mağaza CDN'leri listeleme sayfasında küçük/bulanık bir thumbnail
 * boyutu döndürüyor, oysa URL'deki boyut segmentini değiştirerek aynı
 * CDN'den çok daha büyük bir varyant istemek mümkün (yeni istek gerekmiyor,
 * sadece string değişimi). Doğrulandı: productimages.hepsiburada.net,
 * "424-600" yerine "1500-1500" istendiğinde 200 dönüyor ve ~3-4 kat daha
 * büyük dosya boyutu geliyor (gerçek yüksek çözünürlük).
 */
export function upgradeImageQuality(url) {
    if (!url) return url;
    if (url.includes('productimages.hepsiburada.net')) {
        return url.replace(/\/\d+-\d+\//, '/1500-1500/');
    }
    return url;
}

/**
 * Online alışveriş sitesinden ilanları parse et
 * Yeni onual.com yapısı (2025+): <a class="product-card group" data-share-id="...">
 */
export function parseDeals(html) {
    const $ = cheerio.load(html);
    const deals = [];
    const seenIds = new Set();

    // Yeni yapı: data-share-id attribute'u olan kart linkleri
    $('[data-share-id]').each((_, card) => {
        const $card = $(card);

        const productId = $card.attr('data-share-id');
        if (!productId || seenIds.has(productId)) return;
        seenIds.add(productId);

        // Başlık: title attribute daha temiz (HTML entity yok), text() fallback
        const title = ($card.find('.product-title').attr('title') || $card.find('.product-title').text()).trim();
        if (!title || title.length < 3) return;

        // Fiyat: ".product-price" içindeki "52 TL" → 52
        let newPrice = 0;
        const priceText = $card.find('.product-price').first().text().trim();
        const priceMatch = priceText.match(/([\d.]+(?:,\d+)?)\s*TL/i);
        if (priceMatch) {
            newPrice = parseFloat(priceMatch[1].replace(/\./g, '').replace(',', '.')) || 0;
        }
        // Fallback: URL fragment'taki #fiyat= değeri
        if (!newPrice) {
            const href = $card.attr('href') || '';
            const hashMatch = href.match(/fiyat=(\d+)/);
            if (hashMatch) {
                const raw = parseInt(hashMatch[1], 10);
                newPrice = raw > 10000 ? Math.round(raw / 100) : raw; // kuruş → TL
            }
        }

        const thumbnailUrl = upgradeImageQuality($card.find('.product-image').attr('src') || '');
        const storeName = $card.find('.product-store-logo-badge').attr('title') || '';
        const discountNote = $card.find('.product-note-tooltip').text().trim();

        const href = ($card.attr('href') || '').split('#')[0];
        const fullLink = href.startsWith('http')
            ? href
            : `https://www.onual.com/${href.replace(/^\//, '')}`;

        deals.push({
            id: productId,
            title: title.replace(/\s+/g, ' ').trim(),
            url: fullLink,
            newPrice,
            thumbnailUrl,
            storeName,
            discountNote,
        });
    });

    // Fallback: eski article.post yapısı
    if (deals.length === 0) {
        $('article.post').each((_, card) => {
            const $card = $(card);
            const titleLink = $card.find('h3.entry-title a, h3 a').first();
            const href = titleLink.attr('href') || '';
            const title = titleLink.text().trim();
            if (!title || title.length < 5) return;
            const idMatch = href.match(/-p-(\d+)/);
            if (!idMatch) return;
            const productId = idMatch[1];
            if (seenIds.has(productId)) return;
            seenIds.add(productId);
            let newPrice = 0;
            const priceText = $card.find('h4').first().text();
            const priceMatch = priceText.match(/(\d[\d.,]*)\s*TL/i);
            if (priceMatch) newPrice = parseFloat(priceMatch[1].replace('.', '').replace(',', '.')) || 0;
            if (!newPrice) {
                const hashMatch = href.match(/fiyat=(\d+)/);
                if (hashMatch) newPrice = parseInt(hashMatch[1], 10);
            }
            const img = $card.find('figure.post-thumbnail img, .post-thumbnail img, img').first();
            const thumbnailUrl = upgradeImageQuality(img.attr('src') || img.attr('data-src') || '');
            const fullLink = href.startsWith('http') ? href : `https://www.onual.com${href}`;
            deals.push({ id: productId, title: title.replace(/\s+/g, ' ').trim(), url: fullLink.split('#')[0], newPrice, thumbnailUrl });
        });
    }

    return deals;
}
