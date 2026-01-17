
import type { Discount } from '../types';
import { uploadToImgbb } from './imgbb';

// ===== CACHE SİSTEMİ =====
// Gereksiz istekleri azaltmak için memory cache (10 dakika TTL)

interface CacheEntry<T> {
    data: T;
    timestamp: number;
    expiresAt: number;
}

const dealCache = new Map<string, CacheEntry<ScrapedDeal[]>>();
const CACHE_DURATION = 10 * 60 * 1000; // 10 dakika

/**
 * Cache'den veri al veya yeni veri çek
 */
function getCachedData(key: string): ScrapedDeal[] | null {
    const cached = dealCache.get(key);
    if (cached && Date.now() < cached.expiresAt) {
        console.log(`📦 Cache'den ${cached.data.length} fırsat döndürülüyor (${key})`);
        return cached.data;
    }
    // Süresi dolmuş cache'i temizle
    if (cached) {
        dealCache.delete(key);
    }
    return null;
}

/**
 * Veriyi cache'e kaydet
 */
function setCacheData(key: string, data: ScrapedDeal[]): void {
    const now = Date.now();
    dealCache.set(key, {
        data,
        timestamp: now,
        expiresAt: now + CACHE_DURATION
    });
    console.log(`💾 ${data.length} fırsat cache'lendi (${key})`);
}

/**
 * Cache'i temizle (manuel yenileme için)
 */
export function clearDealCache(): void {
    dealCache.clear();
    console.log('🗑️ Cache temizlendi');
}

// ===== RATE LIMITING =====
// IP engellemesini önlemek için istekler arası bekleme

let lastRequestTime = 0;
const MIN_REQUEST_INTERVAL = 2000; // 2 saniye minimum bekleme

/**
 * Rate limiting ile bekleme
 */
async function waitForRateLimit(): Promise<void> {
    const now = Date.now();
    const timeSinceLastRequest = now - lastRequestTime;

    if (timeSinceLastRequest < MIN_REQUEST_INTERVAL) {
        const waitTime = MIN_REQUEST_INTERVAL - timeSinceLastRequest;
        console.log(`⏳ Rate limit: ${waitTime}ms bekleniyor...`);
        await new Promise(r => setTimeout(r, waitTime));
    }

    lastRequestTime = Date.now();
}

// ===== IP ENGELLEME TESPİTİ =====

interface BlockedError extends Error {
    isIPBlocked: boolean;
    retryAfter?: number;
}

/**
 * Yanıtın IP engelleme olup olmadığını kontrol et
 */
function isBlockedResponse(status: number, content?: string): boolean {
    // HTTP 403 (Forbidden) veya 429 (Too Many Requests)
    if (status === 403 || status === 429) return true;

    // İçerikte engelleme işaretleri
    if (content) {
        const blockedIndicators = [
            'captcha',
            'blocked',
            'rate limit',
            'too many requests',
            'access denied',
            'forbidden'
        ];
        const lowerContent = content.toLowerCase();
        return blockedIndicators.some(indicator => lowerContent.includes(indicator));
    }

    return false;
}

/**
 * IP engelleme hatası oluştur
 */
function createBlockedError(message: string, retryAfter?: number): BlockedError {
    const error = new Error(message) as BlockedError;
    error.isIPBlocked = true;
    error.retryAfter = retryAfter;
    return error;
}

// OnuAl'dan çekilen ham indirim verisi
export interface ScrapedDeal {
    id: string;
    title: string;
    price: number;
    source: 'amazon' | 'trendyol' | 'hepsiburada' | 'n11' | 'other';
    onualLink: string;
    productLink?: string;
    couponCode?: string;
    imageUrl?: string;
    scrapedAt: Date;
    postedAt?: Date; // Telegram mesajının paylaşıldığı tarih
    channelName?: string; // Hangi kanaldan geldiği
}

// ===== TELEGRAM KANALLARI =====

export interface TelegramChannel {
    id: string;
    name: string;
    username: string;
    url: string;
    color: string;
    icon: string;
}

// Desteklenen Telegram kanalları
// Yeni kanal eklemek için: id, name, username, url, color, icon alanlarını doldurun
export const TELEGRAM_CHANNELS: TelegramChannel[] = [
    {
        id: 'onual',
        name: 'OnuAl',
        username: 'onual_firsat',
        url: 'https://t.me/s/onual_firsat',
        color: 'bg-purple-600',
        icon: '🛍️'
    },
    // Yeni public kanallar bulunduğunda buraya eklenebilir:
    // {
    //     id: 'kanal_id',
    //     name: 'Kanal Adı',
    //     username: 'telegram_username',
    //     url: 'https://t.me/s/telegram_username',
    //     color: 'bg-green-600',
    //     icon: '💰'
    // },
];

// Varsayılan kanal
const DEFAULT_CHANNEL = TELEGRAM_CHANNELS[0];

// 2. CORS Proxy'ler (Yedek - Telegram başarısız olursa)
// Sıralama önemli: En güvenilir olanlar önce
const CORS_PROXIES = [
    (url: string) => `https://api.allorigins.win/get?url=${encodeURIComponent(url)}`,
    (url: string) => `https://corsproxy.io/?${encodeURIComponent(url)}`,
    (url: string) => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(url)}`,
    (url: string) => `https://corsproxy.org/?${encodeURIComponent(url)}`,
    (url: string) => `https://thingproxy.freeboard.io/fetch/${url}`,
    (url: string) => `https://api.cors.lol/?url=${encodeURIComponent(url)}`,
];

// Son başarılı proxy index'i (akıllı seçim için)
let lastSuccessfulProxyIndex = 0;

// 3. Vercel Proxy (Son yedek)
const VERCEL_PROXY_URL = 'https://indiva-proxy.vercel.app/api/scrape';


/**
 * Timeout ile fetch
 */
async function fetchWithTimeout(url: string, options: RequestInit = {}, timeout = 20000): Promise<Response> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
        const response = await fetch(url, {
            ...options,
            signal: controller.signal
        });
        return response;
    } finally {
        clearTimeout(timeoutId);
    }
}

/**
 * CORS proxy üzerinden URL fetch et (geliştirilmiş fallback + retry)
 */
