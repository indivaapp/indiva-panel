import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import fs from 'fs';
import path from 'path';

const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || fs.readFileSync('./firebase-service-account.json', 'utf8'));
initializeApp({ credential: cert(serviceAccount) });
const db = getFirestore();

async function diagnose() {
    console.log("--- Indiva Diagnostic Start ---");

    const snapshot = await db.collection('discounts').orderBy('createdAt', 'desc').limit(10).get();
    console.log(`Checking ${snapshot.size} most recent discounts:`);

    for (const doc of snapshot.docs) {
        const data = doc.data();
        const createdAt = data.createdAt?.toDate ? data.createdAt.toDate() : new Date(data.createdAt);
        const ageInHours = (Date.now() - createdAt.getTime()) / (1000 * 60 * 60);

        console.log(`\nID: ${doc.id}`);
        console.log(`Title: ${data.title.substring(0, 40)}`);
        console.log(`Status: ${data.status}`);
        console.log(`CreatedAt: ${createdAt.toISOString()}`);
        console.log(`Age (Hours): ${ageInHours.toFixed(2)}`);
        console.log(`Store Link: ${data.originalStoreLink ? 'Exists' : 'MISSING'}`);

        if (ageInHours > 24) {
            console.log(">> SHOULD BE EXPIRED (24h rule)");
        }
    }

    console.log("\n--- Testing fetch to a major store ---");
    try {
        const res = await fetch("https://www.trendyol.com", { headers: { 'User-Agent': 'Mozilla/5.0' } });
        console.log(`Fetch Trendyol: ${res.status} ${res.ok ? 'OK' : 'FAIL'}`);
    } catch (e) {
        console.error(`Fetch Error: ${e.message}`);
    }

    console.log("\n--- End of Diagnostic ---");
}

diagnose().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
