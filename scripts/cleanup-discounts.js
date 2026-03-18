import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
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
    console.log(`\n🧹 Temizlik Başlatıldı: ${new Date().toLocaleString('tr-TR')}`);
    console.log('═══════════════════════════════════════════');
    const db = initFirebase();
    const now = new Date();

    try {
        let totalDeleted = 0;

        // ── 1. ADIM: "İndirim Bitti" olup 1 saat geçenleri fiziken sil ──
        // NOT: Composite index gerektirmemek için JS tarafında filtre yapıyoruz
        console.log('🗑️ "İndirim Bitti" → 1 saat geçenler kalıcı siliniyor...');
        const oneHourAgo = new Date(now.getTime() - (60 * 60 * 1000));

        // Sadece status üzerinden çek (single-field = index gerekmez)
        const endedSnapshot = await db.collection('discounts')
            .where('status', '==', 'İndirim Bitti')
            .get();

        // expiredAt filtresini JavaScript'te yap
        const toDelete = endedSnapshot.docs.filter(doc => {
            const expiredAt = doc.data().expiredAt;
            if (!expiredAt) return false;
            const expiredDate = expiredAt.toDate ? expiredAt.toDate() : new Date(expiredAt);
            return expiredDate < oneHourAgo;
        });

        if (toDelete.length > 0) {
            // Firestore batch max 500 doc
            for (let i = 0; i < toDelete.length; i += 400) {
                const chunk = toDelete.slice(i, i + 400);
                const batch = db.batch();
                chunk.forEach(doc => batch.delete(doc.ref));
                await batch.commit();
            }
            totalDeleted += toDelete.length;
            console.log(`   ✅ ${toDelete.length} adet süresi dolmuş ilan kalıcı olarak silindi.`);
        } else {
            console.log('   ℹ️ Silinecek süresi dolmuş ilan yok.');
        }

        // ── 2. ADIM: 24 saat geçmiş TÜM ilanları sil (status farketmez) ──
        // Onual ilanları zaten 24 saatte expire oluyor, bundan sonrası veritabanı şişirmek
        console.log('🧹 24 saati geçen tüm eski ilanlar temizleniyor...');
        const twentyFourHoursAgo = new Date(now.getTime() - (24 * 60 * 60 * 1000));
        let hasMore = true;

        while (hasMore) {
            const snapshot = await db.collection('discounts')
                .where('createdAt', '<', twentyFourHoursAgo)
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
        console.log('═══════════════════════════════════════════\n');
    } catch (err) {
        console.error(`💥 HATA: ${err.message}`);
        process.exit(1);
    }
}

cleanupOldDiscounts();