async function fetchWithProxy(targetUrl: string, retryCount = 0): Promise<string> {
    let lastError: Error | null = null;
    const errors: string[] = [];
    const maxRetries = 2;

    // Önce Vercel proxy'yi dene (action=list için)
    if (targetUrl.includes('onual.com/fiyat/') && retryCount === 0) {
        try {
            // Cache busting için timestamp ekle
            const timestamp = Date.now();
            const vercelUrl = `${VERCEL_PROXY_URL}?action=list&_t=${timestamp}`;
            console.log('Vercel proxy deneniyor...');

            const response = await fetchWithTimeout(vercelUrl, {
                headers: {
                    'Accept': 'application/json',
                    'Cache-Control': 'no-cache',
                }
            }, 30000); // Daha uzun timeout

            if (response.ok) {
                const json = await response.json();
                if (json.success && json.deals && json.deals.length > 0) {
                    console.log(`Vercel proxy başarılı: ${json.deals.length} fırsat`);
                    return JSON.stringify(json);
                }
            } else {
                console.log(`Vercel proxy HTTP ${response.status}, CORS proxy'lere geçiliyor...`);
            }
        } catch (e: any) {
            console.log('Vercel proxy hatası:', e.message);
        }
    }


    for (let i = 0; i < CORS_PROXIES.length; i++) {
        const proxyFn = CORS_PROXIES[i];
        const proxyUrl = proxyFn(targetUrl);

        try {
            const response = await fetchWithTimeout(proxyUrl, {
                headers: {
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                },
            }, 20000);

            if (response.ok) {
                const data = await response.text();

                // allorigins.win JSON olarak dönüyor
                if (proxyUrl.includes('allorigins.win/get')) {
                    try {
                        const json = JSON.parse(data);
                        if (json.contents && json.contents.length > 500) {
                            console.log(`Proxy ${i + 1} (allorigins) başarılı`);
                            return json.contents;
                        }
                    } catch {
                        // JSON değilse devam et
                    }
                }

                // cors.lol JSON wrapper kullanıyor
                if (proxyUrl.includes('cors.lol')) {
                    try {
                        const json = JSON.parse(data);
                        if (json.body && json.body.length > 500) {
                            console.log(`Proxy ${i + 1} (cors.lol) başarılı`);
                            return json.body;
                        }
                    } catch {
                        // JSON değilse direkt kullan
                    }
                }

                // Diğer proxy'ler direkt HTML dönüyor
                if (data && data.length > 500) {
                    console.log(`Proxy ${i + 1} başarılı`);
                    return data;
                }
            }

            errors.push(`Proxy ${i + 1}: HTTP ${response.status}`);
        } catch (error: any) {
            const errorMsg = error.name === 'AbortError' ? 'Timeout' : error.message;
            errors.push(`Proxy ${i + 1}: ${errorMsg}`);
            lastError = error;
        }

        // Rate limit'ten kaçınmak için kısa bekleme
        if (i < CORS_PROXIES.length - 1) {
            await new Promise(r => setTimeout(r, 300));
        }
    }

    // Tüm proxy'ler başarısız olduysa, bir kez daha dene
    if (retryCount < maxRetries) {
        console.log(`Retry ${retryCount + 1}/${maxRetries}...`);
        await new Promise(r => setTimeout(r, 1000));
        return fetchWithProxy(targetUrl, retryCount + 1);
    }

    console.error('Tüm proxy denemeleri başarısız:', errors);
    throw lastError || new Error('Tüm proxy servisleri başarısız oldu. Lütfen birkaç dakika sonra tekrar deneyin.');
}

// ===== ONU.AL LİNK ÇÖZÜMLEME =====
// Kısa linkleri gerçek ürün linklerine çevirir

// Link çözümleme cache'i (session boyunca sakla)
const resolvedLinksCache = new Map<string, string>();

/**
 * onu.al kısa linkini gerçek ürün linkine çözümle
 * 2 adımlı çözümleme: onu.al → onual.com/fiyat/... → gerçek mağaza linki
 * @export - DealFinder bileşeninden çağrılır
 */
