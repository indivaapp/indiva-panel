import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import fs from 'fs';

const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || fs.readFileSync('./firebase-service-account.json', 'utf8'));
initializeApp({ credential: cert(serviceAccount) });
const db = getFirestore();

async function forceExpire() {
    console.log("Looking for discounts older than 24h that are not marked as expired...");
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

    // Get items that haven't been marked as 'İndirim Bitti' and are old
    const snapshot = await db.collection('discounts')
        .where('createdAt', '<', twentyFourHoursAgo)
        .limit(50)
        .get();

    let count = 0;
    for (const doc of snapshot.docs) {
        const data = doc.data();
        if (data.status !== 'İndirim Bitti') {
            console.log(`Expiring: ${data.title.substring(0, 30)}... (Status was: ${data.status})`);
            await doc.ref.update({
                status: 'İndirim Bitti',
                expiredAt: new Date()
            });
            count++;
        }
    }

    console.log(`\nSuccessfully expired ${count} items.`);
}

forceExpire().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
