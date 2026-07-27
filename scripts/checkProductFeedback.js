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
    const col = db.collection('product_feedback');

    const [totalCount, positiveCount, negativeCount] = await Promise.all([
        col.count().get(),
        col.where('rating', '==', 'positive').count().get(),
        col.where('rating', '==', 'negative').count().get(),
    ]);

    console.log(`📊 product_feedback GERÇEK toplam: ${totalCount.data().count} belge (👍 ${positiveCount.data().count} · 👎 ${negativeCount.data().count})\n`);

    const snap = await col.orderBy('ratedAt', 'desc').limit(50).get();
    let withReason = 0;
    snap.docs.forEach(d => {
        const data = d.data();
        if (data.reason && data.reason.trim()) withReason++;
        const ratedAt = data.ratedAt?.toDate?.() ? data.ratedAt.toDate().toISOString() : String(data.ratedAt);
        console.log(`  [${data.rating === 'positive' ? '👍' : '👎'}] ${ratedAt} — ${data.title?.slice(0, 60) || d.id}${data.reason ? ` (sebep: "${data.reason.slice(0, 40)}")` : ''}`);
    });

    console.log(`\n(Son ${snap.size} kayıttan sebepli: ${withReason})`);

    if (totalCount.data().count === 0) {
        console.log('\n⚠️  Hiç belge bulunamadı — kayıtlar gerçekten Firestore\'a düşmüyor olabilir.');
        process.exit(1);
    }
}

main().catch(err => {
    console.error('❌ Hata:', err.message);
    process.exit(1);
});
