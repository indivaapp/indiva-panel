import type { VercelRequest, VercelResponse } from '@vercel/node';
import { trackOpenRouterUsage } from './_aiUsageTracker';

/**
 * Social Content — Son 50 ilan içinden sosyal medya için en iyi 3 FARKLI ürünü
 * seçer, her biri için ayrı bir başlık/caption üretir. Admin bu 3 öneriden
 * istediğini seçip kuyruğa ekler.
 * OpenRouter (deepseek/deepseek-v4-flash) kullanır — generate-caption.ts ile
 * aynı sağlayıcı/model: ucuz, Türkçe satış diline yatkın, paylaşılan Gemini
 * kotasını yormaz (bkz. generate-caption.ts başındaki not).
 *
 * POST { discounts: Array<{ id, title, brand, category, oldPrice, newPrice, reviewCount, link, imageUrl }> }
 * → { success, picks: [{ productId, reasoning, title, caption }, ...] } (3 farklı ürün)
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

    // NOT: AI'a Firestore doküman ID'sini (uzun/rastgele string) birebir geri
    // ürettirmiyoruz — LLM'ler bunu güvenilir kopyalayamıyor (deepseek-v4-flash'ta
    // sıkça hatalı/uydurma ID döndürüyordu). Bunun yerine listedeki sıra numarasını
    // ("index") seçtiriyoruz; gerçek ID'yi (ve link/imageUrl'i) burada biz bu
    // index'ten buluyoruz — AI'nın uydurmasına hiç gerek kalmıyor.
    const compact = discounts.slice(0, 50).map((d: any, i: number) => ({
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

    const prompt = `Sen İNDİVA uygulamasının sosyal medya içerik editörüsün. Aşağıda son 50 indirim ilanı JSON olarak veriliyor.

GÖREV — 3 FARKLI EN İYİ ÜRÜNÜ SEÇ:
Sosyal medyada (Instagram story/post) paylaşılmaya değer, BİRBİRİNDEN FARKLI 3 ürün seç
(aynı ürünü iki kez seçme, mümkünse farklı kategorilerden çeşitlilik olsun). Her biri için şu 3
kriteri birlikte değerlendir:
- Satış/popülerlik potansiyeli yüksek olmalı (reviewCount, marka tanınırlığı, kategori popülerliği ipucu olarak kullanılabilir)
- İndirim oranı (discountPercent) yüksek olmalı
- Geniş kitleye hitap etmeli (çok nadir/niş bir ürün değil, mainstream bir kategori/marka)

Seçtiğin HER ürün için AYRI bir sosyal medya içeriği yaz:
- "title": max 60 karakter, ÜRÜNÜ TANIMLAYAN dikkat çekici bir başlık (marka/ürün adını içersin).
  SADECE indirim yüzdesini tekrar eden bir başlık YAZMA (örn. "%37 İndirim!" YANLIŞ) — indirim
  yüzdesi zaten görselde ayrı bir rozette gösteriliyor, başlık ürünün ne olduğunu anlatmalı.
  Örnek doğru başlık: "Samsung Galaxy Buds Yarı Fiyatına!"
- "caption": Instagram story/post metni (2-4 cümle + hashtag'ler), emoji kullanılabilir, sonunda
  İNDİVA'yı indirmeye teşvik eden bir cümle olsun

İLANLAR (her ilanın başındaki "index" numarasıyla referans ver, "id" alanını YAZMA/KOPYALAMA):
${JSON.stringify(compact)}

SADECE aşağıdaki JSON formatında cevap ver, başka hiçbir şey yazma. Her "index" MUTLAKA
yukarıdaki listeden seçtiğin ilanın "index" alanındaki TAM SAYI olmalı (1 ile ${compact.length} arası),
ve üç index birbirinden FARKLI olmalı:
{
  "picks": [
    {"index": 1, "reasoning": "neden bu ürünü seçtiğin, kısa Türkçe (max 100 karakter)", "title": "...", "caption": "..."},
    {"index": 2, "reasoning": "...", "title": "...", "caption": "..."},
    {"index": 3, "reasoning": "...", "title": "...", "caption": "..."}
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
            // Fonksiyonun toplam süre sınırı (vercel.json: 60sn) içinde kalacak
            // şekilde mümkün olduğunca fazla pay bırakıyoruz — deepseek-v4-flash
            // 50 ürünlük bu görevde bazen 45sn'yi aşabiliyor, önceki 45sn sınırı
            // aralıklı "Zaman aşımı" hatalarına yol açıyordu.
            signal: AbortSignal.timeout(55000),
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

        const result = JSON.parse(jsonMatch[0]);
        if (!Array.isArray(result.picks) || result.picks.length === 0) {
            return res.status(502).json({ success: false, error: 'AI eksik veri döndürdü' });
        }

        // Her pick'i doğrula + gerçek ürün verisiyle (id/link/imageUrl) eşleştir.
        // Geçersiz index'ler sessizce elenir; en az 1 geçerli pick kalmalı.
        const seenIndices = new Set<number>();
        const picks = result.picks
            .map((p: any) => {
                const idx = Number(p.index);
                if (!Number.isInteger(idx) || seenIndices.has(idx)) return null;
                const chosen = compact[idx - 1];
                if (!chosen) return null;
                seenIndices.add(idx);
                return {
                    productId: chosen.id,
                    reasoning: String(p.reasoning || '').slice(0, 200),
                    title: String(p.title || '').slice(0, 100),
                    caption: String(p.caption || ''),
                };
            })
            .filter(Boolean)
            .slice(0, 3);

        if (picks.length === 0) {
            return res.status(502).json({ success: false, error: 'AI geçerli ürün seçemedi' });
        }

        return res.status(200).json({ success: true, picks });
    } catch (err: any) {
        if (err?.name === 'AbortError' || err?.name === 'TimeoutError') {
            return res.status(504).json({ success: false, error: 'Zaman aşımı' });
        }
        return res.status(500).json({ success: false, error: err?.message || 'Bilinmeyen hata' });
    }
}
