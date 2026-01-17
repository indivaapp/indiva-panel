/**
 * Brochure Scraper Service
 * Akakce.com'dan otomatik aktüel/broşür çekme servisi
 * CORS proxy kullanarak tarayıcıdan direkt çeker (Vercel engelleniyor)
 */

// Desteklenen marketler
export const SUPPORTED_MARKETS = [
    { id: 'bim', name: 'BİM', color: '#D32F2F', akakceSlug: 'bim' },
    { id: 'a101', name: 'A101', color: '#1976D2', akakceSlug: 'a101' },
    { id: 'sok', name: 'ŞOK', color: '#F57C00', akakceSlug: 'sok' },
] as const;

export type MarketId = typeof SUPPORTED_MARKETS[number]['id'];

// CORS Proxy'ler (sırayla denenir)
const CORS_PROXIES = [
    {
        name: 'allorigins',
        getUrl: (url: string) => `https://api.allorigins.win/get?url=${encodeURIComponent(url)}`,
        parseResponse: async (res: Response) => {
            const json = await res.json();
            return json.contents;
        }
    },
    {
        name: 'corsproxy.io',
        getUrl: (url: string) => `https://corsproxy.io/?${encodeURIComponent(url)}`,
        parseResponse: async (res: Response) => res.text()
    },
    {
        name: 'codetabs',
        getUrl: (url: string) => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(url)}`,
        parseResponse: async (res: Response) => res.text()
    },
];

// Hata tipi
export class BrochureFetchError extends Error {
    constructor(message: string, public readonly market: string) {
        super(message);
        this.name = 'BrochureFetchError';
    }
}

/**
 * CORS proxy ile URL fetch et
 */
async function fetchWithCorsProxy(url: string): Promise<string> {
    let lastError: Error | null = null;

    for (const proxy of CORS_PROXIES) {
        try {
            console.log(`🔄 ${proxy.name} proxy deneniyor...`);
            const proxyUrl = proxy.getUrl(url);

            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 15000);

            const response = await fetch(proxyUrl, {
                signal: controller.signal,
                headers: { 'Accept': 'application/json, text/html, */*' }
            });

            clearTimeout(timeoutId);

            if (!response.ok) {
                console.warn(`${proxy.name}: HTTP ${response.status}`);
                continue;
            }

            const html = await proxy.parseResponse(response);
            if (html && html.length > 100) {
                console.log(`✅ ${proxy.name} başarılı`);
                return html;
            }
        } catch (error: any) {
            console.warn(`${proxy.name} hatası:`, error.message);
            lastError = error;
        }

        // Proxy'ler arası bekleme
        await new Promise(r => setTimeout(r, 500));
    }

    throw lastError || new Error('Tüm proxy\'ler başarısız oldu');
}

/**
 * Akakce ana sayfasından broşür linklerini parse et
 */
function parseBrochureLinks(html: string, marketSlug: string): string[] {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    const links: string[] = [];
    const seenLinks = new Set<string>();

    // Broşür linklerini bul
    doc.querySelectorAll('a[href*="/brosurler/"]').forEach((el) => {
        const href = el.getAttribute('href');
        if (href && href.includes(marketSlug) && href.includes('aktuel')) {
            const fullUrl = href.startsWith('http') ? href : `https://www.akakce.com${href}`;
            if (!seenLinks.has(fullUrl)) {
                seenLinks.add(fullUrl);
                links.push(fullUrl);
            }
        }
    });

    // En güncel 3 broşürü al
    return links.slice(0, 3);
}

/**
 * Broşür detay sayfasından görsel URL'lerini parse et
 */
function parseBrochureImages(html: string): string[] {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    const images: string[] = [];
    const seenImages = new Set<string>();

    // .bpg .p img seçicisi ile yüksek kalite görseller
    doc.querySelectorAll('.bpg .p img, .bpg img, img[src*="cdn.akakce.com/_bro"]').forEach((el) => {
        const src = el.getAttribute('src');
        if (src && src.includes('cdn.akakce.com') && !seenImages.has(src)) {
            seenImages.add(src);
            images.push(src);
        }
    });

    // Fallback: data-src attribute
    if (images.length === 0) {
        doc.querySelectorAll('img[data-src*="cdn.akakce.com"]').forEach((el) => {
            const src = el.getAttribute('data-src');
            if (src && !seenImages.has(src)) {
                seenImages.add(src);
                images.push(src);
            }
        });
    }

    return images;
}

