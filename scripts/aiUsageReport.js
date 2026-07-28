/**
 * aiUsageReport.js — aiUsage/daily_{tarih} ve aiUsage/monthly_{ay} dokümanlarındaki
 * bySource kırılımını konsola basar. Sadece okur, hiçbir şey değiştirmez.
 *
 * Kullanım: node scripts/aiUsageReport.js
 * Env: FIREBASE_SERVICE_ACCOUNT
 */

import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

function initFirebase() {
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || '{}');
    if (!serviceAccount.project_id) throw new Error('FIREBASE_SERVICE_ACCOUNT yok/geçersiz.');
    initializeApp({ credential: cert(serviceAccount) });
    return getFirestore();
}

function printDoc(label, data) {
    console.log(`\n=== ${label} ===`);
    if (!data) { console.log('(doküman yok)'); return; }
    console.log(`Toplam: $${(data.costUsd || 0).toFixed(4)} | çağrı: ${data.calls || 0} | input tok: ${data.inputTokens || 0} | output tok: ${data.outputTokens || 0}`);
    const bySource = data.bySource || {};
    const rows = Object.entries(bySource).sort((a, b) => (b[1].costUsd || 0) - (a[1].costUsd || 0));
    if (rows.length === 0) { console.log('  (bySource verisi yok)'); return; }
    for (const [source, s] of rows) {
        console.log(`  - ${source}: $${(s.costUsd || 0).toFixed(4)} | çağrı: ${s.calls || 0} | in: ${s.inputTokens || 0} | out: ${s.outputTokens || 0}`);
    }
}

async function main() {
    const db = initFirebase();
    const now = new Date();
    const dayId = now.toISOString().slice(0, 10);
    const monthId = now.toISOString().slice(0, 7);

    const dailySnap = await db.collection('aiUsage').doc(`daily_${dayId}`).get();
    const monthlySnap = await db.collection('aiUsage').doc(`monthly_${monthId}`).get();

    printDoc(`Bugün (${dayId})`, dailySnap.exists ? dailySnap.data() : null);
    printDoc(`Bu ay (${monthId})`, monthlySnap.exists ? monthlySnap.data() : null);
}

main().catch(err => {
    console.error('❌ Hata:', err.message);
    process.exit(1);
});
