/**
 * evaluateFilterReport.js — Filtre raporunun GERÇEKTEN işe yarayıp yaramadığını
 * ölçer (kör test / holdout).
 *
 * Yöntem:
 *  1) product_feedback'teki en yeni HOLDOUT_SIZE kayıt bir kenara ayrılır (test seti).
 *  2) Geri kalan kayıtlarla (train seti) generateFilterReport.js ile AYNI mantıkla
 *     bir filtre raporu ürettirilir — ama test setindeki kararlar/gerekçeler
 *     yapay zekaya HİÇ gösterilmez.
 *  3) Test setindeki her ürün (sadece başlık/marka/kategori/fiyat — karar/gerekçe
 *     GİZLENEREK) 10'luk gruplar halinde bu rapora göre yeniden "EVET/HAYIR"
 *     tahmin ettirilir.
 *  4) Tahminler, kullanıcının gerçek kararıyla karşılaştırılıp doğruluk oranı,
 *     karışıklık matrisi ve yanlış tahminlerin dökümü çıkarılır.
 *
 * Bu script hiçbir canlı veriyi değiştirmez, sadece ölçüm yapar (rapor bilgi
 * amaçlı `aiConfig/productFilterReportEval` dokümanına da yazılır).
 *
 * Kullanım: node scripts/evaluateFilterReport.js
 * Env: FIREBASE_SERVICE_ACCOUNT, GEMINI_API_KEY, HOLDOUT_SIZE (opsiyonel, varsayılan 50)
 */

import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { GoogleGenAI } from '@google/genai';
import { trackGeminiUsage } from './aiUsageTracker.js';
import { buildReportPrompt } from './filterReportPrompt.js';

const MODEL = 'gemini-2.5-flash';
const BATCH_SIZE = 10;

function initFirebase() {
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || '{}');
    if (!serviceAccount.project_id) throw new Error('FIREBASE_SERVICE_ACCOUNT yok/geçersiz.');
    initializeApp({ credential: cert(serviceAccount) });
    return getFirestore();
}

function toMillis(ts) {
    if (!ts) return 0;
    if (typeof ts.toMillis === 'function') return ts.toMillis();
    if (ts._seconds) return ts._seconds * 1000;
    return 0;
}

function buildJudgePrompt(report, batch) {
    const items = batch.map((d, i) => {
        const oldPrice = Number(d.oldPrice) || 0;
        const newPrice = Number(d.newPrice) || 0;
        const discountPct = oldPrice > 0 ? Math.round((1 - newPrice / oldPrice) * 100) : null;
        return `${i + 1}. Kategori: ${d.category || '-'} | Marka: ${d.brand || '-'} | ` +
            `Başlık: ${(d.title || '-').slice(0, 80)} | ` +
            `Fiyat: ${oldPrice || '-'} → ${newPrice || '-'}${discountPct !== null ? ` (%${discountPct} indirim)` : ''}`;
    }).join('\n');

    return `Aşağıda, geçmiş yayın kararlarından çıkarılmış bir FİLTRE RAPORU ve ardından
karar verilmesi gereken ${batch.length} yeni aday ürün var. SADECE bu rapora dayanarak
her ürün için "EVET" (yayınla) ya da "HAYIR" (yayınlama) kararı ver.

--- FİLTRE RAPORU ---
${report}

--- KARAR VERİLECEK ÜRÜNLER ---
${items}

Cevabını SADECE şu JSON formatında ver, başka hiçbir açıklama ekleme:
[{"i": 1, "decision": "EVET", "why": "kısa gerekçe"}, {"i": 2, "decision": "HAYIR", "why": "kısa gerekçe"}, ...]`;
}

