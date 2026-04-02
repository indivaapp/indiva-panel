/**
 * auto-akakce.js — INDIVA Akakce Pipeline
 *
 * akakce.com "Son Yakalanan İndirimler" bölümünü Puppeteer + Stealth ile tarar,
 * en ucuz mağaza linkini resolve ederek Firebase'e kaydeder.
 *
 * Çalıştırma: node scripts/auto-akakce.js
 *
 * NOT: Mevcut auto-onual.js pipeline'ından tamamen bağımsızdır. Dokunmayın.
 */

import { addExtra } from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import puppeteerCore from 'puppeteer-core';
import { GoogleGenAI } from '@google/genai';
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore, FieldValue, FieldPath } from 'firebase-admin/firestore';
import * as fs from 'fs';
import * as path from 'path';
import { sendAdminAlert } from './alertService.js';

// ─── Puppeteer + Stealth kurulumu ─────────────────────────────────────────────
const puppeteer = addExtra(puppeteerCore);
puppeteer.use(StealthPlugin());

// ─── .env Yükle (lokal geliştirme) ──────────────────────────────────────────
const ROOT_DIR = process.cwd();
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
        if (val.includes('YOUR_') || val.includes('indiva-panel-...')) continue;
        if (!process.env[key]) process.env[key] = val;
    }
}

// ─── Config ──────────────────────────────────────────────────────────────────
const AKAKCE_URL = 'https://www.akakce.com/';
const MAX_NEW_PRODUCTS = 12;
const PAGE_TIMEOUT_MS = 20000;
const STEP_DELAY_MS = 1500;

// AI Config (aynı auto-onual.js mekanizması)
const MODEL = 'gemini-2.5-flash-lite';

// ─── Kategori & Mağaza Haritaları (auto-onual.js ile aynı) ───────────────────
const CATEGORY_MAP = [
    { keywords: ['klavye', 'mouse', 'fare', 'monitör', 'bilgisayar', 'laptop', 'notebook', 'tablet', 'telefon', 'iphone', 'samsung', 'xiaomi', 'kulaklık', 'hoparlör', 'kamera', 'ssd', 'harddisk', 'şarj', 'powerbank', 'kablo', 'adaptör', 'akıllı saat', 'scooter', 'drone', 'playstation', 'xbox', 'nintendo', 'router', 'modem', 'yazıcı'], category: 'Teknoloji' },
    { keywords: ['mont', 'ceket', 'kazak', 'gömlek', 'pantolon', 'şort', 'elbise', 'bluz', 'tişört', 't-shirt', 'sweatshirt', 'polar', 'ayakkabı', 'sneaker', 'bot', 'sandalet', 'çanta', 'sırt çantası', 'bere', 'eldiven', 'çorap', 'yelek', 'kemer', 'cüzdan', 'pijama', 'iç giyim'], category: 'Giyim' },
    { keywords: ['şampuan', 'krem', 'losyon', 'maske', 'serum', 'parfüm', 'deodorant', 'saç', 'cilt', 'diş', 'tıraş', 'makyaj', 'ruj', 'oje', 'hijyen', 'sabun', 'duş jeli'], category: 'Kozmetik' },
    { keywords: ['tencere', 'tava', 'çaydanlık', 'bıçak', 'tabak', 'bardak', 'fincan', 'yemek takımı', 'mobilya', 'masa', 'sandalye', 'yatak', 'dolap', 'nevresim', 'perde', 'halı', 'aydınlatma', 'lamba', 'havlu'], category: 'Ev' },
    { keywords: ['deterjan', 'temizlik', 'bakliyat', 'yağ', 'şeker', 'çay', 'kahve', 'atıştırmalık', 'makarna', 'peynir', 'süt', 'yoğurt', 'çikolata', 'gıda', 'bisküvi'], category: 'Market' },
    { keywords: ['bebek', 'bez', 'emzik', 'biberon', 'oyuncak', 'lego', 'puzzle', 'bebek arabası', 'mama'], category: 'Bebek' },
    { keywords: ['vitamin', 'takviye', 'kapsül', 'şurup', 'sağlık', 'medikal'], category: 'Sağlık' },
    { keywords: ['kalem', 'defter', 'boya', 'çizim', 'kağıt', 'kitap', 'roman'], category: 'Kitap' },
    { keywords: ['kamp', 'spor', 'fitness', 'outdoor', 'bisiklet', 'top', 'forma', 'pilates', 'koşu'], category: 'Spor' },
    { keywords: ['kedi', 'köpek', 'kuş', 'balık', 'evcil', 'pet', 'mama kedi', 'mama köpek'], category: 'Pet' },
    { keywords: ['araba', 'otomobil', 'lastik', 'motosiklet', 'kask', 'oto aksesuar'], category: 'Oto' },
];

