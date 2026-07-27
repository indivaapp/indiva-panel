import type { VercelRequest, VercelResponse } from '@vercel/node';
import { trackGeminiUsage } from './_aiUsageTracker';

/**
 * Embed Text — kısa bir ürün metnini (başlık+marka+kategori) Gemini'nin ucuz
 * embedding modeliyle vektöre çevirir. Ürün Değerlendirme'nin (product_feedback)
 * AI'ya "emsal edinme" kararı verdirme sistemi bunun üzerine kurulu: karar
 * mekanizmasının kendisi (cosine similarity + ağırlıklı oy) tamamen ücretsiz
 * bir matematik işlemi — LLM'e HİÇ sorulmuyor, tek maliyet bu (çok ucuz)
 * embedding çağrısı. Tarayıcıda API anahtarı ifşa etmemek için sunucu
 * tarafında (Vercel function) yapılır.
 *
 * POST { text: string } → { success: true, embedding: number[] }
 */

const GEMINI_KEY = process.env.GEMINI_API_KEY || '';
const EMBED_MODEL = 'text-embedding-004';

function corsHeaders(res: VercelResponse) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
    corsHeaders(res);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'POST gerekli' });

    const { text } = req.body || {};
    if (!text || typeof text !== 'string') {
        return res.status(400).json({ success: false, error: 'text gerekli' });
    }
    if (!GEMINI_KEY) {
        return res.status(200).json({ success: false, error: 'GEMINI_API_KEY tanımlı değil' });
    }

    try {
        const aiRes = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/${EMBED_MODEL}:embedContent?key=${GEMINI_KEY}`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    model: `models/${EMBED_MODEL}`,
                    content: { parts: [{ text: text.slice(0, 2000) }] },
                }),
                signal: AbortSignal.timeout(15000),
            }
        );

        if (!aiRes.ok) {
            return res.status(200).json({ success: false, error: `Gemini embed ${aiRes.status}` });
        }

        const data = await aiRes.json();
        const embedding: number[] = data?.embedding?.values || [];
        if (!embedding.length) {
            return res.status(200).json({ success: false, error: 'Boş embedding döndü' });
        }

        // embedContent yanıtı usageMetadata döndürmüyor — kaba bir tahminle
        // (karakter/4 ~ token) yine de maliyet takibine bir satır düşelim.
        const approxTokens = Math.ceil(text.length / 4);
        trackGeminiUsage({ usageMetadata: { promptTokenCount: approxTokens, candidatesTokenCount: 0 } }, EMBED_MODEL, 'embed-text')
            .catch(() => {});

        return res.status(200).json({ success: true, embedding });
    } catch (err: any) {
        return res.status(200).json({ success: false, error: err?.message || 'Bilinmeyen hata' });
    }
}
