/**
 * openRouterUtil.js — generateFilterReport.js ve evaluateFilterReport.js'nin
 * paylaştığı OpenRouter chat-completions çağrısı. Gemini'nin ücretsiz
 * katmanındaki günlük 20 istek/model sınırına (GenerateRequestsPerDayPerProjectPerModel-FreeTier)
 * takılmamak için bu iki script Gemini'yi doğrudan değil, OpenRouter üzerinden
 * (bakiyeden token bazlı ücretlendirilerek) çağırır.
 */

import { trackOpenRouterUsage } from './aiUsageTracker.js';

export async function callOpenRouter(db, { apiKey, model, prompt, temperature = 0.2, maxTokens = 4000, source }) {
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
            'HTTP-Referer': 'https://indiva-proxy.vercel.app',
            'X-Title': 'INDIVA Panel Filter Report',
        },
        body: JSON.stringify({
            model,
            messages: [{ role: 'user', content: prompt }],
            temperature,
            max_tokens: maxTokens,
            usage: { include: true },
        }),
        signal: AbortSignal.timeout(120000),
    });
    if (!response.ok) {
        const errText = await response.text().catch(() => '');
        throw new Error(`OpenRouter ${response.status}: ${errText.slice(0, 300)}`);
    }
    const data = await response.json();
    await trackOpenRouterUsage(db, data, source);
    return data?.choices?.[0]?.message?.content || '';
}
