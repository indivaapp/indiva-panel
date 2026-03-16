import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import fs from 'fs';

const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || fs.readFileSync('./firebase-service-account.json', 'utf8'));

if (!serviceAccount) {
    console.error('Service account not found');
    process.exit(1);
}

initializeApp({ credential: cert(serviceAccount) });
const db = getFirestore();

async function check() {
    const s = await db.collection('discounts').orderBy('createdAt', 'desc').limit(20).get();
    console.log(`Checking last ${s.size} discounts...`);
    s.docs.forEach(doc => {
        const data = doc.data();
        console.log(`ID: ${doc.id} | Title: ${data.title.substring(0, 30)} | Status: "${data.status}"`);
    });

    const bitti = await db.collection('discounts').where('status', '==', 'İndirim Bitti').get();
    console.log(`\nTotal 'İndirim Bitti': ${bitti.size}`);
}

check().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
