/**
 * auto-akakce.js — INDIVA Akakce Pipeline (Gemini URL Context)
 *
 * akakce.com "Son Yakalanan İndirimler" sayfasını Gemini URL Context ile çeker.
 * Google'ın sunucuları üzerinden fetch yapılır — Cloudflare engeli aşılır.
 *
 * Çalıştırma: node scripts/auto-akakce.js
 * Gereksinim: GEMINI_API_KEY (zorunlu)
 *
 * NOT: auto-onual.js pipeline'ından tamamen bağımsızdır.
 */

import { GoogleGenAI } from '@google/genai';
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore, FieldValue, FieldPath } from 'firebase-admin/firestore';
import * as fs from 'fs';
import * as path from 'path';
import { sendAdminAlert } from './alertService.js';

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

// Gemini: URL Context + açıklama üretimi
const MODEL_URL_CONTEXT = 'gemini-2.5-flash';
const MODEL_DESCRIPTION = 'gemini-2.5-flash-lite';

// ─── Kategori & Mağaza Haritaları ────────────────────────────────────────────
const CATEGORY_MAP = [
    { keywords: ['klavye', 'mouse', 'fare', 'monitör', 'bilgisayar', 'laptop', 'notebook', 'tablet', 'telefon', 'iphone', 'samsung', 'xiaomi', 'kulaklık', 'hoparlör', 'kamera', 'ssd', 'harddisk', 'şarj', 'powerbank', 'kablo', 'adaptör', 'akıllı saat', 'scooter', 'drone', 'playstation', 'xbox', 'nintendo', 'router', 'modem', 'yazıcı', 'tv ', 'televizyon'], category: 'Teknoloji' },
    { keywords: ['mont', 'ceket', 'kazak', 'gömlek', 'pantolon', 'şort', 'elbise', 'bluz', 'tişört', 't-shirt', 'sweatshirt', 'polar', 'ayakkabı', 'sneaker', 'bot', 'sandalet', 'çanta', 'sırt çantası', 'bere', 'eldiven', 'çorap', 'yelek', 'kemer', 'cüzdan', 'pijama'], category: 'Giyim' },
    { keywords: ['şampuan', 'krem', 'losyon', 'maske', 'serum', 'parfüm', 'deodorant', 'saç', 'cilt', 'diş', 'tıraş', 'makyaj', 'ruj', 'oje', 'hijyen', 'sabun', 'duş jeli'], category: 'Kozmetik' },
    { keywords: ['tencere', 'tava', 'çaydanlık', 'bıçak', 'tabak', 'bardak', 'fincan', 'mobilya', 'masa', 'sandalye', 'yatak', 'dolap', 'nevresim', 'perde', 'halı', 'aydınlatma', 'lamba', 'havlu'], category: 'Ev' },
    { keywords: ['deterjan', 'temizlik', 'bakliyat', 'yağ', 'şeker', 'çay', 'kahve', 'atıştırmalık', 'makarna', 'peynir', 'süt', 'yoğurt', 'çikolata', 'gıda', 'bisküvi'], category: 'Market' },
    { keywords: ['bebek', 'bez', 'emzik', 'biberon', 'oyuncak', 'lego', 'puzzle', 'bebek arabası', 'mama'], category: 'Bebek' },
    { keywords: ['vitamin', 'takviye', 'kapsül', 'şurup', 'sağlık', 'medikal'], category: 'Sağlık' },
    { keywords: ['kalem', 'defter', 'boya', 'kitap', 'roman'], category: 'Kitap' },
    { keywords: ['kamp', 'spor', 'fitness', 'outdoor', 'bisiklet', 'top', 'forma', 'pilates', 'koşu'], category: 'Spor' },
    { keywords: ['kedi', 'köpek', 'evcil', 'pet', 'mama kedi', 'mama köpek'], category: 'Pet' },
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

// ─── Yardımcı Fonksiyonlar ───────────────────────────────────────────────────
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function detectCategory(title) {
    const lower = title.toLowerCase();
    for (const { keywords, category } of CATEGORY_MAP) {
        if (keywords.some(kw => lower.includes(kw))) return category;
    }
    return 'Teknoloji';
}

function detectStore(url) {
    if (!url) return { name: 'Akakçe', domain: 'akakce.com' };
    for (const store of STORE_MAP) {
        if (url.includes(store.domain)) return store;
    }
    return { name: 'Online Mağaza', domain: '' };
}

function simulateOldPrice(newPrice) {
    const ratio = 0.20 + Math.random() * 0.40;
    return Math.round(Math.round(newPrice / (1 - ratio)) / 5) * 5;
}

function cleanTitle(title) {
    return title.replace(/\s+/g, ' ').trim().substring(0, 200);
}

function extractProductId(url) {
    // Akakce URL formatları: /urun,12345.html veya /kategori/urun,12345.html
    const match = url?.match(/,(\d{4,})\.html/) || url?.match(/\/(\d{6,})\/?$/);
    return match ? match[1] : null;
}

// ─── Gemini ile Akakce Ürün Listesi (URL Context + Google Search fallback) ─────
async function fetchAkakceViaGemini(apiKey) {
    const genAI = new GoogleGenAI({ apiKey });

    const productPrompt = `akakce.com sitesinin "Son Yakalanan İndirimler" veya "Fark Atan Fiyatlar" bölümündeki güncel indirimli ürünleri listele.

Her ürün için şu bilgileri çıkart:
- title: Ürün adı (temiz, pazarlama sloganı olmadan)
- newPrice: Güncel fiyat (sayı, TL, yoksa 0)
- oldPrice: Eski/üstü çizili fiyat (sayı, TL, yoksa 0)
- discountPercent: İndirim yüzdesi (sayı, yoksa 0)
- imageUrl: Ürün görseli tam URL (https:// ile başlamalı, yoksa "")
- productUrl: Akakce ürün sayfası tam URL (https://www.akakce.com/... ile başlamalı)

Kurallar:
- SADECE JSON array döndür, açıklama yazma
- Maksimum ${MAX_NEW_PRODUCTS} ürün
- productUrl mutlaka akakce.com linki olmalı
- Fiyatlar mutlaka sayı olmalı (string değil)

Format: [{"title":"Samsung Galaxy S25","newPrice":35000,"oldPrice":42000,"discountPercent":17,"imageUrl":"https://...","productUrl":"https://www.akakce.com/..."}]`;

    // Yardımcı: yanıttan text çıkar (farklı response formatlarını destekle)
    function extractText(response) {
        if (response.text) return response.text;
        const parts = response.candidates?.[0]?.content?.parts || [];
        return parts.filter(p => p.text).map(p => p.text).join('');
    }

    // Strateji 1: URL Context + JSON modu (Google sunucuları üzerinden fetch)
    try {
        console.log('🤖 Strateji 1: Gemini URL Context (JSON modu)...');
        const response = await genAI.models.generateContent({
            model: MODEL_URL_CONTEXT,
            contents: [{
                role: 'user',
                parts: [{ text: `Visit this URL: ${AKAKCE_URL}\n\nFrom the page, find the "Fark Atan Fiyatlar" or "Son Yakalanan İndirimler" section and extract products.\n\n${productPrompt}` }]
            }],
            config: {
                tools: [{ urlContext: {} }],
                temperature: 0.1,
                responseMimeType: 'application/json',
            },
        });
        const text = extractText(response);
        console.log(`   📝 Yanıt (ilk 800): ${text.substring(0, 800)}`);
        // JSON modu: response direkt JSON olmalı
        const parsed = JSON.parse(text.trim());
        const products = Array.isArray(parsed) ? parsed : (parsed.products || parsed.items || []);
        if (products.length > 0) {
            console.log(`   ✅ URL Context JSON: ${products.length} ürün`);
            return products;
        }
        console.warn('   ⚠️ URL Context boş döndü, Google Search deneniyor...');
    } catch (err) {
        console.warn(`   ⚠️ URL Context hatası: ${err.message}`);
    }

    // Strateji 2: Google Search — akakce.com'daki güncel indirimli ürünleri ara
    try {
        console.log('🔍 Strateji 2: Gemini Google Search Grounding...');
        const searchPrompt = `Google'da şunu ara: akakce.com indirimli ürünler fiyat düştü TL 2024 2025

Arama sonuçlarında akakce.com'a ait ürün sayfalarını bul.
Her ürün için title, newPrice (TL sayı), oldPrice (TL sayı), discountPercent (sayı), imageUrl (url), productUrl (akakce.com url) çıkart.
SADECE JSON array döndür.
Format: [{"title":"...","newPrice":0,"oldPrice":0,"discountPercent":0,"imageUrl":"","productUrl":"https://www.akakce.com/..."}]`;

        const response = await genAI.models.generateContent({
            model: MODEL_URL_CONTEXT,
            contents: [{ role: 'user', parts: [{ text: searchPrompt }] }],
            config: {
                tools: [{ googleSearch: {} }],
                temperature: 0.1,
            },
        });
        const text = extractText(response);
        console.log(`   📝 Yanıt (ilk 500): ${text.substring(0, 500)}`);
        const match = text.match(/\[[\s\S]*\]/);
        if (match) {
            const products = JSON.parse(match[0]);
            if (products.length > 0) {
                console.log(`   ✅ Google Search: ${products.length} ürün`);
                return products;
            }
        }
        console.warn('   ⚠️ Google Search boş döndü.');
    } catch (err) {
        console.warn(`   ⚠️ Google Search hatası: ${err.message}`);
    }

    // Strateji 3: URL Context + Google Search birlikte
    try {
        console.log('🔗 Strateji 3: URL Context + Google Search kombinasyonu...');
        const response = await genAI.models.generateContent({
            model: MODEL_URL_CONTEXT,
            contents: [{ role: 'user', parts: [{ text: `${AKAKCE_URL} adresine git ve sayfadaki indirimli ürünleri listele. ${productPrompt}` }] }],
            config: {
                tools: [{ urlContext: {} }, { googleSearch: {} }],
                temperature: 0.1,
            },
        });
        const text = extractText(response);
        console.log(`   📝 Yanıt (ilk 500): ${text.substring(0, 500)}`);
        const match = text.match(/\[[\s\S]*\]/);
        if (match) {
            const products = JSON.parse(match[0]);
            if (products.length > 0) {
                console.log(`   ✅ Kombinasyon: ${products.length} ürün`);
                return products;
            }
        }
        console.warn('   ⚠️ Kombinasyon da boş döndü.');
    } catch (err) {
        console.warn(`   ⚠️ Kombinasyon hatası: ${err.message}`);
    }

    throw new Error('Her iki Gemini stratejisi de başarısız oldu.');
}

// ─── Gemini Açıklama Üretimi (AI_ENABLED=true ise) ───────────────────────────
async function generateDescription(apiKey, title, newPrice, oldPrice) {
    if (!apiKey || process.env.AI_ENABLED !== 'true') {
        return { category: detectCategory(title), description: '', aiFomoScore: 5 };
    }

    const genAI = new GoogleGenAI({ apiKey });
    const prompt = `Ürün: "${title}" | ${oldPrice} TL → ${newPrice} TL
Şu JSON'u döndür: {"category":"Teknoloji","description":"45-60 kelime teknik analiz","aiFomoScore":8}
Kategori seçenekleri: Teknoloji, Giyim, Kozmetik, Ev, Market, Bebek, Sağlık, Kitap, Spor, Pet, Oto`;

    try {
        const response = await genAI.models.generateContent({
            model: MODEL_DESCRIPTION,
            contents: [{ role: 'user', parts: [{ text: prompt }] }],
            config: { temperature: 0.2 },
        });
        const text = response.text || '';
        const match = text.match(/\{[\s\S]*\}/);
        const data = JSON.parse((match ? match[0] : text).trim());
        return {
            category: data.category || detectCategory(title),
            description: data.description || '',
            aiFomoScore: parseInt(data.aiFomoScore) || 5,
        };
    } catch {
        return { category: detectCategory(title), description: '', aiFomoScore: 5 };
    }
}

// ─── Firebase Batch ID Kontrolü ───────────────────────────────────────────────
async function filterExistingIds(db, docIds) {
    if (docIds.length === 0) return new Set();
    const existing = new Set();
    for (let i = 0; i < docIds.length; i += 30) {
        const chunk = docIds.slice(i, i + 30);
        try {
            const snap = await db.collection('discounts')
                .where(FieldPath.documentId(), 'in', chunk)
                .select().get();
            snap.docs.forEach(d => existing.add(d.id));
        } catch (e) {
            console.warn(`   ⚠️ Batch check hatası: ${e.message}`);
        }
    }
    return existing;
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────
async function main() {
    console.log('\n🚀 INDIVA Auto-Akakce Pipeline Başlatıldı (Gemini URL Context)');
    console.log('═══════════════════════════════════════════');
    console.log(`⏰ ${new Date().toLocaleString('tr-TR')}\n`);

    // Gemini API key zorunlu
    const apiKey = process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_API_KEY;
    if (!apiKey) {
        throw new Error('GEMINI_API_KEY zorunlu! GitHub Secrets\'a ekleyin.');
    }

    const db = initFirebase();
    console.log(`✅ Firebase hazır. AI açıklaması: ${process.env.AI_ENABLED === 'true' ? 'AÇIK' : 'KAPALI'}`);

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

    // ── 1. Akakce'den ürün listesini çek ────────────────────────────────────
    let rawProducts;
    try {
        rawProducts = await fetchAkakceViaGemini(apiKey);
    } catch (err) {
        console.error(`❌ Akakce fetch hatası: ${err.message}`);
        await sendAdminAlert('Akakce Pipeline Hatası', `Gemini URL fetch başarısız: ${err.message}`);
        process.exit(1);
    }

    if (!rawProducts || rawProducts.length === 0) {
        console.log('❌ Hiç ürün bulunamadı.');
        await sendAdminAlert('Akakce Pipeline', 'Gemini 0 ürün döndürdü.');
        return;
    }

    // Geçersiz ürünleri filtrele (title veya productUrl eksik)
    const validProducts = rawProducts.filter(p =>
        p.title && p.title.length > 3 && p.productUrl && p.productUrl.includes('akakce.com')
    );
    console.log(`\n📊 Toplam: ${rawProducts.length} ürün, geçerli: ${validProducts.length}`);

    // ── 2. Cache & DB filtreleme ──────────────────────────────────────────────
    // ID: akakce URL'den çıkart, yoksa title hash kullan
    const withIds = validProducts.map(p => {
        const urlId = extractProductId(p.productUrl);
        const id = urlId || Buffer.from(p.title).toString('base64').replace(/[^a-zA-Z0-9]/g, '').substring(0, 16);
        return { ...p, _docId: `akakce_${id}` };
    });

    const uncached = withIds.filter(p => !idCache.ids[p._docId]);
    console.log(`   ⏭️  ${withIds.length - uncached.length} ürün cache'den elendi`);

    const existingInDb = await filterExistingIds(db, uncached.map(p => p._docId));
    existingInDb.forEach(id => { idCache.ids[id] = true; });
    if (existingInDb.size > 0) console.log(`   ⏭️  ${existingInDb.size} ürün Firebase'de zaten var`);

    const finalList = uncached.filter(p => !existingInDb.has(p._docId));
    console.log(`   🆕 İşlenecek net yeni ürün: ${finalList.length}\n`);

    if (finalList.length === 0) {
        console.log('✅ Yeni ürün yok. Pipeline tamamlandı.');
        return;
    }

    // ── 3. Her ürünü Firebase'e kaydet ───────────────────────────────────────
    let successCount = 0;
    let failCount = 0;

    for (let i = 0; i < finalList.length; i++) {
        const product = finalList[i];
        console.log(`\n[${i + 1}/${finalList.length}] 📦 ${product.title.substring(0, 60)}...`);

        try {
            await sleep(500);

            const newPrice = Number(product.newPrice) || 0;
            const oldPrice = Number(product.oldPrice) || (newPrice > 0 ? simulateOldPrice(newPrice) : 0);
            const store = detectStore(product.productUrl);

            console.log(`   💰 ${oldPrice} TL → ${newPrice} TL | Mağaza: ${store.name}`);

            // Opsiyonel: AI açıklama üretimi
            const aiData = await generateDescription(apiKey, product.title, newPrice, oldPrice);

            const discountData = {
                title: cleanTitle(product.title),
                brand: store.name,
                category: aiData.category || detectCategory(product.title),
                description: aiData.description || '',
                link: product.productUrl,
                originalStoreLink: product.productUrl,
                oldPrice: oldPrice,
                newPrice: newPrice,
                imageUrl: product.imageUrl || '',
                deleteUrl: '',
                submittedBy: 'auto-akakce-bot',
                isAd: false,
                affiliateLinkUpdated: false,
                originalSource: 'akakce.com',
                storeName: store.name,
                status: 'aktif',
                telegramMessageId: product._docId,
                pushNotifications: [],
                lastPriceCheck: FieldValue.serverTimestamp(),
                autoPublishedAt: FieldValue.serverTimestamp(),
                createdAt: FieldValue.serverTimestamp(),
                aiFomoScore: aiData.aiFomoScore || 5,
            };

            await db.collection('discounts').doc(product._docId).set(discountData);
            console.log(`   🔥 Firebase'e kaydedildi ✅ (ID: ${product._docId})`);

            idCache.ids[product._docId] = true;
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
}

main().catch(async (err) => {
    console.error('\n💥 KRİTİK HATA:', err.message);
    try {
        await sendAdminAlert('Akakce Pipeline Kritik Hata', `auto-akakce.js durdu: ${err.message}`);
    } catch { /* ignore */ }
    process.exit(1);
});
