/**
 * checkProductFeedback.js — Ürün Değerlendirme ekranından yapılan 👍/👎
 * kayıtlarının gerçekten Firestore'a yazılıp yazılmadığını doğrulamak için
 * tek seferlik tanı scripti (CI'da workflow_dispatch ile çalıştırılır).
 *
 * Kullanım: node scripts/checkProductFeedback.js
 * Env: FIREBASE_SERVICE_ACCOUNT
 */

import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

function initFirebase() {
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || '{}');
    if (!serviceAccount.project_id) {
        throw new Error('FIREBASE_SERVICE_ACCOUNT yok/geçersiz.');
    }
    initializeApp({ credential: cert(serviceAccount) });
    return getFirestore();
}

async function main() {
    const db = initFirebase();
    const snap = await db.collection('product_feedback').orderBy('ratedAt', 'desc').limit(50).get();

    console.log(`📊 product_feedback koleksiyonunda toplam (ilk 50 taranan): ${snap.size} belge\n`);

    let positive = 0, negative = 0, withReason = 0;
    snap.docs.forEach(d => {
        const data = d.data();
        if (data.rating === 'positive') positive++;
        if (data.rating === 'negative') negative++;
        if (data.reason && data.reason.trim()) withReason++;
        const ratedAt = data.ratedAt?.toDate?.() ? data.ratedAt.toDate().toISOString() : String(data.ratedAt);
        console.log(`  [${data.rating === 'positive' ? '👍' : '👎'}] ${ratedAt} — ${data.title?.slice(0, 60) || d.id}${data.reason ? ` (sebep: "${data.reason.slice(0, 40)}")` : ''}`);
    });

    console.log(`\n👍 ${positive}  👎 ${negative}  📝 sebepli: ${withReason}`);

    if (snap.size === 0) {
        console.log('\n⚠️  Hiç belge bulunamadı — kayıtlar gerçekten Firestore\'a düşmüyor olabilir.');
        process.exit(1);
    }
}

main().catch(err => {
    console.error('❌ Hata:', err.message);
    process.exit(1);
});
