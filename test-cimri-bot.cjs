// Cimri.com Bot Koruması Test Script
const https = require('https');

const testUrls = [
    'https://www.cimri.com/indirimler',
    'https://www.cimri.com/',
    'https://www.cimri.com/sitemap.xml'
];

console.log('🔍 Cimri.com Bot Koruması Test Ediliyor...\n');

async function testUrl(url) {
    return new Promise((resolve) => {
        const urlObj = new URL(url);

        const options = {
            hostname: urlObj.hostname,
            path: urlObj.pathname + urlObj.search,
            method: 'GET',
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'Accept-Language': 'tr-TR,tr;q=0.9,en-US;q=0.8,en;q=0.7',
                'Accept-Encoding': 'gzip, deflate, br',
                'Referer': 'https://www.google.com/',
                'Connection': 'keep-alive'
            }
        };

        const req = https.request(options, (res) => {
            let data = '';

            res.on('data', (chunk) => {
                data += chunk;
            });

            res.on('end', () => {
                const result = {
                    url: url,
                    statusCode: res.statusCode,
                    headers: res.headers,
                    bodyLength: data.length,
                    hasCloudflare: data.includes('cloudflare') || data.includes('cf-ray'),
                    hasRecaptcha: data.includes('recaptcha') || data.includes('captcha'),
                    hasContent: data.length > 5000,
                    contentPreview: data.substring(0, 500)
                };

                resolve(result);
            });
        });

        req.on('error', (e) => {
            resolve({
                url: url,
                error: e.message
            });
        });

        req.setTimeout(10000, () => {
            req.destroy();
            resolve({
                url: url,
                error: 'Timeout'
            });
        });

        req.end();
    });
}

async function runTests() {
    for (const url of testUrls) {
        console.log(`\n${'='.repeat(80)}`);
        console.log(`Testing: ${url}`);
        console.log('='.repeat(80));

        const result = await testUrl(url);

        if (result.error) {
            console.log(`❌ Hata: ${result.error}`);
        } else {
            console.log(`\n📊 Sonuç:`);
            console.log(`   Status Code: ${result.statusCode}`);
            console.log(`   Content Length: ${result.bodyLength} bytes`);
            console.log(`   Cloudflare: ${result.hasCloudflare ? '⚠️ VAR' : '✅ YOK'}`);
            console.log(`   Recaptcha: ${result.hasRecaptcha ? '⚠️ VAR' : '✅ YOK'}`);
            console.log(`   İçerik Var: ${result.hasContent ? '✅ EVET' : '❌ HAYIR'}`);

            if (result.statusCode === 200) {
                console.log(`\n✅ Erişim Başarılı!`);
            } else if (result.statusCode === 403) {
                console.log(`\n⚠️ 403 Forbidden - Bot koruması olabilir`);
            } else if (result.statusCode === 503) {
                console.log(`\n⚠️ 503 Service Unavailable - Cloudflare challenge`);
            }

            // Server header kontrolü
            const server = result.headers['server'];
            if (server) {
                console.log(`   Server: ${server}`);
                if (server.toLowerCase().includes('cloudflare')) {
                    console.log(`   ⚠️ Cloudflare koruması aktif`);
                }
            }

            // Content-Type kontrolü
            const contentType = result.headers['content-type'];
            if (contentType) {
                console.log(`   Content-Type: ${contentType}`);
            }

            console.log(`\n📄 İçerik Önizleme (ilk 500 karakter):`);
            console.log(result.contentPreview);
        }

        // Rate limiting için bekleme
        await new Promise(r => setTimeout(r, 2000));
    }

    console.log(`\n${'='.repeat(80)}`);
    console.log('Test Tamamlandı!');
    console.log('='.repeat(80));
}

runTests().catch(console.error);
