/**
 * api/auto-brochures.ts — BİM / A101 / ŞOK aktüel katalog otomasyonu
 *
 * Kaynak: aktuel-urunler.com
 * Vercel cron: her Pazartesi 06:00 UTC
 * Panel butonu: POST /api/auto-brochures (market query param opsiyonel)
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import * as cheerio from 'cheerio';

// ─── Market Konfigürasyonu ────────────────────────────────────────────────────

interface MarketConfig {
    name: string;
    key: string;
    listUrl: string;
}

const MARKETS: MarketConfig[] = [
    { name: 'BİM',  key: 'bim',  listUrl: 'https://aktuel-urunler.com/bim-aktuel/' },
    { name: 'A101', key: 'a101', listUrl: 'https://aktuel-urunler.com/a101-aktuel-urunler/' },
    { name: 'ŞOK',  key: 'sok',  listUrl: 'https://aktuel-urunler.com/sok/' },
];

// ─── Firebase Admin ───────────────────────────────────────────────────────────

function initFirebase() {
    if (getApps().length > 0) return getFirestore();
    const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
    if (!raw) throw new Error('FIREBASE_SERVICE_ACCOUNT env eksik');
    initializeApp({ credential: cert(JSON.parse(raw)) });
    return getFirestore();
}

// ─── HTTP ────────────────────────────────────────────────────────────────────

async function fetchHtml(url: string, timeoutMs = 15000): Promise<string | null> {
    try {
        const res = await fetch(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8',
                'Accept-Language': 'tr-TR,tr;q=0.9',
            },
            signal: AbortSignal.timeout(timeoutMs),
            redirect: 'follow',
        });
        if (!res.ok) return null;
        return await res.text();
    } catch { return null; }
}

// ─── Gemini: Tarih Analizi ────────────────────────────────────────────────────

async function getValidityDate(title: string): Promise<string> {
    const apiKey = process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_API_KEY;
    if (!apiKey) return parseDateFallback(title);

    try {
        const today = new Date().toLocaleDateString('tr-TR');
        const prompt = `Katalog başlığı: "${title}"\nBugün: ${today}\n\nBu kataloğun başlangıç tarihini başlıktan çıkar, bitiş tarihini de tahmin et (marketler genelde 1 hafta geçerli). Sadece şu JSON formatını döndür: {"validityDate": "12 Mayıs - 18 Mayıs 2026"}`;

        const res = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-lite:generateContent?key=${apiKey}`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
                signal: AbortSignal.timeout(8000),
            }
        );
        if (!res.ok) return parseDateFallback(title);
        const data = await res.json();
        const text: string = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
        const match = text.match(/\{[\s\S]*?\}/);
        if (match) {
            const parsed = JSON.parse(match[0]);
            if (parsed.validityDate) return parsed.validityDate;
        }
    } catch { /* fallback */ }

    return parseDateFallback(title);
}

function parseDateFallback(title: string): string {
    const m = title.match(/(\d+\s+\w+\s+\d{4})/);
    return m ? m[1].trim() : '';
}

// ─── Scraping: Liste Sayfası ──────────────────────────────────────────────────

interface CatalogEntry {
    title: string;
    detailUrl: string;
    thumbnailUrl: string;
}

function scrapeListPage(html: string): CatalogEntry[] {
    const $ = cheerio.load(html);
    const entries: CatalogEntry[] = [];
    const seen = new Set<string>();

    $('h2 a, h3 a').each((_, el) => {
        const href = $(el).attr('href') || '';
        const title = $(el).text().trim();
        if (!href || !title.toLowerCase().includes('aktüel')) return;
        if (seen.has(href)) return;
        seen.add(href);

        const fullHref = href.startsWith('http') ? href : `https://aktuel-urunler.com${href}`;
        const container = $(el).closest('article, .post, li, .entry, .item');
        const img = container.length
            ? container.find('img').first()
            : $(el).parent().parent().find('img').first();

        const thumbSrc = img.attr('src') || img.attr('data-src') || img.attr('data-lazy-src') || '';
        entries.push({ title, detailUrl: fullHref, thumbnailUrl: thumbSrc });
    });

    return entries;
}

// ─── Scraping: Detay Sayfası ──────────────────────────────────────────────────

