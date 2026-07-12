/**
 * aiUsageTracker.js — Tüm scripts/*.js pipeline'ları için ortak AI maliyet takibi.
 *
 * Firestore'a sadece WRITE yapar (increment), hiç read yapmaz — panel tarafında
 * sadece 2 doküman (bugün + bu ay) okunur (services/firebase.ts:getAiUsageStats).
 *
 * Fiyatlar tahminidir (USD / 1M token), Google'ın güncel fiyat sayfasından
 * kontrol edin: https://ai.google.dev/pricing — model değişirse burayı güncelleyin.
 */

import { FieldValue } from 'firebase-admin/firestore';

const GEMINI_PRICING_PER_1M_USD = {
    'gemini-2.5-flash-lite': { input: 0.10, output: 0.40 },
    'gemini-2.5-flash': { input: 0.30, output: 2.50 },
    'gemini-2.0-flash-001': { input: 0.10, output: 0.40 },
};
const DEFAULT_GEMINI_PRICING = { input: 0.30, output: 2.50 };

/**
 * Doğrudan Gemini SDK/REST çağrısından sonra çağrılır. `response.usageMetadata`
 * (SDK) veya ham REST JSON'daki `usageMetadata` alanını okur.
 */
export async function trackGeminiUsage(db, response, model = 'gemini-2.5-flash') {
    try {
        const usage = response?.usageMetadata;
        if (!usage || !db) return;
        const inputTokens = usage.promptTokenCount || 0;
        const outputTokens = usage.candidatesTokenCount || 0;
        const price = GEMINI_PRICING_PER_1M_USD[model] || DEFAULT_GEMINI_PRICING;
        const costUsd = (inputTokens / 1e6) * price.input + (outputTokens / 1e6) * price.output;
        await writeUsage(db, { calls: 1, inputTokens, outputTokens, costUsd });
    } catch { /* takip hatası ana akışı bozmasın */ }
}

/**
 * OpenRouter çağrısından sonra çağrılır. Mümkünse gerçek `usage.cost` alanını
 * kullanır (request body'de `usage: { include: true }` gönderilmişse OpenRouter
 * gerçek USD maliyetini döndürür — model bazlı tahmini fiyat tablosuna gerek
 * kalmaz). Yoksa token sayısını kaydeder, maliyeti 0 bırakır (bilinmiyor).
 */
export async function trackOpenRouterUsage(db, openRouterResponseJson) {
    try {
        const usage = openRouterResponseJson?.usage;
        if (!usage || !db) return;
        const inputTokens = usage.prompt_tokens || 0;
        const outputTokens = usage.completion_tokens || 0;
        const costUsd = typeof usage.cost === 'number' ? usage.cost : 0;
        await writeUsage(db, { calls: 1, inputTokens, outputTokens, costUsd });
    } catch { /* takip hatası ana akışı bozmasın */ }
}

async function writeUsage(db, { calls, inputTokens, outputTokens, costUsd }) {
    const now = new Date();
    const dayId = now.toISOString().slice(0, 10);
    const monthId = now.toISOString().slice(0, 7);
    const fields = {
        calls: FieldValue.increment(calls),
        inputTokens: FieldValue.increment(inputTokens),
        outputTokens: FieldValue.increment(outputTokens),
        costUsd: FieldValue.increment(costUsd),
        updatedAt: FieldValue.serverTimestamp(),
    };
    await Promise.all([
        db.collection('aiUsage').doc(`daily_${dayId}`).set(fields, { merge: true }),
        db.collection('aiUsage').doc(`monthly_${monthId}`).set(fields, { merge: true }),
    ]);
}
