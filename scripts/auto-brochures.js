/**
 * auto-brochures.js — INDIVA Aktüel Afiş Otomasyonu
 *
 * aktuel-urunler.com üzerinden BİM, A101 ve ŞOK aktüel katalog sayfalarını
 * otomatik olarak Firestore circulars/{market}/brochures koleksiyonuna kaydeder.
 *
 * Kaynak: aktuel-urunler.com (WordPress, Cloudflare yok — doğrudan HTML erişim)
 * Çalışma sıklığı: Her 6 saatte bir (GitHub Actions)
 * Mükerrer kontrol: imageUrl alanına göre
 */

import * as cheerio from 'cheerio';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getFirestore, Timestamp, FieldValue } from 'firebase-admin/firestore';
import { logPipelineRun } from './pipelineRunLogger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.join(__dirname, '..');

// .env dosyasından environment variables yükle (lokal çalıştırma için)
const envPath = path.join(ROOT_DIR, '.env');
if (fs.existsSync(envPath)) {
    const lines = fs.readFileSync(envPath, 'utf8').split('\n');
    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eqIdx = trimmed.indexOf('=');
        if (eqIdx < 0) continue;
        const key = trimmed.substring(0, eqIdx).trim();
        const val = trimmed.substring(eqIdx + 1).trim().replace(/^["']|["']$/g, '');
        if (!process.env[key]) process.env[key] = val;
    }
}

// Firebase Admin başlat
function initFirebase() {
    if (getApps().length > 0) return getFirestore();
    let serviceAccount;
    const envJson = process.env.FIREBASE_SERVICE_ACCOUNT;

    // Env var'ı kullan; geçersiz/truncated JSON ise dosyaya düş
    if (envJson && envJson.includes('private_key')) {
        try { serviceAccount = JSON.parse(envJson); } catch { /* geçersiz JSON */ }
    }

    if (!serviceAccount) {
        const localPath = path.join(ROOT_DIR, 'firebase-service-account.json');
        if (!fs.existsSync(localPath)) {
            throw new Error('Firebase credentials bulunamadı. FIREBASE_SERVICE_ACCOUNT env veya firebase-service-account.json gerekli.');
        }
        serviceAccount = JSON.parse(fs.readFileSync(localPath, 'utf8'));
    }
    // JSON'dan okunan private_key'deki \\n escape'lerini gerçek satır başlarına çevir
    if (serviceAccount?.private_key) {
        serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, '\n').replace(/\n\n/g, '\n');
    }

    initializeApp({ credential: cert(serviceAccount) });
    return getFirestore();
}

// ─── HTTP ───────────────────────────────────────────────────────────────────

const HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'tr-TR,tr;q=0.9,en-US;q=0.8',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'none',
};

async function fetchHtml(url) {
    try {
        const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(20000) });
        if (!res.ok) {
            console.log(`   ⚠️  HTTP ${res.status}: ${url}`);
            return null;
        }
        return await res.text();
    } catch (e) {
        console.log(`   ⚠️  Fetch hatası: ${e.message}`);
        return null;
    }
}

// ─── Parsing ────────────────────────────────────────────────────────────────

// Türkçe ay adları — URL'lerde ASCII versiyonları kullanılır
const TR_MONTHS = {
    ocak: 0, subat: 1, mart: 2, nisan: 3, mayis: 4, haziran: 5,
    temmuz: 6, agustos: 7, eylul: 8, ekim: 9, kasim: 10, aralik: 11,
    // Olası diacritics versiyonları
    şubat: 1, mayıs: 4, ağustos: 7, eylül: 8, kasım: 10, aralık: 11,
};

// Türkçe ay adları — görüntü için (büyük harf ilk harf)
const MONTH_DISPLAY = [
    'Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran',
    'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'
];

/**
 * URL slug'ından başlık ve tarih üret.
 * e.g. "bim-3-temmuz-2026-aktuel-urunler-katalogu"
 *   → { title: "BİM 3 Temmuz 2026 Aktüel", date: Date(2026,6,3) }
 */
function parseSlug(slug, storeName) {
    // Suffix'i kaldır
    const clean = slug
        .replace(/-aktuel-urunler-katalogu.*/, '')
        .replace(/-aktuel-urunler.*/, '')
        .replace(/-aktuel-katalogu.*/, '');

    // Market prefix'ini kaldır (bim-, a101-, sok-)
    const marketRe = /^(bim|a101|sok)-/;
    const withoutMarket = clean.replace(marketRe, '');

    // Parçalara böl: {day}-{month}-{year} veya {day}-{month}-{year}-ek
    const parts = withoutMarket.split('-');
    const yearIdx = parts.findIndex(p => /^\d{4}$/.test(p));

    let date = null;
    let displayTitle = '';

    if (yearIdx >= 2) {
        const year = parseInt(parts[yearIdx]);
        const monthStr = parts[yearIdx - 1]?.toLowerCase();
        const month = TR_MONTHS[monthStr];
        const day = parseInt(parts[yearIdx - 2]);

        if (month !== undefined && !isNaN(day) && day >= 1 && day <= 31) {
            date = new Date(year, month, day);
            displayTitle = `${storeName} ${day} ${MONTH_DISPLAY[month]} ${year} Aktüel`;
        }
    }

    if (!displayTitle) {
        // Fallback: slug'ı okunabilir hale getir
        const readable = parts.map(p => p.charAt(0).toUpperCase() + p.slice(1)).join(' ');
        displayTitle = `${storeName} ${readable} Aktüel`;
    }

    return { title: displayTitle, date };
}

