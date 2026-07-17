import type { VercelRequest, VercelResponse } from '@vercel/node';
import { trackOpenRouterUsage } from './_aiUsageTracker';

/**
 * Social Content — Admin'in social-candidates.ts'ten SEÇTİĞİ TEK bir ürün için
 * sosyal medya başlığı + caption üretir. Önceden bu uç 3 ürünü BİRLİKTE seçip
 * her biri için içerik üretiyordu — artık seçim ayrı bir adım (social-candidates.ts),
 * bu uç sadece zaten seçilmiş TEK ürünü içerikleştiriyor. "Yeniden Üret"
 * butonu da aynı ucu tekrar çağırır (temperature yüksek olduğu için her
 * seferinde farklı bir sonuç gelir).
 *
 * POST { discount: { id, title, brand, category, oldPrice, newPrice, reviewCount } }
 * → { success, title, caption }
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

    const { discount } = req.body || {};
    if (!discount || !discount.title) {
        return res.status(400).json({ success: false, error: 'discount alanı (title dahil) zorunlu' });
    }

    const discountPercent = discount.oldPrice > discount.newPrice && discount.oldPrice > 0
        ? Math.round(((discount.oldPrice - discount.newPrice) / discount.oldPrice) * 100)
        : 0;

    const prompt = `Sen İNDİVA uygulamasının sosyal medya içerik editörüsün. Aşağıdaki TEK ürün için
Instagram story/post içeriği yaz.

ÜRÜN:
${JSON.stringify({
        title: discount.title,
        brand: discount.brand || '',
        category: discount.category || '',
        oldPrice: discount.oldPrice || 0,
        newPrice: discount.newPrice || 0,
        discountPercent,
        reviewCount: discount.reviewCount || '',
    })}

ÜRETMEN GEREKENLER:
- "title": max 60 karakter, ÜRÜNÜ TANIMLAYAN dikkat çekici bir başlık (marka/ürün adını içersin).
  SADECE indirim yüzdesini tekrar eden bir başlık YAZMA (örn. "%37 İndirim!" YANLIŞ) — indirim
  yüzdesi zaten görselde ayrı bir rozette gösteriliyor, başlık ürünün ne olduğunu anlatmalı.
  Örnek doğru başlık: "Samsung Galaxy Buds Yarı Fiyatına!"
- "caption": Instagram story/post metni (2-4 cümle + hashtag'ler), emoji kullanılabilir, sonunda
  İNDİVA'yı indirmeye teşvik eden bir cümle olsun

SADECE aşağıdaki JSON formatında cevap ver, başka hiçbir şey yazma:
{"title": "...", "caption": "..."}`;

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
                // "Yeniden Üret" her seferinde farklı bir sonuç versin diye
                // önceki 3'lü-seçim ucundan (0.7) biraz daha yüksek sıcaklık.
                temperature: 0.85,
                usage: { include: true },
            }),
            signal: AbortSignal.timeout(30000),
        });

        if (!response.ok) {
            const errText = await response.text();
            return res.status(502).json({ success: false, error: `OpenRouter ${response.status}: ${errText.substring(0, 200)}` });
        }

        const data = await response.json();
        await trackOpenRouterUsage(data, 'social-content');
        const text = data?.choices?.[0]?.message?.content || '';
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
            return res.status(502).json({ success: false, error: 'AI JSON döndürmedi' });
        }

        const parsed = JSON.parse(jsonMatch[0]);
        const title = String(parsed.title || '').slice(0, 100);
        const caption = String(parsed.caption || '');
        if (!title || !caption) {
            return res.status(502).json({ success: false, error: 'AI eksik içerik döndürdü' });
        }

        return res.status(200).json({ success: true, title, caption });
    } catch (err: any) {
        if (err?.name === 'AbortError' || err?.name === 'TimeoutError') {
            return res.status(504).json({ success: false, error: 'Zaman aşımı' });
        }
        return res.status(500).json({ success: false, error: err?.message || 'Bilinmeyen hata' });
    }
}
