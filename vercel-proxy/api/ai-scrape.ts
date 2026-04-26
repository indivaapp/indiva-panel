import type { VercelRequest, VercelResponse } from '@vercel/node';

/**
 * AI Scrape — Jina Reader + Gemini ile ürün verisi çıkarır
 * POST { url: string }
 * → r.jina.ai ile sayfayı çek (bot korumasını aşar)
 * → OpenRouter/Gemini ile title, fiyat, görsel çıkar
 */

const GEMINI_KEY_ENV = process.env.GEMINI_API_KEY || '';

function corsHeaders(res: VercelResponse) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function extractFirstImageFromMarkdown(markdown: string): string {
    const match = markdown.match(/!\[.*?\]\((https?:\/\/[^\s)]+)\)/);
    return match ? match[1] : '';
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
    corsHeaders(res);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'POST gerekli' });

    const { url, geminiKey } = req.body || {};
    if (!url || !url.startsWith('http')) {
        return res.status(400).json({ success: false, error: 'Geçerli URL gerekli' });
    }
    const GEMINI_KEY = geminiKey || GEMINI_KEY_ENV;
    if (!GEMINI_KEY) {
        return res.status(500).json({ success: false, error: 'Gemini API key eksik' });
    }

    try {
        // ── 1. Jina Reader — sayfayı markdown olarak çek ──────────────────────
        const jinaUrl = `https://r.jina.ai/${url}`;
        const jinaRes = await fetch(jinaUrl, {
            headers: {
                'X-Return-Format': 'markdown',
                'X-With-Images-Summary': 'true',
            },
            signal: AbortSignal.timeout(25000),
        });

        if (!jinaRes.ok) {
            return res.status(502).json({ success: false, error: `Jina ${jinaRes.status}: sayfa okunamadı` });
        }

        const markdown = await jinaRes.text();
        if (!markdown || markdown.length < 100) {
            return res.status(502).json({ success: false, error: 'Sayfa içeriği boş geldi' });
        }

        // Markdown'dan ilk görsel URL'yi çek (Gemini bulamazsa fallback)
        const firstImage = extractFirstImageFromMarkdown(markdown);

        // ── 2. Gemini — yapısal veri çıkar ────────────────────────────────────
        const prompt = `Sen bir e-ticaret ürün analiz uzmanısın.
Aşağıdaki sayfa içeriği bir e-ticaret ürün sayfasından Jina Reader ile çekilmiştir.

URL: ${url}

SAYFA İÇERİĞİ (markdown):
${markdown.substring(0, 12000)}

Görevin: Ürün bilgilerini çıkar. SADECE JSON döndür, başka hiçbir şey yazma.

KATEGORİ KURALLARI (dikkatli oku):
- Süpermarket: gıda, içecek, atıştırmalık, fıstık kreması, reçel, çikolata, bakliyat, tahıl, kahve, çay, deterjan, temizlik ürünleri, kişisel bakım ürünleri DEĞİL
- Kozmetik & Bakım: SADECE makyaj, cilt kremi, şampuan, parfüm, saç bakım, tıraş malzemeleri, diş bakımı
- Ev & Yaşam: hava nemlendirici, hava temizleyici, elektrikli süpürge, mutfak aletleri (küçük), ev dekorasyon, havlu, nevresim, perde — beyaz eşya DEĞİL
- Beyaz Eşya: buzdolabı, çamaşır makinesi, bulaşık makinesi, fırın, ocak, klima
- Teknoloji: telefon, laptop, tablet, kulaklık, hoparlör, akıllı saat, TV, bilgisayar bileşenleri
- Sağlık: ilaç, takviye, vitamin, medikal cihaz, eczane ürünleri
- Spor & Outdoor: spor ekipmanları, fitness, bisiklet, kamp malzemeleri, spor giyim

{
  "title": "Tam ürün adı, Title Case, max 100 karakter",
  "brand": "Marka adı (bulunamazsa boş string)",
  "newPrice": sayısal değer (TL, indirimli fiyat, bulunamazsa 0),
  "oldPrice": sayısal değer (TL, orijinal/eski fiyat, bulunamazsa 0),
  "imageUrl": "En iyi ürün görseli URL (bulunamazsa boş string)",
  "category": "Teknoloji / Giyim & Moda / Ev & Yaşam / Kozmetik & Bakım / Spor & Outdoor / Süpermarket / Anne & Bebek / Oyun & Oyuncak / Beyaz Eşya / Mobilya & Dekorasyon / Sağlık / Otomotiv / Pet Shop / Diğer"
}`;

        const aiRes = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_KEY}`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{ role: 'user', parts: [{ text: prompt }] }],
                    generationConfig: { temperature: 0.1, responseMimeType: 'application/json' },
                }),
                signal: AbortSignal.timeout(30000),
            }
        );

        if (!aiRes.ok) {
            const errText = await aiRes.text();
            return res.status(502).json({ success: false, error: `Gemini ${aiRes.status}: ${errText.substring(0, 200)}` });
        }

        const aiData = await aiRes.json();
        const rawText = aiData.candidates?.[0]?.content?.parts?.[0]?.text || '';
        const jsonMatch = rawText.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
            return res.status(502).json({ success: false, error: 'Gemini JSON döndürmedi' });
        }

        const product = JSON.parse(jsonMatch[0]);

        // Görsel: Gemini bulamazsa markdown'dan çıkardığımız ilk görseli kullan
        if (!product.imageUrl && firstImage) {
            product.imageUrl = firstImage;
        }

        // Fiyat kontrolü
        product.newPrice = parseFloat(String(product.newPrice || 0)) || 0;
        product.oldPrice = parseFloat(String(product.oldPrice || 0)) || 0;

        return res.status(200).json({ success: true, product });

    } catch (err: any) {
        if (err?.name === 'AbortError' || err?.name === 'TimeoutError') {
            return res.status(504).json({ success: false, error: 'Zaman aşımı (istek çok uzun sürdü)' });
        }
        return res.status(500).json({ success: false, error: err?.message || 'Bilinmeyen hata' });
    }
}
