/**
 * Trendyol Affiliate Link Üretici
 * Capacitor native HTTP ile telefon üzerinden çalışır (Türk IP, CORS yok)
 */

import { CapacitorHttp } from '@capacitor/core';

const TRENDYOL_USER_ID = 17000813;

// ─── Cookie Yönetimi ──────────────────────────────────────────────────────────

const STORAGE_KEY_ENTRANCE = 'ty_cookie_entrance';
const STORAGE_KEY_ANONYM   = 'ty_cookie_anonym';

export function saveTrendyolCookies(entrance: string, anonym: string): void {
    localStorage.setItem(STORAGE_KEY_ENTRANCE, entrance);
    localStorage.setItem(STORAGE_KEY_ANONYM, anonym);
}

export function getTrendyolCookies(): { entrance: string; anonym: string } | null {
    const entrance = localStorage.getItem(STORAGE_KEY_ENTRANCE);
    const anonym   = localStorage.getItem(STORAGE_KEY_ANONYM);
    if (!entrance || !anonym) return null;
    return { entrance, anonym };
}

export function hasTrendyolCookies(): boolean {
    return !!getTrendyolCookies();
}

// ─── URL Parse ───────────────────────────────────────────────────────────────

function parseTrendyolUrl(url: string): { contentId: number; boutiqueId: number; merchantId: number; brand: string } | null {
    const match = url.match(/-p-(\d+)/);
    if (!match) return null;
    const contentId = parseInt(match[1]);

    try {
        const u = new URL(url);
        const boutiqueId = parseInt(u.searchParams.get('boutiqueId') || '61');
        const merchantId = parseInt(u.searchParams.get('merchantId') || '1');

        // Brand'i URL path'inden çıkar
        const pathParts = u.pathname.split('/');
        const brand = pathParts[1] || 'Marka';

        return { contentId, boutiqueId, merchantId, brand };
    } catch {
        return { contentId, boutiqueId: 61, merchantId: 1, brand: 'Marka' };
    }
}

// ─── Ana Fonksiyon ────────────────────────────────────────────────────────────

export async function generateAffiliateLink(trendyolUrl: string): Promise<string> {
    // Zaten ty.gl ise direkt döndür
    if (trendyolUrl.includes('ty.gl')) return trendyolUrl;

    // Trendyol URL değilse orijinal URL'yi döndür
    if (!trendyolUrl.includes('trendyol.com')) return trendyolUrl;

    const parsed = parseTrendyolUrl(trendyolUrl);
    if (!parsed) return trendyolUrl;

    const cookies = getTrendyolCookies();
    if (!cookies) throw new Error('Trendyol cookie ayarlanmamış. Ayarlardan giriş yapın.');

    const cookieHeader = `COOKIE_TY.Entrance=${cookies.entrance}; COOKIE_TY.Anonym=${cookies.anonym}`;

    try {
        const response = await CapacitorHttp.request({
            method: 'POST',
            url: 'https://apigw.trendyol.com/discovery-storefront-trproductgw-service/api/product-link/product-link?channelId=2',
            headers: {
                'Content-Type': 'application/json',
                'Origin': 'https://www.trendyol.com',
                'User-Agent': 'Mozilla/5.0 (Linux; Android 10; SM-G975F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
                'Cookie': cookieHeader,
            },
            data: {
                brand: parsed.brand,
                contentId: parsed.contentId,
                boutiqueId: parsed.boutiqueId,
                productName: 'Ürün',
                merchantId: parsed.merchantId,
                platformName: 'android',
                page: 'Product',
                userId: TRENDYOL_USER_ID,
            },
        });

        const data = response.data as any;
        if (data?.isSuccess && data?.result?.shortKey) {
            return data.result.shortKey;
        }
        throw new Error(data?.message || 'Trendyol API hatası');

    } catch (err: any) {
        // Native HTTP başarısız olursa orijinal URL'yi döndür
        console.error('Affiliate link üretilemedi:', err?.message);
        return trendyolUrl;
    }
}

export function isTrendyolUrl(url: string): boolean {
    return url?.includes('trendyol.com') || url?.includes('ty.gl');
}
