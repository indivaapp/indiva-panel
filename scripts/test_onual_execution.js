import * as cheerio from 'cheerio';
import * as fs from 'fs';
import * as path from 'path';

// --- Mocks ---
const db = {
    collection: (col) => ({
        where: () => ({
            select: () => ({
                get: async () => ({ docs: [] })
             })
        }),
        doc: (id) => ({
            set: async (data) => {
                console.log(`   [MOCK FIREBASE] Simulated save for ${id}:`, data.title.substring(0, 50) + "...");
                return true;
            }
        })
    })
};

const FieldValue = {
    serverTimestamp: () => new Date().toISOString()
};

// --- Config ---
const ONUAL_URL = 'https://onual.com/fiyat/';
const MAX_NEW_PRODUCTS = 3; 

const CATEGORY_MAP = [
    { keywords: ['klavye', 'mouse', 'fare', 'monitör', 'bilgisayar', 'laptop', 'notebook', 'tablet', 'telefon', 'kulaklık', 'hoparlör', 'kamera', 'projeksiyon', 'ssd', 'harddisk', 'şarj', 'powerbank', 'kablo', 'adaptör'], category: 'Teknoloji' },
    { keywords: ['mont', 'ceket', 'kazak', 'gömlek', 'pantolon', 'şort', 'elbise', 'bluz', 'tişört', 'sweatshirt', 'polar', 'ayakkabı', 'sneaker', 'bot', 'sandalet', 'çanta', 'sırt çantası', 'bere', 'eldiven', 'çorap', 'yelek', 'kemer', 'cüzdan'], category: 'Giyim & Ayakkabı' },
    { keywords: ['şampuan', 'krem', 'losyon', 'maske', 'serum', 'parfüm', 'deodorant', 'saç', 'cilt', 'diş', 'tıraş', 'makyaj', 'ruj', 'oje', 'ped', 'orkid', 'hijyen', 'sabun', 'duş jeli', 'vücut spreyi'], category: 'Kozmetik & Kişisel Bakım' },
    { keywords: ['tencere', 'tava', 'çaydanlık', 'bıçak', 'kaşık', 'tabak', 'bardak', 'fincan', 'yemek takımı', 'çay takımı', 'mobilya', 'masa', 'sandalye', 'yatak', 'dolap', 'nevresim', 'perde', 'halı', 'kilim', 'aydınlatma', 'lamba'], category: 'Ev, Yaşam & Mutfak' },
    { keywords: ['deterjan', 'sabun', 'temizlik', 'bez', 'süpürge', 'mop', 'fırça', 'çöp', 'bakliyat', 'yağ', 'şeker', 'çay', 'kahve', 'atıştırmalık', 'makarna', 'peynir', 'süt', 'yoğurt'], category: 'Süpermarket' }
];

const STORE_MAP = [
    { domain: 'trendyol.com', name: 'Trendyol' },
    { domain: 'hepsiburada.com', name: 'Hepsiburada' },
    { domain: 'amazon.com.tr', name: 'Amazon' },
    { domain: 'amazon.com', name: 'Amazon' },
    { domain: 'n11.com', name: 'n11' }
];

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36';

