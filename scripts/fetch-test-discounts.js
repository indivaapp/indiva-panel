import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import fs from 'fs';
import path from 'path';

const localPath = 'firebase-service-account.json';
if (!fs.existsSync(localPath)) {
    console.error('Service account file not found.');
    process.exit(1);
}

const serviceAccount = JSON.parse(fs.readFileSync(localPath, 'utf8'));

try {
    initializeApp({ credential: cert(serviceAccount) });
    const db = getFirestore();

    const snapshot = await db.collection('discounts')
        .where('status', 'in', ['aktif', 'active', ''])
        .limit(10)
        .get();

    const data = snapshot.docs.map(doc => ({
        id: doc.id,
        title: doc.data().title,
        link: doc.data().link,
        newPrice: doc.data().newPrice,
        brand: doc.data().brand
    }));
    
    console.log(JSON.stringify(data, null, 2));
    process.exit(0);
} catch (err) {
    console.error('Error:', err);
    process.exit(1);
}
