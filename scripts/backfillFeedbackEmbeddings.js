/**
 * backfillFeedbackEmbeddings.js — Tek seferlik geriye dönük doldurma.
 *
 * Embedding üretimi (bkz. services/firebase.ts:saveProductFeedback,
 * embeddingUtil.js) sadece BUNDAN SONRAKİ değerlendirmelerde otomatik
 * çalışıyordu — bu özellik eklenmeden önce yapılmış yüzlerce product_feedback
 * kaydında `embedding` alanı hiç yoktu. Sonuç: AI'nın karşılaştıracağı
 * "hafıza" pratikte boştu, panelde hiç öneri/kararsız rozeti çıkmıyordu.
 *
 * Bu script, embedding'i eksik olan TÜM product_feedback kayıtları için
 * (title/brand/category/storeName'den) embedding üretip geri yazar.
 *
 * Kullanım: node scripts/backfillFeedbackEmbeddings.js
 * Env: FIREBASE_SERVICE_ACCOUNT, GEMINI_API_KEY
 */

import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { buildEmbeddingText, getEmbedding } from './embeddingUtil.js';

function initFirebase() {
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || '{}');
    if (!serviceAccount.project_id) throw new Error('FIREBASE_SERVICE_ACCOUNT yok/geçersiz.');
    initializeApp({ credential: cert(serviceAccount) });
    return getFirestore();
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function main() {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error('GEMINI_API_KEY yok.');

    const db = initFirebase();
    const snap = await db.collection('product_feedback').get();
    console.log(`📊 Toplam ${snap.size} product_feedback kaydı bulundu.\n`);

    const missing = snap.docs.filter(d => !Array.isArray(d.data().embedding) || d.data().embedding.length === 0);
    console.log(`🔍 Embedding'i eksik: ${missing.length} kayıt\n`);

    let done = 0, failed = 0;
    for (const doc of missing) {
        const data = doc.data();
        const text = buildEmbeddingText({ title: data.title, brand: data.brand, category: data.category, storeName: data.storeName });
        const embedding = await getEmbedding(text, apiKey);
        if (embedding) {
            await doc.ref.update({ embedding });
            done++;
            if (done % 25 === 0) console.log(`   ... ${done}/${missing.length} tamamlandı`);
        } else {
            failed++;
            console.warn(`   ⚠️ Embedding üretilemedi: ${data.title?.slice(0, 50) || doc.id}`);
        }
        await sleep(150); // Gemini free-tier rate limit'e karşı küçük bir tampon
    }

    console.log(`\n✅ Tamamlandı: ${done} dolduruldu, ${failed} başarısız, ${snap.size - missing.length} zaten vardı.`);
}

main().catch(err => {
    console.error('❌ Hata:', err.message);
    process.exit(1);
});
