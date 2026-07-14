/**
 * pipelineRunLogger.js — Otomasyon pipeline'larının çalışma özetini Firestore'a
 * yazar. AI Analist (scripts/auto-ai-analyst.js) bu veriyi kullanarak kaynak
 * sağlığı, kalite kapısı reddetme oranı gibi metrikleri hesaplar — bunlar
 * 'discounts' koleksiyonundan tek başına çıkarılamaz (reddedilen/atlanan
 * adaylar hiç Firestore'a yazılmıyor, sadece konsola loglanıyor).
 *
 * Amaçlı olarak çok hafif: her run sonunda TEK bir doküman yazılır.
 */

import { FieldValue } from 'firebase-admin/firestore';

/**
 * @param {object} db Firestore instance
 * @param {{
 *   script: string,           // örn. 'auto-indirimradar', 'price-checker'
 *   fetched?: number,         // kaynaktan çekilen toplam aday sayısı
 *   approved?: number,        // yayınlanan
 *   rejected?: number,        // kalite kapısında reddedilen
 *   skipped?: number,         // görsel/veri eksikliği vb. nedenle atlanan
 *   failed?: number,          // yazma/işleme hatası
 *   durationMs?: number,
 *   note?: string,            // opsiyonel serbest metin (örn. "0 ürün — kaynak kırılmış olabilir")
 * }} stats
 */
export async function logPipelineRun(db, stats) {
    try {
        // Firestore Admin SDK, "undefined" değerli alanları reddediyor (tüm yazmayı
        // başarısız kılıyor) — çağıranlardan biri bir alanı şartlı olarak undefined
        // bırakırsa (örn. `note: hataVar ? '...' : undefined`), TÜM kayıt sessizce
        // kaybolur. Bunu tek bir yerde, kalıcı olarak eleyip her çağıranı korumak
        // için undefined alanları burada filtreliyoruz.
        const clean = Object.fromEntries(
            Object.entries(stats).filter(([, v]) => v !== undefined)
        );
        await db.collection('pipeline_runs').add({
            ...clean,
            createdAt: FieldValue.serverTimestamp(),
        });
    } catch (e) {
        console.warn(`   ⚠️ [PipelineRunLogger] Kayıt yazılamadı: ${e.message}`);
    }
}
