import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import fs from 'fs';

const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || fs.readFileSync('./firebase-service-account.json', 'utf8'));
initializeApp({ credential: cert(serviceAccount) });
const db = getFirestore();

async function checkDeepStats() {
    const snapshot = await db.collection('discounts').limit(20).get();

    console.log("Deep Document Check (Last 20):");
    snapshot.docs.forEach(doc => {
        const data = doc.data();
        console.log(`ID: ${doc.id}`);
        console.log(`- Status: ${data.status}`);
        console.log(`- has lastPriceCheck: ${!!data.lastPriceCheck}`);
        console.log(`- lastPriceCheck type: ${data.lastPriceCheck?.constructor?.name || typeof data.lastPriceCheck}`);
    });
}

checkDeepStats().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
