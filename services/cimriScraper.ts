// Cimri.com Scraper Service
// İndirimli ürünleri çekmek için kullanılır

export interface CimriProduct {
    id: string;
    title: string;
    price: number;
    oldPrice: number;
    discount: string;
    imageUrl: string;
    productLink: string;
    source: 'cimri';
}

// CORS proxy'leri
const CORS_PROXIES = [
    (url: string) => `https://api.allorigins.win/get?url=${encodeURIComponent(url)}&_t=${Date.now()}`,
    (url: string) => `https://corsproxy.io/?${encodeURIComponent(url)}`,
    (url: string) => `https://api.cors.lol/?url=${encodeURIComponent(url)}`,
];

async function fetchWithProxy(targetUrl: string): Promise<string> {
    for (const proxyFn of CORS_PROXIES) {
        try {
            const proxyUrl = proxyFn(targetUrl);
            const response = await fetch(proxyUrl, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                }
            });

            if (!response.ok) continue;

            const contentType = response.headers.get('content-type') || '';
            let html = '';

            if (contentType.includes('application/json')) {
                const json = await response.json();
                html = json.contents || json.body || '';
            } else {
                html = await response.text();
            }

            if (html && html.length > 1000) {
                return html;
            }
        } catch (error) {
            console.warn('Proxy hatası:', error);
            continue;
        }
    }
    throw new Error('Tüm proxy\'ler başarısız oldu');
}

// Fiyat stringini number'a çevir
function parsePrice(priceStr: string): number {
    if (!priceStr) return 0;
    // "1.234,56 TL" veya "1234.56 TL" formatını parse et
    const cleaned = priceStr
        .replace(/[^\d.,]/g, '')  // Sadece rakam, nokta ve virgül bırak
        .replace(/\./g, '')       // Binlik ayraçları kaldır
        .replace(',', '.');       // Virgülü noktaya çevir
    return parseFloat(cleaned) || 0;
}

// HTML'den ürünleri parse et
function parseProducts(html: string): CimriProduct[] {
    const products: CimriProduct[] = [];

    // Basit regex ile ürün bilgilerini çek
    // Not: Gerçek scraper için DOM parser kullanılmalı

    // Ürün kartlarını bul - ana pattern
    const cardPattern = /<a[^>]*class="[^"]*SGuZK[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
    let match;
    let index = 0;

    while ((match = cardPattern.exec(html)) !== null && index < 30) {
        try {
            const link = match[1];
            const cardHtml = match[2];

            // Başlık
            const titleMatch = cardHtml.match(/<h3[^>]*>([^<]+)<\/h3>/i);
            const title = titleMatch ? titleMatch[1].trim() : '';

            // Görsel
            const imgMatch = cardHtml.match(/<img[^>]*class="[^"]*p2aw_[^"]*"[^>]*src="([^"]+)"/i) ||
                cardHtml.match(/<img[^>]*src="([^"]+)"/i);
            const imageUrl = imgMatch ? imgMatch[1] : '';

            // İndirim oranı
            const discountMatch = cardHtml.match(/<span[^>]*class="[^"]*DWR_r[^"]*"[^>]*>([^<]+)<\/span>/i) ||
                cardHtml.match(/%\s*(\d+)/);
            const discount = discountMatch ? discountMatch[1].trim() : '';

            if (title && link) {
                // Fiyatları ana container'dan ara
                const fullLink = link.startsWith('http') ? link : `https://www.cimri.com${link}`;

                products.push({
                    id: `cimri_${Date.now()}_${index}`,
                    title: title,
                    price: 0, // Fiyat ayrı parse edilecek
                    oldPrice: 0,
                    discount: discount,
                    imageUrl: imageUrl,
                    productLink: fullLink,
                    source: 'cimri'
                });
                index++;
            }
        } catch (e) {
            console.warn('Parse hatası:', e);
        }
    }

    // Fiyatları bul - ayrı pattern (class bazlı)
    const pricePattern = /<span[^>]*class="[^"]*h1Anp[^"]*gN9lq[^"]*"[^>]*>([^<]+)<\/span>/gi;
    const oldPricePattern = /<span[^>]*class="[^"]*fvt5M[^"]*XFpik[^"]*"[^>]*>([^<]+)<\/span>/gi;

    let priceMatch;
    let priceIndex = 0;
    while ((priceMatch = pricePattern.exec(html)) !== null && priceIndex < products.length) {
        products[priceIndex].price = parsePrice(priceMatch[1]);
        priceIndex++;
    }

    let oldPriceMatch;
    let oldPriceIndex = 0;
    while ((oldPriceMatch = oldPricePattern.exec(html)) !== null && oldPriceIndex < products.length) {
        products[oldPriceIndex].oldPrice = parsePrice(oldPriceMatch[1]);
        oldPriceIndex++;
    }

    return products.filter(p => p.title && p.productLink);
}

// Ana fetch fonksiyonu
export async function fetchFromCimri(page: number = 1): Promise<CimriProduct[]> {
    try {
        const url = `https://www.cimri.com/indirimli-urunler${page > 1 ? `?page=${page}` : ''}`;
        console.log(`🔄 Cimri'den veri çekiliyor: ${url}`);

        const html = await fetchWithProxy(url);

        if (!html || html.length < 1000) {
            console.warn('Cimri\'den yeterli veri alınamadı');
            return [];
        }

        const products = parseProducts(html);
        console.log(`✅ Cimri'den ${products.length} ürün çekildi`);

        return products;
    } catch (error) {
        console.error('Cimri fetch hatası:', error);
        throw error;
    }
}

// Cache
let cimriCache: CimriProduct[] = [];
let cimriCacheTime = 0;
const CACHE_DURATION = 5 * 60 * 1000; // 5 dakika

export async function getCimriDeals(forceRefresh: boolean = false): Promise<CimriProduct[]> {
    const now = Date.now();

    if (!forceRefresh && cimriCache.length > 0 && (now - cimriCacheTime) < CACHE_DURATION) {
        console.log('📦 Cimri cache\'den döndürülüyor');
        return cimriCache;
    }

    const products = await fetchFromCimri(1);
    cimriCache = products;
    cimriCacheTime = now;

    return products;
}

export function clearCimriCache(): void {
    cimriCache = [];
    cimriCacheTime = 0;
}
