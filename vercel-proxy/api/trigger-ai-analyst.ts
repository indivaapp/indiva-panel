import type { VercelRequest, VercelResponse } from '@vercel/node';

/**
 * AI Analist raporunu panelden elle tetikleme — GitHub'ın workflow_dispatch
 * API'sini çağırarak .github/workflows/auto-ai-analyst-daily.yml'yi anında
 * çalıştırır (normalde 14:00/22:00 TR cron'uyla otomatik çalışır).
 *
 * POST { mode?: 'daily' | 'weekly' } (varsayılan 'daily')
 * → { success, message }
 *
 * Not: Rapor senkron dönmez — workflow arka planda birkaç dakika sürer,
 * bittiğinde push bildirimi + Firestore'a yeni rapor olarak düşer
 * (bkz. scripts/aiAnalystCore.js).
 */

const GITHUB_TOKEN = process.env.GITHUB_ACTIONS_TOKEN || '';
const REPO = 'indivaapp/indiva-panel';

function corsHeaders(res: VercelResponse) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
    corsHeaders(res);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'Sadece POST destekleniyor' });

    if (!GITHUB_TOKEN) {
        return res.status(500).json({ success: false, error: 'GITHUB_ACTIONS_TOKEN tanımlı değil' });
    }

    const mode = req.body?.mode === 'weekly' ? 'weekly' : 'daily';
    const workflowFile = mode === 'weekly' ? 'auto-ai-analyst-weekly.yml' : 'auto-ai-analyst-daily.yml';

    try {
        const response = await fetch(
            `https://api.github.com/repos/${REPO}/actions/workflows/${workflowFile}/dispatches`,
            {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${GITHUB_TOKEN}`,
                    'Accept': 'application/vnd.github+json',
                    'Content-Type': 'application/json',
                    'X-GitHub-Api-Version': '2022-11-28',
                },
                body: JSON.stringify({ ref: 'main' }),
                signal: AbortSignal.timeout(15000),
            }
        );

        if (response.status !== 204) {
            const errText = await response.text();
            return res.status(502).json({ success: false, error: `GitHub ${response.status}: ${errText.substring(0, 300)}` });
        }

        return res.status(200).json({ success: true, message: 'Rapor oluşturma başlatıldı, birkaç dakika içinde bildirim gelecek' });
    } catch (err: any) {
        if (err?.name === 'AbortError' || err?.name === 'TimeoutError') {
            return res.status(504).json({ success: false, error: 'Zaman aşımı' });
        }
        return res.status(500).json({ success: false, error: err?.message || 'Bilinmeyen hata' });
    }
}
