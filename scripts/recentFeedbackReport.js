/**
 * recentFeedbackReport.js — Son N product_feedback kaydını (en yeniden en
 * eskiye) konsola basar: kategori, karar, gerekçe. Kullanıcının yakın
 * zamandaki değerlendirmelerinin ne kadar açıklayıcı (gerekçeli) olduğunu
 * hızlıca gözden geçirmek için — hiçbir şey değiştirmez, sadece okur.
 *
 * Kullanım: node scripts/recentFeedbackReport.js
 * Env: FIREBASE_SERVICE_ACCOUNT, LIMIT (opsiyonel, varsayılan 30)
 */

import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

function initFirebase() {
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || '{}');
    if (!serviceAccount.project_id) throw new Error('FIREBASE_SERVICE_ACCOUNT yok/geçersiz.');
    initializeApp({ credential: cert(serviceAccount) });
    return getFirestore();
}

async function main() {
    const db = initFirebase();
    const LIMIT = Number(process.env.LIMIT) || 30;

    const snap = await db.collection('product_feedback').orderBy('ratedAt', 'desc').limit(LIMIT).get();
    const docs = snap.docs.map(d => d.data());

    const withReason = docs.filter(d => (d.reason || '').trim()).length;
    console.log(`📊 Son ${docs.length} kayıttan ${withReason} tanesi gerekçeli (%${docs.length ? Math.round(withReason / docs.length * 100) : 0}).\n`);

    docs.forEach((d, i) => {
        const karar = d.rating === 'positive' ? 'EVET' : 'HAYIR';
        const reason = (d.reason || '').trim();
        console.log(`${i + 1}. [${karar}] ${(d.category || '-')} · ${(d.title || '-').slice(0, 60)}`);
        console.log(`   Gerekçe: ${reason || '⚠️  (yok)'}\n`);
    });
}

main().catch(err => {
    console.error('❌ Hata:', err.message);
    process.exit(1);
});
