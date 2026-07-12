import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

/**
 * Tüm vercel-proxy AI uç noktaları (ai-scrape, vision, scrape, generate-caption)
 * için ortak kullanım/maliyet takibi. Dosya adı `_` ile başladığı için Vercel
 * bunu bir API route olarak yayınlamaz, sadece import edilebilir bir modüldür.
 *
 * Gemini fiyatları tahminidir (USD / 1M token) — https://ai.google.dev/pricing
 * OpenRouter için gerçek maliyet `usage.cost` alanından okunur (request body'de
 * `usage: { include: true }` gönderilmesi gerekir), tahmini fiyat tablosuna
 * ihtiyaç yoktur.
 */

const GEMINI_PRICING_PER_1M_USD: Record<string, { input: number; output: number }> = {
    'gemini-2.5-flash-lite': { input: 0.10, output: 0.40 },
    'gemini-2.5-flash': { input: 0.30, output: 2.50 },
    'gemini-2.0-flash-001': { input: 0.10, output: 0.40 },
};
const DEFAULT_GEMINI_PRICING = { input: 0.30, output: 2.50 };

function getDb() {
    if (getApps().length === 0) {
        const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || '{}');
        initializeApp({ credential: cert(serviceAccount) });
    }
    return getFirestore();
}

async function writeUsage(calls: number, inputTokens: number, outputTokens: number, costUsd: number) {
    const db = getDb();
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

/** Ham Gemini REST yanıtındaki `usageMetadata` alanını okur. */
export async function trackGeminiUsage(geminiResponseJson: any, model: string) {
    try {
        const usage = geminiResponseJson?.usageMetadata;
        if (!usage) return;
        const inputTokens = usage.promptTokenCount || 0;
        const outputTokens = usage.candidatesTokenCount || 0;
        const price = GEMINI_PRICING_PER_1M_USD[model] || DEFAULT_GEMINI_PRICING;
        const costUsd = (inputTokens / 1e6) * price.input + (outputTokens / 1e6) * price.output;
        await writeUsage(1, inputTokens, outputTokens, costUsd);
    } catch { /* takip hatası ana akışı bozmasın */ }
}

/** OpenRouter yanıtındaki `usage` alanını okur (mümkünse gerçek `usage.cost`). */
export async function trackOpenRouterUsage(openRouterResponseJson: any) {
    try {
        const usage = openRouterResponseJson?.usage;
        if (!usage) return;
        const inputTokens = usage.prompt_tokens || 0;
        const outputTokens = usage.completion_tokens || 0;
        const costUsd = typeof usage.cost === 'number' ? usage.cost : 0;
        await writeUsage(1, inputTokens, outputTokens, costUsd);
    } catch { /* takip hatası ana akışı bozmasın */ }
}