const STORE_MAP = [
    { domain: 'trendyol.com', name: 'Trendyol' },
    { domain: 'hepsiburada.com', name: 'Hepsiburada' },
    { domain: 'amazon.com.tr', name: 'Amazon' },
    { domain: 'amazon.com', name: 'Amazon' },
    { domain: 'n11.com', name: 'n11' },
    { domain: 'pazarama.com', name: 'Pazarama' },
    { domain: 'ciceksepeti.com', name: 'ÇiçekSepeti' },
    { domain: 'teknosa.com', name: 'Teknosa' },
    { domain: 'vatan.com.tr', name: 'Vatan' },
    { domain: 'mediamarkt.com.tr', name: 'MediaMarkt' },
    { domain: 'boyner.com.tr', name: 'Boyner' },
    { domain: 'lcwaikiki.com', name: 'LC Waikiki' },
    { domain: 'defacto.com.tr', name: 'DeFacto' },
    { domain: 'koton.com', name: 'Koton' },
    { domain: 'zara.com', name: 'Zara' },
    { domain: 'itopya.com', name: 'İtopya' },
    { domain: 'akakce.com', name: 'Akakçe' },
];

// ─── Firebase ────────────────────────────────────────────────────────────────
function initFirebase() {
    if (getApps().length > 0) return getFirestore();

    let serviceAccount;
    const envJson = process.env.FIREBASE_SERVICE_ACCOUNT;

    if (envJson && !envJson.includes('indiva-panel-...')) {
        serviceAccount = JSON.parse(envJson);
    } else {
        const localPath = path.join(ROOT_DIR, 'firebase-service-account.json');
        if (fs.existsSync(localPath)) {
            serviceAccount = JSON.parse(fs.readFileSync(localPath, 'utf8'));
        } else {
            throw new Error('Firebase service account bulunamadı.');
        }
    }

    if (serviceAccount?.private_key) {
        serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, '\n').replace(/\n\n/g, '\n');
    }

    initializeApp({ credential: cert(serviceAccount) });
    return getFirestore();
}

// ─── AI Config (auto-onual.js ile aynı mekanizma) ───────────────────────────
function getGeminiKey() {
    if (process.env.AI_ENABLED !== 'true') return null;
    const key = process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_API_KEY;
    if (!key) {
        console.warn('⚠️  AI_ENABLED=true ama GEMINI_API_KEY eksik — AI devre dışı.');
        return null;
    }
    return key;
}

// ─── Yardımcı Fonksiyonlar ───────────────────────────────────────────────────
function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
}

function detectCategory(title) {
    const lower = title.toLowerCase();
    for (const { keywords, category } of CATEGORY_MAP) {
        if (keywords.some(kw => lower.includes(kw))) return category;
    }
    return 'Teknoloji';
}

function detectStore(storeUrl) {
    if (!storeUrl) return { name: 'Online Mağaza', domain: '' };
    for (const store of STORE_MAP) {
        if (storeUrl.includes(store.domain)) return store;
    }
    return { name: 'Online Mağaza', domain: '' };
}

function simulateOldPrice(newPrice) {
    const discountRatio = 0.20 + Math.random() * 0.40;
    const oldPrice = Math.round(newPrice / (1 - discountRatio));
    return Math.round(oldPrice / 5) * 5;
}

function cleanTitle(title) {
    return title
        .replace(/[\u{1F300}-\u{1F9FF}]/gu, '')
        .replace(/\s+/g, ' ')
        .trim()
        .substring(0, 200);
}

