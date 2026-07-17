import type { VercelRequest, VercelResponse } from '@vercel/node';
import { trackOpenRouterUsage } from './_aiUsageTracker';

/**
 * Social Candidates — Son ~100 ilan içinden sosyal medyada paylaşılmaya değer
 * EN İYİ 10 ürünü puanlar ve döndürür. Bu aşamada başlık/caption ÜRETİLMEZ —
 * sadece adayları sıralar. Admin bu 10'dan birini seçtiğinde social-content.ts
 * SADECE o ürün için içerik üretir (10'unun tamamı için gereksiz AI çağrısı
 * yapılmaz).
 * OpenRouter (deepseek/deepseek-v4-flash) kullanır.
 *
 * POST { discounts: Array<{ id, title, brand, category, oldPrice, newPrice, reviewCount }> }
 * → { success, candidates: [{ productId, score, reasoning }, ...] } (en fazla 10, puana göre sıralı)
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

    const compact = discounts.slice(0, 100).map((d: any, i: number) => ({
        index: i + 1,
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

    const prompt = `Sen İNDİVA uygulamasının sosyal medya içerik editörüsün. Aşağıda son ${compact.length} indirim ilanı JSON olarak veriliyor.

GÖREV — EN İYİ 10 ADAYI PUANLA VE SIRALA:
Her ürünü sosyal medyada (Instagram story/post) paylaşılmaya UYGUNLUK açısından 1-10 arası puanla.
Puanlarken şu kriterleri birlikte değerlendir:
- Satış/popülerlik potansiyeli (reviewCount, marka tanınırlığı, kategori popülerliği ipucu olarak kullanılabilir)
- İndirim oranı (discountPercent) — yüksek indirim daha çekici
- İlgi çekicilik — geniş kitleye hitap eden, mainstream bir ürün/kategori/marka (çok nadir/niş bir ürün düşük puan almalı)

En yüksek puanlı 10 FARKLI ürünü seç (mümkünse farklı kategorilerden çeşitlilik olsun, aynı ürünü iki kez seçme).
Bu aşamada başlık veya sosyal medya metni YAZMA — sadece puanla ve kısa bir gerekçe ver.

İLANLAR (her ilanın başındaki "index" numarasıyla referans ver, "id" alanını YAZMA/KOPYALAMA):
${JSON.stringify(compact)}

SADECE aşağıdaki JSON formatında cevap ver, başka hiçbir şey yazma. Her "index" MUTLAKA
yukarıdaki listeden seçtiğin ilanın "index" alanındaki TAM SAYI olmalı (1 ile ${compact.length} arası),
"score" 1-10 arası tam sayı olmalı, "candidates" en yüksek puandan en düşüğe sıralı olmalı ve
en fazla 10 eleman içermeli, tüm index'ler birbirinden FARKLI olmalı:
{
  "candidates": [
    {"index": 1, "score": 9, "reasoning": "neden bu puanı verdiğin, kısa Türkçe (max 100 karakter)"},
    {"index": 2, "score": 8, "reasoning": "..."}
  ]
}`;

    try {
        const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
                'Content-Type': 'application/json',
                'HTTP-Referer': 'https://indiva-proxy.vercel.app',
                'X-Title': 'INDIVA Panel Social Candidates',
            },
            body: JSON.stringify({
                model: MODEL,
                messages: [{ role: 'user', content: prompt }],
                temperature: 0.4,
                usage: { include: true },
            }),
            signal: AbortSignal.timeout(55000),
        });

        if (!response.ok) {
            const errText = await response.text();
            return res.status(502).json({ success: false, error: `OpenRouter ${response.status}: ${errText.substring(0, 200)}` });
        }

        const data = await response.json();
        await trackOpenRouterUsage(data, 'social-candidates');
        const text = data?.choices?.[0]?.message?.content || '';
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
            return res.status(502).json({ success: false, error: 'AI JSON döndürmedi' });
        }

        const result = JSON.parse(jsonMatch[0]);
        if (!Array.isArray(result.candidates) || result.candidates.length === 0) {
            return res.status(502).json({ success: false, error: 'AI eksik veri döndürdü' });
        }

        const seenIndices = new Set<number>();
        const candidates = result.candidates
            .map((c: any) => {
                const idx = Number(c.index);
                if (!Number.isInteger(idx) || seenIndices.has(idx)) return null;
                const chosen = compact[idx - 1];
                if (!chosen) return null;
                seenIndices.add(idx);
                return {
                    productId: chosen.id,
                    score: Math.min(10, Math.max(1, Math.round(Number(c.score)) || 5)),
                    reasoning: String(c.reasoning || '').slice(0, 200),
                };
            })
            .filter(Boolean)
            .sort((a: any, b: any) => b.score - a.score)
            .slice(0, 10);

        if (candidates.length === 0) {
            return res.status(502).json({ success: false, error: 'AI geçerli aday seçemedi' });
        }

        return res.status(200).json({ success: true, candidates });
    } catch (err: any) {
        if (err?.name === 'AbortError' || err?.name === 'TimeoutError') {
            return res.status(504).json({ success: false, error: 'Zaman aşımı' });
        }
        return res.status(500).json({ success: false, error: err?.message || 'Bilinmeyen hata' });
    }
}
