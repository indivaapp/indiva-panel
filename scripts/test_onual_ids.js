import * as cheerio from 'cheerio';

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

async function testIds() {
    try {
        const html = await fetchHtml('https://onual.com/fiyat/');
        const $ = cheerio.load(html);
        const products = [];

        const allLinks = $('a[href*="/fiyat/"]');
        allLinks.each((_, el) => {
            const href = $(el).attr('href');
            if (!href || !href.match(/\/fiyat\/[^/]+-p-\d+\.html/i)) return;

            const fullUrl = href.startsWith('http') ? href : `https://onual.com${href}`;
            const idMatch = fullUrl.match(/-p-(\d+)\.html/);
            const productId = idMatch ? parseInt(idMatch[1]) : null;
            if (!productId) return;
            
            const title = $(el).text().trim() || $(el).attr('title') || '';
            const cleanTitle = title.replace(/\s+/g, ' ').trim();

            products.push({
                id: productId,
                title: cleanTitle,
                url: fullUrl
            });
        });

        // Unique
        const seen = new Set();
        const unique = products.filter(p => {
            if (seen.has(p.id)) return false;
            seen.add(p.id);
            return true;
        });

        console.log(`Found ${unique.length} unique products.`);
        
        // Sort by ID descending
        unique.sort((a,b) => b.id - a.id);
        
        console.log("\n--- TOP 30 HIGHEST IDs ---");
        for (let i = 0; i < Math.min(30, unique.length); i++) {
            console.log(`${unique[i].id} - ${unique[i].title.substring(0, 50)}`);
        }
        
        // Sort by original page order
        console.log("\n--- FIRST 15 PRODUCTS ON PAGE ---");
        for (let i = 0; i < Math.min(15, unique.length); i++) {
           // We need original array for this
        }
        
        const originalUnique = [];
        const seen2 = new Set();
        for(const p of products) {
            if(!seen2.has(p.id)) {
                seen2.add(p.id);
                originalUnique.push(p);
            }
        }
        
        for (let i = 0; i < Math.min(15, originalUnique.length); i++) {
            console.log(`[Pos ${i}] ID: ${originalUnique[i].id} - ${originalUnique[i].title.substring(0, 50)}`);
        }
        
    } catch (e) {
        console.error("Error fetching:", e);
    }
}

testIds();