async function fetchHtml(url, timeoutMs = 15000, retries = 2) {
    for (let i = 0; i <= retries; i++) {
        try {
            const res = await fetch(url, {
                headers: {
                    'User-Agent': USER_AGENT,
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                    'Accept-Language': 'tr-TR,tr;q=0.9,en;q=0.7',
                    'Referer': 'https://onual.com/',
                    'Cache-Control': 'no-cache'
                },
                signal: AbortSignal.timeout(timeoutMs),
                redirect: 'follow',
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            return await res.text();
        } catch (err) {
            if (i === retries) throw err;
            console.log(`      ⚠️  İstek hatası, yeniden deneniyor (${i + 1}/${retries})...`);
            await sleep(2000);
        }
    }
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function detectStore(storeUrl) {
    if (!storeUrl) return { name: 'Online Mağaza', domain: '' };
    for (const store of STORE_MAP) {
        if (storeUrl.includes(store.domain)) return store;
    }
    return { name: 'Online Mağaza', domain: '' };
}

function detectCategory(title) {
    const lower = title.toLowerCase();
    for (const { keywords, category } of CATEGORY_MAP) {
        if (keywords.some(kw => lower.includes(kw))) return category;
    }
    return 'Ev, Yaşam & Mutfak'; // default fallback 
}

function generateFallbackDescription(productTitle, discountPercent) {
    return `İnanılmaz bir fırsat! ${productTitle} şimdi stoklarda. Hem kullanışlı hem de kaliteli.`;
}

function cleanProductTitle(title) {
    return title.replace(/\s+\d{5,}[-]\d+\s*$/g, '').replace(/\s+/g, ' ').trim();
}

function simulateOldPrice(newPrice) {
    const discountRatio = 0.20 + Math.random() * 0.40;
    const oldPrice = Math.round(newPrice / (1 - discountRatio));
    return Math.round(oldPrice / 5) * 5;
}

// ─── Extractors ───
async function fetchProductList() {
    console.log('📡 onual.com/fiyat/ çekiliyor...');
    const html = await fetchHtml(ONUAL_URL);
    const $ = cheerio.load(html);
    const products = [];

    const allLinks = $('a[href*="/fiyat/"]');
    console.log(`🔍 Sayfada toplam ${allLinks.length} adet /fiyat/ linki bulundu.`);

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
            newPrice: price,
            rawUrl: href,
        });
    });

    const seen = new Set();
    const unique = products.filter(p => {
        if (seen.has(p.id)) return false;
        seen.add(p.id);
        return true;
    });

    console.log(`✅ ${unique.length} benzersiz ürün parse edildi.`);
    return unique;
}

async function fetchProductDetails(product) {
    try {
        const html = await fetchHtml(product.url);
        const $ = cheerio.load(html);

        const button = $('#buton');
        let intermediateLink = button.attr('href') || product.url;

        let newPrice = product.newPrice || 0;
        let oldPrice = 0;

        $('script[type="application/ld+json"]').each((_, el) => {
            try {
                const data = JSON.parse($(el).html() || '{}');
                if (data['@type'] === 'Product' || data.offers) {
                    const offers = data.offers || data;
                    if (offers.price && !newPrice) newPrice = parseFloat(String(offers.price).replace(',', '.'));
                    if (offers.highPrice) oldPrice = parseFloat(String(offers.highPrice).replace(',', '.'));
                }
            } catch { }
        });

        if (!oldPrice) {
            const strikeText = $('del, s, .old-price, .price-old, .original-price, [class*="crossed"], [class*="line-through"]').first().text().replace(/[^\d.,]/g, '').trim();
            if (strikeText) oldPrice = parseFloat(strikeText.replace(',', '.')) || 0;
        }

        if (!newPrice) {
            const priceText = $('.current-price, .new-price, .sale-price, [class*="current"], [itemprop="price"]').first().text().replace(/[^\d.,]/g, '').trim();
            if (priceText) newPrice = parseFloat(priceText.replace(',', '.')) || 0;
        }

        let imageUrl = '';
        const ogImage = $('meta[property="og:image"]').attr('content');
        if (ogImage && ogImage.startsWith('http')) imageUrl = ogImage;

        if (!imageUrl) {
            const mainImg = $('img[class*="product"], img[id*="product"], .product-image img, .main-image img').first().attr('src');
            if (mainImg && mainImg.startsWith('http')) imageUrl = mainImg;
        }

        let title = product.title;
        const h1Title = $('h1').first().text().trim();
        if (h1Title && h1Title.length > title.length) title = h1Title;
        
        const metaDesc = $('meta[name="description"]').attr('content') || '';

        if (intermediateLink && !intermediateLink.startsWith('http')) {
            intermediateLink = `https://onual.com${intermediateLink}`;
        }

        return { imageUrl, newPrice, oldPrice, intermediateLink, title, metaDescription: metaDesc };
    } catch (err) {
        console.warn(`   ⚠️  Detay sayfası parse hatası (${product.url}): ${err.message}`);
        return null;
    }
}

