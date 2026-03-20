/**
 * price-checker.js — INDIVA Akıllı Fiyat Takip ve Otomatik Pasife Alma
 * 
 * Özellikler:
 * - Hibrit Tarama: Klasik fetch + Jina Reader (Bot engeli aşımı)
 * - Groq AI Entegrasyonu: Llama 3.3 ile yüksek hızlı ve ucuz doğrulama
 * - Akıllı Önceliklendirme: Sadece şüpheli durumlarda AI kullanımı
 * - Gerçek Zamanlı Senkronizasyon: Uygulama içi bildirim ve FCM sinyali
 */

import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { getMessaging } from 'firebase-admin/messaging';
import * as fs from 'fs';
import * as path from 'path';
import { fetchWithFallback } from './scraperService.js';
import { sendAdminAlert } from './alertService.js';

// ─── .env Yükle ─────────────────────────────────────────────────────────────
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

    // PEM formatı için private_key'deki kaçış karakterlerini (\n) GERÇEK satır başlarına çevir
    if (serviceAccount && serviceAccount.private_key) {
        // Hem \n hem de \\n durumlarını kapsayacak şekilde temizlik yap
        serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, '\n').replace(/\n\n/g, '\n');
    }

    initializeApp({ credential: cert(serviceAccount) });
    return getFirestore();
}

// ─── HTTP & Scraper Utilities ────────────────────────────────────────────────
/**
 * fetchHtml - REFACTORED to use scraperService
 */
async function fetchHtml(url, useJina = false) {
    try {
        const { html } = await fetchWithFallback(url, { useJina, timeout: 15000 });
        return html;
    } catch (e) {
        console.warn(`      ⚠️ Fetch failed for ${url}: ${e.message}`);
        return null;
    }
}


// ─── FCM Sessiz Güncelleme ─────────────────────────────────────────────────────
/**
 * Mobil uygulamaya sessiz FCM push gönder.
 * HomePage.tsx "DISCOUNT_STATUS_UPDATED" event'ini dinliyor;
 * bu event ancak FCM data mesajı gelince tetiklenir.
 */
async function sendSilentExpiredNotification(discountId, title) {
    try {
        const message = {
            // "notification" alanı YOK — bu ekranı göstermez, sadece app'i tetikler
            data: {
                type: 'DISCOUNT_EXPIRED',
                discountId: discountId,
                status: 'İndirim Bitti',
                timestamp: Date.now().toString(),
            },
            topic: 'all_users',
            android: { priority: 'high' }
        };
        await getMessaging().send(message);
        console.log(`   📣 [FCM] Sessiz güncelleme gönderildi: ${title?.substring(0, 30)}...`);
    } catch (e) {
        console.warn(`   ⚠️ [FCM] Sessiz bildirim gönderilemedi: ${e.message}`);
        // Fail silently — Firebase kaydı zaten yapıldı
    }
}

// ─── AI Verification (Groq) ──────────────────────────────────────────────────
async function verifyWithAI(product, content) {
    // VITE_ prefix'siz key'i de dene (GitHub Actions secrets'ta VITE_ olmaz)
    const apiKey = process.env.GROQ_API_KEY || process.env.VITE_GROQ_API_KEY;
    if (!apiKey || apiKey.startsWith('gsk_vU1y')) return { expired: false, reason: 'Groq API Key yok veya test key' };

    const prompt = `Ürün: "${product.title}" | Beklenen Fiyat: ${product.newPrice} TL
    GÖREV: Sayfa içeriğine göre ürünün durumunu belirle.
    1. Stokta mı?
    2. Güncel fiyat nedir?
    3. İndirim bitmiş mi? (Fiyat %10+ artmışsa veya stok yoksa true)
    
    SADECE JSON: {"expired": boolean, "currentPrice": number, "inStock": boolean, "reason": "kısa açıklama"}`;

    try {
        const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
            body: JSON.stringify({
                model: "llama-3.3-70b-versatile",
                messages: [{ role: "user", content: prompt + "\n\nİÇERİK:\n" + content.substring(0, 10000) }],
                temperature: 0.1,
                response_format: { type: "json_object" }
            })
        });

        if (!response.ok) return { expired: false, reason: 'AI Servis Hatası' };

        const data = await response.json();
        const result = JSON.parse(data.choices?.[0]?.message?.content || '{}');
        return result;
    } catch (e) {
        return { expired: false, reason: 'AI Analiz Hatası' };
    }
}

