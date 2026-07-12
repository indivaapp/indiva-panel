import type { VercelRequest, VercelResponse } from '@vercel/node';
import { trackOpenRouterUsage } from './_aiUsageTracker';

/**
 * Social Content — Son 50 ilan içinden sosyal medya için en iyi ürünü seçer
 * ve o ürün için 3 farklı başlık/açıklama önerisi üretir.
 * OpenRouter (deepseek/deepseek-v4-flash) kullanır — generate-caption.ts ile
 * aynı sağlayıcı/model: ucuz, Türkçe satış diline yatkın, paylaşılan Gemini
 * kotasını yormaz (bkz. generate-caption.ts başındaki not).
 *
 * POST { discounts: Array<{ id, title, brand, category, oldPrice, newPrice, reviewCount }> }
 * → { success, productId, reasoning, options: [{ title, caption }, ...] }
 */

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || '';
const MODEL = 'deepseek/deepseek-v4-flash';

function corsHeaders(res: VercelResponse) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
    corsHeaders(res);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'Sadece POST destekleniyor' });

    if (!OPENROUTER_API_KEY) {
        return res.status(500).json({ success: false, error: 'OPENROUTER_API_KEY tanımlı değil' });
    }

    const { discounts } = req.body || {};
    if (!Array.isArray(discounts) || discounts.length === 0) {
        return res.status(400).json({ success: false, error: 'discounts listesi boş olamaz' });
    }

    const compact = discounts.slice(0, 50).map((d: any) => ({
        id: d.id,
        title: d.title,
        brand: d.brand,
        category: d.category,
        oldPrice: d.oldPrice || 0,
        newPrice: d.newPrice || 0,
        discountPercent: d.oldPrice > d.newPrice && d.oldPrice > 0
            ? Math.round(((d.oldPrice - d.newPrice) / d.oldPrice) * 100) : 0,
        reviewCount: d.reviewCount || '',
    }));

    const prompt = `Sen İNDİVA uygulamasının sosyal medya içerik editörüsün. Aşağıda son 50 indirim ilanı JSON olarak veriliyor.

GÖREV 1 — EN İYİ ÜRÜNÜ SEÇ:
Sosyal medyada (Instagram story/post) paylaşılacak TEK bir ürün seç. Şu 3 kriteri birlikte değerlendir:
- Satış/popülerlik potansiyeli yüksek olmalı (reviewCount, marka tanınırlığı, kategori popülerliği ipucu olarak kullanılabilir)
- İndirim oranı (discountPercent) yüksek olmalı
- Geniş kitleye hitap etmeli (çok nadir/niş bir ürün değil, mainstream bir kategori/marka)

GÖREV 2 — 3 FARKLI İÇERİK ÜRET:
Seçtiğin TEK ürün için, birbirinden farklı üslupta 3 sosyal medya içeriği yaz:
1. FOMO/aciliyet odaklı (kısa, heyecanlı, emoji kullan)
2. Bilgilendirici/güven verici (ürünün değerini vurgula)
3. Eğlenceli/samimi (günlük konuşma dili, esprili)

Her içerik için:
- "title": max 60 karakter, dikkat çekici başlık
- "caption": Instagram story/post metni (2-4 cümle + hashtag'ler), emoji kullanılabilir, sonunda İNDİVA'yı indirmeye teşvik eden bir cümle olsun

İLANLAR:
${JSON.stringify(compact)}

SADECE aşağıdaki JSON formatında cevap ver, başka hiçbir şey yazma:
{
  "productId": "seçilen ürünün id'si",
  "reasoning": "neden bu ürünü seçtiğin, kısa Türkçe açıklama (max 100 karakter)",
  "options": [
    {"title": "...", "caption": "..."},
    {"title": "...", "caption": "..."},
    {"title": "...", "caption": "..."}
  ]
}`;

    try {
        const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
                'Content-Type': 'application/json',
                'HTTP-Referer': 'https://indiva-proxy.vercel.app',
                'X-Title': 'INDIVA Panel Social Content',
            },
            body: JSON.stringify({
                model: MODEL,
                messages: [{ role: 'user', content: prompt }],
                temperature: 0.7,
                usage: { include: true },
            }),
            signal: AbortSignal.timeout(45000),
        });

        if (!response.ok) {
            const errText = await response.text();
            return res.status(502).json({ success: false, error: `OpenRouter ${response.status}: ${errText.substring(0, 200)}` });
        }

        const data = await response.json();
        await trackOpenRouterUsage(data);
        const text = data?.choices?.[0]?.message?.content || '';
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
            return res.status(502).json({ success: false, error: 'AI JSON döndürmedi' });
        }

        const result = JSON.parse(jsonMatch[0]);
        if (!result.productId || !Array.isArray(result.options) || result.options.length === 0) {
            return res.status(502).json({ success: false, error: 'AI eksik veri döndürdü' });
        }

        const chosen = compact.find((d: any) => d.id === result.productId);
        if (!chosen) {
            return res.status(502).json({ success: false, error: 'AI geçersiz bir ürün id döndürdü' });
        }

        return res.status(200).json({
            success: true,
            productId: result.productId,
            reasoning: result.reasoning || '',
            options: result.options.slice(0, 3),
        });
    } catch (err: any) {
        if (err?.name === 'AbortError' || err?.name === 'TimeoutError') {
            return res.status(504).json({ success: false, error: 'Zaman aşımı' });
        }
        return res.status(500).json({ success: false, error: err?.message || 'Bilinmeyen hata' });
    }
}