// ─── Chromium Path Tespiti ────────────────────────────────────────────────────
function getChromiumPath() {
    // GitHub Actions'da CHROMIUM_PATH env var set edilir
    if (process.env.CHROMIUM_PATH && fs.existsSync(process.env.CHROMIUM_PATH)) {
        return process.env.CHROMIUM_PATH;
    }
    // Yaygın Linux yolları
    const candidates = [
        '/usr/bin/chromium',
        '/usr/bin/chromium-browser',
        '/snap/bin/chromium',
        '/usr/bin/google-chrome',
        '/usr/bin/google-chrome-stable',
    ];
    for (const p of candidates) {
        if (fs.existsSync(p)) return p;
    }
    throw new Error('Chromium bulunamadı. CHROMIUM_PATH env var set edin veya chromium yükleyin.');
}

// ─── Puppeteer Browser Başlatma ───────────────────────────────────────────────
async function launchBrowser() {
    const executablePath = getChromiumPath();
    console.log(`🌐 Chromium: ${executablePath}`);

    return puppeteer.launch({
        executablePath,
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--disable-gpu',
            '--no-first-run',
            '--no-zygote',
            '--window-size=1366,768',
            '--disable-blink-features=AutomationControlled',
        ],
        defaultViewport: { width: 1366, height: 768 },
    });
}

// ─── Cloudflare Bypass Bekleme ────────────────────────────────────────────────
async function waitForCloudflare(page, timeoutMs = 15000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        const title = await page.title();
        if (!title.includes('Just a moment') && !title.includes('Checking your browser')) {
            return true;
        }
        console.log('   ⏳ Cloudflare challenge bekleniyor...');
        await sleep(2000);
    }
    console.warn('   ⚠️  Cloudflare bypass zaman aşımı');
    return false;
}

