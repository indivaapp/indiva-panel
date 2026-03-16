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
        console.log(`HTML length: ${html.length}`);
        
        // Let's see if there are Cloudflare protections
        if (html.includes('Cloudflare') || html.includes('Just a moment...')) {
            console.log("CLOUDFLARE DETECTED");
        }
        
        const $ = cheerio.load(html);
        const allLinks = $('a[href*="/fiyat/"]');
        console.log(`Found ${allLinks.length} links with /fiyat/`);
        
        // Print first 5 links
        allLinks.slice(0, 5).each((_, el) => {
            console.log($(el).attr('href'));
        });
        
    } catch (e) {
        console.error("Error fetching:", e);
    }
}

testFetch();
