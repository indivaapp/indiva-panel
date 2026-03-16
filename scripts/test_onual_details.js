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

async function testDetails() {
    try {
        const url = 'https://onual.com/fiyat/bosch-sms4iki62t-6-programli-bulasik-makinesi-p-1447322.html';
        const html = await fetchHtml(url);
        const $ = cheerio.load(html);
        
        console.log("=== PRODUCT DETAILS ===");
        
        // 1. Check for the old "buton" id
        const button = $('#buton');
        console.log(`id="buton" exists: ${button.length > 0}`);
        console.log(`button href: ${button.attr('href')}`);
        
        // Let's find any a tag that looks like a store link
        console.log("\nLooking for store links:");
        $('a').each((_, el) => {
            const href = $(el).attr('href');
            const text = $(el).text().trim();
            if (href && (href.includes('git') || href.includes('http'))) {
                 // console.log(`LINK: ${text} -> ${href}`);
                 if($(el).attr('id') !== undefined || $(el).attr('class')?.includes('btn') || $(el).attr('class')?.includes('button')) {
                      console.log(`POTENTIAL BUTTON: id=${$(el).attr('id')} class=${$(el).attr('class')} href=${href} text=${text}`);
                 }
            }
        });
        
    } catch (e) {
        console.error("Error fetching:", e);
    }
}

testDetails();