// ─── Akakce Ana Sayfa Ürün Listesi ───────────────────────────────────────────
async function fetchAkakceProducts(page) {
    console.log(`📡 ${AKAKCE_URL} yükleniyor...`);

    await page.goto(AKAKCE_URL, {
        waitUntil: 'domcontentloaded',
        timeout: PAGE_TIMEOUT_MS,
    });

    await waitForCloudflare(page);
    await sleep(STEP_DELAY_MS);

    // Sayfanın tam yüklenmesini bekle
    try {
        await page.waitForSelector('a[href]', { timeout: 8000 });
    } catch {
        console.warn('   ⚠️  Sayfa yüklenme selector timeout, devam ediliyor...');
    }

    // DEBUG: Sayfa başlığını ve ilk linkleri logla — selector tespiti için
    const debugInfo = await page.evaluate(() => {
        const allLinks = Array.from(document.querySelectorAll('a[href]'));
        const hrefs = allLinks
            .map(a => a.getAttribute('href') || '')
            .filter(h => h && h.length > 3 && !h.startsWith('#') && !h.startsWith('javascript'))
            .slice(0, 30);
        const bodySnippet = document.body?.innerHTML?.substring(0, 800) || '';
        return { title: document.title, hrefs, bodySnippet };
    });
    console.log(`   📄 Sayfa başlığı: ${debugInfo.title}`);
    console.log(`   🔗 İlk 30 link:\n${debugInfo.hrefs.map((h, i) => `      ${i + 1}. ${h}`).join('\n')}`);
    console.log(`   🧩 Body snippet:\n${debugInfo.bodySnippet.substring(0, 400)}`);

    // Sayfa içinde ürünleri çıkar
    const products = await page.evaluate(() => {
        const results = [];
        const seen = new Set();

        function parsePrice(text) {
            if (!text) return 0;
            // "1.234,56 TL" veya "1234 TL" gibi formatları parse et
            const clean = text.replace(/[^\d.,]/g, '').replace(/\./g, '').replace(',', '.');
            return parseFloat(clean) || 0;
        }

        function fixImageUrl(url) {
            if (!url) return '';
            if (url.startsWith('//')) return 'https:' + url;
            if (url.startsWith('http')) return url;
            return '';
        }

        // Akakce ürün URL'si — birden fazla pattern dene
        const allLinks = Array.from(document.querySelectorAll('a[href]'));
        const productLinks = allLinks.filter(a => {
            const h = a.getAttribute('href') || '';
            return /,\d{5,}\.html/.test(h) ||   // /urun,12345.html
                   /\/[^/]+-p-\d+/.test(h) ||    // /urun-p-12345
                   /\/\d{5,}($|\/)/.test(h);      // /12345 veya /12345/
        });

        for (const link of productLinks) {
            const href = link.getAttribute('href') || '';
            const idMatch = href.match(/,(\d{5,})\.html/);
            if (!idMatch) continue;

            const productId = idMatch[1];
            if (seen.has(productId)) continue;

            // Container: genellikle li veya product card div
            const container = link.closest('li') ||
                link.closest('[class*="item"]') ||
                link.closest('[class*="card"]') ||
                link.closest('[class*="product"]') ||
                link.parentElement;
            if (!container) continue;

            // Başlık: önce link title attr, sonra img alt, sonra yakın text
            let title = link.getAttribute('title') || '';
            if (!title) {
                const img = link.querySelector('img');
                title = img?.getAttribute('alt') || '';
            }
            if (!title || title.length < 5) {
                const textEl = container.querySelector(
                    '[class*="pu"], [class*="name"], [class*="title"], h3, h4, p a, p'
                );
                title = textEl?.textContent?.trim() || link.textContent?.trim() || '';
            }
            if (!title || title.length < 5) continue;

            // Görsel
            const img = link.querySelector('img') || container.querySelector('img');
            const rawImg = img?.getAttribute('src') ||
                img?.getAttribute('data-src') ||
                img?.getAttribute('data-lazy-src') || '';
            const imageUrl = fixImageUrl(rawImg);

            // Fiyatlar — Akakce CSS class isimleri versiyonlu: p1_v8, p3_v8, pr_v8
            // Birden fazla pattern dene
            const newPriceEl =
                container.querySelector('[class*="p1_"]') ||
                container.querySelector('[class*="newprice"]') ||
                container.querySelector('[class*="current-price"]');

            const oldPriceEl =
                container.querySelector('[class*="p3_"]') ||
                container.querySelector('[class*="oldprice"]') ||
                container.querySelector('del') ||
                container.querySelector('s');

            const discountEl =
                container.querySelector('[class*="pr_"]') ||
                container.querySelector('[class*="discount"]') ||
                container.querySelector('[class*="indirim"]');

            const newPrice = parsePrice(newPriceEl?.textContent || '');
            const oldPrice = parsePrice(oldPriceEl?.textContent || '');
            const discountText = discountEl?.textContent?.trim() || '';

            const fullUrl = href.startsWith('http') ? href : 'https://www.akakce.com' + href;

            seen.add(productId);
            results.push({
                id: productId,
                title: title.replace(/\s+/g, ' ').trim(),
                url: fullUrl,
                newPrice,
                oldPrice,
                discountText,
                imageUrl,
            });

            if (results.length >= 30) break;
        }

        return results;
    });

    console.log(`   📦 Sayfa taraması: ${products.length} ürün kartı bulundu`);
    return products;
}

