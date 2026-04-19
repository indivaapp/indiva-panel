/**
 * api/check.ts — İNDİVA JIT Discount Verification Proxy
 *
 * Mobil uygulamanın discountService.ts'i bu endpoint'i çağırır.
 * Ürün sayfasını scrape eder, stok/fiyat durumunu kontrol eder ve
 * expired olup olmadığını döndürür.
 *
 * POST /api/check
 * Body: { url: string, title: string, expectedPrice: number }
 * Response: { expired: boolean, currentPrice?: number, inStock?: boolean, reason?: string }
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import * as cheerio from 'cheerio';

const USER_AGENTS = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:122.0) Gecko/20100101 Firefox/122.0',
];

function randomUA() {
    return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

/**
 * Sayfa HTML'ini çek (timeout + retry)
 */
async function fetchPage(url: string, timeoutMs = 12000): Promise<string | null> {
    for (let attempt = 0; attempt < 2; attempt++) {
        try {
            const controller = new AbortController();
            const id = setTimeout(() => controller.abort(), timeoutMs);
            const res = await fetch(url, {
                signal: controller.signal,
                headers: {
                    'User-Agent': randomUA(),
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                    'Accept-Language': 'tr-TR,tr;q=0.9,en;q=0.7',
                    'Accept-Encoding': 'gzip, deflate, br',
                    'Cache-Control': 'no-cache',
                },
            });
            clearTimeout(id);
            if (res.ok) return await res.text();
        } catch {
            if (attempt === 1) return null;
            await new Promise(r => setTimeout(r, 1500));
        }
    }
    return null;
}

/**
 * Sayfa içeriğinden stok ve fiyat bilgisini çıkar
 */
function analyzePageContent(html: string, expectedPrice: number, title: string): {
    expired: boolean;
    inStock: boolean;
    currentPrice: number;
    reason: string;
} {
    const $ = cheerio.load(html);
    const bodyText = $('body').text().toLowerCase();

    // ── Stok Kontrolü ────────────────────────────────────────────────
    const outOfStockKeywords = [
        'stokta yok', 'tükendi', 'satışta değil', 'mevcut değil',
        'satışa kapalı', 'out of stock', 'unavailable', 'sold out',
    ];
    const inStockKeywords = ['sepete ekle', 'hemen al', 'satın al', 'add to cart', 'stokta var'];

    const isOutOfStock = outOfStockKeywords.some(kw => bodyText.includes(kw));
    const isInStock = inStockKeywords.some(kw => bodyText.includes(kw));

    if (isOutOfStock) {
        return { expired: true, inStock: false, currentPrice: 0, reason: 'Ürün stokta yok.' };
    }

    // ── Fiyat Tespiti ─────────────────────────────────────────────────
    let currentPrice = 0;

    // JSON-LD
    $('script[type="application/ld+json"]').each((_, el) => {
        try {
            const data = JSON.parse($(el).html() || '{}');
            const offers = data.offers || (data['@type'] === 'Product' ? data.offers : null);
            if (offers?.price) {
                const p = parseFloat(String(offers.price).replace(',', '.'));
                if (p > 0) currentPrice = p;
            }
        } catch { }
    });

    // meta itemprop
    if (!currentPrice) {
        const metaPrice = $('[itemprop="price"]').attr('content') || $('[itemprop="price"]').text();
        if (metaPrice) {
            const p = parseFloat(metaPrice.replace(/[^0-9.,]/g, '').replace(',', '.'));
            if (p > 0) currentPrice = p;
        }
    }

    // Trendyol/HB spesifik seçiciler
    if (!currentPrice) {
        const selectors = [
            '.prc-dsc', '.product-price', '.price-box .price',
            '[data-testid="price"]', '.price-container .price',
            '.featured-prices .discounted-price', '.special-price .value',
        ];
        for (const sel of selectors) {
            const text = $(sel).first().text().replace(/[^0-9.,]/g, '').replace('.', '').replace(',', '.');
            if (text) {
                const p = parseFloat(text);
                if (p > 0) { currentPrice = p; break; }
            }
        }
    }

    // ── İndirim Bitti Mi? ──────────────────────────────────────────────
    if (currentPrice > 0 && expectedPrice > 0) {
        const priceIncrease = (currentPrice - expectedPrice) / expectedPrice;
        if (priceIncrease > 0.12) {
            // Fiyat %12'den fazla artmışsa indirim bitmiş
            return {
                expired: true,
                inStock: isInStock,
                currentPrice,
                reason: `Fiyat yükseldi: ${expectedPrice} TL → ${currentPrice} TL (%${Math.round(priceIncrease * 100)} artış).`,
            };
        }
    }

    // Stok bilgisi belirsizse ve fiyat makul → aktif say
    return {
        expired: false,
        inStock: isInStock || !isOutOfStock,
        currentPrice: currentPrice || expectedPrice,
        reason: 'Ürün aktif görünüyor.',
    };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
    // CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }

    if (req.method !== 'POST') {
        res.status(405).json({ error: 'Method not allowed. Use POST.' });
        return;
    }

    const { url, title = '', expectedPrice = 0 } = req.body || {};

    if (!url) {
        res.status(400).json({ expired: false, reason: 'URL parametresi gereklidir.' });
        return;
    }

    try {
        // URL parse et ve hostname'i kontrol et
        let hostname: string;
        try {
            hostname = new URL(url).hostname.toLowerCase();
        } catch {
            res.status(400).json({ expired: false, reason: 'Geçersiz URL formatı.' });
            return;
        }

        // Tanınan mağaza hostname'lerini kontrol et
        const storePatterns = ['trendyol.com', 'hepsiburada.com', 'amazon.com.tr', 'n11.com', 'gittigidiyor.com'];
        const isKnownStore = storePatterns.some(p => hostname === p || hostname.endsWith(`.${p}`));

        if (!isKnownStore) {
            // Tanınmayan URL → güvenliye al, sil me
            res.status(200).json({ expired: false, reason: 'Tanınmayan mağaza, kontrol atlandı.' });
            return;
        }

        const html = await fetchPage(url);

        if (!html || html.length < 500) {
            // Sayfa çekilemedi → güvenli liman (false positive'den kaçın)
            res.status(200).json({ expired: false, reason: 'Sayfa çekilemedi, aktif olarak kabul edildi.' });
            return;
        }

        const result = analyzePageContent(html, expectedPrice, title);
        res.status(200).json(result);

    } catch (err: any) {
        console.error('check.ts error:', err.message);
        res.status(200).json({ expired: false, reason: 'Kontrol hatası, aktif olarak kabul edildi.' });
    }
}
