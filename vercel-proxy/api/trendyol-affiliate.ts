export const config = { runtime: 'edge' };

/**
 * Trendyol Affiliate Link Üretici — Edge Runtime
 * POST { url: string }
 * Kullanıcıya yakın edge node'dan çalışır (Türkiye edge'i → Cloudflare bypass)
 */

function parseTrendyolUrl(url: string): { contentId: number; boutiqueId: number; merchantId: number } | null {
    try {
        const match = url.match(/-p-(\d+)/);
        if (!match) return null;
        const contentId = parseInt(match[1]);
        const u = new URL(url);
        const boutiqueId = parseInt(u.searchParams.get('boutiqueId') || '61');
        const merchantId = parseInt(u.searchParams.get('merchantId') || '1');
        return { contentId, boutiqueId, merchantId };
    } catch {
        return null;
    }
}

const CORS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
};

export default async function handler(req: Request): Promise<Response> {
    if (req.method === 'OPTIONS') return new Response(null, { status: 200, headers: CORS });
    if (req.method !== 'POST') return new Response(JSON.stringify({ success: false, error: 'POST gerekli' }), { status: 405, headers: CORS });

    let body: any;
    try { body = await req.json(); } catch { body = {}; }

    const url: string = body?.url || '';
    if (!url) return new Response(JSON.stringify({ success: false, error: 'url gerekli' }), { status: 400, headers: CORS });

    if (!url.includes('trendyol.com') && !url.includes('ty.gl')) {
        return new Response(JSON.stringify({ success: false, error: 'Trendyol URL değil' }), { status: 400, headers: CORS });
    }

    if (url.includes('ty.gl')) {
        return new Response(JSON.stringify({ success: true, affiliateUrl: url, cached: true }), { headers: CORS });
    }

    const parsed = parseTrendyolUrl(url);
    if (!parsed) {
        return new Response(JSON.stringify({ success: false, error: 'contentId alınamadı' }), { status: 400, headers: CORS });
    }

    const COOKIE_ENTRANCE = process.env.TRENDYOL_COOKIE_ENTRANCE || '';
    const COOKIE_ANONYM   = process.env.TRENDYOL_COOKIE_ANONYM   || '';
    const USER_ID         = parseInt(process.env.TRENDYOL_USER_ID || '0');

    if (!COOKIE_ENTRANCE || !COOKIE_ANONYM || !USER_ID) {
        return new Response(JSON.stringify({ success: false, error: 'Cookie ayarlanmamış' }), { status: 500, headers: CORS });
    }

    try {
        const apiRes = await fetch(
            'https://apigw.trendyol.com/discovery-storefront-trproductgw-service/api/product-link/product-link?channelId=2',
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Origin': 'https://www.trendyol.com',
                    'User-Agent': 'Mozilla/5.0 (Linux; Android 10; SM-G975F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
                    'Cookie': `COOKIE_TY.Entrance=${COOKIE_ENTRANCE}; COOKIE_TY.Anonym=${COOKIE_ANONYM}`,
                },
                body: JSON.stringify({
                    brand: '',
                    contentId: parsed.contentId,
                    boutiqueId: parsed.boutiqueId,
                    productName: '',
                    merchantId: parsed.merchantId,
                    platformName: 'android',
                    page: 'Product',
                    userId: USER_ID,
                }),
                signal: AbortSignal.timeout(10000),
            }
        );

        const rawText = await apiRes.text();
        let data: any;
        try { data = JSON.parse(rawText); } catch {
            return new Response(JSON.stringify({ success: false, error: 'IP engeli (Cloudflare)', raw: rawText.substring(0, 300) }), { status: 502, headers: CORS });
        }

        if (!data.isSuccess || !data.result?.shortKey) {
            return new Response(JSON.stringify({ success: false, error: data.message || 'API hatası' }), { status: 502, headers: CORS });
        }

        return new Response(JSON.stringify({ success: true, affiliateUrl: data.result.shortKey }), { headers: CORS });

    } catch (err: any) {
        return new Response(JSON.stringify({ success: false, error: err?.message || 'Bilinmeyen hata' }), { status: 500, headers: CORS });
    }
}
