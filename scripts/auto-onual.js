/**
 * auto-onual.js — INDIVA Otomatik Fırsat Pipeline
 * 
 * onual.com/fiyat/ sitesini tarar, MiniMax M2.5 ile açıklama üretir,
 * gerçek mağaza linkini resolve ederek Firebase'e kaydeder.
 * 
 * Çalıştırma: node scripts/auto-onual.js
 */

import * as cheerio from 'cheerio';
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import * as fs from 'fs';
import * as path from 'path';

// ─── .env Yükle (lokal geliştirme) ─────────────────────────────────────────
// GitHub Actions'da ortam değişkenleri zaten set edilmiş olur
// Lokal'de .env dosyasını okuyoruz (dotenv paketi olmadan)
const ROOT_DIR = process.cwd(); // script her zaman proje kökünden çalıştırılmalı
const envPath = path.join(ROOT_DIR, '.env');
if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf8');
    for (const line of envContent.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eqIdx = trimmed.indexOf('=');
        if (eqIdx < 0) continue;
        const key = trimmed.substring(0, eqIdx).trim();
        const val = trimmed.substring(eqIdx + 1).trim().replace(/^["']|["']$/g, '');
        if (!process.env[key]) process.env[key] = val;
    }
}


// ─── Config ──────────────────────────────────────────────────────────────────

const ONUAL_URL = 'https://onual.com/fiyat/';
const MAX_NEW_PRODUCTS = 10; // Her çalışmada en fazla kaç ürün işlensin
const REQUEST_DELAY_MS = 2000; // İstekler arası bekleme (ms)

// Kategorileri tespit için anahtar kelimeler
const CATEGORY_MAP = [
    { keywords: ['klavye', 'mouse', 'fare', 'monitör', 'bilgisayar', 'laptop', 'notebook', 'tablet', 'telefon', 'kulaklık', 'hoparlör', 'kamera', 'projeksiyon', 'ssd', 'harddisk'], category: 'Elektronik' },
    { keywords: ['mont', 'ceket', 'kazak', 'gömlek', 'pantolon', 'şort', 'elbise', 'bluz', 'tişört', 'sweatshirt', 'polar', 'ayakkabı', 'sneaker', 'bot', 'sandalet', 'çanta', 'sırt çantası', 'bere', 'eldiven', 'çorap'], category: 'Giyim & Ayakkabı' },
    { keywords: ['şampuan', 'krem', 'losyon', 'maske', 'serum', 'parfüm', 'deodorant', 'saç', 'cilt', 'diş', 'tıraş'], category: 'Kozmetik & Kişisel Bakım' },
    { keywords: ['deterjan', 'sabun', 'temizlik', 'bez', 'süpürge', 'mop', 'fırça', 'çöp'], category: 'Temizlik & Ev Bakımı' },
    { keywords: ['tencere', 'tava', 'çaydanlık', 'bıçak', 'kaşık', 'tabak', 'bardak', 'fincan', 'yemek takımı', 'çay takımı'], category: 'Mutfak & Sofra' },
    { keywords: ['bebek', 'oyuncak', 'çocuk', 'emzik', 'bez'], category: 'Bebek & Oyuncak' },
    { keywords: ['vitamin', 'takviye', 'kapsül', 'şurup', 'macun'], category: 'Sağlık & Vitamin' },
    { keywords: ['kalem', 'defter', 'boya', 'çizim', 'kağıt', 'resim'], category: 'Kırtasiye & Hobi' },
    { keywords: ['kamp', 'spor', 'fitness', 'outdoor', 'ayakkabı'], category: 'Spor & Outdoor' },
];

// Mağaza tespiti
const STORE_MAP = [
    { domain: 'trendyol.com', name: 'Trendyol' },
    { domain: 'hepsiburada.com', name: 'Hepsiburada' },
    { domain: 'amazon.com.tr', name: 'Amazon' },
    { domain: 'amazon.com', name: 'Amazon' },
    { domain: 'n11.com', name: 'n11' },
    { domain: 'gittigidiyor.com', name: 'GittiGidiyor' },
    { domain: 'pazarama.com', name: 'Pazarama' },
    { domain: 'ciceksepeti.com', name: 'ÇiçekSepeti' },
    { domain: 'teknosa.com', name: 'Teknosa' },
    { domain: 'vatan.com.tr', name: 'Vatan' },
    { domain: 'mediamarkt.com.tr', name: 'MediaMarkt' },
    { domain: 'boyner.com.tr', name: 'Boyner' },
    { domain: 'lcwaikiki.com', name: 'LC Waikiki' },
    { domain: 'zara.com', name: 'Zara' },
    { domain: 'koton.com', name: 'Koton' },
    { domain: 'morhipo.com', name: 'Morhipo' },
    { domain: 'defacto.com.tr', name: 'DeFacto' },
];

// ─── Firebase ────────────────────────────────────────────────────────────────

function initFirebase() {
    if (getApps().length > 0) return getFirestore();

    let serviceAccount;
    const envJson = process.env.FIREBASE_SERVICE_ACCOUNT;

    if (envJson) {
        serviceAccount = JSON.parse(envJson);
    } else {
        // Lokal geliştirme için service account dosyası
        const localPath = path.join(ROOT_DIR, 'firebase-service-account.json');
        if (fs.existsSync(localPath)) {
            serviceAccount = JSON.parse(fs.readFileSync(localPath, 'utf8'));
        } else {
            throw new Error('Firebase service account bulunamadı. FIREBASE_SERVICE_ACCOUNT env değişkenini ayarlayın veya firebase-service-account.json dosyasını ekleyin.');
        }
    }

    initializeApp({ credential: cert(serviceAccount) });
    return getFirestore();
}

// ─── OpenRouter AI ───────────────────────────────────────────────────────────

function getOpenRouterKey() {
    const key = process.env.OPENROUTER_API_KEY;
    if (!key) throw new Error('OPENROUTER_API_KEY env değişkeni eksik');
    return key;
}

/**
 * Ürün başlığındaki gereksiz kodları ve numaraları temizle
 */
function cleanProductTitle(title) {
    return title
        // Sondaki ürün kodlarını sil (örn: "Ürün Adı - ABC123", "Ürün Adı 50276557-VR090")
        .replace(/[-–]\s*[A-Z0-9]{4,}(?:[\-_][A-Z0-9]+)*\s*$/i, '')
        // Parantez içindeki kodları sil (örn: "(HB000018U0DJ)")
        .replace(/\([A-Z0-9]{5,}\)\s*$/i, '')
        // Başlık sonundaki kısa büyük harf kodları (örn: "Eld01", "Eld-01")
        .replace(/\s+[A-Z][a-z]?[0-9]{2,}\s*$/g, '')
        // Çift boşlukları temizle
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * Eski fiyat yoksa yeni fiyattan %20-%60 arası rastgele simüle et
 */
function simulateOldPrice(newPrice) {
    const discountRatio = 0.20 + Math.random() * 0.40; // %20 ile %60 arası
    const oldPrice = Math.round(newPrice / (1 - discountRatio));
    // 5'e yuvarla (daha gerçekçi görünsün)
    return Math.round(oldPrice / 5) * 5;
}

/**
 * OpenRouter üzerinden MiniMax M2.5 ile Türkçe ürün açıklaması oluştur
 */
async function generateDescription(apiKey, productTitle, newPrice, oldPrice, storeName) {
    const discountPercent = oldPrice > 0 ? Math.round(((oldPrice - newPrice) / oldPrice) * 100) : 0;

    const prompt = `Sen bir Türk e-ticaret uygulamasının metin yazarısın. Aşağıdaki ürünü kullanıcılara sattırmayı amaçlayan, eğlenceli ve samimi bir Türkçe ürün tanıtım metni yaz.

Kurallar:
- Tam olarak 50-70 kelime olmalı
- Emoji kullanma
- Fiyat rakamı yazma
- Ürünün faydalarını ve cazibesini ön plana çıkar
- Kullanıcıyı harekete geçirecek bir kapanış cümlesi ekle
- Sadece açıklama metnini yaz, başka hiçbir şey ekleme

Ürün: ${productTitle}
Mağaza: ${storeName || 'Online Mağaza'}${discountPercent > 0 ? `
Indirim: %${discountPercent}` : ''}`;

    try {
        const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
                'HTTP-Referer': 'https://indiva.app',
                'X-Title': 'INDIVA Auto-Onual',
            },
            body: JSON.stringify({
                model: 'minimax/minimax-m2.5',
                max_tokens: 150,
                messages: [{ role: 'user', content: prompt }],
            }),
            signal: AbortSignal.timeout(20000),
        });

        if (!res.ok) {
            const errText = await res.text();
            throw new Error(`${res.status} ${errText}`);
        }

        const data = await res.json();
        return data.choices?.[0]?.message?.content?.trim() || '';
    } catch (err) {
        console.warn(`⚠️  AI açıklama üretilemedi: ${err.message}`);
        return '';
    }
}

