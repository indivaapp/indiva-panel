import type { VercelRequest, VercelResponse } from '@vercel/node';

/**
 * Akakce "Fark Atan Fiyatlar" sayfasından ürünleri çeker
 * GET /api/akakce-deals
 */

interface AkakceProduct {
    title: string;
    akakceUrl: string;
    category?: string;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        console.log('📰 Akakce fırsatları çekiliyor...');

        const response = await fetch('https://www.akakce.com/fark-atan-fiyatlar/', {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                'Accept-Language': 'tr-TR,tr;q=0.9,en;q=0.8',
            },
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        const html = await response.text();
        const products = parseAkakceProducts(html);

        console.log(`✅ ${products.length} ürün bulundu`);

        return res.status(200).json({
            success: true,
            count: products.length,
            products,
            timestamp: new Date().toISOString(),
        });

    } catch (error: any) {
        console.error('Akakce fetch hatası:', error);
        return res.status(500).json({
            success: false,
            error: error.message || 'Akakce verileri çekilemedi',
        });
    }
}

function parseAkakceProducts(html: string): AkakceProduct[] {
    const products: AkakceProduct[] = [];
    const seenUrls = new Set<string>();

    // Akakce ürün linklerini bul - format: /kategori/en-ucuz-urun-adi-fiyati,id.html
    const linkRegex = /<a[^>]*href="(https?:\/\/www\.akakce\.com\/[^"]+fiyati,[^"]+\.html)"[^>]*>([^<]+)<\/a>/gi;

    let match;
    while ((match = linkRegex.exec(html)) !== null) {
        const url = match[1];
        let title = match[2].trim();

        // Duplicate kontrolü
        if (seenUrls.has(url)) continue;
        seenUrls.add(url);

        // Boş veya çok kısa başlıkları atla
        if (!title || title.length < 5) continue;

        // Sadece % işareti olanları atla (bunlar badge'ler)
        if (/^%\d+$/.test(title)) continue;

        // HTML entities decode
        title = decodeHtmlEntities(title);

        // Kategoriyi URL'den çıkar
        const categoryMatch = url.match(/akakce\.com\/([^\/]+)\//);
        const category = categoryMatch ? formatCategory(categoryMatch[1]) : undefined;

        products.push({
            title,
            akakceUrl: url,
            category,
        });

        // Max 50 ürün
        if (products.length >= 50) break;
    }

    return products;
}

function decodeHtmlEntities(text: string): string {
    return text
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&nbsp;/g, ' ');
}

function formatCategory(slug: string): string {
    return slug
        .replace(/-/g, ' ')
        .replace(/\b\w/g, c => c.toUpperCase());
}
