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

async function testFetch() {
    try {
        const html = await fetchHtml('https://onual.com/fiyat/');
        const $ = cheerio.load(html);
        const allLinks = $('a[href*="/fiyat/"]');
        
        console.log(`Found ${allLinks.length} links with /fiyat/`);
        
        let foundPattern = 0;
        
        allLinks.each((_, el) => {
            const href = $(el).attr('href');
            if (!href) return;
            
            // This is the pattern currently in auto-onual.js
            if (href.match(/\/fiyat\/[^/]+-p-\d+\.html/i)) {
                foundPattern++;
                if (foundPattern <= 5) {
                    console.log(`MATCHED: ${href}`);
                }
            } else {
                // If it's a product link but doesn't match the old pattern
                if (href !== "https://onual.com/fiyat/" && href !== "/fiyat/") {
                   // console.log(`UNMATCHED: ${href}`);
                }
            }
        });
        
        console.log(`\nLinks matching old pattern (/-p-\\d+\\.html/): ${foundPattern}`);
        
        // Let's find what the new product links look like
        console.log("\nSample of actual product links on the page:");
        let sampleCount = 0;
        allLinks.each((_, el) => {
            const href = $(el).attr('href');
            if (!href || href === "https://onual.com/fiyat/" || href === "/fiyat/" || href === "#") return;
            
            // Print out the first 10 distinct, non-trivial links
            if (sampleCount < 10 && href.length > 20) {
                console.log(`EXAMPLE: ${href}`);
                const title = $(el).text().trim() || $(el).attr('title') || '';
                if (title) console.log(`  TITLE: ${title}`);
                sampleCount++;
            }
        });
        
        
    } catch (e) {
        console.error("Error fetching:", e);
    }
}

testFetch();