// ─── Main Controller ─────────────────────────────────────────────────────────
async function checkPrices() {
    process.stdout.write('\x1Bc'); // Terminali temizle
    console.log(`\n🚀 INDIVA AKILLI TAKİP SİSTEMİ: ${new Date().toLocaleString('tr-TR')}`);
    const db = initFirebase();

    try {
        // --- AŞAMA 1: 12 SAAT KURALI İLE OTOMATİK TEMİZLİK ---
        // Bu aşamada TÜM aktif ilanları çekip 12 saati geçenleri anında pasife alıyoruz.
        // İndeks hatası almamak için orderBy kullanmıyoruz (Zaten tüm aktifleri kontrol ediyoruz).
        const activeSnapshot = await db.collection('discounts')
            .where('status', '==', 'aktif')
            .get();

        const activeDocs = activeSnapshot.docs;
        const now = Date.now();
        const TWELVE_HOURS_MS = 12 * 60 * 60 * 1000;

        console.log(`📊 Toplam ${activeDocs.length} aktif ilan kontrol ediliyor...\n`);

        let autoExpiredCount = 0;
        const autoExpiredIds = new Set();
        
        for (const doc of activeDocs) {
            const deal = doc.data();
            let createdAtMs = 0;
            
            // Farklı tarih formatlarını destekle (Timestamp, Seconds, Number, String)
            if (deal.createdAt && typeof deal.createdAt.toMillis === 'function') {
                createdAtMs = deal.createdAt.toMillis();
            } else if (deal.createdAt && deal.createdAt._seconds) {
                createdAtMs = deal.createdAt._seconds * 1000;
            } else if (typeof deal.createdAt === 'number') {
                createdAtMs = deal.createdAt;
            } else if (typeof deal.createdAt === 'string') {
                createdAtMs = new Date(deal.createdAt).getTime();
            }

            if (createdAtMs > 0 && (now - createdAtMs > TWELVE_HOURS_MS)) {
                autoExpiredCount++;
                autoExpiredIds.add(doc.id);
                const deleteDate = new Date(Date.now() + 60 * 60 * 1000); // 1 saatlik sayaç
                
                await doc.ref.update({
                    status: 'İndirim Bitti',
                    expiredAt: FieldValue.serverTimestamp(),
                    expiresAt: FieldValue.serverTimestamp(),
                    deleteAt: deleteDate,
                    errorReason: '12 saatlik yayın süresi dolmuştur (Otomatik).'
                });
                // Mobil uygulamaı gerçek zamanlı bilgilendirmek için sessiz FCM gönder
                await sendSilentExpiredNotification(doc.id, deal.title);
                console.log(`   ⏰ OTOMATİK PASİF: ${deal.title.substring(0, 30)}... (${( (now - createdAtMs) / 3600000).toFixed(1)} sa)`);
            }
        }

        if (autoExpiredCount > 0) {
            console.log(`\n✅ ${autoExpiredCount} adet 12 saati geçmiş ilan anında pasife alındı (Sayaç Başladı).`);
        } else {
            console.log('✅ 12 saati geçmiş aktif ilan bulunamadı.');
        }

        // --- AŞAMA 2: KALAN GENÇ İLANLAR İÇİN AI FİYAT/STOK KONTROLÜ ---
        // Sadece 12 saatten küçük olan ve bu turda pasife alınmayanlardan bir kısmını tarıyoruz.
        const adsToInspect = activeDocs.filter(d => !autoExpiredIds.has(d.id)).slice(0, 100);
        
        if (adsToInspect.length > 0) {
            console.log(`\n🔍 ${adsToInspect.length} güncel ilan AI ile fiyat/stok kontrolüne alınıyor...\n`);
        }

        const processDeal = async (doc) => {
            const deal = doc.data();
            const id = doc.id;

            // Zaten bitmişse veya link yoksa atla
            if (deal.status === 'İndirim Bitti' || !deal.link) return;

            const url = deal.originalStoreLink || deal.link;
            console.log(`📦 [${deal.brand || 'Mağaza'}] ${deal.title.substring(0, 40)}...`);

            try {
                const isHardSite = /trendyol|amazon|hepsiburada|n11/.test(url.toLowerCase());
                let html = await fetchHtml(url, isHardSite);

                if (isHardSite) await new Promise(r => setTimeout(r, 2000)); // Rate limit bekleme

                if (!html) {
                    await doc.ref.update({ lastPriceCheck: FieldValue.serverTimestamp() });
                    return;
                }

                const aiResult = await verifyWithAI(deal, html);

                if (aiResult.expired) {
                    console.log(`   🚩 İNDİRİM BİTTİ: ${aiResult.reason} (${id})`);
                    const deleteDate = new Date(Date.now() + 60 * 60 * 1000);

                    const updateData = {
                        status: 'İndirim Bitti',
                        expiredAt: FieldValue.serverTimestamp(),
                        expiresAt: FieldValue.serverTimestamp(),
                        deleteAt: deleteDate,
                        lastCheckedPrice: aiResult.currentPrice || 0,
                        lastPriceCheck: FieldValue.serverTimestamp(),
                        errorReason: aiResult.reason
                    };
                    await doc.ref.update(updateData);
                    // Mobil uygulamaı gerçek zamanlı bilgilendirmek için sessiz FCM gönder
                    await sendSilentExpiredNotification(id, deal.title);

                    // Bildirim
                    await db.collection('notifications').add({
                        title: `🏷️ İndirim Bitti: ${deal.brand || 'İNDİVA'}`,
                        body: `${deal.title} indirimi sona erdi.`,
                        image: deal.imageUrl || "",
                        url: `https://indiva.app/detay/${id}`,
                        target: 'all',
                        status: 'pending',
                        createdAt: FieldValue.serverTimestamp()
                    });
                } else {
                    console.log(`   ✅ Aktif: ${deal.title.substring(0, 20)}...`);
                    await doc.ref.update({
                        lastPriceCheck: FieldValue.serverTimestamp(),
                        lastCheckedPrice: aiResult.currentPrice || deal.newPrice,
                        status: 'aktif'
                    });
                }
            } catch (e) {
                console.error(`   ❌ Hata (${id}): ${e.message}`);
            }
        };

        // 5'erli paketler halinde paralel işle (Sunucuyu ve kotaları yormadan)
        const batchSize = 5;
        for (let i = 0; i < adsToInspect.length; i += batchSize) {
            const batch = adsToInspect.slice(i, i + batchSize);
            await Promise.all(batch.map(doc => processDeal(doc)));
        }

        // --- AŞAMA 3: KESİN SİLME (deleteAt dolanlar) ---
        console.log(`\n🗑️  Kesin silme kontrolü yapılıyor...`);
        const toDeleteSnapshot = await db.collection('discounts')
            .where('deleteAt', '<=', new Date())
            .get();

        if (toDeleteSnapshot.size > 0) {
            const deleteBatch = db.batch();
            toDeleteSnapshot.docs.forEach(doc => {
                deleteBatch.delete(doc.ref);
                console.log(`   🚮 SİLİNDİ: ${doc.data().title.substring(0, 30)}...`);
            });
            await deleteBatch.commit();
            console.log(`✅ ${toDeleteSnapshot.size} adet süresi dolan ilan kalıcı olarak silindi.`);
        } else {
            console.log('✅ Silinecek süresi dolmuş ilan yok.');
        }

        console.log(`\n✨ Tarama tamamlandı. 10 dakika sonra tekrar çalışacak.`);

    } catch (err) {
        console.error(`💥 Kritik Hata: ${err.message}`);
        await sendAdminAlert('Kritik Sistem Hatası', `price-checker.js durdu: ${err.message}`);
    }
}

/**
 * GitHub Actions cron ile 10 dakikada bir tek seferlik çalıştır.
 * while(true) döngüsü kaldırıldı — Actions zaten cron ile tetikliyor.
 */
checkPrices()
    .then(() => {
        console.log('\n✅ Price Checker başarıyla tamamlandı.');
        process.exit(0);
    })
    .catch(async (err) => {
        console.error(`\n💥 KRİTİK HATA: ${err.message}`);
        try { await sendAdminAlert('Price Checker Kritik Hata', err.message); } catch {}
        process.exit(1);
    });
