/**
 * generateFilterReport.js — Ürün Değerlendirme (product_feedback) verisinden
 * yayın filtresi raporu üretir.
 *
 * Kullanıcının yüzlerce üründe verdiği evet/hayır kararı + gerekçesini tek bir
 * Gemini çağrısına vererek, gelecekteki ürünleri değerlendirirken referans
 * alınacak Türkçe bir "filtre raporu" ürettirir: hangi kategoriler güvenle
 * otomatik geçer/reddedilir, hangi istisnalar öğrenilmiş, belirsiz durumlarda
 * nelere dikkat edilmeli.
 *
 * Bu script SADECE rapor üretir — hiçbir canlı yayın kararını etkilemez.
 * Üretilen rapor `aiConfig/productFilterReport` dokümanına yazılır ve konsola
 * basılır; kullanıcı onaylamadan pipeline'a bağlanmaz.
 *
 * Kullanım: node scripts/generateFilterReport.js
 * Env: FIREBASE_SERVICE_ACCOUNT, OPENROUTER_API_KEY
 */

import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { callOpenRouter } from './openRouterUtil.js';
import { buildReportPrompt } from './filterReportPrompt.js';

const MODEL = 'google/gemini-2.5-flash';

function initFirebase() {
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || '{}');
    if (!serviceAccount.project_id) throw new Error('FIREBASE_SERVICE_ACCOUNT yok/geçersiz.');
    initializeApp({ credential: cert(serviceAccount) });
    return getFirestore();
}

async function main() {
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) throw new Error('OPENROUTER_API_KEY yok.');

    const db = initFirebase();
    const snap = await db.collection('product_feedback').get();
    const docs = snap.docs.map(d => d.data()).filter(d => d.rating === 'positive' || d.rating === 'negative');

    const positiveCount = docs.filter(d => d.rating === 'positive').length;
    const negativeCount = docs.filter(d => d.rating === 'negative').length;
    console.log(`📊 Toplam ${docs.length} değerlendirilmiş kayıt (${positiveCount} evet, ${negativeCount} hayır).\n`);

    if (docs.length < 20) {
        console.warn('⚠️ Çok az veri var, rapor güvenilir olmayabilir. Yine de devam ediliyor...\n');
    }

    console.log('🤖 Rapor üretiliyor (OpenRouter)...\n');
    const report = await callOpenRouter(db, {
        apiKey,
        model: MODEL,
        prompt: buildReportPrompt(docs),
        temperature: 0.2,
        source: 'generateFilterReport',
    });
    if (!report) throw new Error('OpenRouter boş cevap döndü.');

    await db.collection('aiConfig').doc('productFilterReport').set({
        report,
        basedOnCount: docs.length,
        positiveCount,
        negativeCount,
        model: MODEL,
        generatedAt: FieldValue.serverTimestamp(),
        approved: false, // Kullanıcı onaylayana kadar hiçbir pipeline bunu kullanmaz
    });

    console.log('════════════════════════════════════════════════════');
    console.log(report);
    console.log('════════════════════════════════════════════════════');
    console.log('\n✅ Rapor aiConfig/productFilterReport dokümanına yazıldı (approved: false).');
}

main().catch(err => {
    console.error('❌ Hata:', err.message);
    process.exit(1);
});