function scrapeDetailImages(html: string): string[] {
    const $ = cheerio.load(html);
    const images: string[] = [];
    const seen = new Set<string>();

    $('img').each((_, el) => {
        const src = $(el).attr('src')
            || $(el).attr('data-src')
            || $(el).attr('data-lazy-src')
            || '';

        if (!src || !src.includes('/wp-diger/uploads/')) return;
        if (seen.has(src)) return;
        if (/\-\d+x\d+\.[a-z]+$/i.test(src)) return;
        if (/\/(story|stories|widget|logo|banner|icon)\//i.test(src)) return;
        if (!/\/uploads\/\d{4}\/\d{2}\//i.test(src)) return;

        seen.add(src);
        images.push(src);
    });

    return images;
}

function thumbToFull(url: string): string {
    return url.replace(/-\d+x\d+(\.[a-z]+)$/i, '$1');
}

// ─── Market İşleme ────────────────────────────────────────────────────────────

interface MarketResult {
    added: number;
    skipped: number;
    error?: string;
}

async function processMarket(
    market: MarketConfig,
    db: FirebaseFirestore.Firestore,
    maxCatalogs = 1
): Promise<MarketResult> {
    let added = 0, skipped = 0;

    try {
        const listHtml = await fetchHtml(market.listUrl);
        if (!listHtml) return { added: 0, skipped: 0, error: 'Liste sayfası çekilemedi' };

        const entries = scrapeListPage(listHtml).slice(0, maxCatalogs);
        if (entries.length === 0) return { added: 0, skipped: 0, error: 'Katalog bulunamadı' };

        const collRef = db.collection('circulars').doc(market.key).collection('brochures');

        for (const entry of entries) {
            const detailHtml = await fetchHtml(entry.detailUrl);
            let images: string[] = detailHtml ? scrapeDetailImages(detailHtml) : [];

            if (images.length === 0 && entry.thumbnailUrl) {
                const fallback = thumbToFull(entry.thumbnailUrl);
                if (fallback) images = [fallback];
            }

            if (images.length === 0) {
                console.log(`[${market.name}] Görsel bulunamadı: ${entry.title}`);
                continue;
            }

            const validityDate = await getValidityDate(entry.title);

            for (const imageUrl of images) {
                const existing = await collRef.where('imageUrl', '==', imageUrl).limit(1).get();
                if (!existing.empty) { skipped++; continue; }

                await collRef.add({
                    storeName: market.key,
                    marketName: market.key,
                    title: entry.title,
                    validityDate,
                    imageUrl,
                    deleteUrl: '',
                    autoImported: true,
                    sourceUrl: entry.detailUrl,
                    publishDate: FieldValue.serverTimestamp(),
                    createdAt: FieldValue.serverTimestamp(),
                });
                added++;
            }

            await new Promise(r => setTimeout(r, 1500));
        }
    } catch (e: any) {
        return { added, skipped, error: e.message };
    }

    return { added, skipped };
}

// ─── Handler ─────────────────────────────────────────────────────────────────

export default async function handler(req: VercelRequest, res: VercelResponse) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    if (req.method === 'OPTIONS') { res.status(200).end(); return; }

    const secret = req.query.secret as string | undefined;
    const isCron = !!secret;
    if (isCron && secret !== process.env.AUTO_PUBLISH_SECRET) {
        return res.status(401).json({ error: 'Yetkisiz' });
    }

    const marketFilter = (req.query.market as string | undefined)?.toLowerCase();
    const targets = marketFilter
        ? MARKETS.filter(m => m.key === marketFilter)
        : MARKETS;

    if (targets.length === 0) {
        return res.status(400).json({ error: `Bilinmeyen market: ${marketFilter}` });
    }

    try {
        const db = initFirebase();
        const results: Record<string, MarketResult> = {};

        for (const market of targets) {
            console.log(`[auto-brochures] İşleniyor: ${market.name}`);
            results[market.name] = await processMarket(market, db, 1);
            await new Promise(r => setTimeout(r, 1000));
        }

        const totalAdded = Object.values(results).reduce((s, r) => s + r.added, 0);
        const totalSkipped = Object.values(results).reduce((s, r) => s + r.skipped, 0);

        console.log(`[auto-brochures] Tamamlandı: +${totalAdded} eklendi, ${totalSkipped} atlandı`);
        return res.status(200).json({
            success: true,
            totalAdded,
            totalSkipped,
            results,
            timestamp: new Date().toISOString(),
        });

    } catch (err: any) {
        console.error('[auto-brochures] Hata:', err.message);
        return res.status(500).json({ error: err.message });
    }
}
