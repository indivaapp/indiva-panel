/**
 * scraperService.js - Modular and Robust Web Scraper
 * 
 * This service provides a unified interface for scraping web pages using 
 * multiple stages: direct fetch, proxy fetch, and fallback services like Jina Reader.
 */

import * as cheerio from 'cheerio';
import { sendAdminAlert } from './alertService.js';

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36';

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

    // Stage 1: Direct Fetch
    try {
        console.log(`📡 [Scraper] Stage 1: Direct fetch for ${url}`);
        const response = await fetch(url, {
            headers: { 'User-Agent': USER_AGENT },
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

    // Stage 2: Jina Reader (Güvenilir Fallback)
    if (useJina) {
        try {
            const jinaUrl = `https://r.jina.ai/${url}`;
            console.log(`📡 [Scraper] Stage 2: Jina Reader → ${jinaUrl}`);
            const response = await fetch(jinaUrl, {
                headers: { 'Accept': 'text/html' },
                signal: AbortSignal.timeout(timeout + 5000)
            });
            
            if (response.ok) {
                const html = await response.text();
                return { html, source: 'jina' };
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
 * Basic HTML validity check to skip captcha/error pages
 */
function isValidHtml(html) {
    if (!html || html.length < 500) return false;
    const lower = html.toLowerCase();
    if (lower.includes('captcha') || lower.includes('robot check') || lower.includes('forbidden')) {
        return false;
    }
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
 * Online alışveriş sitesinden ilanları parse et
 * api/scrape.ts → parseOnualHtml() ile aynı mantığa sahip
 */
export function parseDeals(html) {
    const $ = cheerio.load(html);
    const deals = [];
    const seenIds = new Set();

    // article.post kart yapısını parse et (OnuAl'nın gerçek HTML yapısı)
    $('article.post').each((_, card) => {
        const $card = $(card);
        const titleLink = $card.find('h3.entry-title a, h3 a').first();
        const href = titleLink.attr('href') || '';
        const title = titleLink.text().trim();

        if (!title || title.length < 5) return;

        // Onual ürün ID'si URL'den al
        const idMatch = href.match(/-p-(\d+)/);
        if (!idMatch) return;
        const productId = idMatch[1];
        if (seenIds.has(productId)) return;
        seenIds.add(productId);

        // Fiyat
        let newPrice = 0;
        const priceText = $card.find('h4').first().text();
        const priceMatch = priceText.match(/(\d[\d.,]*)\s*TL/i);
        if (priceMatch) {
            newPrice = parseFloat(priceMatch[1].replace('.', '').replace(',', '.')) || 0;
        }
        // URL'den fiyat fallback
        if (!newPrice) {
            const hashMatch = href.match(/fiyat=(\d+)/);
            if (hashMatch) newPrice = parseInt(hashMatch[1], 10);
        }

        // Thumbnail (varsa — detay sayfasında OG image ile üzerine yazılacak)
        const img = $card.find('figure.post-thumbnail img, .post-thumbnail img, img').first();
        const thumbnailUrl = img.attr('src') || img.attr('data-src') || '';

        const fullLink = href.startsWith('http') ? href : `https://onual.com${href}`;

        deals.push({
            id: productId,
            title: title.replace(/\s+/g, ' ').trim(),
            url: fullLink.split('#')[0],
            newPrice,
            thumbnailUrl
        });
    });

    // Fallback: article.post bulunamazsa eski yöntemi dene
    if (deals.length === 0) {
        $('a[href*="/fiyat/"]').each((_, el) => {
            const href = $(el).attr('href');
            if (!href || !href.match(/\/fiyat\/[^/]+-p-\d+\.html/i)) return;
            const title = $(el).text().trim();
            if (!title || title.length < 3) return;
            const idMatch = href.match(/-p-(\d+)\.html/);
            const productId = idMatch ? idMatch[1] : null;
            if (!productId || seenIds.has(productId)) return;
            seenIds.add(productId);
            deals.push({
                id: productId,
                title,
                url: href.startsWith('http') ? href : `https://onual.com${href}`,
                newPrice: 0,
                thumbnailUrl: ''
            });
        });
    }

    return deals;
}
