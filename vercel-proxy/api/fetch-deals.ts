import type { VercelRequest, VercelResponse } from '@vercel/node';
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

// Firebase Admin SDK başlat
if (getApps().length === 0) {
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || '{}');
    initializeApp({
        credential: cert(serviceAccount)
    });
}

const db = getFirestore();

// Telegram'dan veri çekmek için proxy'ler
const PROXIES = [
    {
        name: 'AllOrigins',
        buildUrl: (url: string) => `https://api.allorigins.win/get?url=${encodeURIComponent(url)}`,
        parseResponse: async (res: Response) => {
            const json = await res.json();
            return json.contents || '';
        }
    },
    {
        name: 'Direct',
        buildUrl: (url: string) => url,
        parseResponse: async (res: Response) => await res.text()
    }
];

interface ScrapedDeal {
    id: string;
    title: string;
    price: number;
    source: string;
    onualLink: string;
    imageUrl?: string;
    postedAt?: Date;
}

/**
 * HTML'den onu.al linklerini ve bilgilerini çıkar
 */
function parseDealsFromHtml(html: string): ScrapedDeal[] {
    const deals: ScrapedDeal[] = [];

    // onu.al linklerini bul
    const linkRegex = /href=["'](https?:\/\/onu\.al\/[a-zA-Z0-9]+)["']/gi;
    const linkSet = new Set<string>();
    let match;

    while ((match = linkRegex.exec(html)) !== null) {
        linkSet.add(match[1]);
    }

    // Fiyat regex
    const priceRegex = /(\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{2})?)\s*(?:₺|TL)/i;

    let msgIndex = 0;
    for (const link of linkSet) {
        const linkIndex = html.indexOf(`href="${link}"`);
        if (linkIndex === -1) continue;

        const start = Math.max(0, linkIndex - 3000);
        const end = Math.min(html.length, linkIndex + 500);
        const msgBlock = html.substring(start, end);

        // Başlık çıkar
        const textMatch = msgBlock.match(/tgme_widget_message_text[^>]*>([\s\S]*?)<\/div>/);
        const rawText = textMatch ? textMatch[1] : '';
        const text = rawText.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
        const title = text.substring(0, 200) || `İndirim #${msgIndex + 1}`;

        // Fiyat çıkar
        const priceMatch = text.match(priceRegex);
        const price = priceMatch ? parseInt(priceMatch[1].replace(/[.,]/g, ''), 10) : 0;

        // Görsel çıkar (Telegram CDN)
        let imageUrl: string | undefined;
        const photoMatch = msgBlock.match(/tgme_widget_message_photo_wrap[^>]*style=["'][^"']*url\(['"]?([^'")\s]+)['"]?\)/i);
        if (photoMatch) {
            imageUrl = photoMatch[1];
        } else {
            const bgMatch = msgBlock.match(/background-image:\s*url\(['"]?(https?:\/\/cdn[^'")\s]+)['"]?\)/i);
            if (bgMatch) imageUrl = bgMatch[1];
        }

        // Kaynak tespit
        let source = 'other';
        const lowerText = text.toLowerCase();
        if (lowerText.includes('trendyol')) source = 'trendyol';
        else if (lowerText.includes('amazon')) source = 'amazon';
        else if (lowerText.includes('hepsiburada')) source = 'hepsiburada';
        else if (lowerText.includes('n11')) source = 'n11';

        // Tarih çıkar - bulunamazsa undefined (fetch zamanını gösterme)
        const timeMatch = msgBlock.match(/datetime=["']([^"']+)["']/);
        const postedAt = timeMatch ? new Date(timeMatch[1]) : undefined;

        deals.push({
            id: `telegram_${link.split('/').pop()}_${Date.now()}`,
            title,
            price,
            source,
            onualLink: link,
            imageUrl,
            postedAt
        });

        msgIndex++;
    }

    return deals;
}

/**
 * Telegram'dan ham HTML çek
 */
async function fetchTelegramHtml(): Promise<string> {
    const telegramUrl = 'https://t.me/s/onual_firsat';

    for (const proxy of PROXIES) {
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 20000);

            const response = await fetch(proxy.buildUrl(telegramUrl), {
                signal: controller.signal,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/121.0.0.0',
                    'Accept': 'text/html,application/xhtml+xml,*/*'
                }
            });

            clearTimeout(timeoutId);

            if (!response.ok) continue;

            const html = await proxy.parseResponse(response);
            if (html && html.length > 1000) {
                console.log(`✅ ${proxy.name} ile ${html.length} karakter alındı`);
                return html;
            }
        } catch (e) {
            console.log(`❌ ${proxy.name} başarısız`);
        }
    }

    throw new Error('Tüm proxy\'ler başarısız');
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
    // CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    console.log('🔄 Arka plan veri çekme başlatıldı...');

    try {
        // 1. Telegram'dan HTML çek
        const html = await fetchTelegramHtml();

        // 2. İlanları parse et
        const deals = parseDealsFromHtml(html);
        console.log(`📦 ${deals.length} ilan parse edildi`);

        if (deals.length === 0) {
            return res.json({ success: true, message: 'İlan bulunamadı', newDeals: 0 });
        }

        // 3. Daha önce kaydedilmiş onu.al linklerini al
        const existingLinksSnapshot = await db.collection('pendingDeals')
            .select('onualLink')
            .get();

        const existingLinks = new Set(existingLinksSnapshot.docs.map(d => d.data().onualLink));

        // Yayınlanmış indirimlerin linklerini de kontrol et
        const publishedLinksSnapshot = await db.collection('discounts')
            .select('link')
            .limit(100)
            .get();

        publishedLinksSnapshot.docs.forEach(d => {
            const link = d.data().link;
            if (link && link.includes('onu.al')) {
                existingLinks.add(link);
            }
        });

        // 4. Yeni ilanları filtrele
        const newDeals = deals.filter(d => !existingLinks.has(d.onualLink));
        console.log(`🆕 ${newDeals.length} yeni ilan bulundu`);

        if (newDeals.length === 0) {
            return res.json({ success: true, message: 'Yeni ilan yok', newDeals: 0 });
        }

        // 5. Yeni ilanları Firebase'e kaydet
        const batch = db.batch();

        for (const deal of newDeals) {
            const docRef = db.collection('pendingDeals').doc();

            // Undefined alanları filtrele - Firestore undefined kabul etmiyor
            const cleanDeal = {
                id: deal.id,
                title: deal.title || 'İndirim',
                price: deal.price || 0,
                source: deal.source || 'other',
                onualLink: deal.onualLink,
                imageUrl: deal.imageUrl || '', // undefined yerine boş string
                postedAt: deal.postedAt || new Date(),
                fetchedAt: FieldValue.serverTimestamp(),
                status: 'pending'
            };

            batch.set(docRef, cleanDeal);
        }

        await batch.commit();
        console.log(`✅ ${newDeals.length} ilan pendingDeals'e kaydedildi`);

        // 6. Toplam bekleyen ilan sayısını güncelle
        const pendingCount = existingLinksSnapshot.size + newDeals.length;

        return res.json({
            success: true,
            message: `${newDeals.length} yeni ilan kaydedildi`,
            newDeals: newDeals.length,
            totalPending: pendingCount
        });

    } catch (error: any) {
        console.error('❌ Hata:', error.message);
        return res.status(500).json({
            success: false,
            error: error.message
        });
    }
}
