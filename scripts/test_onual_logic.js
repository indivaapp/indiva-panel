import * as cheerio from 'cheerio';
import * as fs from 'fs';
import * as path from 'path';

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36';

async function fetchHtml(url) {
    const res = await fetch(url, {
        headers: {
            'User-Agent': USER_AGENT,
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'tr-TR,tr;q=0.9,en;q=0.7',
            'Referer': 'https://onual.com/',
            'Cache-Control': 'no-cache'
        }
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
}

async function testFullPipeline() {
    try {
        console.log("Fetching main page...");
        const html = await fetchHtml('https://onual.com/fiyat/');
        const $ = cheerio.load(html);
        const products = [];

        const allLinks = $('a[href*="/fiyat/"]');
        allLinks.each((_, el) => {
            const href = $(el).attr('href');
            if (!href || !href.match(/\/fiyat\/[^/]+-p-\d+\.html/i)) return;

            const fullUrl = href.startsWith('http') ? href : `https://onual.com${href}`;
            const priceMatch = href.match(/#fiyat=(\d+)/);
            const price = priceMatch ? parseInt(priceMatch[1]) : 0;
            const title = $(el).text().trim() || $(el).attr('title') || '';
            const cleanTitle = title.replace(/\s+/g, ' ').trim();

            if (!cleanTitle || cleanTitle.length < 3) return;

            const idMatch = fullUrl.match(/-p-(\d+)\.html/);
            const productId = idMatch ? idMatch[1] : null;
            if (!productId) return;

            products.push({
                id: productId,
                title: cleanTitle,
                url: fullUrl.split('#')[0],
                newPrice: price
            });
        });

        const seen = new Set();
        const unique = products.filter(p => {
            if (seen.has(p.id)) return false;
            seen.add(p.id);
            return true;
        });

        console.log(`Found ${unique.length} unique products. Testing first product...`);
        
        if (unique.length === 0) {
            console.log("NO PRODUCTS FOUND! Regex failed?");
            return;
        }

        const product = unique[0];
        console.log(`Testing Product: ${product.title}`);
        console.log(`URL: ${product.url}`);
        
        // Let's test the detail page scraping
        const detailHtml = await fetchHtml(product.url);
        const $detail = cheerio.load(detailHtml);
        
        const button = $detail('#buton');
        const intermediateLink = button.attr('href') || product.url;
        
        let newPrice = product.newPrice || 0;
        let oldPrice = 0;
        
        // Test JSON-LD
        $detail('script[type="application/ld+json"]').each((_, el) => {
            try {
                const data = JSON.parse($detail(el).html() || '{}');
                // console.log("JSON-LD found:", data ? "yes" : "no");
                if (data['@type'] === 'Product' || data.offers) {
                    const offers = data.offers || data;
                    if (offers.price && !newPrice) {
                        newPrice = parseFloat(String(offers.price).replace(',', '.'));
                    }
                    if (offers.highPrice) {
                        oldPrice = parseFloat(String(offers.highPrice).replace(',', '.'));
                    }
                }
            } catch (e) {
                // console.log("JSON-LD parse error", e.message);
            }
        });
        
        console.log(`Parsed New Price: ${newPrice}`);
        console.log(`Parsed Old Price: ${oldPrice}`);
        console.log(`Intermediate Link: ${intermediateLink}`);
        
        let imageUrl = '';
        const ogImage = $detail('meta[property="og:image"]').attr('content');
        if (ogImage && ogImage.startsWith('http')) imageUrl = ogImage;
        console.log(`Image URL: ${imageUrl}`);
        
        // The issue might be the ID Caching!
        const CACHE_DIR = path.join(process.cwd(), 'data');
        const CACHE_FILE = path.join(CACHE_DIR, 'processed_onual_ids.json');
        
        console.log(`\n--- CACHE CHECK ---`);
        console.log(`Looking for cache at: ${CACHE_FILE}`);
        if (fs.existsSync(CACHE_FILE)) {
            const cacheData = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
            const cacheKeys = Object.keys(cacheData.ids);
            console.log(`Cache exists. Last update: ${cacheData.lastUpdate}`);
            console.log(`Number of cached IDs: ${cacheKeys.length}`);
            
            // Check if our first product is in cache
            const docId = `onual_${product.id}`;
            console.log(`Is product ${docId} in cache? ${cacheData.ids[docId] ? 'YES' : 'NO'}`);
            
            // Look at the highest IDs in cache
            const sortedNumbers = cacheKeys
                .map(k => parseInt(k.replace('onual_', '')))
                .filter(n => !isNaN(n))
                .sort((a,b) => b - a);
                
            console.log(`Top 5 highest IDs in cache: ${sortedNumbers.slice(0, 5).join(', ')}`);
            console.log(`Highest ID on current page: ${Math.max(...unique.map(p => parseInt(p.id)))}`);
            
        } else {
            console.log(`Cache file DOES NOT EXIST at ${CACHE_FILE}`);
        }

    } catch (e) {
        console.error("Error expected:", e);
    }
}

testFullPipeline();
