/**
 * test-expired-ui.js
 * 
 * Bu script, Firestore'daki rastgele bir ilanı "İndirim Bitti" durumuna getirir
 * ve 15 dakika önce bitmiş gibi gösterir. 
 * Böylece uygulamayı açtığınızda grayscale ve 45 dk sayaç efektini görebilirsiniz.
 * 
 * Çalıştırma: node scripts/test-expired-ui.js (Panel klasöründe)
 */

import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import * as fs from 'fs';
import * as path from 'path';

const ROOT_DIR = process.cwd();

function initFirebase() {
    if (getApps().length > 0) return getFirestore();
    let serviceAccount;
    const localPath = path.join(ROOT_DIR, 'firebase-service-account.json');
    if (fs.existsSync(localPath)) {
        serviceAccount = JSON.parse(fs.readFileSync(localPath, 'utf8'));
    } else {
        throw new Error('firebase-service-account.json bulunamadı. Lütfen panel klasöründe olduğunuzdan emin olun.');
    }
    initializeApp({ credential: cert(serviceAccount) });
    return getFirestore();
}

async function mockExpired() {
    const db = initFirebase();
    const snapshot = await db.collection('discounts').where('status', '==', 'aktif').limit(1).get();

    if (snapshot.empty) {
        console.log('❌ Aktif ilan bulunamadı.');
        return;
    }

    const doc = snapshot.docs[0];
    const fifteenMinsAgo = new Date(Date.now() - 15 * 60 * 1000);

    await doc.ref.update({
        status: 'İndirim Bitti',
        expiredAt: fifteenMinsAgo,
        expiresAt: fifteenMinsAgo // Mobil uygulamanın baktığı alan
    });

    console.log(`✅ Başarılı! "${doc.data().title}" ilanı "İndirim Bitti" olarak işaretlendi.`);
    console.log(`⏳ Şu an uygulamayı açıp refresh yaparsanız grayscale ve ~45:00 sayaç görmelisiniz.`);
}

mockExpired().catch(console.error);
