/**
 * cleanup-discounts.js — Firebase Discount Temizleyici
 *
 * Siler:
 *   1. expiresAt geçmiş tüm ilanlar (isAd dahil değil)
 *   2. expiresAt yoksa createdAt 12 saatten eski ilanlar (isAd dahil değil)
 *   3. status==="İndirim Bitti" + expiredAt geçmiş (eski mantık, geriye dönük uyumluluk)
 *
 * Dokunmaz: isAd: true ilanlar (reklamların kendi expiresAt kontrolü var)
 */

import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import * as fs from 'fs';
import * as path from 'path';

const ROOT_DIR = process.cwd();
const envPath = path.join(ROOT_DIR, '.env');
if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf8');
    for (const line of envContent.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eqIdx = trimmed.indexOf('=');
        if (eqIdx < 0) continue;
        const key = trimmed.substring(0, eqIdx).trim();
        const val = trimmed.substring(eqIdx + 1).trim().replace(/^["']|["']$/g, '');
        if (!process.env[key]) process.env[key] = val;
    }
}

function initFirebase() {
    if (getApps().length > 0) return getFirestore();
    const envJson = process.env.FIREBASE_SERVICE_ACCOUNT;
    let serviceAccount;
    if (envJson) {
        serviceAccount = JSON.parse(envJson);
    } else {
        const localPath = path.join(ROOT_DIR, 'firebase-service-account.json');
        if (fs.existsSync(localPath)) {
            serviceAccount = JSON.parse(fs.readFileSync(localPath, 'utf8'));
        } else {
            throw new Error('Firebase service account bulunamadı.');
        }
    }
    if (serviceAccount?.private_key) {
        serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, '\n').replace(/\n\n/g, '\n');
    }
    initializeApp({ credential: cert(serviceAccount) });
    return getFirestore();
}

async function deleteBatch(db, docs) {
    for (let i = 0; i < docs.length; i += 400) {
        const batch = db.batch();
        docs.slice(i, i + 400).forEach(d => batch.delete(d.ref));
        await batch.commit();
    }
}

async function cleanupOldDiscounts() {
    console.log(`\n🧹 Discount Temizliği: ${new Date().toLocaleString('tr-TR')}`);
    console.log('═══════════════════════════════════════════');

    const db = initFirebase();
    const now = Date.now();
    const TWELVE_HOURS = 12 * 60 * 60 * 1000;
    const cutoff = new Date(now - TWELVE_HOURS);

    let totalDeleted = 0;

    // ── 1. expiresAt geçmiş ilanlar ─────────────────────────────────────────────
    console.log('🗑️  expiresAt geçmiş ilanlar siliniyor...');
    try {
        const snap = await db.collection('discounts')
            .where('isAd', '==', false)
            .where('expiresAt', '<', cutoff)
            .get();

        if (snap.size > 0) {
            await deleteBatch(db, snap.docs);
            totalDeleted += snap.size;
            console.log(`   ✅ ${snap.size} ilan silindi (expiresAt geçmiş)`);
        } else {
            console.log('   ℹ️  Silinecek ilan yok.');
        }
    } catch (err) {
        console.warn(`   ⚠️  expiresAt sorgusu hatası: ${err.message}`);
    }

    // ── 2. expiresAt yok + createdAt 12 saatten eski (eski ilanlar) ─────────────
    console.log('🗑️  expiresAt olmayan eski ilanlar siliniyor...');
    try {
        const snap = await db.collection('discounts')
            .where('isAd', '==', false)
            .where('createdAt', '<', cutoff)
            .get();

        // JS tarafında filtrele: sadece expiresAt olmayan veya null olanlar
        const toDelete = snap.docs.filter(d => {
            const data = d.data();
            return !data.expiresAt; // expiresAt varsa zaten 1. adımda silindi
        });

        if (toDelete.length > 0) {
            await deleteBatch(db, toDelete);
            totalDeleted += toDelete.length;
            console.log(`   ✅ ${toDelete.length} ilan silindi (expiresAt yok, 12h+ eski)`);
        } else {
            console.log('   ℹ️  Silinecek ilan yok.');
        }
    } catch (err) {
        console.warn(`   ⚠️  createdAt sorgusu hatası: ${err.message}`);
    }

    // ── 3. Geriye dönük: status="İndirim Bitti" + expiredAt geçmiş ──────────────
    try {
        const snap = await db.collection('discounts')
            .where('status', '==', 'İndirim Bitti')
            .get();

        const toDelete = snap.docs.filter(d => {
            const expiredAt = d.data().expiredAt;
            if (!expiredAt) return false;
            const t = expiredAt.toDate ? expiredAt.toDate() : new Date(expiredAt);
            return t < cutoff;
        });

        if (toDelete.length > 0) {
            await deleteBatch(db, toDelete);
            totalDeleted += toDelete.length;
            console.log(`   ✅ ${toDelete.length} ilan silindi (İndirim Bitti)`);
        }
    } catch (err) {
        console.warn(`   ⚠️  İndirim Bitti sorgusu hatası: ${err.message}`);
    }

    console.log(`\n✨ Temizlik tamamlandı. Toplam ${totalDeleted} ilan silindi.`);
    console.log('═══════════════════════════════════════════\n');
}

cleanupOldDiscounts().catch(err => {
    console.error('💥 KRİTİK HATA:', err.message);
    process.exit(1);
});
