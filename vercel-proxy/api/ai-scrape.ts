import type { VercelRequest, VercelResponse } from '@vercel/node';

/**
 * AI Scrape — Jina Reader + Gemini ile ürün verisi çıkarır
 * POST { url: string }
 * → r.jina.ai ile sayfayı çek (bot korumasını aşar)
 * → Gemini ile title, fiyat, görsel çıkar
 */

const GEMINI_KEY_ENV = process.env.GEMINI_API_KEY || '';

function corsHeaders(res: VercelResponse) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

/** Türkçe fiyat formatını sayıya çevir: "1.299,99 TL" → 1299.99 */
function parseTurkishPrice(val: any): number {
    if (typeof val === 'number' && !isNaN(val)) return val;
    const s = String(val || '')
        .replace(/\s/g, '')
        .replace('TL', '')
        .replace('₺', '')
        .replace('tl', '')
        .trim();
    if (!s) return 0;
    // Türkçe format: 1.299,99  →  binlik ayraç nokta, ondalık virgül
    if (s.includes(',')) {
        return parseFloat(s.replace(/\./g, '').replace(',', '.')) || 0;
    }
    // İngilizce format: 1,299.99
    if (s.includes('.') && s.indexOf('.') < s.lastIndexOf('.') === false && s.split('.').length === 2) {
        // tek nokta — ondalık nokta
        return parseFloat(s.replace(/,/g, '')) || 0;
    }
    return parseFloat(s.replace(/[^\d.]/g, '')) || 0;
}

