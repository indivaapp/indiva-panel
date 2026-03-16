// Trendyol API Test Script
const https = require('https');

const url = 'public.trendyol.com';
const path = '/discovery-web-searchgw-service/v2/api/infinite-scroll?pi=1&culture=tr-TR&storefrontId=1&discountedPriceInfo=true';

const options = {
    hostname: url,
    path: path,
    method: 'GET',
    headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
        'Accept': 'application/json',
        'Accept-Language': 'tr-TR,tr;q=0.9',
        'Referer': 'https://www.trendyol.com/'
    }
};

console.log('🔍 Trendyol API\'den indirimli ürünler çekiliyor...\n');

const req = https.request(options, (res) => {
    let data = '';

    console.log('Status Code:', res.statusCode);
    console.log('Headers:', JSON.stringify(res.headers, null, 2));
    console.log('\n');

    res.on('data', (chunk) => {
        data += chunk;
    });

    res.on('end', () => {
        try {
            const json = JSON.parse(data);

            if (json.result && json.result.products) {
                const products = json.result.products;

                console.log('✅ BAŞARILI!\n');
                console.log(`📦 Toplam ${products.length} indirimli ürün bulundu\n`);
                console.log('='.repeat(80) + '\n');

                // İlk 5 ürünü detaylı göster
                products.slice(0, 5).forEach((p, i) => {
                    const discount = p.price?.discountRate || 0;
                    const oldPrice = p.price?.originalPrice || 0;
                    const newPrice = p.price?.sellingPrice || 0;
                    const savings = oldPrice - newPrice;

                    console.log(`${i + 1}. ${p.name}`);
                    console.log(`   💰 Eski Fiyat: ${oldPrice.toLocaleString('tr-TR')} TL`);
                    console.log(`   💵 Yeni Fiyat: ${newPrice.toLocaleString('tr-TR')} TL`);
                    console.log(`   📉 İndirim: %${discount} (${savings.toLocaleString('tr-TR')} TL tasarruf)`);
                    console.log(`   🏷️  Marka: ${p.brand?.name || 'Belirtilmemiş'}`);
                    console.log(`   🔗 Link: https://www.trendyol.com${p.url}`);
                    console.log(`   ⭐ Puan: ${p.ratingScore?.toFixed(1) || 'N/A'} (${p.reviewsCount || 0} yorum)`);
                    console.log('');
                });

                console.log('='.repeat(80));
                console.log('\n📊 İstatistikler:');

                // İndirim oranlarına göre grupla
                const highDiscount = products.filter(p => (p.price?.discountRate || 0) >= 50).length;
                const mediumDiscount = products.filter(p => {
                    const d = p.price?.discountRate || 0;
                    return d >= 30 && d < 50;
                }).length;
                const lowDiscount = products.filter(p => {
                    const d = p.price?.discountRate || 0;
                    return d >= 20 && d < 30;
                }).length;

                console.log(`   %50+ indirim: ${highDiscount} ürün`);
                console.log(`   %30-49 indirim: ${mediumDiscount} ürün`);
                console.log(`   %20-29 indirim: ${lowDiscount} ürün`);

            } else {
                console.log('❌ Beklenmeyen yanıt formatı');
                console.log('Yanıt:', JSON.stringify(json, null, 2).substring(0, 500));
            }
        } catch (e) {
            console.error('❌ JSON Parse Hatası:', e.message);
            console.log('Ham yanıt (ilk 1000 karakter):');
            console.log(data.substring(0, 1000));
        }
    });
});

req.on('error', (e) => {
    console.error('❌ İstek Hatası:', e.message);
});

req.end();