// ─── HTTP Utilities ──────────────────────────────────────────────────────────

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36';

/**
 * URL'ye GET isteği at, HTML döndür
 */
async function fetchHtml(url, timeoutMs = 15000) {
    const response = await fetch(url, {
        headers: {
            'User-Agent': USER_AGENT,
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'tr-TR,tr;q=0.9,en;q=0.7',
        },
        signal: AbortSignal.timeout(timeoutMs),
        redirect: 'follow',
    });

    if (!response.ok) throw new Error(`HTTP ${response.status} — ${url}`);
    return response.text();
}

/**
 * Redirect zincirini takip ederek gerçek mağaza URL'sini bul
 * Strateji 1: zxro.com/u/?url=ENCODED_URL → parametredeki URL'yi decode et (en hızlı yol)
 * Strateji 2: HTTP follow redirect → final URL mağaza ise kullan
 * Strateji 3: HTML içinde meta refresh veya JS redirect ara
 */
async function resolveStoreLink(intermediateUrl, timeoutMs = 12000) {
    try {
        // ── Strateji 1: zxro.com ve benzeri aracılardaki url= parametresini oku ──
        // Örnek: https://zxro.com/u/?redirect=1&url=https%3A%2F%2Fwww.amazon.com.tr%2F...
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

        // ── Strateji 2: HTTP redirect follow ────────────────────────────────────
        const response = await fetch(intermediateUrl, {
            method: 'GET',
            headers: {
                'User-Agent': USER_AGENT,
                'Accept': 'text/html,application/xhtml+xml,*/*',
            },
            signal: AbortSignal.timeout(timeoutMs),
            redirect: 'follow',
        });

        const finalUrl = response.url;
        const isStore = STORE_MAP.some(s => finalUrl.includes(s.domain));
        if (isStore) {
            console.log(`   ✅ HTTP redirect ile mağaza linki: ${finalUrl.substring(0, 80)}...`);
            return finalUrl;
        }

        // ── Strateji 3: HTML içindeki meta/JS redirect ───────────────────────────
        const html = await response.text();

        const metaRefresh = html.match(/url=["']?(https?:\/\/[^"'\s>]+)/i);
        if (metaRefresh) {
            const targetUrl = metaRefresh[1];
            if (STORE_MAP.some(s => targetUrl.includes(s.domain))) {
                console.log(`   ✅ Meta refresh ile mağaza linki: ${targetUrl.substring(0, 80)}...`);
                return targetUrl;
            }
        }

        const jsRedirect = html.match(/(?:window\.location(?:\.href)?\s*=\s*|location\.replace\()\s*["']?(https?:\/\/[^"'\s)]+)/i);
        if (jsRedirect) {
            const targetUrl = jsRedirect[1];
            if (STORE_MAP.some(s => targetUrl.includes(s.domain))) {
                console.log(`   ✅ JS redirect ile mağaza linki: ${targetUrl.substring(0, 80)}...`);
                return targetUrl;
            }
        }

        console.warn(`   ⚠️  Mağaza linki çözülemedi: ${intermediateUrl} → ${finalUrl}`);
        return null;
    } catch (err) {
        console.warn(`   ⚠️  Link resolve hatası: ${err.message}`);
        return null;
    }
}

/**
 * Gecikme fonksiyonu
 */
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// ─── Onual Parser ────────────────────────────────────────────────────────────

/**
 * onual.com/fiyat/ ana sayfasını parse et
 * Ürün adı, URL, yeni fiyat ver
 */
async function fetchProductList() {
    console.log('📡 onual.com/fiyat/ çekiliyor...');
    const html = await fetchHtml(ONUAL_URL);
    const $ = cheerio.load(html);
    const products = [];

    // Ürün listesi: her ürün bir <a> linki
    // onual.com'da ürünler genellikle .product-list veya <a> etiketli kartlar
    $('a[href*="/fiyat/"]').each((_, el) => {
        const href = $(el).attr('href');
        if (!href) return;

        // Sadece ürün sayfası linkleri (ana liste sayfası değil)
        if (!href.match(/\/fiyat\/[a-z0-9-]+-p-\d+\.html/)) return;

        const fullUrl = href.startsWith('http') ? href : `https://onual.com${href}`;

        // Fiyat varsa al (URL hash'indeki #fiyat=XXX formatı)
        const priceMatch = href.match(/#fiyat=(\d+)/);
        const price = priceMatch ? parseInt(priceMatch[1]) : 0;

        // Ürün adı - link text'inden
        const title = $(el).text().trim() || $(el).attr('title') || '';
        const cleanTitle = title.replace(/\s+/g, ' ').trim();

        if (!cleanTitle || cleanTitle.length < 3) return;

        // ID olarak URL'deki ürün kodu kullan
        const idMatch = fullUrl.match(/-p-(\d+)\.html/);
        const productId = idMatch ? idMatch[1] : null;
        if (!productId) return;

        products.push({
            id: productId,
            title: cleanTitle,
            url: fullUrl.split('#')[0], // Hash olmadan URL
            newPrice: price,
            rawUrl: href,
        });
    });

    // Tekrarları kaldır (aynı ID'ye göre)
    const seen = new Set();
    const unique = products.filter(p => {
        if (seen.has(p.id)) return false;
        seen.add(p.id);
        return true;
    });

    console.log(`✅ ${unique.length} benzersiz ürün listelendi`);
    return unique;
}

/**
 * Onual ürün detay sayfasını parse et
 * Görsel, eski fiyat, mağaza linki al
 */
async function fetchProductDetails(product) {
    try {
        const html = await fetchHtml(product.url);
        const $ = cheerio.load(html);

        // ── Görsel ──────────────────────────────────────────────────────
        let imageUrl = '';

        // 1. OG image (en güvenilir)
        const ogImage = $('meta[property="og:image"]').attr('content');
        if (ogImage && ogImage.startsWith('http')) {
            imageUrl = ogImage;
        }

        // 2. Twitter card image
        if (!imageUrl) {
            const twitterImage = $('meta[name="twitter:image"]').attr('content');
            if (twitterImage && twitterImage.startsWith('http')) imageUrl = twitterImage;
        }

        // 3. Ana ürün görseli
        if (!imageUrl) {
            const mainImg = $('img[class*="product"], img[id*="product"], .product-image img, .main-image img').first().attr('src');
            if (mainImg && mainImg.startsWith('http')) imageUrl = mainImg;
        }

        // ── Fiyatlar ────────────────────────────────────────────────────
        let newPrice = product.newPrice || 0;
        let oldPrice = 0;

        // JSON-LD'den fiyat çek
        $('script[type="application/ld+json"]').each((_, el) => {
            try {
                const data = JSON.parse($(el).html() || '{}');
                if (data['@type'] === 'Product' || data.offers) {
                    const offers = data.offers || data;
                    if (offers.price && !newPrice) {
                        newPrice = parseFloat(String(offers.price).replace(',', '.'));
                    }
                    if (offers.highPrice) {
                        oldPrice = parseFloat(String(offers.highPrice).replace(',', '.'));
                    }
                }
            } catch { }
        });

        // HTML'den eski fiyat çek (genellikle üstü çizili)
        if (!oldPrice) {
            const strikeText = $('del, s, .old-price, .price-old, .original-price, [class*="crossed"], [class*="line-through"]').first().text().replace(/[^\d.,]/g, '').trim();
            if (strikeText) {
                oldPrice = parseFloat(strikeText.replace(',', '.')) || 0;
            }
        }

        // HTML'den yeni fiyat çek
        if (!newPrice) {
            const priceText = $('.current-price, .new-price, .sale-price, [class*="current"], [itemprop="price"]').first().text().replace(/[^\d.,]/g, '').trim();
            if (priceText) {
                newPrice = parseFloat(priceText.replace(',', '.')) || 0;
            }
        }

        // ── Mağaza Linki ────────────────────────────────────────────────
        // Onual'da "Satın Al", "Mağazaya Git" veya "Fiyatı Gör" gibi butonlar var
        // Bu butonlar zxro.com veya benzeri aracı sitelere yönlendiriyor
        let intermediateLink = '';

        // Önce href'te bilinen aracı domain'leri ara
        const INTERMEDIATE_DOMAINS = ['zxro.com', 'onu.al', 'knv.al', 'onual.com/git'];
        const STORE_DOMAINS = STORE_MAP.map(s => s.domain);

        $('a[href]').each((_, el) => {
            if (intermediateLink) return; // Bulduktan sonra dur
            const href = $(el).attr('href') || '';

            // Doğrudan mağaza linki mi?
            if (STORE_DOMAINS.some(d => href.includes(d))) {
                intermediateLink = href;
                return;
            }

            // Aracı site mi?
            if (INTERMEDIATE_DOMAINS.some(d => href.includes(d))) {
                intermediateLink = href;
            }
        });

        // Eğer burada /git/ path'i varsa tam URL'ye çevir
        if (intermediateLink && !intermediateLink.startsWith('http')) {
            intermediateLink = `https://onual.com${intermediateLink}`;
        }

        // ── Ürün başlığı ─────────────────────────────────────────────────
        let title = product.title;
        const h1Title = $('h1').first().text().trim();
        if (h1Title && h1Title.length > title.length) {
            title = h1Title;
        }

        return {
            imageUrl,
            newPrice,
            oldPrice,
            intermediateLink,
            title,
        };
    } catch (err) {
        console.warn(`   ⚠️  Detay sayfası parse hatası (${product.url}): ${err.message}`);
        return null;
    }
}

/**
 * Mağaza adını URL'den tespit et
 */
function detectStore(storeUrl) {
    if (!storeUrl) return { name: 'Online Mağaza', domain: '' };
    for (const store of STORE_MAP) {
        if (storeUrl.includes(store.domain)) return store;
    }
    return { name: 'Online Mağaza', domain: '' };
}

/**
 * Ürün kategorisini başlıktan tespit et
 */
function detectCategory(title) {
    const lower = title.toLowerCase();
    for (const { keywords, category } of CATEGORY_MAP) {
        if (keywords.some(kw => lower.includes(kw))) return category;
    }
    return 'Genel';
}

// ─── Main Pipeline ───────────────────────────────────────────────────────────

async function main() {
    console.log('\n🚀 INDIVA Auto-Onual Pipeline Başlatıldı');
    console.log('═══════════════════════════════════════════');
    console.log(`⏰ ${new Date().toLocaleString('tr-TR')}\n`);

    // Bağımlılıkları başlat
    const db = initFirebase();
    const aiKey = getOpenRouterKey();

    // ── 1. Mevcut ürün ID'lerini al (duplicate önleme) ────────────────────
    console.log('🔍 Mevcut kayıtlar kontrol ediliyor...');
    const existingSnapshot = await db.collection('discounts')
        .select('telegramMessageId')
        .limit(1000)
        .get();

    const existingIds = new Set(
        existingSnapshot.docs
            .map(d => d.data().telegramMessageId)
            .filter(Boolean)
    );
    console.log(`   ${existingIds.size} mevcut ürün ID'si yüklendi\n`);

    // ── 2. onual.com/fiyat/ listesini çek ────────────────────────────────
    const allProducts = await fetchProductList();

    // Zaten kayıtlı olanları çıkar
    const newProducts = allProducts.filter(p => !existingIds.has(`onual_${p.id}`));

    // onual.com en yeni ürünleri en başa koyar.
    // Firebase'de en yeni ürün en son eklenmeli (createdAt sırası).
    // Bu yüzden işleme sırasını tersine çeviriyoruz:
    // En eski yeni ürün önce Firebase'e kaydedilsin, en yeni en sona.
    const toProcess = newProducts.slice(0, MAX_NEW_PRODUCTS).reverse();

    console.log(`\n📊 Durum: ${allProducts.length} ürün bulundu, ${newProducts.length} yeni, ${toProcess.length} işlenecek\n`);

    if (toProcess.length === 0) {
        console.log('✅ İşlenecek yeni ürün yok. Pipeline tamamlandı.');
        return;
    }

    // ── 3. Her ürünü işle ─────────────────────────────────────────────────
    let successCount = 0;
    let failCount = 0;

    for (let i = 0; i < toProcess.length; i++) {
        const product = toProcess[i];
        console.log(`\n[${i + 1}/${toProcess.length}] 📦 ${product.title.substring(0, 60)}...`);

        await sleep(REQUEST_DELAY_MS);

        // Detay sayfasını çek
        const details = await fetchProductDetails(product);
        if (!details) {
            failCount++;
            continue;
        }

        // Görsel yoksa atla
        if (!details.imageUrl) {
            console.warn(`   ⚠️  Görsel bulunamadı, atlanıyor`);
            failCount++;
            continue;
        }

        // Mağaza linkini çöz
        let storeLink = null;
        if (details.intermediateLink) {
            // Doğrudan mağaza linki ise kullan
            const isDirectStore = STORE_MAP.some(s => details.intermediateLink.includes(s.domain)) &&
                !details.intermediateLink.includes('zxro.com') &&
                !details.intermediateLink.includes('onu.al') &&
                !details.intermediateLink.includes('knv.al');

            if (isDirectStore) {
                storeLink = details.intermediateLink;
                console.log(`   ✅ Doğrudan mağaza linki bulundu`);
            } else {
                // Aracı linkse resolve et
                console.log(`   🔄 Linki çözüyorum: ${details.intermediateLink.substring(0, 70)}...`);
                storeLink = await resolveStoreLink(details.intermediateLink);
            }
        }

        // Mağaza linki bulunamadıysa atla
        if (!storeLink) {
            console.warn(`   ⚠️  Mağaza linki çözülemedi, atlanıyor`);
            failCount++;
            continue;
        }

        const store = detectStore(storeLink);
        const category = detectCategory(details.title || product.title);

        // Fiyat doğrulama ve eski fiyat simülasyonu
        const newPrice = details.newPrice || product.newPrice || 0;
        let oldPrice = details.oldPrice || 0;

        if (newPrice <= 0) {
            console.warn(`   ⚠️  Fiyat bulunamadı, atlanıyor`);
            failCount++;
            continue;
        }

        // Eski fiyat yoksa simüle et
        if (!oldPrice || oldPrice <= newPrice) {
            oldPrice = simulateOldPrice(newPrice);
            console.log(`   💡 Eski fiyat simüle edildi: ${oldPrice} TL (yeni: ${newPrice} TL)`);
        }

        // AI ile açıklama üret
        console.log(`   🤖 OpenRouter MiniMax M2.5 açıklama üretiyor...`);
        const description = await generateDescription(
            aiKey,
            details.title || product.title,
            newPrice,
            oldPrice,
            store.name
        );
        console.log(`   ✍️  Açıklama: "${description.substring(0, 80)}${description.length > 80 ? '...' : ''}"`);

        // Firebase'e kaydet
        const cleanedTitle = cleanProductTitle(details.title || product.title);
        const discountData = {
            title: cleanedTitle.substring(0, 200),
            description: description || `${store.name} üzerinde harika bir fırsat!`,
            brand: store.name,
            category,
            link: storeLink,                         // Gerçek mağaza linki
            originalStoreLink: storeLink,
            oldPrice: oldPrice || 0,
            newPrice,
            imageUrl: details.imageUrl,
            deleteUrl: '',                            // ImgBB kullanmıyoruz, doğrudan URL
            submittedBy: 'auto-onual-bot',
            isAd: false,
            affiliateLinkUpdated: false,              // Admin daha sonra affiliate link ekleyebilir
            originalSource: 'onual.com',
            storeName: store.name,
            telegramMessageId: `onual_${product.id}`, // Unique ID, duplicate önleme için
            autoPublishedAt: FieldValue.serverTimestamp(),
            createdAt: FieldValue.serverTimestamp(),
        };

        try {
            await db.collection('discounts').add(discountData);
            console.log(`   🔥 Firebase'e kaydedildi ✅`);
            successCount++;
        } catch (err) {
            console.error(`   ❌ Firebase kayıt hatası: ${err.message}`);
            failCount++;
        }
    }

    // ── 4. Özet ───────────────────────────────────────────────────────────
    console.log('\n═══════════════════════════════════════════');
    console.log('📊 PIPELINE TAMAMLANDI');
    console.log(`   ✅ Başarılı: ${successCount}`);
    console.log(`   ❌ Başarısız: ${failCount}`);
    console.log(`   ⏰ ${new Date().toLocaleString('tr-TR')}`);
    console.log('═══════════════════════════════════════════\n');
}

main().catch(err => {
    console.error('\n💥 KRİTİK HATA:', err.message);
    process.exit(1);
});
