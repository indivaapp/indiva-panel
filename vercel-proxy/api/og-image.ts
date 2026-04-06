import type { VercelRequest, VercelResponse } from '@vercel/node';

/**
 * og-image — Ürün URL'sinden og:image meta etiketini çeker
 * Affiliate link → gerçek ürün görseli URL'si
 */

export default async function handler(req: VercelRequest, res: VercelResponse) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') { res.status(200).end(); return; }
    if (req.method !== 'GET') {
        res.status(405).json({ success: false, error: 'Sadece GET destekleniyor' });
        return;
    }

    const { url } = req.query;
    if (!url || typeof url !== 'string') {
        res.status(400).json({ success: false, error: 'url parametresi gerekli' });
        return;
    }

    try {
        // Sırayla farklı User-Agent'lar dene (bazı siteler DC IP'yi bot UA ile geçirir)
        const USER_AGENTS = [
            'Googlebot/2.1 (+http://www.google.com/bot.html)',
            'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)',
            'Twitterbot/1.0',
            'Mozilla/5.0 (compatible; Baiduspider/2.0; +http://www.baidu.com/search/spider.html)',
        ];

        let response: Response | null = null;
        let lastStatus = 0;

        for (const ua of USER_AGENTS) {
            try {
                const r = await fetch(url, {
                    method: 'GET',
                    headers: {
                        'User-Agent': ua,
                        'Accept': 'text/html,application/xhtml+xml',
                        'Accept-Language': 'tr-TR,tr;q=0.9',
                    },
                    redirect: 'follow',
                    signal: AbortSignal.timeout(10000),
                });
                if (r.ok) { response = r; break; }
                lastStatus = r.status;
                // 410 = sayfa yok (gerçek hata), devam etme
                if (r.status === 410 || r.status === 404) break;
            } catch {}
        }

        if (!response) {
            res.status(502).json({ success: false, error: `Sayfa alınamadı: HTTP ${lastStatus}` });
            return;
        }

        // Sadece ilk 50KB oku — og:image head kısmında olur
        const reader  = response.body?.getReader();
        let html      = '';
        let totalRead = 0;
        const LIMIT   = 50_000;

        if (reader) {
            const decoder = new TextDecoder();
            while (totalRead < LIMIT) {
                const { done, value } = await reader.read();
                if (done) break;
                html      += decoder.decode(value, { stream: true });
                totalRead += value.byteLength;
                // <head> bitti mi? Daha fazla okumaya gerek yok
                if (html.includes('</head>')) break;
            }
            reader.cancel().catch(() => {});
        } else {
            html = await response.text();
        }

        // og:image veya twitter:image çek
        const imageUrl = extractMetaImage(html);

        if (!imageUrl) {
            res.status(404).json({ success: false, error: 'Görsele ulaşılamadı' });
            return;
        }

        res.status(200).json({ success: true, imageUrl });

    } catch (err: any) {
        console.error('[og-image] Hata:', err?.message);
        res.status(500).json({ success: false, error: err?.message || 'Bilinmeyen hata' });
    }
}

// ─── Yardımcı ─────────────────────────────────────────────────────────────────

function extractMetaImage(html: string): string | null {
    // og:image (iki ayrı sıra olabilir)
    const patterns = [
        /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i,
        /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i,
        /<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i,
        /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']twitter:image["']/i,
    ];

    for (const pattern of patterns) {
        const m = html.match(pattern);
        if (m?.[1] && m[1].startsWith('http')) return m[1];
    }
    return null;
}
