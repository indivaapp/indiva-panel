/**
 * auto-indirimradar.js — INDIVA IndirimRadar Pipeline
 *
 * indirimradarapp.com'un kendi (gizli ama halka açık) API'sinden temiz,
 * yapılandırılmış ürün verisi çeker — başlık/fiyat/görsel/stok bilgisi
 * zaten JSON olarak geliyor, AI ile sayfa okuma/çıkarma GEREKMİYOR.
 * Bu hem OnuAl/Akakçe'den çok daha ucuz (AI sadece kalite puanlama +
 * caption üretiminde kullanılıyor) hem de tamamen bulut tabanlı — PC'ye
 * ihtiyaç duymuyor (Trendyol scraper'ın aksine).
 *
 * NOT: API `asin`/`url` alanlarını boş döndürüyor (kasıtlı olarak
 * gizlenmiş gibi görünüyor), gerçek ürün linki yok. Bu yüzden başlıktan
 * bir Amazon Türkiye arama linki oluşturuyoruz — başlıklar çok spesifik
 * olduğu için (marka+model+varyant) aranan ürün neredeyse hep ilk sırada
 * çıkıyor. Tam ürün sayfası kadar net değil ama ek maliyet/AI gerektirmiyor.
 *
 * Çalıştırma: node scripts/auto-indirimradar.js
 */

import { GoogleGenAI } from '@google/genai';
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore, FieldValue, FieldPath } from 'firebase-admin/firestore';
import { getMessaging } from 'firebase-admin/messaging';
import * as fs from 'fs';
import * as path from 'path';
import { sendAdminAlert } from './alertService.js';
import { runQualityGate } from './qualityGate.js';
import { maybeNotifyHighScoreDeal } from './notifyGate.js';
import { maybeQueueSocialContent } from './socialContentGate.js';

// ─── .env Yükle (lokal geliştirme) ─────────────────────────────────────────
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
const API_URL = 'https://www.indirimradarapp.com/api/products';
const MAX_NEW_PRODUCTS = 50;
// En az bu oranda gerçek indirim yoksa (list_price yoksa/newPrice'tan düşükse)
// ürünü atla — düz katalog fiyatı, indirim değil.
const MIN_DISCOUNT_PERCENT = 8;

const CATEGORY_MAP = [
    { keywords: ['klavye', 'mouse', 'fare', 'monitör', 'bilgisayar', 'laptop', 'notebook', 'tablet', 'telefon', 'iphone', 'samsung', 'xiaomi', 'kulaklık', 'hoparlör', 'kamera', 'ssd', 'harddisk', 'şarj', 'powerbank', 'kablo', 'adaptör', 'akıllı saat', 'watch', 'scooter', 'drone', 'playstation', 'xbox', 'nintendo', 'router', 'modem', 'yazıcı', 'tv ', 'televizyon', 'stick'], category: 'Teknoloji' },
    { keywords: ['mont', 'ceket', 'kazak', 'gömlek', 'pantolon', 'şort', 'elbise', 'bluz', 'tişört', 't-shirt', 'sweatshirt', 'polar', 'ayakkabı', 'sneaker', 'bot', 'sandalet', 'çanta', 'sırt çantası', 'bere', 'eldiven', 'çorap', 'yelek', 'kemer', 'cüzdan', 'pijama'], category: 'Giyim & Moda' },
    { keywords: ['şampuan', 'krem', 'losyon', 'maske', 'serum', 'parfüm', 'deodorant', 'saç', 'cilt', 'diş', 'tıraş', 'makyaj', 'ruj', 'oje', 'hijyen', 'sabun', 'duş jeli', 'lip balm', 'dudak'], category: 'Kozmetik & Bakım' },
    { keywords: ['tencere', 'tava', 'çaydanlık', 'bıçak', 'tabak', 'bardak', 'fincan', 'mobilya', 'masa', 'sandalye', 'yatak', 'dolap', 'nevresim', 'perde', 'halı', 'aydınlatma', 'lamba', 'havlu', 'süpürge', 'elektrikli süpürge'], category: 'Ev & Yaşam' },
    { keywords: ['deterjan', 'temizlik', 'bakliyat', 'yağ', 'şeker', 'çay', 'kahve', 'atıştırmalık', 'makarna', 'peynir', 'süt', 'yoğurt', 'çikolata', 'gıda', 'bisküvi'], category: 'Süpermarket' },
    { keywords: ['bebek', 'bez', 'emzik', 'biberon', 'mama sandalyesi', 'bebek arabası'], category: 'Anne & Bebek' },
    { keywords: ['lego', 'puzzle', 'oyuncak', 'oyun seti', 'kutu oyunu', 'figür'], category: 'Oyun & Oyuncak' },
    { keywords: ['vitamin', 'takviye', 'kapsül', 'şurup', 'sağlık', 'medikal', 'prezervatif'], category: 'Sağlık' },
    { keywords: ['kalem', 'defter', 'boya', 'kitap', 'roman'], category: 'Kitap & Kırtasiye' },
    { keywords: ['kamp', 'spor', 'fitness', 'outdoor', 'bisiklet', 'top', 'forma', 'pilates', 'koşu'], category: 'Spor & Outdoor' },
    { keywords: ['kedi', 'köpek', 'evcil', 'pet', 'mama kedi', 'mama köpek', 'kısırlaştırılmış'], category: 'Pet Shop' },
    { keywords: ['araba', 'otomobil', 'lastik', 'motosiklet', 'kask', 'oto aksesuar'], category: 'Otomotiv' },
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
    return 'Ev & Yaşam';
}