// ─── Akakce Ürün Detay Sayfası → Mağaza Linki ────────────────────────────────
async function extractStoreLink(page, productUrl) {
    try {
        await page.goto(productUrl, {
            waitUntil: 'domcontentloaded',
            timeout: PAGE_TIMEOUT_MS,
        });
        await waitForCloudflare(page, 10000);
        await sleep(1000);

        const result = await page.evaluate(() => {
            // Strateji 1: /git/ linki içeren ilk buton (en ucuz mağaza)
            const gitLink = document.querySelector('a[href*="/git/"]');
            if (gitLink) return { type: 'git', href: gitLink.href };

            // Strateji 2: Fiyat tablosundaki ilk mağaza linki
            const priceRow = document.querySelector(
                'table tr a[href*="http"], .price-table a[href*="http"], [class*="liste"] a[href^="http"]'
            );
            if (priceRow) return { type: 'direct', href: priceRow.href };

            // Strateji 3: OG URL (ürün sayfasının kendisi)
            const ogUrl = document.querySelector('meta[property="og:url"]')?.getAttribute('content');
            return { type: 'og', href: ogUrl || '' };
        });

        if (!result?.href) return null;

        // /git/ linki için: URL parametresinden mağaza URL'sini çözümle
        if (result.type === 'git') {
            try {
                const url = new URL(result.href);
                const encodedStore = url.searchParams.get('u') || url.searchParams.get('url');
                if (encodedStore) {
                    const storeUrl = decodeURIComponent(encodedStore);
                    if (storeUrl.startsWith('http')) return storeUrl;
                }
            } catch { /* devam */ }

            // Parametreden çıkartılamazsa redirect'i takip et
            try {
                const response = await page.goto(result.href, {
                    waitUntil: 'domcontentloaded',
                    timeout: 12000,
                });
                const finalUrl = page.url();
                if (finalUrl && !finalUrl.includes('akakce.com/git')) {
                    return finalUrl;
                }
            } catch { /* devam */ }
        }

        // Direct veya OG link döndür
        if (result.href.startsWith('http')) return result.href;
        return null;

    } catch (err) {
        console.warn(`   ⚠️  Detay sayfası hatası: ${err.message}`);
        return null;
    }
}

// ─── AI Analiz (auto-onual.js ile aynı mantık) ───────────────────────────────
async function generateAISentiments(apiKey, productTitle, newPrice, oldPrice) {
    if (!apiKey) return { category: detectCategory(productTitle), aiFomoScore: 5 };

    const genAI = new GoogleGenAI({ apiKey });

    const systemInstruction = `Sen INDIVA uygulamasının kıdemli Teknik Ürün Analisti ve e-ticaret metin yazarı uzmanısın.
    Görevin, paylaşılan ürün başlığını ve detaylarını analiz ederek "profesyonel bir inceleme ve kategori tespiti" yapmaktır.

    GÖREV KURALLARI:
    1. SANİTİZE BAŞLIK (title): Sadece gerçek ÜRÜN ADI ve MODELİNİ döndür.
    2. KATEGORİ TESPİTİ: [Teknoloji, Giyim, Kozmetik, Ev, Market, Bebek, Sağlık, Kitap, Spor, Pet, Oto] listesinden en uygununu seç.
    3. TEKNİK ANALİZ: 45-60 kelime, tek paragraf, bilirkişi tonu.
    4. FOMO PUANI (aiFomoScore): 1-10 arası.
    5. CEVAP: SADECE saf JSON formatında.`;

    const prompt = `Ürün: "${productTitle}" | Fiyat: ${oldPrice} TL -> ${newPrice} TL
    JSON: {"title":"...","category":"...","description":"...","aiFomoScore":8}`;

    try {
        const response = await genAI.models.generateContent({
            model: MODEL,
            contents: [{ role: 'user', parts: [{ text: `${systemInstruction}\n\n${prompt}` }] }],
            config: { temperature: 0.2 },
        });

        const text = response.text || '';
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        const aiData = JSON.parse((jsonMatch ? jsonMatch[0] : text).trim());

        const CATEGORY_MAPPING = {
            'Elektronik': 'Teknoloji', 'Cep Telefonu': 'Teknoloji', 'Bilgisayar': 'Teknoloji',
            'Mutfak': 'Ev', 'Ev Aletleri': 'Ev', 'Giyim & Ayakkabı': 'Giyim',
            'Süpermarket': 'Market', 'Anne & Bebek': 'Bebek', 'Otomotiv & Motosiklet': 'Oto',
        };
        const finalCategory = CATEGORY_MAPPING[aiData.category] || aiData.category || detectCategory(productTitle);

        return {
            title: aiData.title || productTitle,
            category: finalCategory,
            description: aiData.description || '',
            aiFomoScore: parseInt(aiData.aiFomoScore) || 5,
        };
    } catch (err) {
        console.warn(`   ❌ AI Hatası: ${err.message}`);
        return { category: detectCategory(productTitle), aiFomoScore: 5 };
    }
}

