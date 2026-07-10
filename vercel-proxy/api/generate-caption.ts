import type { VercelRequest, VercelResponse } from '@vercel/node';

/**
 * Generate Caption — panelden manuel seçilen fırsatlar için satış dilinde
 * Instagram caption'ı üretir. Tarayıcıda Gemini anahtarı ifşa etmemek için
 * bu üretim sunucu tarafında (Vercel function) yapılır; frontend sadece
 * ürün bilgisini gönderir, üretilen metni geri alır.
 *
 * POST { title, newPrice, oldPrice, category, storeName }
 * → { success: true, caption: string }
 */

const GEMINI_KEY = process.env.GEMINI_API_KEY || '';

function corsHeaders(res: VercelResponse) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function fallbackCaption(title: string, newPrice: number, oldPrice: number, storeName: string) {
    const discountPct = oldPrice > 0 && newPrice > 0
        ? Math.round(((oldPrice - newPrice) / oldPrice) * 100)
        : 0;
    return `🔥 %${discountPct} indirim: ${title}\n${Math.floor(newPrice)} TL — ${storeName}\n\nSen de İNDİVA'yı indir, fırsatları kaçırma! 📲\n\n#indirim #firsat #kampanya #indivaapp`;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
    corsHeaders(res);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'POST gerekli' });

    const { title, newPrice, oldPrice, category, storeName } = req.body || {};
    if (!title) {
        return res.status(400).json({ success: false, error: 'title gerekli' });
    }

    const np = Number(newPrice) || 0;
    const op = Number(oldPrice) || 0;
    const store = storeName || 'bilinmiyor';
    const cat = category || 'bilinmiyor';
    const discountPct = op > 0 && np > 0 ? Math.round(((op - np) / op) * 100) : 0;

    if (!GEMINI_KEY) {
        return res.status(200).json({ success: true, caption: fallbackCaption(title, np, op, store), source: 'fallback' });
    }

    const prompt = `Sen İNDİVA uygulamasının sosyal medya içerik editörü ve satış metni
yazarısın (copywriter). Instagram'da paylaşılacak, ürünü SATMAYA çalışan, indirimli
alışverişe teşvik eden dikkat çekici bir gönderi metni (caption) yaz.

Ürün: "${title}"
Fiyat: ${op} TL -> ${np} TL (%${discountPct} indirim)
Mağaza: ${store}
Kategori: ${cat}

KURALLAR:
1. İlk satır dikkat çekici bir kanca, emoji ile başla (fiyat/indirim vurgulu)
2. Ürünü tanıt ve fırsatı 2-3 cümlede heyecanlı, ikna edici bir satış diliyle anlat
   (abartma/yalan yok ama "kaçırma", "şimdi al", "stoklar tükenmeden" gibi aciliyet
   hissi ver — gerçek bir e-ticaret pazarlamacısı gibi yaz)
3. Son satır MUTLAKA İNDİVA uygulamasını indirmeye teşvik eden, "Sen de İNDİVA'yı
   indir, fırsatları kaçırma!" temalı bir slogan cümlesi olsun (birebir aynı cümleyi
   kullanmak zorunda değilsin, ama anlamı ve enerjisi aynı olsun)
4. Altına 5-8 adet ilgili Türkçe hashtag ekle (#indirim #firsat gibi genel + kategoriye özel + #indivaapp)
5. Emoji kullan ama abartma, samimi bir Instagram tonu olsun
6. SADECE caption metnini döndür, açıklama/markdown ekleme`;

    try {
        const aiRes = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${GEMINI_KEY}`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{ role: 'user', parts: [{ text: prompt }] }],
                    generationConfig: { temperature: 0.7 },
                }),
                signal: AbortSignal.timeout(25000),
            }
        );

        if (!aiRes.ok) {
            return res.status(200).json({ success: true, caption: fallbackCaption(title, np, op, store), source: 'fallback', warning: `Gemini ${aiRes.status}` });
        }

        const aiData = await aiRes.json();
        const text = (aiData.candidates?.[0]?.content?.parts?.[0]?.text || '').trim();
        if (!text) {
            return res.status(200).json({ success: true, caption: fallbackCaption(title, np, op, store), source: 'fallback' });
        }

        return res.status(200).json({ success: true, caption: text, source: 'ai' });
    } catch (err: any) {
        return res.status(200).json({ success: true, caption: fallbackCaption(title, np, op, store), source: 'fallback', warning: err?.message });
    }
}
