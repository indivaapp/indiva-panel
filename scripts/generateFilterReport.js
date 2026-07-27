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
 * Env: FIREBASE_SERVICE_ACCOUNT, GEMINI_API_KEY
 */

import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { GoogleGenAI } from '@google/genai';
import { trackGeminiUsage } from './aiUsageTracker.js';

const MODEL = 'gemini-2.5-flash';

function initFirebase() {
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || '{}');
    if (!serviceAccount.project_id) throw new Error('FIREBASE_SERVICE_ACCOUNT yok/geçersiz.');
    initializeApp({ credential: cert(serviceAccount) });
    return getFirestore();
}

function buildDataset(docs) {
    return docs.map((d, i) => {
        const oldPrice = Number(d.oldPrice) || 0;
        const newPrice = Number(d.newPrice) || 0;
        const discountPct = oldPrice > 0 ? Math.round((1 - newPrice / oldPrice) * 100) : null;
        const karar = d.rating === 'positive' ? 'EVET' : 'HAYIR';
        const parts = [
            `${i + 1}. [${karar}]`,
            `Kategori: ${d.category || '-'}`,
            `Marka: ${d.brand || '-'}`,
            `Başlık: ${(d.title || '-').slice(0, 80)}`,
            `Fiyat: ${oldPrice || '-'} → ${newPrice || '-'}${discountPct !== null ? ` (%${discountPct} indirim)` : ''}`,
        ];
        if (d.reason) parts.push(`Gerekçe: ${d.reason.slice(0, 200)}`);
        return parts.join(' | ');
    }).join('\n');
}

const SYSTEM_INSTRUCTION = `Sen, bir e-ticaret indirim uygulamasının kıdemli merchandising analistisin.
Görevin: Uygulama sahibinin yüzlerce ürün için verdiği EVET (yayınla) / HAYIR (yayınlama)
kararlarını ve varsa yazdığı gerekçeleri inceleyip, gelecekte otomatik sistemin kullanacağı
bir "filtre raporu" yazmak.

Rapor kesinlikle şu Türkçe bölümlerde, düz metin (madde işaretli) olmalı:

1) GENEL GÖZLEM — Kararlardaki genel eğilimi 3-5 cümleyle özetle.
2) KESİN ONAYLA KATEGORİLERİ — Verideki örneklerde çok yüksek oranda EVET almış kategoriler.
   Her biri için kaç örnekte görüldüğünü ve güven düzeyini belirt. Az örnekli/belirsiz
   kategorileri BURAYA KOYMA.
3) KESİN REDDET KATEGORİLERİ — Aynı mantıkla, çok yüksek oranda HAYIR almış kategoriler.
4) FİYAT / İNDİRİM KALIPLARI — Gerekçelerden çıkardığın fiyat mantığı (örn. "aşırı yüksek
   fiyatlı ürünler reddedilmiş", "indirim oranı çok düşükse reddedilmiş" gibi somut eşikler
   varsa yaz).
5) İSTİSNALAR VE NÜANSLAR — "Genelde evet alan bir kategori olsa da şu durumda hayır
   almış" tarzı önemli istisnaları listele. Bu bölüm en kritik bölüm, atlama.
6) BELİRSİZ DURUMLAR İÇİN PRENSİP — Yukarıdaki kurallara net uymayan bir ürünle
   karşılaşıldığında sistemin nasıl davranması gerektiğine dair genel bir prensip yaz
   (ör. hangi sinyaller varsa insana danışılmalı).

Sadece eldeki veriye dayan, veride desteği olmayan varsayımlar üretme. Kategori/kural
önerirken kaç örneğe dayandığını mutlaka belirt (örn. "12/12 örnek", "8/9 örnek").`;

async function main() {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error('GEMINI_API_KEY yok.');

    const db = initFirebase();
    const snap = await db.collection('product_feedback').get();
    const docs = snap.docs.map(d => d.data()).filter(d => d.rating === 'positive' || d.rating === 'negative');

    const positiveCount = docs.filter(d => d.rating === 'positive').length;
    const negativeCount = docs.filter(d => d.rating === 'negative').length;
    console.log(`📊 Toplam ${docs.length} değerlendirilmiş kayıt (${positiveCount} evet, ${negativeCount} hayır).\n`);

    if (docs.length < 20) {
        console.warn('⚠️ Çok az veri var, rapor güvenilir olmayabilir. Yine de devam ediliyor...\n');
    }

    const dataset = buildDataset(docs);
    const genAI = new GoogleGenAI({ apiKey });

    console.log('🤖 Rapor üretiliyor (Gemini)...\n');
    const response = await genAI.models.generateContent({
        model: MODEL,
        contents: [{ role: 'user', parts: [{ text: `${SYSTEM_INSTRUCTION}\n\n--- VERİ (${docs.length} kayıt) ---\n${dataset}` }] }],
        config: { temperature: 0.2 },
    });
    await trackGeminiUsage(db, response, MODEL, 'generateFilterReport');

    const report = response.text || '';
    if (!report) throw new Error('Gemini boş cevap döndü.');

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
