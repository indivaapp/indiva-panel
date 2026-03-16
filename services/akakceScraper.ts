/**
 * Akakce Scraper Service
 * Vercel API üzerinden Akakce "Fark Atan Fiyatlar" verilerini çeker
 */

export interface AkakceProduct {
    title: string;
    akakceUrl: string;
    category?: string;
    fetchedAt: Date;
}

// Vercel API endpoint
const VERCEL_API_URL = 'https://indiva-proxy.vercel.app/api/akakce-deals';

/**
 * Akakce "Fark Atan Fiyatlar" sayfasından ürünleri çeker
 */
export async function fetchAkakceDeals(
    onProgress?: (step: string) => void
): Promise<AkakceProduct[]> {
    console.log('📰 Akakce fırsatları çekiliyor...');
    onProgress?.('Akakce sayfası yükleniyor...');

    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 30000);

        const response = await fetch(VERCEL_API_URL, {
            signal: controller.signal,
            headers: { 'Accept': 'application/json' }
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        const data = await response.json();

        if (!data.success) {
            throw new Error(data.error || 'Veri çekilemedi');
        }

        onProgress?.('Ürünler işleniyor...');

        const now = new Date();
        const products: AkakceProduct[] = data.products.map((p: any) => ({
            title: p.title,
            akakceUrl: p.akakceUrl,
            category: p.category,
            fetchedAt: now,
        }));

        console.log(`✅ ${products.length} ürün bulundu`);
        onProgress?.(`${products.length} ürün bulundu`);

        return products;
    } catch (error: any) {
        console.error('Akakce fetch hatası:', error);
        throw new Error(`Akakce verileri çekilemedi: ${error.message}`);
    }
}