/**
 * Belirtilen marketten aktüel görsellerini çeker
 * @param marketId Market ID (bim, a101, sok)
 * @param onProgress İlerleme callback
 * @returns Görsel URL'lerinin listesi
 */
export async function fetchBrochuresFromAkakce(
    marketId: MarketId,
    onProgress?: (step: string) => void
): Promise<string[]> {
    const market = SUPPORTED_MARKETS.find(m => m.id === marketId);
    if (!market) {
        throw new BrochureFetchError(`Desteklenmeyen market: ${marketId}`, marketId);
    }

    console.log(`📰 ${market.name} aktüelleri çekiliyor...`);

    try {
        // 1. Market ana sayfasını çek
        onProgress?.(`${market.name} sayfası yükleniyor...`);
        const marketUrl = `https://www.akakce.com/brosurler/${market.akakceSlug}`;
        const listHtml = await fetchWithCorsProxy(marketUrl);

        // 2. Broşür linklerini parse et
        const brochureLinks = parseBrochureLinks(listHtml, market.akakceSlug);
        console.log(`📋 ${brochureLinks.length} broşür linki bulundu`);

        if (brochureLinks.length === 0) {
            throw new BrochureFetchError(`${market.name} için broşür bulunamadı`, marketId);
        }

        // 3. Her broşürden görselleri çek
        const allImages: string[] = [];

        for (let i = 0; i < brochureLinks.length; i++) {
            const link = brochureLinks[i];
            onProgress?.(`Broşür ${i + 1}/${brochureLinks.length} yükleniyor...`);

            try {
                // Rate limiting
                await new Promise(r => setTimeout(r, 1000));

                const brochureHtml = await fetchWithCorsProxy(link);
                const images = parseBrochureImages(brochureHtml);
                allImages.push(...images);

                console.log(`   Broşür ${i + 1}: ${images.length} görsel`);

                // Max 30 görsel
                if (allImages.length >= 30) break;
            } catch (error) {
                console.warn(`Broşür çekilemedi: ${link}`);
            }
        }

        // Duplicate'ları kaldır
        const uniqueImages = [...new Set(allImages)];
        console.log(`✅ ${market.name}: Toplam ${uniqueImages.length} benzersiz görsel`);

        return uniqueImages;
    } catch (error: any) {
        if (error instanceof BrochureFetchError) {
            throw error;
        }
        throw new BrochureFetchError(
            error.message || 'Aktüeller çekilirken hata oluştu',
            marketId
        );
    }
}

/**
 * Birden fazla marketten aktüel çeker
 */
export async function fetchAllMarketBrochures(
    marketIds: MarketId[] = ['bim', 'a101', 'sok'],
    onProgress?: (market: MarketId, status: 'fetching' | 'done' | 'error', count?: number) => void
): Promise<Record<MarketId, string[]>> {
    const results: Record<string, string[]> = {};

    for (const marketId of marketIds) {
        try {
            onProgress?.(marketId, 'fetching');
            const images = await fetchBrochuresFromAkakce(marketId);
            results[marketId] = images;
            onProgress?.(marketId, 'done', images.length);
        } catch (error) {
            console.error(`${marketId} aktüelleri çekilemedi:`, error);
            results[marketId] = [];
            onProgress?.(marketId, 'error');
        }

        // Marketler arası bekleme
        await new Promise(r => setTimeout(r, 1000));
    }

    return results as Record<MarketId, string[]>;
}

/**
 * Market için renk döndür
 */
export function getMarketColor(marketId: MarketId): string {
    return SUPPORTED_MARKETS.find(m => m.id === marketId)?.color || '#666';
}

/**
 * Market için isim döndür
 */
export function getMarketName(marketId: MarketId): string {
    return SUPPORTED_MARKETS.find(m => m.id === marketId)?.name || marketId.toUpperCase();
}
