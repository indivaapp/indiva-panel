import type { VercelRequest, VercelResponse } from '@vercel/node';

/**
 * Vision API — Ekran görüntüsünden ürün bilgisi çıkarır
 * OpenRouter üzerinden Gemini Flash vision modeli kullanır
 */

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || '';

export default async function handler(req: VercelRequest, res: VercelResponse) {
    // CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }

    if (req.method !== 'POST') {
        res.status(405).json({ success: false, error: 'Sadece POST destekleniyor' });
        return;
    }

    if (!OPENROUTER_API_KEY) {
        res.status(500).json({ success: false, error: 'OPENROUTER_API_KEY tanımlı değil' });
        return;
    }

    const { imageBase64, mimeType = 'image/jpeg' } = req.body || {};

    if (!imageBase64 || imageBase64.length < 100) {
        res.status(400).json({ success: false, error: 'imageBase64 eksik veya çok kısa' });
        return;
    }

    const prompt = `Bu ekran görüntüsü bir e-ticaret ürün sayfasına ait.
Lütfen şu bilgileri çıkar:

1. title: Tam ürün adı
2. newPrice: İndirimli satış fiyatı (sadece sayı, TL)
3. oldPrice: Orijinal / eski fiyat (üstü çizili olan, varsa)
4. storeName: Mağaza adı (Trendyol, Hepsiburada, N11, Amazon, vb.)
5. brand: Ürün markası
6. category: En uygun kategori → Teknoloji / Giyim & Moda / Ev & Yaşam / Kozmetik & Bakım / Spor & Outdoor / Süpermarket / Anne & Bebek / Oyun & Oyuncak / Diğer
7. discountPercent: İndirim yüzdesi
8. confidence: Güven skoru 0-100

SADECE JSON yaz, başka hiçbir şey ekleme:
{"title":"...","newPrice":0,"oldPrice":0,"storeName":"...","brand":"...","category":"...","discountPercent":0,"confidence":0}`;

    try {
        const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
                'Content-Type': 'application/json',
                'X-Title': 'INDIVA Panel Vision',
            },
            body: JSON.stringify({
                model: 'google/gemini-2.5-flash',
                messages: [{
                    role: 'user',
                    content: [
                        { type: 'text', text: prompt },
                        {
                            type: 'image_url',
                            image_url: {
                                url: `data:${mimeType};base64,${imageBase64}`
                            }
                        }
                    ]
                }],
                max_tokens: 300,
                temperature: 0.1,
            }),
            signal: AbortSignal.timeout(25000),
        });

        if (!response.ok) {
            const errText = await response.text().catch(() => '');
            // Fallback: gemini-flash-1.5 dene
            if (response.status === 429 || response.status === 503) {
                return await fallbackModel(req, res, imageBase64, mimeType, prompt);
            }
            res.status(502).json({
                success: false,
                error: `OpenRouter HTTP ${response.status}: ${errText.slice(0, 150)}`
            });
            return;
        }

        const data = await response.json();
        const text: string = data.choices?.[0]?.message?.content || '';

        if (!text) {
            res.status(502).json({ success: false, error: 'Model boş yanıt döndü' });
            return;
        }

        // JSON parse
        const jsonMatch = text.match(/\{[\s\S]*?\}/);
        if (!jsonMatch) {
            res.status(422).json({
                success: false,
                error: 'Yanıttan JSON çıkarılamadı',
                rawText: text.slice(0, 200)
            });
            return;
        }

        const parsed = JSON.parse(jsonMatch[0]);

        // Fiyatları normalize et
        const newPrice = parseFloat(String(parsed.newPrice).replace(',', '.')) || 0;
        const oldPrice = parseFloat(String(parsed.oldPrice).replace(',', '.')) || 0;

        let discountPercent = Number(parsed.discountPercent) || 0;
        if (!discountPercent && oldPrice > newPrice && newPrice > 0) {
            discountPercent = Math.round(((oldPrice - newPrice) / oldPrice) * 100);
        }

        res.status(200).json({
            success: true,
            product: {
                title:           String(parsed.title || '').trim(),
                newPrice,
                oldPrice,
                storeName:       String(parsed.storeName || '').trim(),
                brand:           String(parsed.brand || '').trim(),
                category:        String(parsed.category || 'Diğer').trim(),
                discountPercent,
                confidence:      Math.min(100, Math.max(0, Number(parsed.confidence) || 50)),
            }
        });

    } catch (err: any) {
        console.error('[Vision] Hata:', err);
        res.status(500).json({
            success: false,
            error: err?.message || 'Bilinmeyen hata'
        });
    }
}

/**
 * Yedek model — ücretsiz kota dolunca devreye girer
 */
async function fallbackModel(
    req: VercelRequest,
    res: VercelResponse,
    imageBase64: string,
    mimeType: string,
    prompt: string
) {
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            model: 'google/gemini-2.0-flash-001',
            messages: [{
                role: 'user',
                content: [
                    { type: 'text', text: prompt },
                    { type: 'image_url', image_url: { url: `data:${mimeType};base64,${imageBase64}` } }
                ]
            }],
            max_tokens: 300,
            temperature: 0.1,
        }),
        signal: AbortSignal.timeout(25000),
    });

    if (!response.ok) {
        res.status(502).json({ success: false, error: `Yedek model de başarısız: HTTP ${response.status}` });
        return;
    }

    const data = await response.json();
    const text: string = data.choices?.[0]?.message?.content || '';
    const jsonMatch = text.match(/\{[\s\S]*?\}/);
    if (!jsonMatch) {
        res.status(422).json({ success: false, error: 'Yedek model JSON döndürmedi' });
        return;
    }

    const parsed = JSON.parse(jsonMatch[0]);
    const newPrice = parseFloat(String(parsed.newPrice).replace(',', '.')) || 0;
    const oldPrice = parseFloat(String(parsed.oldPrice).replace(',', '.')) || 0;

    res.status(200).json({
        success: true,
        product: {
            title: String(parsed.title || '').trim(),
            newPrice, oldPrice,
            storeName: String(parsed.storeName || '').trim(),
            brand: String(parsed.brand || '').trim(),
            category: String(parsed.category || 'Diğer').trim(),
            discountPercent: Math.round(oldPrice > newPrice ? ((oldPrice - newPrice) / oldPrice) * 100 : 0),
            confidence: Number(parsed.confidence) || 50,
        }
    });
}
