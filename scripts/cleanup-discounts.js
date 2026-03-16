import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import * as fs from 'fs';
import * as path from 'path';

// Load .env
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
        if (!process.env[key]) process.env[key] = val;
    }
}

function initFirebase() {
    if (getApps().length > 0) return getFirestore();
    const envJson = process.env.FIREBASE_SERVICE_ACCOUNT;
    let serviceAccount;
    if (envJson) {
        serviceAccount = JSON.parse(envJson);
    } else {
        const localPath = path.join(ROOT_DIR, 'firebase-service-account.json');
        if (fs.existsSync(localPath)) {
            serviceAccount = JSON.parse(fs.readFileSync(localPath, 'utf8'));
        } else {
            throw new Error('Firebase service account not found.');
        }
    }
    initializeApp({ credential: cert(serviceAccount) });
    return getFirestore();
}

async function cleanupOldDiscounts() {
    console.log('🧹 48 saati geçen eski ilanlar temizleniyor...');
    const db = initFirebase();
    const now = new Date();
    const fortyEightHoursAgo = new Date(now.getTime() - (48 * 60 * 60 * 1000));

    try {
        let totalDeleted = 0;

        // ── 1. ADIM: "Sonlanıyor" olup süresi 1 saati geçenleri "İndirim Bitti" yap ──
        console.log('⏳ 1 saat önce "Sonlanıyor" olan ilanlar "İndirim Bitti" olarak işaretleniyor...');
        const oneHourAgo = new Date(now.getTime() - (60 * 60 * 1000));
        
        const sonlaniyorSnapshot = await db.collection('discounts')
            .where('status', '==', 'Sonlanıyor')
            .where('expiredAt', '<', oneHourAgo)
            .get();

        if (!sonlaniyorSnapshot.empty) {
            const batch = db.batch();
            sonlaniyorSnapshot.docs.forEach(doc => {
                batch.update(doc.ref, {
                    status: 'İndirim Bitti',
                    lastPriceCheck: FieldValue.serverTimestamp()
                });
            });
            await batch.commit();
            console.log(`   ✅ ${sonlaniyorSnapshot.size} adet ilan "İndirim Bitti" oldu ve anasayfadan düştü.`);
        }
        
        // ── 2. ADIM: "İndirim Bitti" olup süresi çok geçenleri fiziken sil (İsteğe bağlı temizlik) ──
        console.log('🗑️ "İndirim Bitti" olan eski kalıntı ilanlar veritabanından tamamen siliniyor...');
        // Let's actually delete things that have been 'completed' for > 2 hours to keep the DB small.
        const twoHoursAgo = new Date(now.getTime() - (2 * 60 * 60 * 1000));
        const endedSnapshot = await db.collection('discounts')
            .where('status', '==', 'İndirim Bitti')
            .where('expiredAt', '<', twoHoursAgo)
            .get();

        if (!endedSnapshot.empty) {
            const batch = db.batch();
            endedSnapshot.docs.forEach(doc => batch.delete(doc.ref));
            await batch.commit();
            totalDeleted += endedSnapshot.size;
            console.log(`   ✅ ${endedSnapshot.size} adet çöp ilan tamamen kalıcı silindi.`);
        }

        // ── 3. ADIM: 48 saati geçen tüm eski ilanları sil ──
        console.log('🧹 48 saati geçen tüm eski ilanlar temizleniyor...');
        let hasMore = true;

        while (hasMore) {
            const snapshot = await db.collection('discounts')
                .where('createdAt', '<', fortyEightHoursAgo)
                .limit(400)
                .get();

            if (snapshot.empty) {
                hasMore = false;
                break;
            }

            const batch = db.batch();
            snapshot.docs.forEach(doc => batch.delete(doc.ref));

            await batch.commit();
            totalDeleted += snapshot.size;
            console.log(`   ✅ ${snapshot.size} eski ilan silindi... (Toplam: ${totalDeleted})`);

            if (totalDeleted > 5000) {
                console.log('   ⚠️ Güvenlik sınırı (5000) aşıldı.');
                break;
            }
        }

        console.log(`\n✨ Temizlik tamamlandı. Toplam ${totalDeleted} ilan silindi.`);
    } catch (err) {
        console.error(`💥 HATA: ${err.message}`);
        process.exit(1);
    }
}

cleanupOldDiscounts();