export async function resolveOnuAlLink(shortLink: string): Promise<string> {
    // Cache kontrolü
    if (resolvedLinksCache.has(shortLink)) {
        console.log(`📋 Cache'den link: ${resolvedLinksCache.get(shortLink)!.substring(0, 50)}...`);
        return resolvedLinksCache.get(shortLink)!;
    }

    // onu.al linki değilse direkt döndür
    if (!shortLink.includes('onu.al')) {
        return shortLink;
    }

    console.log(`🔗 Link çözümleniyor: ${shortLink}`);

    try {
        // ADIM 1: onu.al kısa linkinden onual.com/fiyat/... ara sayfasını al
        const proxyUrl = `https://api.allorigins.win/get?url=${encodeURIComponent(shortLink)}`;

        const response = await fetchWithTimeout(proxyUrl, {
            headers: { 'Accept': 'application/json' }
        }, 10000);

        if (!response.ok) {
            console.warn(`Link çözümleme başarısız: ${shortLink}`);
            return shortLink;
        }

        const json = await response.json();
        const html = json.contents || '';

        // ADIM 2: Ara sayfadan (onual.com/fiyat/...) gerçek mağaza linkini çıkar
        // OnuAl sitesi "Kampanyaya Git" veya "Ürüne Git" butonunda id="buton" kullanıyor

        // 1. id="buton" elementinden linki çıkar (en güvenilir yöntem)
        const butonIdMatch = html.match(/id=["']buton["'][^>]*href=["']([^"']+)["']/i) ||
            html.match(/href=["']([^"']+)["'][^>]*id=["']buton["']/i);
        if (butonIdMatch) {
            const rawUrl = butonIdMatch[1];
            const storeUrl = extractFinalUrl(rawUrl); // Redirect URL'yi decode et
            if (isProductUrl(rawUrl)) {
                console.log(`✅ id="buton" ile çözümlendi: ${storeUrl.substring(0, 50)}...`);
                resolvedLinksCache.set(shortLink, storeUrl);
                return storeUrl;
            }
        }

        // 2. class içinde "btn" ve href içinde mağaza linki olan butonu ara
        const btnClassMatch = html.match(/class=["'][^"']*btn[^"']*["'][^>]*href=["']([^"']+)["']/gi);
        if (btnClassMatch) {
            for (const match of btnClassMatch) {
                const hrefMatch = match.match(/href=["']([^"']+)["']/i);
                if (hrefMatch && isProductUrl(hrefMatch[1])) {
                    const storeUrl = extractFinalUrl(hrefMatch[1]);
                    console.log(`✅ class="btn" ile çözümlendi: ${storeUrl.substring(0, 50)}...`);
                    resolvedLinksCache.set(shortLink, storeUrl);
                    return storeUrl;
                }
            }
        }

        // 3. "Kampanyaya Git" veya "Ürüne Git" metnini içeren linkler
        const buttonTextMatch = html.match(/href=["']([^"']+)["'][^>]*>(?:[^<]*(?:Kampanyaya|Ürüne|İndirimi)[^<]*Git[^<]*)<\/a>/gi);
        if (buttonTextMatch) {
            for (const match of buttonTextMatch) {
                const hrefMatch = match.match(/href=["']([^"']+)["']/i);
                if (hrefMatch && isProductUrl(hrefMatch[1])) {
                    console.log(`✅ Buton metni ile çözümlendi: ${hrefMatch[1].substring(0, 50)}...`);
                    resolvedLinksCache.set(shortLink, hrefMatch[1]);
                    return hrefMatch[1];
                }
            }
        }

        // 4. Bilinen mağaza domain'lerini içeren herhangi bir href
        const storePatterns = [
            /href=["'](https?:\/\/[^"']*(?:sl\.n11\.com|n11\.com\/urun)[^"']*)["']/gi,
            /href=["'](https?:\/\/[^"']*(?:ty\.gl|trendyol\.com\/[^"']*-p-)[^"']*)["']/gi,
            /href=["'](https?:\/\/[^"']*(?:app\.hb\.biz|hepsiburada\.com)[^"']*)["']/gi,
            /href=["'](https?:\/\/[^"']*amazon\.com\.tr[^"']*)["']/gi
        ];

        for (const pattern of storePatterns) {
            const matches = html.matchAll(pattern);
            for (const match of matches) {
                const storeUrl = match[1];
                // onu.al linklerini atla
                if (!storeUrl.includes('onu.al') && !storeUrl.includes('onual.com')) {
                    console.log(`✅ Mağaza pattern ile çözümlendi: ${storeUrl.substring(0, 50)}...`);
                    resolvedLinksCache.set(shortLink, storeUrl);
                    return storeUrl;
                }
            }
        }

        // 5. Son çare: meta refresh veya window.location
        const metaRefreshMatch = html.match(/url=([^"'\s>]+)/i);
        if (metaRefreshMatch && isProductUrl(metaRefreshMatch[1])) {
            console.log(`✅ Meta refresh ile çözümlendi: ${metaRefreshMatch[1].substring(0, 50)}...`);
            resolvedLinksCache.set(shortLink, metaRefreshMatch[1]);
            return metaRefreshMatch[1];
        }

        const jsRedirectMatch = html.match(/(?:window\.location|location\.href)\s*=\s*['"]([^'"]+)['"]/i);
        if (jsRedirectMatch && isProductUrl(jsRedirectMatch[1])) {
            console.log(`✅ JS redirect ile çözümlendi: ${jsRedirectMatch[1].substring(0, 50)}...`);
            resolvedLinksCache.set(shortLink, jsRedirectMatch[1]);
            return jsRedirectMatch[1];
        }

        // Çözümlenemedi, en azından onual.com linkini döndür (onu.al'dan daha iyi)
        const onualLinkMatch = html.match(/href=["'](https?:\/\/onual\.com\/fiyat\/[^"']+)["']/i);
        if (onualLinkMatch) {
            console.log(`⚠️ Sadece OnuAl linki bulundu: ${onualLinkMatch[1].substring(0, 50)}...`);
            // Bu linki de fetch edip gerçek mağaza linkini çıkarmayı dene
            return await resolveOnuAlProductPage(onualLinkMatch[1], shortLink);
        }

        console.warn(`❌ Link çözümlenemedi: ${shortLink}`);
        return shortLink;
    } catch (error) {
        console.warn(`❌ Link çözümleme hatası: ${shortLink}`, error);
        return shortLink;
    }
}

/**
 * OnuAl ürün sayfasından (onual.com/fiyat/...) gerçek mağaza linkini çıkar
 */
async function resolveOnuAlProductPage(onualPageUrl: string, originalShortLink: string): Promise<string> {
    try {
        console.log(`🔄 OnuAl ara sayfası fetch ediliyor: ${onualPageUrl.substring(0, 50)}...`);

        const proxyUrl = `https://api.allorigins.win/get?url=${encodeURIComponent(onualPageUrl)}`;
        const response = await fetchWithTimeout(proxyUrl, {
            headers: { 'Accept': 'application/json' }
        }, 10000);

        if (!response.ok) {
            return originalShortLink;
        }

        const json = await response.json();
        const html = json.contents || '';

        // id="buton" elementini ara
        const butonMatch = html.match(/id=[\"']buton[\"'][^>]*href=[\"']([^\"']+)[\"']/i) ||
            html.match(/href=[\"']([^\"']+)[\"'][^>]*id=[\"']buton[\"']/i);
        if (butonMatch && isProductUrl(butonMatch[1])) {
            const storeUrl = extractFinalUrl(butonMatch[1]);
            console.log(`✅ Ara sayfadan çözümlendi: ${storeUrl.substring(0, 50)}...`);
            resolvedLinksCache.set(originalShortLink, storeUrl);
            return storeUrl;
        }

        // class="btn" içeren mağaza linklerini ara
        const storePatterns = [
            /href=["'](https?:\/\/[^"']*(?:sl\.n11\.com|n11\.com\/urun)[^"']*)["']/gi,
            /href=["'](https?:\/\/[^"']*(?:ty\.gl|trendyol\.com)[^"']*)["']/gi,
            /href=["'](https?:\/\/[^"']*(?:app\.hb\.biz|hepsiburada\.com)[^"']*)["']/gi,
            /href=["'](https?:\/\/[^"']*amazon\.com\.tr[^"']*)["']/gi
        ];

        for (const pattern of storePatterns) {
            const matches = html.matchAll(pattern);
            for (const match of matches) {
                const storeUrl = match[1];
                if (!storeUrl.includes('onu.al') && !storeUrl.includes('onual.com')) {
                    console.log(`✅ Ara sayfadan pattern ile çözümlendi: ${storeUrl.substring(0, 50)}...`);
                    resolvedLinksCache.set(originalShortLink, storeUrl);
                    return storeUrl;
                }
            }
        }

        // OnuAl sayfasını döndür (en azından kısa linkten daha iyi)
        resolvedLinksCache.set(originalShortLink, onualPageUrl);
        return onualPageUrl;
    } catch (error) {
        console.warn(`Ara sayfa çözümleme hatası:`, error);
        return originalShortLink;
    }
}

/**
 * URL'in gerçek bir ürün linki olup olmadığını kontrol et
 * zxro.com gibi redirect servisleri de tanır
 */
function isProductUrl(url: string): boolean {
    if (!url || url.length < 10) return false;

    const productDomains = ['amazon', 'trendyol', 'hepsiburada', 'n11.com', 'hb.biz', 'ty.gl', 'sl.n11'];
    const redirectServices = ['zxro.com'];

    const lowerUrl = url.toLowerCase();

    // Direkt ürün linki mi?
    if (productDomains.some(domain => lowerUrl.includes(domain))) {
        return true;
    }

    // Redirect servisi mi? (içinde gerçek ürün linki var mı kontrol et)
    if (redirectServices.some(service => lowerUrl.includes(service))) {
        // URL parametresinden gerçek linki çıkarmayı dene
        const finalUrl = extractFinalUrl(url);
        return productDomains.some(domain => finalUrl.toLowerCase().includes(domain));
    }

    return false;
}

/**
 * Redirect servislerinden (zxro.com vb.) gerçek mağaza linkini çıkar
 */
function extractFinalUrl(url: string): string {
    if (!url) return url;

    try {
        // zxro.com/u/?redirect=1&url=ENCODED_URL formatı
        if (url.includes('zxro.com')) {
            const urlObj = new URL(url);
            const encodedUrl = urlObj.searchParams.get('url');
            if (encodedUrl) {
                const decoded = decodeURIComponent(encodedUrl);
                console.log(`🔓 zxro.com URL decode edildi: ${decoded.substring(0, 50)}...`);
                return decoded;
            }
        }

        // Genel redirect pattern: ?url= veya ?redirect_url=
        if (url.includes('url=')) {
            const match = url.match(/[?&](?:url|redirect_url|goto)=([^&]+)/i);
            if (match) {
                const decoded = decodeURIComponent(match[1]);
                return decoded;
            }
        }
    } catch (e) {
        console.warn('URL decode hatası:', e);
    }

    return url;
}

/**
 * Birden fazla linki paralel olarak çözümle (max 5 aynı anda)
 */
async function resolveLinksInBatch(deals: ScrapedDeal[]): Promise<ScrapedDeal[]> {
    console.log(`🔗 ${deals.length} ürün linki çözümleniyor...`);

    // Paralel işlem için batch'lere böl (5'erli)
    const batchSize = 5;
    const resolvedDeals = [...deals];

    for (let i = 0; i < deals.length; i += batchSize) {
        const batch = deals.slice(i, i + batchSize);

        await Promise.all(batch.map(async (deal, idx) => {
            const originalIndex = i + idx;
            const shortLink = deal.onualLink || deal.productLink || '';

            if (shortLink.includes('onu.al')) {
                const resolvedLink = await resolveOnuAlLink(shortLink);
                if (resolvedLink !== shortLink) {
                    resolvedDeals[originalIndex] = {
                        ...resolvedDeals[originalIndex],
                        productLink: resolvedLink
                    };
                }
            }
        }));

        // Batch'ler arası kısa bekleme
        if (i + batchSize < deals.length) {
            await new Promise(r => setTimeout(r, 200));
        }
    }

    const resolvedCount = resolvedDeals.filter(d => d.productLink && !d.productLink.includes('onu.al')).length;
    console.log(`✅ ${resolvedCount}/${deals.length} link çözümlendi`);

    return resolvedDeals;
}

/**
 * Telegram kanalından fırsatları çek (BİRİNCİL KAYNAK - Bot koruması yok!)
 * Çoklu proxy fallback, cache ve rate limiting desteği ile
 * @param channel - Çekilecek Telegram kanalı (varsayılan: OnuAl)
 * @param forceRefresh - Cache'i atla ve yeni veri çek
 */
export async function fetchFromTelegram(channel: TelegramChannel = TELEGRAM_CHANNELS[0], forceRefresh = false): Promise<ScrapedDeal[]> {
    const cacheKey = `telegram_${channel.id}`;

    // 1. Cache kontrolü (forceRefresh değilse)
    if (!forceRefresh) {
        const cachedDeals = getCachedData(cacheKey);
        if (cachedDeals) {
            return cachedDeals;
        }
    }

    console.log(`📱 ${channel.name} kanalından veri çekiliyor...`);

    // 2. Rate limiting uygula
    await waitForRateLimit();

    // 3. Telegram için kullanılacak proxy'ler (sırayla denenir)
    const telegramProxies = [
        {
            name: 'allorigins',
            url: `https://api.allorigins.win/get?url=${encodeURIComponent(channel.url)}`,
            parseResponse: async (res: Response) => {
                const json = await res.json();
                return json.contents;
            }
        },
        {
            name: 'corsproxy.io',
            url: `https://corsproxy.io/?${encodeURIComponent(channel.url)}`,
            parseResponse: async (res: Response) => res.text()
        },
        {
            name: 'codetabs',
            url: `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(channel.url)}`,
            parseResponse: async (res: Response) => res.text()
        },
        {
            name: 'corsproxy.org',
            url: `https://corsproxy.org/?${encodeURIComponent(channel.url)}`,
            parseResponse: async (res: Response) => res.text()
        }
    ];

    // Son başarılı proxy'yi öne al (akıllı seçim)
    if (lastSuccessfulProxyIndex > 0 && lastSuccessfulProxyIndex < telegramProxies.length) {
        const successfulProxy = telegramProxies[lastSuccessfulProxyIndex];
        telegramProxies.splice(lastSuccessfulProxyIndex, 1);
        telegramProxies.unshift(successfulProxy);
        console.log(`🎯 Son başarılı proxy öncelikli: ${successfulProxy.name}`);
    }

    let lastError: Error | null = null;
    const errors: string[] = [];

    // 4. Her proxy'yi sırayla dene
    for (let i = 0; i < telegramProxies.length; i++) {
        const proxy = telegramProxies[i];

        try {
            console.log(`🔄 Proxy ${i + 1}/${telegramProxies.length} (${proxy.name}) deneniyor...`);

            const response = await fetchWithTimeout(proxy.url, {
                headers: {
                    'Accept': 'application/json, text/html, */*',
                }
            }, 15000);

            // IP engelleme kontrolü
            if (isBlockedResponse(response.status)) {
                const errorMsg = `Proxy ${proxy.name}: IP engellendi (HTTP ${response.status})`;
                console.warn(`⚠️ ${errorMsg}`);
                errors.push(errorMsg);

                // Bir sonraki proxy'e geçmeden önce biraz bekle
                await new Promise(r => setTimeout(r, 1000));
                continue;
            }

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }

            const html = await proxy.parseResponse(response);

            if (!html || html.length < 500) {
                throw new Error('İçerik çok kısa veya boş');
            }

            // İçerikte engelleme işareti var mı kontrol et
            if (isBlockedResponse(response.status, html)) {
                console.warn(`⚠️ Proxy ${proxy.name}: İçerikte engelleme tespit edildi`);
                errors.push(`Proxy ${proxy.name}: İçerikte engelleme tespit edildi`);
                continue;
            }

            // Başarılı! HTML'i parse et
            const deals = parseTelegramHtml(html);

            if (deals.length === 0) {
                console.warn(`⚠️ Proxy ${proxy.name}: Fırsat bulunamadı, sonraki proxy deneniyor...`);
                continue;
            }

            // Her deal'e kanal bilgisi ekle
            const dealsWithChannel = deals.map(deal => ({
                ...deal,
                channelName: channel.name
            }));

            // 5. Başarılı sonucu cache'le (linkler henüz çözümlenmemiş olabilir)
            // Link çözümleme UI tarafında lazy olarak yapılacak
            setCacheData(cacheKey, dealsWithChannel);

            // Başarılı proxy'yi hatırla
            lastSuccessfulProxyIndex = i;

            console.log(`✅ Proxy ${proxy.name} başarılı: ${deals.length} fırsat`);
            return dealsWithChannel;

        } catch (error: any) {
            const errorMsg = error.name === 'AbortError'
                ? `Proxy ${proxy.name}: Timeout`
                : `Proxy ${proxy.name}: ${error.message}`;

            console.warn(`⚠️ ${errorMsg}`);
            errors.push(errorMsg);
            lastError = error;
        }

        // Proxy'ler arası bekleme (rate limiting)
        if (i < telegramProxies.length - 1) {
            await new Promise(r => setTimeout(r, 500));
        }
    }

    // 6. Tüm proxy'ler başarısız oldu
    console.error('❌ Tüm proxy denemeleri başarısız:', errors);

    // IP engelleme tespit edildiyse özel hata döndür
    if (errors.some(e => e.includes('engellen'))) {
        throw createBlockedError(
            '⚠️ IP engelleme tespit edildi. Lütfen 5-10 dakika bekleyip tekrar deneyin veya VPN kullanın.',
            300000 // 5 dakika
        );
    }

    throw lastError || new Error('Tüm proxy servisleri başarısız oldu. Lütfen birkaç dakika sonra tekrar deneyin.');
}


/**
 * Telegram HTML'ini parse ederek fırsat listesi çıkarır
 */
function parseTelegramHtml(html: string): ScrapedDeal[] {
    const deals: ScrapedDeal[] = [];
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');

    // Tüm mesajları bul
    const messages = doc.querySelectorAll('.tgme_widget_message');
    const seenIds = new Set<string>();

    messages.forEach((msg) => {
        try {
            // Mesaj ID'si ve tarihi
            const msgLink = msg.querySelector('.tgme_widget_message_date');
            const msgHref = msgLink?.getAttribute('href') || '';
            const msgIdMatch = msgHref.match(/\/(\d+)$/);
            const msgId = msgIdMatch ? msgIdMatch[1] : `msg_${Date.now()}_${Math.random()}`;

            // Mesaj tarihini çek (datetime attribute)
            const datetimeAttr = msgLink?.getAttribute('datetime');
            let postedAt: Date | undefined;
            if (datetimeAttr) {
                postedAt = new Date(datetimeAttr);
            }

            if (seenIds.has(msgId)) return;

            // Metin içeriği
            const textEl = msg.querySelector('.tgme_widget_message_text');
            const text = textEl?.textContent?.trim() || '';

            // Ürün linki (onu.al kısa linki)
            const linkBtn = msg.querySelector('.tgme_widget_message_inline_button.url_button');
            const productLink = linkBtn?.getAttribute('href') || '';

            // Link yoksa bu bir fırsat değil, atla
            if (!productLink || !productLink.includes('onu.al')) {
                return;
            }

            // Görsel URL'si (background-image'dan)
            const photoWrap = msg.querySelector('.tgme_widget_message_photo_wrap');
            let imageUrl: string | undefined;
            if (photoWrap) {
                const style = photoWrap.getAttribute('style') || '';
                const urlMatch = style.match(/url\(['"]?([^'"]+)['"]?\)/);
                if (urlMatch) {
                    imageUrl = urlMatch[1];
                }
            }

            // Başlığı çıkar (ilk satır genellikle ürün adı)
            const lines = text.split('\n').filter(l => l.trim());
            let title = lines[0] || 'Fırsat';

            // Emojileri temizle
            title = title.replace(/^[🔥🏷️📦🛍️⭐💥🎁🛒]+\s*/, '').trim();

            // Fiyatı çıkar (🏷️ 199 TL formatında)
            let price = 0;
            const priceMatch = text.match(/🏷️?\s*(\d[\d.,]*)\s*TL/i) || text.match(/(\d[\d.,]*)\s*TL/i);
            if (priceMatch) {
                price = parseInt(priceMatch[1].replace(/[.,]/g, ''), 10);
            }

            // Kaynağı belirle
            let source: ScrapedDeal['source'] = 'other';
            const textLower = text.toLowerCase();
            if (textLower.includes('amazon') || productLink.includes('amazon')) {
                source = 'amazon';
            } else if (textLower.includes('trendyol') || productLink.includes('trendyol')) {
                source = 'trendyol';
            } else if (textLower.includes('hepsiburada') || productLink.includes('hb.biz')) {
                source = 'hepsiburada';
            } else if (textLower.includes('n11')) {
                source = 'n11';
            }

            // Kupon kodu ara
            let couponCode: string | undefined;
            const couponMatch = text.match(/kupon[:\s]+([A-Z0-9]+)/i) ||
                text.match(/kod[:\s]+([A-Z0-9]+)/i) ||
                text.match(/🎫\s*([A-Z0-9]+)/i);
            if (couponMatch) {
                couponCode = couponMatch[1];
            }

            seenIds.add(msgId);

            deals.push({
                id: msgId,
                title: title.substring(0, 200), // Max 200 karakter
                price,
                source,
                onualLink: productLink,
                productLink: productLink,
                couponCode,
                imageUrl,
                scrapedAt: new Date(),
                postedAt
            });
        } catch (err) {
            console.warn('Mesaj parse hatası:', err);
        }
    });

    // En yeni mesaj en üstte olacak şekilde sırala
    deals.sort((a, b) => {
        const dateA = a.postedAt?.getTime() || 0;
        const dateB = b.postedAt?.getTime() || 0;
        return dateB - dateA; // Azalan sıralama (en yeni en üstte)
    });

    console.log(`📱 Telegram'dan ${deals.length} fırsat bulundu (tarihe göre sıralı)`);
    return deals;
}

/**
 * Belirli bir Telegram kanalından fırsatları çeker
 * @param channelId - Kanal ID'si (TELEGRAM_CHANNELS'dan)
 * @param forceRefresh - Cache'i atla ve yeni veri çek
 */
export async function fetchDealsFromChannel(channelId: string, forceRefresh = false): Promise<ScrapedDeal[]> {
    const channel = TELEGRAM_CHANNELS.find(c => c.id === channelId);

    if (!channel) {
        throw new Error(`Kanal bulunamadı: ${channelId}`);
    }

    try {
        return await fetchFromTelegram(channel, forceRefresh);
    } catch (error: any) {
        console.error(`${channel.name} kanalından veri çekilemedi:`, error.message);

        // IP engelleme hatası mı kontrol et
        if (error.isIPBlocked) {
            throw error; // Orijinal hatayı ilet
        }

        throw new Error(`${channel.name} kanalından veri çekilemedi. Lütfen tekrar deneyin.`);
    }
}

/**
 * Tüm kanallardan fırsatları çeker ve birleştirir
 */
export async function fetchAllChannels(): Promise<ScrapedDeal[]> {
    const allDeals: ScrapedDeal[] = [];
    const errors: string[] = [];

    for (const channel of TELEGRAM_CHANNELS) {
        try {
            const deals = await fetchFromTelegram(channel);
            allDeals.push(...deals);
            console.log(`✅ ${channel.name}: ${deals.length} fırsat`);
        } catch (error: any) {
            errors.push(`${channel.name}: ${error.message}`);
            console.warn(`⚠️ ${channel.name} başarısız:`, error.message);
        }
    }

    if (allDeals.length === 0 && errors.length > 0) {
        throw new Error('Hiçbir kanaldan veri çekilemedi.');
    }

    // ID'ye göre tekrarları kaldır
    const uniqueDeals = allDeals.filter((deal, index, self) =>
        index === self.findIndex(d => d.id === deal.id)
    );

    console.log(`📊 Toplam: ${uniqueDeals.length} benzersiz fırsat`);
    return uniqueDeals;
}

/**
 * OnuAl fırsatlarını çeker - Önce Telegram, başarısız olursa website
 * @deprecated fetchDealsFromChannel kullanın
 */
export async function fetchOnualDeals(channel?: TelegramChannel): Promise<ScrapedDeal[]> {
    // Kanal belirtilmişse o kanaldan çek
    const targetChannel = channel || TELEGRAM_CHANNELS[0];

    // 1. Önce Telegram'ı dene (en güvenilir)
    try {
        const telegramDeals = await fetchFromTelegram(targetChannel);
        if (telegramDeals.length > 0) {
            return telegramDeals;
        }
    } catch (error: any) {
        console.log('Telegram başarısız:', error.message);
    }

    // 2. Yedek: OnuAl website'ı (sadece OnuAl kanalı için)
    if (targetChannel.id === 'onual') {
        console.log('🌐 Website üzerinden deneniyor...');
        const targetUrl = 'https://onual.com/fiyat/';

        try {
            const response = await fetchWithProxy(targetUrl);

            // Vercel proxy JSON döndürüyor mu kontrol et
            if (response.startsWith('{')) {
                try {
                    const json = JSON.parse(response);
                    if (json.success && json.deals && Array.isArray(json.deals)) {
                        console.log(`Vercel proxy'den ${json.deals.length} fırsat alındı`);
                        return json.deals.map((deal: any) => ({
                            ...deal,
                            scrapedAt: new Date(),
                            channelName: 'OnuAl'
                        }));
                    }
                } catch {
                    // JSON parse edilemedi, HTML olarak devam et
                }
            }

            // CORS proxy HTML döndürüyor, parse et
            const deals = parseOnualHtml(response);
            return deals.map(deal => ({ ...deal, channelName: 'OnuAl' }));
        } catch (error) {
            console.error('OnuAl verileri çekilirken hata:', error);
            throw new Error('Bağlantı hatası - Lütfen internet bağlantınızı kontrol edip tekrar deneyin.');
        }
    }


    throw new Error(`${targetChannel.name} kanalından veri çekilemedi.`);
}

/**
 * OnuAl HTML'ini parse ederek indirim listesi çıkarır
 */
function parseOnualHtml(html: string): ScrapedDeal[] {
    const deals: ScrapedDeal[] = [];

    // DOMParser kullanarak HTML'i parse et
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');

    // Ürün kartlarını bul - OnuAl'ın güncel yapısı: article.post
    const productCards = doc.querySelectorAll('article.post');

    const seenIds = new Set<string>();

    productCards.forEach((card) => {
        // Başlık ve link - h3.entry-title a içinden
        const titleLink = card.querySelector('h3.entry-title a, h3 a');
        if (!titleLink) return;

        const href = titleLink.getAttribute('href') || '';
        const title = titleLink.textContent?.trim() || '';

        // Boş başlıkları ve çok kısa olanları atla
        if (!title || title.length < 5) return;

        // Ürün ID'sini URL'den çıkar (örn: -p-1904840.html)
        const idMatch = href.match(/-p-(\d+)/);
        if (!idMatch) return;

        const productId = idMatch[1];

        // Aynı ürünü tekrar ekleme
        if (seenIds.has(productId)) return;
        seenIds.add(productId);

        // Fiyat - h4 tag'ından (🏷️ 314 TL 🤖 formatında)
        const priceElement = card.querySelector('h4');
        let price = 0;
        if (priceElement) {
            const priceText = priceElement.textContent || '';
            // Sayıları ve nokta/virgülleri çıkar (1.244 TL gibi)
            const priceMatch = priceText.match(/(\d[\d.,]*)\s*TL/i);
            if (priceMatch) {
                // Nokta ve virgülü temizle
                price = parseInt(priceMatch[1].replace(/[.,]/g, ''), 10);
            }
        }

        // URL hash'inden de fiyat bilgisini çıkarmayı dene (yedek)
        if (price === 0) {
            const hashPriceMatch = href.match(/fiyat=(\d+)/);
            if (hashPriceMatch) {
                price = parseInt(hashPriceMatch[1], 10);
            }
        }

        // Kupon kodu - URL'den veya içerikten
        const couponMatch = href.match(/kupon=([^&]+)/);
        const couponCode = couponMatch ? decodeURIComponent(couponMatch[1]) : undefined;

        // Kaynak site - span.category a içinden
        const sourceElement = card.querySelector('span.category a, .entry-meta a');
        const sourceText = sourceElement?.textContent?.toLowerCase() || card.textContent?.toLowerCase() || '';

        let source: ScrapedDeal['source'] = 'other';
        if (sourceText.includes('amazon')) {
            source = 'amazon';
        } else if (sourceText.includes('trendyol')) {
            source = 'trendyol';
        } else if (sourceText.includes('hepsiburada')) {
            source = 'hepsiburada';
        } else if (sourceText.includes('n11')) {
            source = 'n11';
        }

        // Resim URL'si - figure.post-thumbnail img
        const img = card.querySelector('figure.post-thumbnail img, .post-thumbnail img, img');
        const imageUrl = img?.getAttribute('src') || img?.getAttribute('data-src') || undefined;

        // Full URL oluştur
        const fullLink = href.startsWith('http') ? href : `https://onual.com${href}`;

        deals.push({
            id: productId,
            title: cleanTitle(title),
            price,
            source,
            onualLink: fullLink.split('#')[0], // Hash'i kaldır
            couponCode,
            imageUrl,
            scrapedAt: new Date()
        });
    });

    // Eğer article.post bulunamazsa, eski yöntemi de dene (fallback)
    if (deals.length === 0) {
        const productLinks = doc.querySelectorAll('a[href*="/fiyat/"][href*="-p-"]');

        productLinks.forEach((link) => {
            const href = link.getAttribute('href') || '';
            const title = link.textContent?.trim() || '';

            if (!title || title.length < 5) return;

            const idMatch = href.match(/-p-(\d+)/);
            if (!idMatch) return;

            const productId = idMatch[1];
            if (seenIds.has(productId)) return;
            seenIds.add(productId);

            const priceMatch = href.match(/fiyat=(\d+)/);
            const price = priceMatch ? parseInt(priceMatch[1], 10) : 0;

            const parentElement = link.closest('article, div, section');
            const sourceText = parentElement?.textContent?.toLowerCase() || '';

            let source: ScrapedDeal['source'] = 'other';
            if (sourceText.includes('amazon')) source = 'amazon';
            else if (sourceText.includes('trendyol')) source = 'trendyol';
            else if (sourceText.includes('hepsiburada')) source = 'hepsiburada';
            else if (sourceText.includes('n11')) source = 'n11';

            const img = parentElement?.querySelector('img');
            const imageUrl = img?.getAttribute('src') || img?.getAttribute('data-src') || undefined;

            const fullLink = href.startsWith('http') ? href : `https://onual.com${href}`;

            deals.push({
                id: productId,
                title: cleanTitle(title),
                price,
                source,
                onualLink: fullLink.split('#')[0],
                couponCode: undefined,
                imageUrl,
                scrapedAt: new Date()
            });
        });
    }

    return deals;
}

/**
 * OnuAl detay sayfasından gerçek ürün bilgilerini çeker
 */
export interface DealDetails {
    productLink: string;
    imageUrl?: string;
    description?: string;
    brand?: string;
    oldPrice?: number;
}

export async function fetchDealDetails(onualLink: string): Promise<DealDetails> {
    try {
        const html = await fetchWithProxy(onualLink);
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');

        // "Ürüne Git" butonunu bul
        const productLinkEl = doc.querySelector('a[href*="trendyol.com"], a[href*="amazon.com.tr"], a[href*="hepsiburada.com"], a[href*="n11.com"]');
        const productLink = productLinkEl?.getAttribute('href') || '';

        // Ürün resmini bul (yüksek kaliteli)
        const imgEl = doc.querySelector('img[src*="cdn"], img[src*="product"], img.product-image, article img, .product img');
        let imageUrl = imgEl?.getAttribute('src') || imgEl?.getAttribute('data-src') || undefined;

        // Relative URL'yi absolute yap
        if (imageUrl && !imageUrl.startsWith('http')) {
            imageUrl = `https://onual.com${imageUrl}`;
        }

        // Açıklama ve meta bilgileri çek
        const metaDesc = doc.querySelector('meta[name="description"]')?.getAttribute('content') || '';
        const ogDesc = doc.querySelector('meta[property="og:description"]')?.getAttribute('content') || '';
        const pageTitle = doc.querySelector('h1')?.textContent?.trim() || '';

        // En iyi açıklamayı seç
        let description = ogDesc || metaDesc || '';

        // Açıklamayı temizle ve kısalt
        description = description
            .replace(/En ucuz.*?OnuAl'da\./gi, '')
            .replace(/fiyatları.*?başlayan/gi, '')
            .replace(/kullanıcı yorumları okuyun.*$/gi, '')
            .trim();

        // Eğer açıklama hala boşsa, başlıktan üret
        if (!description && pageTitle) {
            description = `${pageTitle} - Uygun fiyata alışveriş fırsatı`;
        }

        // Markayı başlıktan çıkar (genellikle ilk kelime)
        const brand = extractBrand(pageTitle);

        return { productLink, imageUrl, description, brand };
    } catch (error) {
        console.error('Detay bilgisi çekilirken hata:', error);
        return { productLink: '' };
    }
}

/**
 * Başlıktan marka adını çıkar
 */
function extractBrand(title: string): string {
    if (!title) return '';

    // Yaygın marka kalıplarını tanı
    const commonBrands = [
        'Apple', 'Samsung', 'Xiaomi', 'Philips', 'Sony', 'LG', 'Bosch', 'Dyson',
        'Nike', 'Adidas', 'Puma', 'Reebok', 'New Balance', 'Skechers',
        'Loreal', 'Nivea', 'Dove', 'Garnier', 'Maybelline',
        'Nestle', 'Eti', 'Ülker', 'Torku', 'Pınar',
        'Lego', 'Mattel', 'Hasbro', 'Fisher-Price',
        'HP', 'Dell', 'Lenovo', 'Asus', 'Acer', 'MSI',
        'JBL', 'Bose', 'Sennheiser', 'Razer', 'Logitech',
        'Karaca', 'Emsan', 'Schafer', 'Korkmaz', 'Arzum'
    ];

    // Başlığı kelimelere ayır
    const words = title.split(/\s+/);

    // İlk kelimeyi veya bilinen markayı bul
    for (const word of words.slice(0, 3)) {
        const cleanWord = word.replace(/[^a-zA-ZğüşıöçĞÜŞİÖÇ]/gi, '');

        // Bilinen marka mı kontrol et
        const matchedBrand = commonBrands.find(b =>
            b.toLowerCase() === cleanWord.toLowerCase()
        );

        if (matchedBrand) return matchedBrand;
    }

    // İlk kelimeyi marka olarak kullan (2+ karakter ise)
    const firstWord = words[0]?.replace(/[^a-zA-ZğüşıöçĞÜŞİÖÇ0-9]/gi, '') || '';
    return firstWord.length >= 2 ? firstWord : '';
}

/**
 * URL'den görsel indir ve ImgBB'ye yükle
 * 
 * Önce Vercel proxy (server-side) denenir - Telegram CDN için gerekli.
 * Başarısız olursa CORS proxy yöntemine fallback yapar.
 */
export async function uploadImageFromUrl(imageUrl: string): Promise<{ downloadURL: string; deleteUrl: string } | null> {
    if (!imageUrl) return null;

    console.log(`📷 Görsel yükleniyor: ${imageUrl.substring(0, 60)}...`);

    // 1. ÖNCELİKLİ: Vercel proxy endpoint'i (server-side, CORS yok)
    // Telegram CDN görselleri için bu yöntem gerekli
    try {
        const vercelEndpoint = `${VERCEL_PROXY_URL.replace('/scrape', '/image-upload')}?imageUrl=${encodeURIComponent(imageUrl)}`;
        console.log('🔄 Vercel proxy deneniyor...');

        const response = await fetchWithTimeout(vercelEndpoint, {
            headers: { 'Accept': 'application/json' }
        }, 45000); // 45 saniye timeout (görsel yükleme yavaş olabilir)

        if (response.ok) {
            const data = await response.json();
            if (data.success && data.downloadURL) {
                console.log(`✅ Vercel proxy başarılı: ${data.downloadURL.substring(0, 50)}...`);
                return {
                    downloadURL: data.downloadURL,
                    deleteUrl: data.deleteUrl || ''
                };
            }
        }
        console.log('⚠️ Vercel proxy başarısız, CORS proxy deneniyor...');
    } catch (error: any) {
        console.log(`⚠️ Vercel proxy hatası: ${error.message}, CORS proxy deneniyor...`);
    }

    // 2. FALLBACK: CORS proxy üzerinden görseli çek (eski yöntem)
    try {
        let blob: Blob | null = null;
        let lastError: Error | null = null;

        for (let i = 0; i < CORS_PROXIES.length; i++) {
            try {
                const proxyUrl = CORS_PROXIES[i](imageUrl);
                const response = await fetchWithTimeout(proxyUrl, {}, 15000);
                if (response.ok) {
                    blob = await response.blob();
                    if (blob && blob.size > 1000) {
                        console.log(`✅ CORS proxy ${i + 1} başarılı: ${Math.round(blob.size / 1024)}KB`);
                        break;
                    }
                }
            } catch (error) {
                lastError = error as Error;
            }
        }

        if (!blob) {
            throw lastError || new Error('Görsel indirilemedi');
        }

        // Blob'u File'a çevir
        const file = new File([blob], 'product.jpg', { type: blob.type || 'image/jpeg' });

        // Merkezi imgbb servisini kullan
        const result = await uploadToImgbb(file);

        console.log(`✅ ImgBB yükleme başarılı: ${result.downloadURL.substring(0, 50)}...`);
        return {
            downloadURL: result.downloadURL,
            deleteUrl: result.deleteUrl,
        };
    } catch (error: any) {
        console.error(`❌ Görsel yükleme tamamen başarısız: ${error.message}`);
        return null;
    }
}

/**
 * Başlığı temizle
 */
function cleanTitle(title: string): string {
    return title
        .replace(/\s+/g, ' ')
        .replace(/🏷️.*$/g, '')
        .replace(/🤖/g, '')
        .replace(/🔻/g, '')
        .trim();
}

/**
 * ScrapedDeal'i Discount formatına dönüştür (yayınlama için)
 */
export function convertToDiscount(deal: ScrapedDeal, additionalData: {
    description: string;
    brand: string;
    category: string;
    oldPrice: number;
    imageUrl: string;
    deleteUrl?: string;
    screenshotUrl?: string;
    screenshotDeleteUrl?: string;
}): Omit<Discount, 'id' | 'createdAt'> {
    return {
        title: deal.title,
        description: additionalData.description,
        brand: additionalData.brand,
        category: additionalData.category,
        link: deal.productLink || deal.onualLink,
        oldPrice: additionalData.oldPrice,
        newPrice: deal.price,
        imageUrl: additionalData.imageUrl,
        deleteUrl: additionalData.deleteUrl || '',
        screenshotUrl: additionalData.screenshotUrl,
        screenshotDeleteUrl: additionalData.screenshotDeleteUrl,
        submittedBy: 'OnuAl Bot'
    };
}

/**
 * Kaynak siteyi Türkçe göster
 */
export function getSourceLabel(source: ScrapedDeal['source']): string {
    switch (source) {
        case 'amazon': return 'Amazon';
        case 'trendyol': return 'Trendyol';
        case 'hepsiburada': return 'Hepsiburada';
        case 'n11': return 'N11';
        default: return 'Diğer';
    }
}

/**
 * Kaynak site rengini döndür
 */
export function getSourceColor(source: ScrapedDeal['source']): string {
    switch (source) {
        case 'amazon': return 'bg-orange-600';
        case 'trendyol': return 'bg-orange-500';
        case 'hepsiburada': return 'bg-orange-400';
        case 'n11': return 'bg-purple-600';
        default: return 'bg-gray-600';
    }
}
