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

// Self-chain zinciri ~5 dakikada bir sonraki çalışmayı tetikliyor (workflow
// dosyasında). Yeni ürünleri hemen art arda yayınlamak yerine, bulunanları bu
// ~5 dakikalık pencereye yayarak paylaşıyoruz — böylece site "canlı" görünür,
// birden 27 ürün patlaması yerine düzenli aralıklarla akan bir yayın olur.
// Hiç yeni ürün yoksa veya yayınlama pencereden erken biterse, sonraki
// self-chain tetiklemesinin hâlâ ~5 dakikada bir olması için kalan süre
// beklenir (aksi halde "0 yeni ürün" durumunda zincir çok hızlı dönerdi).
const TARGET_WINDOW_MS = 290_000; // 290s — 300s'lik self-chain periyodundan biraz az, tampon payı
const MIN_SPACING_MS = 3_000;

async function padToTargetWindow(mainStartTime) {
    const elapsed = Date.now() - mainStartTime;
    const remaining = TARGET_WINDOW_MS - elapsed;
    if (remaining > 0) {
        console.log(`⏳ Pencereyi tamamlamak için ${Math.round(remaining / 1000)}sn bekleniyor...`);
        await sleep(remaining);
    }
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────
async function main() {
    const mainStartTime = Date.now();
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

    // ── 2. GEÇİCİ: filtre yok — çekilen her ürünü işliyoruz ─────────────────
    // NOT: MIN_DISCOUNT_PERCENT eşiği ve AI kalite kapısı bilinçli olarak
    // devre dışı bırakıldı (kullanıcı isteği: önce hacmi görelim, filtreyi
    // sonra ekleriz). list_price olmayan ürünlerde oldPrice=0 olarak kalır -
    // panel/uygulama bunu zaten "indirim yok, düz fiyat" olarak gösteriyor.
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
        .slice(0, MAX_NEW_PRODUCTS);

    console.log(`📊 İşlenecek aday: ${withDiscount.length} ürün (filtre kapalı)\n`);

    if (withDiscount.length === 0) {
        console.log('✅ Bu turda ürün yok. Pipeline tamamlandı.');
        await padToTargetWindow(mainStartTime);
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
        await padToTargetWindow(mainStartTime);
        return;
    }

    // ── 4. GEÇİCİ: AI kalite kapısı kapalı — hepsi onaylanmış sayılıyor ─────
    // (kullanıcı isteği: filtreyi sonra ekleriz). Sabit nötr puan (6) veriliyor
    // ki bildirim/sosyal-içerik eşikleri (9+) kırılmasın — bunlar hâlâ sadece
    // gerçekten yüksek puanlı fırsatlar için tetiklenmeli.
    const gateMap = new Map(finalList.map(p => [p._docId, { publish: true, score: 6, reason: 'Filtre geçici olarak kapalı' }]));

    const approved = finalList;
    const rejected = [];
    console.log(`🛡️  Kalite kapısı KAPALI: ${approved.length}/${finalList.length} (hepsi) yayınlanacak\n`);

    for (const item of rejected) {
        const verdict = gateMap.get(item._docId);
        console.log(`   🚫 Reddedildi (${item._docId}): ${verdict?.reason || 'bilinmeyen'}`);
    }
    const rejectedCount = rejected.length;
    let successCount = 0, failCount = 0;

    // Onaylanan ürünleri hemen art arda değil, kalan pencereye (~5dk) yayarak
    // yayınlıyoruz — site "canlı" görünsün, tek seferde toplu patlama olmasın.
    const remainingForSpread = Math.max(0, TARGET_WINDOW_MS - (Date.now() - mainStartTime));
    const spacingMs = approved.length > 0
        ? Math.max(MIN_SPACING_MS, Math.floor(remainingForSpread / approved.length))
        : 0;
    console.log(`⏱️  ${approved.length} ürün, aralarında ~${Math.round(spacingMs / 1000)}sn boşlukla yayınlanacak\n`);

    for (let i = 0; i < approved.length; i++) {
        const item = approved[i];
        const verdict = gateMap.get(item._docId);

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
                // Gercek indirim sinyali (list_price) yoksa uydurma "eski fiyat"
                // gostermiyoruz - bu alan, uygulama tarafinda bu urunleri "indirim"
                // yerine "duz fiyat/fiyat takibi" gibi ayri gosterebilmek icin.
                hasDiscount: item.oldPrice > 0,
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
        } catch (err) {
            console.error(`   ❌ Kaydetme hatası (${item._docId}): ${err.message}`);
            failCount++;
        }

        // Son üründen sonra beklemeye gerek yok — pencere zaten doldu.
        if (i < approved.length - 1) {
            await sleep(spacingMs);
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