// ─── Firebase Batch ID Kontrolü ───────────────────────────────────────────────
async function filterExistingIds(db, docIds) {
    if (docIds.length === 0) return new Set();
    const existing = new Set();

    for (let i = 0; i < docIds.length; i += 30) {
        const chunk = docIds.slice(i, i + 30);
        try {
            const snapshot = await db.collection('discounts')
                .where(FieldPath.documentId(), 'in', chunk)
                .select()
                .get();
            snapshot.docs.forEach(doc => existing.add(doc.id));
        } catch (e) {
            console.warn(`   ⚠️ Batch check hatası: ${e.message}`);
        }
    }
    return existing;
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────
async function main() {
    console.log('\n🚀 INDIVA Auto-Akakce Pipeline Başlatıldı');
    console.log('═══════════════════════════════════════════');
    console.log(`⏰ ${new Date().toLocaleString('tr-TR')}\n`);

    const db = initFirebase();
    const aiKey = getGeminiKey();
    console.log(`✅ Firebase hazır. AI: ${aiKey ? 'AÇIK' : 'KAPALI'}`);

    // ── Cache ──────────────────────────────────────────────────────────────────
    const CACHE_DIR = path.join(ROOT_DIR, 'data');
    const CACHE_FILE = path.join(CACHE_DIR, 'processed_akakce_ids.json');
    if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR);

    let idCache = { ids: {}, lastUpdate: new Date().toISOString() };
    if (fs.existsSync(CACHE_FILE)) {
        try {
            idCache = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
            const ageDays = (Date.now() - new Date(idCache.lastUpdate)) / 86400000;
            if (ageDays > 7) idCache = { ids: {}, lastUpdate: new Date().toISOString() };
        } catch { /* ignore */ }
    }

    // ── Browser başlat ────────────────────────────────────────────────────────
    let browser;
    try {
        browser = await launchBrowser();
    } catch (err) {
        console.error(`❌ Browser başlatılamadı: ${err.message}`);
        await sendAdminAlert('Akakce Pipeline Hatası', `Browser başlatılamadı: ${err.message}`);
        process.exit(1);
    }

    const page = await browser.newPage();

    // Gereksiz resource'ları engelle (daha hızlı yükleme)
    await page.setRequestInterception(true);
    page.on('request', req => {
        const type = req.resourceType();
        if (['font', 'media'].includes(type)) {
            req.abort();
        } else {
            req.continue();
        }
    });

    try {
        // ── 1. Ürün listesini çek ─────────────────────────────────────────────
        const allProducts = await fetchAkakceProducts(page);

        if (allProducts.length === 0) {
            console.log('❌ Hiç ürün bulunamadı. Sayfa yapısı değişmiş olabilir.');
            await sendAdminAlert('Akakce Pipeline', 'Ürün bulunamadı — CSS selectors güncellemesi gerekebilir.');
            return;
        }

        const toProcess = allProducts.slice(0, MAX_NEW_PRODUCTS);
        console.log(`\n📊 Toplam: ${allProducts.length} ürün, işlenecek: ${toProcess.length}`);

        // ── 2. Cache & DB filtreleme ──────────────────────────────────────────
        const uncached = toProcess.filter(p => !idCache.ids[`akakce_${p.id}`]);
        console.log(`   ⏭️  ${toProcess.length - uncached.length} ürün cache'den elendi`);

        const uncachedIds = uncached.map(p => `akakce_${p.id}`);
        const existingInDb = await filterExistingIds(db, uncachedIds);
        if (existingInDb.size > 0) {
            existingInDb.forEach(id => { idCache.ids[id] = true; });
            console.log(`   ⏭️  ${existingInDb.size} ürün Firebase'de zaten var`);
        }

        const finalList = uncached.filter(p => !existingInDb.has(`akakce_${p.id}`));
        console.log(`   🆕 İşlenecek net yeni ürün: ${finalList.length}\n`);

        if (finalList.length === 0) {
            console.log('✅ Yeni ürün yok. Pipeline tamamlandı.');
            return;
        }

        // ── 3. Her ürünü işle ─────────────────────────────────────────────────
        let successCount = 0;
        let failCount = 0;

        for (let i = 0; i < finalList.length; i++) {
            const product = finalList[i];
            const docId = `akakce_${product.id}`;

            console.log(`\n[${i + 1}/${finalList.length}] 📦 ${product.title.substring(0, 60)}...`);

            try {
                await sleep(STEP_DELAY_MS);

                // Detay sayfasından mağaza linkini çıkar
                console.log(`   🔍 Detay sayfası: ${product.url.substring(0, 70)}...`);
                let storeLink = await extractStoreLink(page, product.url);

                if (!storeLink) {
                    // Fallback: akakce ürün sayfasını link olarak kullan
                    storeLink = product.url;
                    console.log(`   ⚠️  Mağaza linki çözülemedi, akakce URL kullanılıyor`);
                }

                const store = detectStore(storeLink);

                // OG image kontrolü — detay sayfasından daha iyi görsel alma
                let imageUrl = product.imageUrl;
                try {
                    const ogImage = await page.evaluate(() =>
                        document.querySelector('meta[property="og:image"]')?.getAttribute('content') || ''
                    );
                    if (ogImage?.startsWith('http')) imageUrl = ogImage;
                } catch { /* ignore */ }

                if (!imageUrl) {
                    console.warn(`   ⚠️  Görsel bulunamadı, atlanıyor`);
                    failCount++;
                    continue;
                }

                // Fiyat hesaplama
                const newPrice = product.newPrice || 0;
                const oldPrice = product.oldPrice || (newPrice > 0 ? simulateOldPrice(newPrice) : 0);

                console.log(`   💰 ${oldPrice} TL → ${newPrice} TL | Mağaza: ${store.name}`);

                // AI analiz
                const aiData = await generateAISentiments(aiKey, product.title, newPrice, oldPrice);

                // Firebase'e kaydet
                const discountData = {
                    title: cleanTitle(aiData.title || product.title),
                    brand: store.name || 'Online Mağaza',
                    category: aiData.category || detectCategory(product.title),
                    description: aiData.description || '',
                    link: storeLink,
                    originalStoreLink: storeLink,
                    oldPrice: oldPrice || 0,
                    newPrice: newPrice || 0,
                    imageUrl,
                    deleteUrl: '',
                    submittedBy: 'auto-akakce-bot',
                    isAd: false,
                    affiliateLinkUpdated: false,
                    originalSource: 'akakce.com',
                    storeName: store.name,
                    status: 'aktif',
                    telegramMessageId: docId,
                    pushNotifications: [],
                    lastPriceCheck: FieldValue.serverTimestamp(),
                    autoPublishedAt: FieldValue.serverTimestamp(),
                    createdAt: FieldValue.serverTimestamp(),
                    aiFomoScore: aiData.aiFomoScore || 5,
                };

                await db.collection('discounts').doc(docId).set(discountData);
                console.log(`   🔥 Firebase'e kaydedildi ✅ (ID: ${docId})`);

                idCache.ids[docId] = true;
                successCount++;

            } catch (err) {
                console.error(`   ❌ Ürün işleme hatası: ${err.message}`);
                failCount++;
            }
        }

        // Cache kaydet
        try {
            idCache.lastUpdate = new Date().toISOString();
            fs.writeFileSync(CACHE_FILE, JSON.stringify(idCache, null, 2));
            console.log(`\n💾 Cache güncellendi (${Object.keys(idCache.ids).length} ürün)`);
        } catch (e) {
            console.error('Cache kaydetme hatası:', e.message);
        }

        console.log('\n═══════════════════════════════════════════');
        console.log('📊 AKAKCE PIPELINE TAMAMLANDI');
        console.log(`   ✅ Başarılı: ${successCount}`);
        console.log(`   ❌ Başarısız: ${failCount}`);
        console.log(`   ⏰ ${new Date().toLocaleString('tr-TR')}`);
        console.log('═══════════════════════════════════════════\n');

    } finally {
        await browser.close();
    }
}

main().catch(async (err) => {
    console.error('\n💥 KRİTİK HATA:', err.message);
    try {
        await sendAdminAlert('Akakce Pipeline Kritik Hata', `auto-akakce.js durdu: ${err.message}`);
    } catch { /* ignore */ }
    process.exit(1);
});