/** Markdown'dan en iyi ürün görselini çıkar */
function extractBestImage(markdown: string): string {
    // 1. CDN/img domain'lerindeki görseller (ürün görseli olma ihtimali yüksek)
    const cdnPattern = /!\[.*?\]\((https?:\/\/(?:cdn|img|images|static|media|photos|content|product)[^\s)]+)\)/gi;
    const cdnMatch = cdnPattern.exec(markdown);
    if (cdnMatch) {
        const u = cdnMatch[0].match(/\((https?:\/\/[^\s)]+)\)/);
        if (u) return u[1];
    }
    // 2. jpg/jpeg/png/webp uzantılı görseller
    const extPattern = /!\[.*?\]\((https?:\/\/[^\s)]+\.(?:jpg|jpeg|png|webp)(?:[?#][^\s)]*)?)\)/gi;
    const extMatch = extPattern.exec(markdown);
    if (extMatch) {
        const u = extMatch[0].match(/\((https?:\/\/[^\s)]+)\)/);
        if (u) return u[1];
    }
    // 3. Herhangi bir markdown görseli
    const anyMatch = markdown.match(/!\[.*?\]\((https?:\/\/[^\s)]+)\)/);
    if (anyMatch) {
        const u = anyMatch[0].match(/\((https?:\/\/[^\s)]+)\)/);
        if (u) return u[1];
    }
    // 4. Düz URL olarak yazılmış görseller
    const directImgMatch = markdown.match(/https?:\/\/[^\s"'<>]+\.(?:jpg|jpeg|png|webp)(?:[?#][^\s"'<>]*)?/i);
    return directImgMatch ? directImgMatch[0] : '';
}

/** Fiyat bölümünü bulmak için markdown'dan akıllı kesit al */
function extractSmartContext(markdown: string): string {
    const MAX_LEN = 15000;
    if (markdown.length <= MAX_LEN) return markdown;

    // Fiyat ile ilgili anahtar kelimelerin bulunduğu bölümü bul
    const priceKeywords = ['fiyat', 'price', 'tl', '₺', 'indirim', 'sepet', 'satın', 'sipariş'];
    let bestIdx = -1;
    for (const kw of priceKeywords) {
        const idx = markdown.toLowerCase().lastIndexOf(kw);
        if (idx > bestIdx) bestIdx = idx;
    }

    if (bestIdx > 0 && bestIdx > MAX_LEN) {
        // Fiyat bölümü geç geliyorsa: baştan 8000 + fiyat bölgesinden 7000 al
        const start = markdown.substring(0, 8000);
        const priceSection = markdown.substring(Math.max(0, bestIdx - 1000), bestIdx + 6000);
        return start + '\n...\n' + priceSection;
    }

    return markdown.substring(0, MAX_LEN);
}

/** Kısa URLleri gerçek adrese çevir (ty.gl, hb.biz, amzn.to vb.) */
async function resolveShortUrl(url: string): Promise<string> {
    const shortDomains = ['ty.gl', 'hb.biz', 'amzn.to', 'bit.ly', 'tinyurl.com'];
    const isShort = shortDomains.some(d => url.includes(d));
    if (!isShort) return url;

    try {
        const res = await fetch(url, {
            method: 'HEAD',
            redirect: 'follow',
            signal: AbortSignal.timeout(5000),
        });
        const resolved = res.url;
        if (resolved && resolved.startsWith('http') && resolved !== url) {
            return resolved;
        }
    } catch {
        // Çözümlenemezse orijinal URL ile devam et
    }
    return url;
}

/** Jina ile sayfa çek — 1 retry ile (Vercel süre limitine uygun) */
async function fetchWithJina(url: string): Promise<string> {
    // Kısa URL ise önce gerçek adrese çevir
    const resolvedUrl = await resolveShortUrl(url);

    const jinaUrl = `https://r.jina.ai/${resolvedUrl}`;
    const headers: Record<string, string> = {
        'X-Return-Format': 'markdown',
        'X-With-Images-Summary': 'true',
        'X-No-Cache': 'true',
    };
    if (process.env.JINA_API_KEY) {
        headers['Authorization'] = `Bearer ${process.env.JINA_API_KEY}`;
    }

    let lastError: Error | null = null;
    for (let attempt = 0; attempt < 2; attempt++) {
        if (attempt > 0) {
            await new Promise(r => setTimeout(r, 1500));
        }
        try {
            const jinaRes = await fetch(jinaUrl, {
                headers,
                signal: AbortSignal.timeout(12000),
            });
            if (jinaRes.ok) {
                const text = await jinaRes.text();
                if (text && text.length >= 100) return text;
            }
            lastError = new Error(`Jina ${jinaRes.status}`);
        } catch (e: any) {
            lastError = e;
        }
    }
    throw lastError || new Error('Jina başarısız');
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
        // ── 1. Jina Reader — retry ile ────────────────────────────────────────
        let markdown: string;
        try {
            markdown = await fetchWithJina(url);
        } catch (e: any) {
            return res.status(502).json({ success: false, error: `Sayfa okunamadı: ${e?.message || 'Jina hatası'}` });
        }

        const firstImage = extractBestImage(markdown);
        const context = extractSmartContext(markdown);

        // ── 2. Gemini — yapısal veri çıkar ────────────────────────────────────
        const prompt = `Sen bir e-ticaret ürün analiz uzmanısın.
Aşağıdaki sayfa içeriği bir e-ticaret ürün sayfasından çekilmiştir.
URL: ${url}

ÖNEMLİ FİYAT KURALLARI:
- Türkçe sayı formatı: 1.299,99 TL → newPrice: 1299.99 (noktalar binlik ayraç, virgül ondalık)
- "İndirimli fiyat", "Sepet fiyatı", "Şimdi" yazan fiyat → newPrice
- "Liste fiyatı", "Piyasa fiyatı", "Önceki fiyat", üstü çizili fiyat → oldPrice
- Eğer tek fiyat varsa → newPrice olarak yaz, oldPrice: 0
- Fiyatı ASLA metin olarak döndürme, sadece sayı (float)

KATEGORİ KURALLARI:
- Teknoloji: telefon, laptop, tablet, kulaklık, hoparlör, kamera, bilgisayar, TV
- Beyaz Eşya: buzdolabı, çamaşır makinesi, fırın, ocak, klima
- Giyim & Moda: kıyafet, ayakkabı, çanta (spor giyim dahil)
- Ev & Yaşam: mutfak, nevresim, havlu, ev aletleri (küçük)
- Kozmetik & Bakım: makyaj, cilt, şampuan, parfüm, tıraş
- Spor & Outdoor: spor ekipmanları, fitness, bisiklet
- Süpermarket: gıda, içecek, temizlik, deterjan
- Sağlık: vitamin, takviye, medikal

SAYFA İÇERİĞİ:
${context}

SADECE aşağıdaki JSON formatında döndür, başka hiçbir şey yazma:
{
  "title": "Tam ürün adı, Title Case, max 100 karakter",
  "brand": "Marka adı (bulunamazsa boş string)",
  "newPrice": 0,
  "oldPrice": 0,
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

        // Görsel: Gemini bulamazsa markdown'dan çıkardığımız en iyi görseli kullan
        if (!product.imageUrl && firstImage) {
            product.imageUrl = firstImage;
        }

        // Türkçe fiyat formatını düzelt
        product.newPrice = parseTurkishPrice(product.newPrice);
        product.oldPrice = parseTurkishPrice(product.oldPrice);

        // Mantık kontrolü: oldPrice < newPrice ise sıfırla
        if (product.oldPrice > 0 && product.oldPrice < product.newPrice) {
            product.oldPrice = 0;
        }

        return res.status(200).json({ success: true, product });

    } catch (err: any) {
        if (err?.name === 'AbortError' || err?.name === 'TimeoutError') {
            return res.status(504).json({ success: false, error: 'Zaman aşımı (istek çok uzun sürdü)' });
        }
        return res.status(500).json({ success: false, error: err?.message || 'Bilinmeyen hata' });
    }
}