async function resolveStoreLink(intermediateUrl, timeoutMs = 12000) {
    try {
        const urlObj = new URL(intermediateUrl);
        const encodedTarget = urlObj.searchParams.get('url');
        if (encodedTarget) {
            const decoded = decodeURIComponent(encodedTarget);
            const isStore = STORE_MAP.some(s => decoded.includes(s.domain));
            if (isStore) {
                console.log(`   ✅ URL param'dan mağaza linki alındı: ${decoded.substring(0, 80)}...`);
                return decoded;
            }
        }

        const response = await fetch(intermediateUrl, {
            method: 'GET',
            headers: { 'User-Agent': USER_AGENT, 'Accept': 'text/html,application/xhtml+xml,*/*' },
            signal: AbortSignal.timeout(timeoutMs),
            redirect: 'follow',
        });

        const finalUrl = response.url;
        const isStore = STORE_MAP.some(s => finalUrl.includes(s.domain));
        if (isStore) {
            console.log(`   ✅ HTTP redirect ile mağaza linki: ${finalUrl.substring(0, 80)}...`);
            return finalUrl;
        }

        return null;
    } catch (err) {
        console.warn(`   ⚠️  Link resolve hatası: ${err.message}`);
        return null;
    }
}

async function testMain() {
    console.log('\n🚀 INDIVA Auto-Onual Mock Pipeline Başlatıldı');
    
    const allProducts = await fetchProductList();
    const sorted = [...allProducts].sort((a, b) => parseInt(a.id) - parseInt(b.id));
    const toProcess = sorted.slice(-MAX_NEW_PRODUCTS); // En yenileri işle
    
    console.log(`\n📊 Durum: ${toProcess.length} aday işlenecek\n`);

    for (let i = 0; i < toProcess.length; i++) {
        const product = toProcess[i];
        const docId = `onual_${product.id}`;

        try {
            console.log(`\n[${i + 1}/${toProcess.length}] 📦 ${product.title.substring(0, 60)}...`);
            const docRef = db.collection('discounts').doc(docId);
            await sleep(1000);

            const details = await fetchProductDetails(product);
            if (!details || !details.imageUrl) {
                console.warn(`   ⚠️  Sorunlu ürün, atlanıyor`);
                continue;
            }

            let storeLink = null;
            if (details.intermediateLink) {
                const isDirectStore = STORE_MAP.some(s => details.intermediateLink.includes(s.domain)) &&
                    !details.intermediateLink.includes('zxro.com') &&
                    !details.intermediateLink.includes('onu.al') &&
                    !details.intermediateLink.includes('knv.al');

                if (isDirectStore) {
                    storeLink = details.intermediateLink;
                } else {
                    console.log(`   🔄 Linki çözüyorum: ${details.intermediateLink.substring(0, 70)}...`);
                    storeLink = await resolveStoreLink(details.intermediateLink);
                }
            }

            if (!storeLink) {
                console.warn(`   ⚠️  Mağaza linki çözülemedi, atlanıyor (Fallback'e girmeden!)`);
                continue; 
            }

            const newPrice = details.newPrice || product.newPrice || 0;
            const oldPrice = details.oldPrice || simulateOldPrice(newPrice);
            const store = detectStore(storeLink);

            console.log(`   💰 Fiyat: ${oldPrice} TL -> ${newPrice} TL | Mağaza: ${store.name}`);

            // Skipping AI for local testing, just mock it
            const aiData = { category: detectCategory(details.title), description: generateFallbackDescription(details.title, 0) };

            const cleanedTitle = cleanProductTitle(details.title || product.title);
            const discountData = {
                title: cleanedTitle.substring(0, 200),
                description: aiData.description,
                brand: store.name,
                category: aiData.category,
                link: storeLink,
                oldPrice,
                newPrice,
                imageUrl: details.imageUrl,
            };

            await docRef.set(discountData);

        } catch (itemErr) {
            console.error(`   ❌ Ürün işleme hatası: ${itemErr.message}`);
        }
    }
    
    console.log('\n✅ Mock Test Tamamlandı.');
}

testMain();
