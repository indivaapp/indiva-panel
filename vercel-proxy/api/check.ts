import type { VercelRequest, VercelResponse } from '@vercel/node';

export default async function handler(req: VercelRequest, res: VercelResponse) {
    if (req.method === 'OPTIONS') {
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
        return res.status(200).end();
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const { url, title, expectedPrice } = req.body;
    if (!url || !title) {
        return res.status(400).json({ error: 'Missing parameters' });
    }

    const groqKey = process.env.VITE_GROQ_API_KEY || process.env.GROQ_API_KEY;
    
    try {
        // 1. Scrape with Jina Reader (Most reliable for JIT)
        const jinaUrl = `https://r.jina.ai/${url}`;
        const jinaRes = await fetch(jinaUrl, { 
            headers: { 'X-Retain-Images': 'none' },
            signal: AbortSignal.timeout(20000) 
        });

        if (!jinaRes.ok) {
            return res.status(500).json({ error: 'Scraping failed' });
        }

        const markdown = await jinaRes.text();

        // 2. Verify with Groq AI
        const prompt = `Ürün: "${title}" | Beklenen Fiyat: ${expectedPrice} TL
        GÖREV: Sayfa içeriğine göre ürünün durumunu belirle.
        SADECE JSON: {"expired": boolean, "currentPrice": number, "inStock": boolean, "reason": "kısa açıklama"}`;

        const aiRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${groqKey}`
            },
            body: JSON.stringify({
                model: "llama-3.3-70b-versatile",
                messages: [{ role: "user", content: prompt + "\n\nİÇERİK:\n" + markdown.substring(0, 15000) }],
                temperature: 0.1,
                response_format: { type: "json_object" }
            })
        });

        if (!aiRes.ok) {
            return res.status(500).json({ error: 'AI verification failed' });
        }

        const aiData = await aiRes.json();
        const result = JSON.parse(aiData.choices?.[0]?.message?.content || '{}');

        res.setHeader('Access-Control-Allow-Origin', '*');
        res.status(200).json(result);
    } catch (e: any) {
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.status(500).json({ error: e.message });
    }
}
