/**
 * api/auto-cleanup.ts — Süresi dolmuş ilanları otomatik siler
 * Vercel cron: her gece 03:00 UTC
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

function initFirebase() {
    if (getApps().length > 0) return getFirestore();
    const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
    if (!raw) throw new Error('FIREBASE_SERVICE_ACCOUNT env eksik');
    initializeApp({ credential: cert(JSON.parse(raw)) });
    return getFirestore();
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    if (req.method === 'OPTIONS') { res.status(200).end(); return; }

    const secret = req.query.secret as string | undefined;
    if (secret && secret !== process.env.AUTO_PUBLISH_SECRET) {
        return res.status(401).json({ error: 'Yetkisiz' });
    }

    try {
        const db = initFirebase();
        const snap = await db.collection('discounts').where('status', '==', 'İndirim Bitti').get();

        if (snap.empty) {
            return res.status(200).json({ success: true, deleted: 0, message: 'Silinecek ilan yok' });
        }

        const CHUNK = 400;
        let deleted = 0;
        const docs = snap.docs;

        for (let i = 0; i < docs.length; i += CHUNK) {
            const batch = db.batch();
            docs.slice(i, i + CHUNK).forEach(d => batch.delete(d.ref));
            await batch.commit();
            deleted += Math.min(CHUNK, docs.length - i);
        }

        console.log(`[auto-cleanup] ${deleted} süresi biten ilan silindi`);
        return res.status(200).json({ success: true, deleted, timestamp: new Date().toISOString() });

    } catch (err: any) {
        console.error('[auto-cleanup] Hata:', err.message);
        return res.status(500).json({ error: err.message });
    }
}