function cleanTitle(title) {
    return String(title || '').replace(/\s+/g, ' ').trim().substring(0, 200);
}

// Başlıktan Amazon Türkiye arama linki oluştur — API gerçek ürün linkini
// vermiyor, ama başlıklar (marka+model+varyant) o kadar spesifik ki arama
// sonucunun ilk sırasında neredeyse her zaman doğru ürün çıkıyor.
function buildAmazonSearchLink(title) {
    const q = encodeURIComponent(cleanTitle(title));
    return `https://www.amazon.com.tr/s?k=${q}`;
}

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

// ─── IndirimRadar API'den ürün listesi çek ──────────────────────────────────
async function fetchIndirimRadarProducts() {
    const response = await fetch(API_URL, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        },
        // API'nin bulduğumuz sunucu tavanı: 50/istek (varsayılan 20). En son
        // güncellenen ürünleri döndürüyor (canlı akış, tam katalog değil) -
        // limit'i tavana çekmek, her taramada daha geniş bir zaman penceresi
        // kapsamamızı sağlıyor, ek maliyet yok.
        body: JSON.stringify({ limit: 50 }),
        signal: AbortSignal.timeout(20000),
    });
    if (!response.ok) throw new Error(`API HTTP ${response.status}`);
    const data = await response.json();
    return data.products || [];
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────
async function main() {
    console.log('\n🚀 INDIVA Auto-IndirimRadar Pipeline Başlatıldı');
    console.log('═══════════════════════════════════════════');
    console.log(`⏰ ${new Date().toLocaleString('tr-TR')}\n`);

    const db = initFirebase();
    const qualityGateKey = process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_API_KEY || null;
    if (!qualityGateKey) {
        console.warn('⚠️  GEMINI_API_KEY yok — kalite kapısı/bildirim/sosyal içerik puanlaması devre dışı (varsayılan 6/10 ile geçecek).');
    }

    // ── 1. IndirimRadar'dan ürün listesini çek ──────────────────────────────
    let rawProducts;
    try {
        rawProducts = await fetchIndirimRadarProducts();
    } catch (err) {
        console.error(`❌ IndirimRadar fetch hatası: ${err.message}`);
        await sendAdminAlert('IndirimRadar Pipeline Hatası', `Fetch başarısız: ${err.message}`);
        process.exit(1);
    }

    console.log(`📡 ${rawProducts.length} ürün çekildi.`);

    // ── 2. Gerçek indirimi olanları filtrele ────────────────────────────────
    const withDiscount = rawProducts
        .filter(p => p.title && p.current_price > 0 && p.is_in_stock !== false)
        .map(p => {
            const newPrice = Number(p.current_price) || 0;
            const oldPrice = Number(p.list_price) || 0;
            const discountPct = oldPrice > newPrice
                ? Math.round(((oldPrice - newPrice) / oldPrice) * 100)
                : 0;
            return { raw: p, newPrice, oldPrice, discountPct };
        })
        .filter(p => p.discountPct >= MIN_DISCOUNT_PERCENT)
        .sort((a, b) => b.discountPct - a.discountPct)
        .slice(0, MAX_NEW_PRODUCTS);

    console.log(`📊 Gerçek indirimli (%${MIN_DISCOUNT_PERCENT}+): ${withDiscount.length} ürün\n`);

    if (withDiscount.length === 0) {
        console.log('✅ Bu turda yeterli indirimli ürün yok. Pipeline tamamlandı.');
        return;
    }

    // ── 3. Cache & DB filtreleme ─────────────────────────────────────────────
    const withIds = withDiscount.map(p => ({ ...p, _docId: `indirimradar_${p.raw.id}` }));
    const existingInDb = await filterExistingIds(db, withIds.map(p => p._docId));
    if (existingInDb.size > 0) console.log(`   ⏭️  ${existingInDb.size} ürün Firebase'de zaten var`);

    const finalList = withIds.filter(p => !existingInDb.has(p._docId));
    console.log(`   🆕 İşlenecek net yeni ürün: ${finalList.length}\n`);

    if (finalList.length === 0) {
        console.log('✅ Yeni ürün yok. Pipeline tamamlandı.');
        return;
    }

    // ── 4. AI kalite kapısı — TEK istekte toplu puanlama ────────────────────
    const gateCandidates = finalList.map(p => ({
        id: p._docId,
        title: p.raw.title,
        oldPrice: p.oldPrice,
        newPrice: p.newPrice,
        category: detectCategory(p.raw.title),
        link: buildAmazonSearchLink(p.raw.title),
    }));
    const gateResults = await runQualityGate(gateCandidates, { apiKey: qualityGateKey, threshold: 6, db });
    const gateMap = new Map(gateResults.map(r => [r.id, r]));

    console.log(`🛡️  Kalite kapısı: ${gateResults.filter(r => r.publish).length}/${gateResults.length} onaylandı\n`);

    let successCount = 0, rejectedCount = 0, failCount = 0;

    for (const item of finalList) {
        const verdict = gateMap.get(item._docId);
        if (!verdict?.publish) {
            console.log(`   🚫 Reddedildi (${item._docId}): ${verdict?.reason || 'bilinmeyen'}`);
            rejectedCount++;
            continue;
        }

        try {
            const storeLink = buildAmazonSearchLink(item.raw.title);
            const title = cleanTitle(item.raw.title);
            const category = detectCategory(item.raw.title);

            const discountData = {
                title,
                brand: item.raw.marketplace_display_name || 'Amazon',
                category,
                description: '',
                link: storeLink,
                originalStoreLink: storeLink,
                oldPrice: item.oldPrice,
                newPrice: item.newPrice,
                imageUrl: item.raw.thumbnail || '',
                deleteUrl: '',
                submittedBy: 'auto-indirimradar-bot',
                isAd: false,
                affiliateLinkUpdated: false,
                originalSource: 'indirimradar',
                storeName: item.raw.marketplace_display_name || 'Amazon',
                status: 'aktif',
                telegramMessageId: item._docId,
                pushNotifications: [],
                lastPriceCheck: FieldValue.serverTimestamp(),
                autoPublishedAt: FieldValue.serverTimestamp(),
                createdAt: FieldValue.serverTimestamp(),
                aiFomoScore: verdict.score || 6,
                expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
                priceHistory: [{ price: item.newPrice, at: new Date() }],
                qualityScore: verdict.score,
            };

            await db.collection('discounts').doc(item._docId).set(discountData);
            console.log(`   🔥 Kaydedildi ✅ (${item._docId}): ${title.substring(0, 50)} | ${item.oldPrice} TL -> ${item.newPrice} TL (%${item.discountPct})`);

            await maybeNotifyHighScoreDeal(db, getMessaging(), {
                docId: item._docId,
                title,
                imageUrl: discountData.imageUrl,
                score: verdict.score,
                newPrice: item.newPrice,
                oldPrice: item.oldPrice,
            }).catch(() => {});

            await maybeQueueSocialContent(db, qualityGateKey, {
                discountId: item._docId,
                title,
                imageUrl: discountData.imageUrl,
                category,
                storeName: discountData.storeName,
                score: verdict.score,
                newPrice: item.newPrice,
                oldPrice: item.oldPrice,
            }).catch(() => {});

            successCount++;
            await sleep(300);
        } catch (err) {
            console.error(`   ❌ Kaydetme hatası (${item._docId}): ${err.message}`);
            failCount++;
        }
    }

    console.log('\n═══════════════════════════════════════════');
    console.log('📊 INDIRIMRADAR PIPELINE TAMAMLANDI');
    console.log(`   ✅ Başarılı: ${successCount}`);
    console.log(`   🚫 Kalite kapısında reddedildi: ${rejectedCount}`);
    console.log(`   ❌ Başarısız: ${failCount}`);
    console.log(`   ⏰ ${new Date().toLocaleString('tr-TR')}`);
    console.log('═══════════════════════════════════════════\n');
}

main().catch(async (err) => {
    console.error('\n💥 KRİTİK HATA:', err.message);
    try {
        await sendAdminAlert('IndirimRadar Pipeline Kritik Hata', `auto-indirimradar.js durdu: ${err.message}`);
    } catch { /* ignore */ }
    process.exit(1);
});