/**
 * Liste sayfasındaki katalog linklerini topla.
 * Pattern: /bim-3-temmuz-2026-aktuel-urunler-katalogu/
 */
function extractCatalogLinks(html) {
    const $ = cheerio.load(html);
    const seen = new Set();
    const links = [];

    $('a[href]').each((_, el) => {
        const href = $(el).attr('href') || '';
        // Katalog URL deseni: /{market}-{sayı}-{ay}-{yıl}-aktuel
        if (/\/(bim|a101|sok)-\d+-[a-z]+-\d{4}-aktuel/.test(href)) {
            const fullUrl = href.startsWith('http')
                ? href
                : `https://aktuel-urunler.com${href}`;
            if (!seen.has(fullUrl)) {
                seen.add(fullUrl);
                links.push(fullUrl);
            }
        }
    });

    return links;
}

/**
 * Katalog detay sayfasındaki tam boyutlu görsel URL'lerini çıkar.
 * Thumbnail versiyonları (-200x300, -1280x720 vs.) tam boyuta dönüştürür.
 */
function extractPageImages(html) {
    const $ = cheerio.load(html);
    const images = [];

    $('img[src*="uploads"]').each((_, el) => {
        const src = $(el).attr('src') || '';
        if (src.includes('/story/')) return; // Sidebar story bannerları atla
        // Thumbnail dimensions'ı kaldır: -200x300.webp → .webp
        const fullSrc = src.replace(/-\d+x\d+(\.\w+)$/, '$1');
        if (!images.includes(fullSrc)) {
            images.push(fullSrc);
        }
    });

    return images;
}

// ─── Firestore ───────────────────────────────────────────────────────────────

async function imageExists(db, marketKey, imageUrl) {
    const col = db.collection('circulars').doc(marketKey).collection('brochures');
    const snap = await col.where('imageUrl', '==', imageUrl).limit(1).get();
    return !snap.empty;
}

async function saveBrochure(db, marketKey, storeName, imageUrl, title, publishDate) {
    const col = db.collection('circulars').doc(marketKey).collection('brochures');
    await col.add({
        storeName,
        marketName: storeName,
        title,
        imageUrl,
        validityDate: '',
        publishDate: publishDate ? Timestamp.fromDate(publishDate) : FieldValue.serverTimestamp(),
        deleteUrl: '',
        createdAt: FieldValue.serverTimestamp(),
    });
}

// ─── Temizlik ────────────────────────────────────────────────────────────────

/**
 * 15+ günlük broşürleri Firestore'dan siler.
 * ImgBB'ye yüklenenler (deleteUrl dolu) için ImgBB'den de siler.
 */
async function cleanupOldBrochures(db, daysToKeep = 15) {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - daysToKeep);
    const cutoffTs = Timestamp.fromDate(cutoff);

    console.log(`\n🗑️  Temizlik: ${cutoff.toLocaleDateString('tr-TR')} öncesi afişler siliniyor...`);
    let totalDeleted = 0;

    for (const market of MARKETS) {
        try {
            const col = db.collection('circulars').doc(market.key).collection('brochures');

            // publishDate varsa onu kullan; yoksa createdAt'e bak
            const snapByPublish = await col.where('publishDate', '<', cutoffTs).get();
            const snapByCreated = await col.where('createdAt', '<', cutoffTs).get();

            // İki sorgunun birleşimi (id bazında tekilleştir)
            const docsMap = new Map();
            [...snapByPublish.docs, ...snapByCreated.docs].forEach(d => docsMap.set(d.id, d));

            if (docsMap.size === 0) {
                console.log(`  ${market.name}: silinecek eski afiş yok`);
                continue;
            }

            let deleted = 0;
            for (const doc of docsMap.values()) {
                const { deleteUrl } = doc.data();
                // ImgBB'ye yüklenmişse oradan da sil
                if (deleteUrl) {
                    try { await fetch(deleteUrl); } catch {}
                }
                await doc.ref.delete();
                deleted++;
            }

            totalDeleted += deleted;
            console.log(`  ${market.name}: ${deleted} eski afiş silindi`);
        } catch (cleanupErr) {
            console.error(`  ⚠️ ${market.name} temizliği başarısız: ${cleanupErr.message} — diğer marketlerle devam ediliyor.`);
        }
    }

    return totalDeleted;
}

// ─── Market Yapılandırması ───────────────────────────────────────────────────

