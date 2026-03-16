import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import fs from 'fs';

const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || fs.readFileSync('./firebase-service-account.json', 'utf8'));
initializeApp({ credential: cert(serviceAccount) });
const db = getFirestore();

async function countStats() {
    const snapshot = await db.collection('discounts').get();
    const stats = {};

    snapshot.docs.forEach(doc => {
        const s = doc.data().status || 'undefined';
        stats[s] = (stats[s] || 0) + 1;
    });

    console.log("Status Distribution:");
    console.log(JSON.stringify(stats, null, 2));
    console.log(`\nTotal items: ${snapshot.size}`);
}

countStats().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