async function main() {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error('GEMINI_API_KEY yok.');
    const HOLDOUT_SIZE = Number(process.env.HOLDOUT_SIZE) || 50;

    const db = initFirebase();
    const genAI = new GoogleGenAI({ apiKey });

    const snap = await db.collection('product_feedback').get();
    const allDocs = snap.docs
        .map(d => d.data())
        .filter(d => d.rating === 'positive' || d.rating === 'negative')
        .sort((a, b) => toMillis(a.ratedAt) - toMillis(b.ratedAt));

    if (allDocs.length < HOLDOUT_SIZE + 20) {
        throw new Error(`Yeterli veri yok: ${allDocs.length} kayıt var, en az ${HOLDOUT_SIZE + 20} lazım.`);
    }

    const holdout = allDocs.slice(-HOLDOUT_SIZE);
    const train = allDocs.slice(0, -HOLDOUT_SIZE);
    console.log(`📊 Eğitim seti: ${train.length} kayıt | Test (holdout) seti: ${holdout.length} kayıt\n`);

    console.log('🤖 Sadece eğitim setiyle rapor üretiliyor...\n');
    const reportRes = await genAI.models.generateContent({
        model: MODEL,
        contents: [{ role: 'user', parts: [{ text: buildReportPrompt(train) }] }],
        config: { temperature: 0.2 },
    });
    await trackGeminiUsage(db, reportRes, MODEL, 'evaluateFilterReport:report');
    const report = reportRes.text || '';
    if (!report) throw new Error('Rapor üretilemedi (boş cevap).');

    const predictions = new Map(); // index in holdout -> {decision, why}
    for (let start = 0; start < holdout.length; start += BATCH_SIZE) {
        const batch = holdout.slice(start, start + BATCH_SIZE);
        console.log(`   ... ${start + 1}-${start + batch.length} arası ürünler değerlendiriliyor`);
        try {
            const res = await genAI.models.generateContent({
                model: MODEL,
                contents: [{ role: 'user', parts: [{ text: buildJudgePrompt(report, batch) }] }],
                config: { temperature: 0 },
            });
            await trackGeminiUsage(db, res, MODEL, 'evaluateFilterReport:judge');
            const text = res.text || '';
            const match = text.match(/\[[\s\S]*\]/);
            if (!match) { console.warn('   ⚠️ JSON bulunamadı, bu grup atlanıyor'); continue; }
            const parsed = JSON.parse(match[0]);
            for (const p of parsed) {
                const idx = start + (Number(p.i) - 1);
                predictions.set(idx, { decision: p.decision, why: p.why || '' });
            }
        } catch (err) {
            console.warn(`   ⚠️ Grup hatası: ${err.message}`);
        }
    }

    // ─── Karşılaştırma ───────────────────────────────────────────────────
    let tp = 0, tn = 0, fp = 0, fn = 0, unknown = 0;
    const mismatches = [];
    holdout.forEach((d, idx) => {
        const pred = predictions.get(idx);
        const actualPositive = d.rating === 'positive';
        if (!pred || !['EVET', 'HAYIR'].includes(pred.decision)) { unknown++; return; }
        const predPositive = pred.decision === 'EVET';
        if (actualPositive && predPositive) tp++;
        else if (!actualPositive && !predPositive) tn++;
        else if (!actualPositive && predPositive) fp++;
        else fn++;

        if (actualPositive !== predPositive) {
            mismatches.push({
                title: (d.title || '-').slice(0, 60),
                category: d.category || '-',
                actual: actualPositive ? 'EVET' : 'HAYIR',
                predicted: pred.decision,
                aiWhy: pred.why,
                userReason: d.reason || '(gerekçe yok)',
            });
        }
    });

    const scored = tp + tn + fp + fn;
    const accuracy = scored > 0 ? ((tp + tn) / scored * 100).toFixed(1) : 'N/A';

    console.log('\n════════════════════════════════════════════════════');
    console.log(`📈 SONUÇ: ${scored}/${holdout.length} ürün değerlendirildi (${unknown} tahmin edilemedi)`);
    console.log(`   Doğruluk: %${accuracy}  (${tp + tn}/${scored} doğru)`);
    console.log(`   Doğru EVET (TP): ${tp} | Doğru HAYIR (TN): ${tn}`);
    console.log(`   Yanlış EVET dedi, aslında HAYIR (FP): ${fp} | Yanlış HAYIR dedi, aslında EVET (FN): ${fn}`);
    console.log('════════════════════════════════════════════════════\n');

    if (mismatches.length) {
        console.log(`❌ Yanlış tahmin edilen ${mismatches.length} ürün:\n`);
        mismatches.forEach((m, i) => {
            console.log(`${i + 1}. [${m.category}] ${m.title}`);
            console.log(`   Gerçek karar: ${m.actual} | AI tahmini: ${m.predicted}`);
            console.log(`   Senin gerekçen: ${m.userReason}`);
            console.log(`   AI'nın gerekçesi: ${m.aiWhy}\n`);
        });
    }

    await db.collection('aiConfig').doc('productFilterReportEval').set({
        trainCount: train.length,
        holdoutCount: holdout.length,
        scored,
        unknown,
        tp, tn, fp, fn,
        accuracyPct: accuracy,
        evaluatedAt: FieldValue.serverTimestamp(),
        model: MODEL,
    });
}

main().catch(err => {
    console.error('❌ Hata:', err.message);
    process.exit(1);
});