const MARKETS = [
    { name: 'BİM',  key: 'bim',  listUrl: 'https://aktuel-urunler.com/bim-aktuel/' },
    { name: 'A101', key: 'a101', listUrl: 'https://aktuel-urunler.com/a101-aktuel/' },
    { name: 'ŞOK',  key: 'sok',  listUrl: 'https://aktuel-urunler.com/sok-aktuel/' },
];

// ─── Ana Akış ────────────────────────────────────────────────────────────────

async function main() {
    console.log(`\n🚀 Aktüel Afiş Otomasyonu başlatıldı: ${new Date().toLocaleString('tr-TR')}`);

    const db = initFirebase();
    const runStartTime = Date.now();
    let totalAdded = 0;
    let totalSkipped = 0;
    let totalFailedMarkets = 0;
    let totalFailedImages = 0;

    for (const market of MARKETS) {
        console.log(`\n━━━ ${market.name} ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
        try {
        const listHtml = await fetchHtml(market.listUrl);
        if (!listHtml) {
            console.log(`  ❌ Liste sayfası yüklenemedi, atlanıyor.`);
            continue;
        }

        const catalogUrls = extractCatalogLinks(listHtml);
        console.log(`  ${catalogUrls.length} katalog linki bulundu`);

        if (catalogUrls.length === 0) {
            console.log(`  ⚠️  Katalog linki bulunamadı.`);
            continue;
        }

        // En yeni 3 kataloğu işle — eskiler zaten Firestore'da olur
        const toProcess = catalogUrls.slice(0, 3);

        for (const catalogUrl of toProcess) {
            const slug = catalogUrl.split('/').filter(Boolean).pop() || '';
            const { title, date } = parseSlug(slug, market.name);

            console.log(`\n  📋 ${title}`);
            if (date) {
                console.log(`     Tarih: ${date.toLocaleDateString('tr-TR')}`);
            }

            const detailHtml = await fetchHtml(catalogUrl);
            if (!detailHtml) {
                console.log(`     ❌ Detay sayfası yüklenemedi`);
                continue;
            }

            const pageImages = extractPageImages(detailHtml);
            console.log(`     ${pageImages.length} sayfa görseli`);

            if (pageImages.length === 0) {
                console.log(`     ⚠️  Görsel bulunamadı`);
                continue;
            }

            let added = 0;
            let skipped = 0;

            for (const imageUrl of pageImages) {
                // Tek bir görselde Firestore/ağ kaynaklı geçici bir hata olursa
                // (önceden buraya try/catch yoktu) TÜM script çöküp workflow'u
                // "failure" olarak işaretliyordu — artık sadece o görsel atlanıyor.
                try {
                    const exists = await imageExists(db, market.key, imageUrl);
                    if (exists) {
                        skipped++;
                        continue;
                    }
                    await saveBrochure(db, market.key, market.name, imageUrl, title, date);
                    added++;
                    totalAdded++;
                } catch (imgErr) {
                    console.log(`     ⚠️  Görsel işlenemedi (${imgErr.message}): ${imageUrl.substring(0, 60)}`);
                    totalFailedImages++;
                }
            }

            totalSkipped += skipped;

            if (added > 0) {
                console.log(`     ✅ ${added} yeni sayfa kaydedildi`);
            } else {
                console.log(`     ⏭️  Tümü zaten mevcut (${skipped} atlandı)`);
            }

            await new Promise(r => setTimeout(r, 800)); // sunucuya nazik ol
        }
        } catch (marketErr) {
            console.error(`  💥 ${market.name} işlenirken hata: ${marketErr.message} — diğer marketlerle devam ediliyor.`);
            totalFailedMarkets++;
        }
    }

    console.log(`\n✨ Tamamlandı! ${totalAdded} yeni afiş eklendi, ${totalSkipped} tekrar atlandı.`);

    // Önce yeni afişleri ekle, sonra eskilerini temizle
    const totalDeleted = await cleanupOldBrochures(db);
    if (totalDeleted > 0) {
        console.log(`🗑️  Toplam ${totalDeleted} eski afiş silindi.`);
    }

    await logPipelineRun(db, {
        script: 'auto-brochures',
        fetched: totalAdded + totalSkipped + totalFailedImages,
        approved: totalAdded,
        rejected: 0,
        skipped: totalSkipped,
        failed: totalFailedImages,
        durationMs: Date.now() - runStartTime,
        note: totalFailedMarkets > 0 ? `${totalFailedMarkets} market işlenemedi` : undefined,
    });
}

main().catch(async err => {
    console.error(`\n💥 KRİTİK HATA: ${err.message}`);
    console.error(err.stack);
    try {
        const db = initFirebase();
        await logPipelineRun(db, {
            script: 'auto-brochures', fetched: 0, approved: 0, rejected: 0, skipped: 0, failed: 1,
            note: `Kritik hata: ${err.message}`,
        });
    } catch { /* ignore */ }
    process.exit(1);
});
