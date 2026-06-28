import type { VercelRequest, VercelResponse } from '@vercel/node';

const GEMINI_API_KEY = process.env.VITE_GEMINI_API_KEY || process.env.GEMINI_API_KEY || '';
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`;

const SYSTEM_PROMPT = `Sen bir Türk e-ticaret ürün analiz asistanısın. Sana gönderilen ekran görüntüsünden ürün bilgilerini çıkar.

KURALLAR:
- Tüm fiyatlar sayı olarak (TL/₺ işareti olmadan)
- Eski fiyat bulunamazsa 0 döndür (sonra sistem %30 ekler)
- Ürün görseli URL yoksa boş string döndür
- indirim yüzdesi yoksa 0 döndür
- storeName: sayfada görünen mağaza adını yaz (Trendyol, Hepsiburada, N11, Amazon, Pazarama vb.)

YANIT FORMATI (sadece JSON, başka hiçbir şey yazma):
{
  "title": "ürün tam adı",
  "brand": "marka adı",
  "newPrice": 299.99,
  "oldPrice": 499.00,
  "storeName": "Trendyol",
  "discountPercent": 40,
  "category": "Kategori adı"
}`;

export default async function handler(req: VercelRequest, res: VercelResponse) {
    // CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') { res.status(200).end(); return; }
    if (req.method !== 'POST') {
        res.status(405).json({ success: false, error: 'Sadece POST desteklenir' });
        return;
    }

    if (!GEMINI_API_KEY) {
        res.status(500).json({ success: false, error: 'GEMINI_API_KEY ayarlanmamış' });
        return;
    }

    const { imageBase64, mimeType = 'image/jpeg' } = req.body || {};

    if (!imageBase64 || typeof imageBase64 !== 'string') {
        res.status(400).json({ success: false, error: 'imageBase64 gerekli' });
        return;
    }

    try {
        const geminiRes = await fetch(GEMINI_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{
                    parts: [
                        { text: SYSTEM_PROMPT },
                        { inlineData: { mimeType, data: imageBase64 } },
                    ],
                }],
                generationConfig: {
                    temperature: 0.1,
                    maxOutputTokens: 512,
                },
            }),
        });

        if (!geminiRes.ok) {
            const errText = await geminiRes.text();
            throw new Error(`Gemini API ${geminiRes.status}: ${errText.slice(0, 200)}`);
        }

        const geminiJson = await geminiRes.json();
        const rawText: string = geminiJson?.candidates?.[0]?.content?.parts?.[0]?.text || '';

        // JSON'u metinden çıkar
        const jsonMatch = rawText.match(/\{[\s\S]*\}/);
        if (!jsonMatch) throw new Error('Gemini geçerli JSON döndürmedi');

        const product = JSON.parse(jsonMatch[0]);

        // Tip güvenliği
        const safeProduct = {
            title:           String(product.title          || '').trim(),
            brand:           String(product.brand          || '').trim(),
            newPrice:        Number(product.newPrice)       || 0,
            oldPrice:        Number(product.oldPrice)       || 0,
            storeName:       String(product.storeName       || 'Trendyol').trim(),
            discountPercent: Number(product.discountPercent) || 0,
            category:        String(product.category       || 'Diğer').trim(),
            confidence:      0.9,
        };

        // Eski fiyat yoksa %30 ekle
        if (safeProduct.oldPrice === 0 && safeProduct.newPrice > 0) {
            safeProduct.oldPrice = Math.round(safeProduct.newPrice * 1.3);
        }

        // discountPercent hesapla (Gemini bulamazsa)
        if (safeProduct.discountPercent === 0 && safeProduct.oldPrice > safeProduct.newPrice) {
            safeProduct.discountPercent = Math.round(
                ((safeProduct.oldPrice - safeProduct.newPrice) / safeProduct.oldPrice) * 100
            );
        }

        res.status(200).json({ success: true, product: safeProduct });

    } catch (err: any) {
        console.error('Vision error:', err);
        res.status(500).json({ success: false, error: err.message || 'Vision analizi başarısız' });
    }
}
