import type { VercelRequest, VercelResponse } from '@vercel/node';
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore, Timestamp, FieldValue } from 'firebase-admin/firestore';

// ===== FIREBASE ADMIN INIT =====

// Firebase Admin SDK'yÄ± baÅŸlat (henÃ¼z baÅŸlatÄ±lmadÄ±ysa)
if (getApps().length === 0) {
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || '{}');
    initializeApp({
        credential: cert(serviceAccount)
    });
}

const db = getFirestore();

// ===== TYPES =====

interface ScrapedDeal {
    id: string;
    title: string;
    price: number;
    source: 'amazon' | 'trendyol' | 'hepsiburada' | 'n11' | 'other';
    onualLink: string;
    productLink?: string;
    couponCode?: string;
    imageUrl?: string;
    channelName?: string;
}

interface EnrichedDeal extends ScrapedDeal {
    cleanTitle: string;
    category: string;
    brand: string;
    description: string;
    confidenceScore: number;
}

interface AutoPublishSettings {
    isActive: boolean;
    minConfidenceScore: number;
    minPrice: number;
    maxDailyPublish: number;
    requireImage: boolean;
}

// ===== HTML ENTITY DECODER =====

/**
 * HTML entity'lerini decode et (&#39; -> ', &amp; -> &, etc.)
 */
function decodeHtmlEntities(text: string): string {
    if (!text) return '';
    return text
        .replace(/&#(\d+);/g, (_, num) => String.fromCharCode(parseInt(num, 10)))
        .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
        .replace(/&nbsp;/g, ' ');
}

// ===== GEMINI API =====

// Gemini 2.0 Flash - Ocak 2026'da stabil Ã§alÄ±ÅŸan model
const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent';

async function callGeminiAPI(prompt: string, apiKey: string): Promise<string> {
    console.log(`ğŸ¤– Gemini API Ã§aÄŸrÄ±lÄ±yor...`);

    try {
        const response = await fetch(`${GEMINI_API_URL}?key=${apiKey}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ parts: [{ text: prompt }] }],
                generationConfig: {
                    temperature: 0.7,
                    maxOutputTokens: 400
                }
            })
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.log(`âŒ Gemini HTTP ${response.status}: ${errorText.substring(0, 200)}`);
            throw new Error(`Gemini API error: ${response.status}`);
        }

        const data = await response.json();
        const result = data.candidates?.[0]?.content?.parts?.[0]?.text || '';

        if (!result) {
            console.log(`âš ï¸ Gemini boÅŸ yanÄ±t:`, JSON.stringify(data).substring(0, 200));
        } else {
            console.log(`âœ… Gemini yanÄ±t: ${result.substring(0, 100)}...`);
        }

        return result;
    } catch (error: any) {
        console.log(`âŒ Gemini Ã§aÄŸrÄ± hatasÄ±: ${error.message}`);
        throw error;
    }
}

function parseAIResponse(text: string): Partial<EnrichedDeal> {
    let jsonStr = text.trim();
    if (jsonStr.startsWith('```json')) jsonStr = jsonStr.slice(7);
    if (jsonStr.startsWith('```')) jsonStr = jsonStr.slice(3);
    if (jsonStr.endsWith('```')) jsonStr = jsonStr.slice(0, -3);
    jsonStr = jsonStr.trim();

    try {
        const parsed = JSON.parse(jsonStr);
        return {
            cleanTitle: parsed.cleanTitle || '',
            category: parsed.category || 'DiÄŸer',
            brand: parsed.brand || '',
            description: parsed.description || '',
            confidenceScore: Math.min(100, Math.max(0, parsed.confidence || 50))
        };
    } catch {
        return { cleanTitle: '', category: 'DiÄŸer', brand: '', description: '', confidenceScore: 30 };
    }
}

async function enrichDealWithAI(deal: ScrapedDeal, apiKey: string): Promise<EnrichedDeal> {
    const prompt = `Sen deneyimli bir e-ticaret iÃ§erik yazarÄ±sÄ±n. AÅŸaÄŸÄ±daki indirim ilanÄ± iÃ§in kullanÄ±cÄ±larÄ± satÄ±n almaya teÅŸvik eden profesyonel bir aÃ§Ä±klama yaz.

ÃœRÃœN BÄ°LGÄ°LERÄ°:
- BaÅŸlÄ±k: "${deal.title}"
- Fiyat: ${deal.price} TL
- Kaynak: ${deal.source}
${deal.couponCode ? `- Kupon Kodu: ${deal.couponCode}` : ''}

GÃ–REVLER:

1. BAÅLIK TEMÄ°ZLE: Emoji, "FIRSAT", "SÃœPER", "KAÃ‡IRMA" gibi pazarlama kelimelerini kaldÄ±r. Sadece Ã¼rÃ¼n adÄ±nÄ± bÄ±rak.

2. KATEGORÄ° SEÃ‡ (sadece biri): GÄ±da, Elektronik, Giyim, Kozmetik, Ev & YaÅŸam, Anne & Bebek, Spor, Kitap, Oyuncak, DiÄŸer

3. MARKA TESPÄ°T ET: BaÅŸlÄ±ktan markayÄ± Ã§Ä±kar (bulamazsan boÅŸ bÄ±rak)

4. AÃ‡IKLAMA YAZ (Ã‡OK Ã–NEMLÄ° - 70-80 KELÄ°ME):
   Bu aÃ§Ä±klama ÅŸunlarÄ± iÃ§ermeli:
   - ÃœrÃ¼nÃ¼n temel Ã¶zelliklerini ve faydalarÄ±nÄ± anlat
   - Bu fiyatÄ±n neden cazip olduÄŸunu vurgula
   - ÃœrÃ¼nÃ¼n kalitesini veya popÃ¼lerliÄŸini belirt
   - KullanÄ±cÄ±yÄ± satÄ±n almaya teÅŸvik et
   - Aciliyet hissi oluÅŸtur (sÄ±nÄ±rlÄ± stok, kaÃ§Ä±rÄ±lmayacak fÄ±rsat vb.)
   ${deal.couponCode ? `- Kupon kodunu kullanmayÄ± hatÄ±rlat: ${deal.couponCode}` : ''}
   
   YAZIM KURALLARI:
   - Samimi ve ikna edici bir dil kullan
   - 4-5 cÃ¼mle yaz (70-80 kelime civarÄ±)
   - TÃ¼rkÃ§e yaz
   - Emoji kullanabilirsin (ğŸ”¥ ğŸ’° â­ ğŸ âœ¨ gibi)
   - Ä°lk cÃ¼mle dikkat Ã§ekici olsun
   - Son cÃ¼mle aksiyon Ã§aÄŸrÄ±sÄ± olsun

   Ã–RNEK Ä°YÄ° AÃ‡IKLAMA:
   "ğŸ”¥ Bu kablosuz kulaklÄ±k, aktif gÃ¼rÃ¼ltÃ¼ engelleme Ã¶zelliÄŸiyle mÃ¼zik deneyiminizi tamamen deÄŸiÅŸtirecek! 40 saat pil Ã¶mrÃ¼ sayesinde tÃ¼m gÃ¼n kesintisiz kullanabilirsiniz. Ergonomik tasarÄ±mÄ± uzun sÃ¼reli kullanÄ±mda bile konfor saÄŸlÄ±yor. Bu kalitede bir kulaklÄ±ÄŸÄ± bu fiyata bulmak gerÃ§ekten zor. Stoklar sÄ±nÄ±rlÄ±, fÄ±rsatÄ± kaÃ§Ä±rmadan hemen sepetinize ekleyin! â­"

5. GÃœVEN SKORU: 0-100 (Ã¼rÃ¼n bilgileri ne kadar net ve eksiksiz?)

SADECE JSON DÃ–NDÃœR, BAÅKA BÄ°R ÅEY YAZMA:
{"cleanTitle":"temiz Ã¼rÃ¼n baÅŸlÄ±ÄŸÄ±","category":"kategori","brand":"marka veya boÅŸ","description":"70-80 kelimelik detaylÄ± aÃ§Ä±klama","confidence":85}`;

    try {
        const responseText = await callGeminiAPI(prompt, apiKey);
        const aiResponse = parseAIResponse(responseText);

        return {
            ...deal,
            cleanTitle: aiResponse.cleanTitle || deal.title.replace(/[ğŸ”¥ğŸ›ï¸â­ğŸ’¥ğŸğŸ›’ğŸ·ï¸ğŸ“¦]+/g, '').trim(),
            category: aiResponse.category || 'DiÄŸer',
            brand: aiResponse.brand || '',
            description: aiResponse.description || '',
            confidenceScore: aiResponse.confidenceScore || 50
        };
    } catch (error: any) {
        const errMsg = error?.message || 'Bilinmeyen hata';
        console.error(`âŒ AI enrichment hatasÄ±: ${errMsg}`);
        return {
            ...deal,
            cleanTitle: deal.title.replace(/[ğŸ”¥ğŸ›ï¸â­ğŸ’¥ğŸğŸ›’ğŸ·ï¸ğŸ“¦]+/g, '').trim(),
            category: 'DiÄŸer',
            brand: '',
            description: `AI hatasÄ±: ${errMsg.substring(0, 50)}`, // Hata mesajÄ±nÄ± aÃ§Ä±klamada gÃ¶ster
            confidenceScore: 30
        };
    }
}

// ===== TELEGRAM FETCH =====

// Daha fazla yedek proxy - güvenilirlik için
// Cache busting için timestamp ekliyoruz
const CORS_PROXIES = [
    { name: 'allorigins', fn: (url: string) => `https://api.allorigins.win/get?url=${encodeURIComponent(url)}&_t=${Date.now()}` },
    { name: 'corsproxy.io', fn: (url: string) => `https://corsproxy.io/?${encodeURIComponent(url + (url.includes('?') ? '&' : '?') + '_t=' + Date.now())}` },
    { name: 'codetabs', fn: (url: string) => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(url)}&_t=${Date.now()}` },
    { name: 'thingproxy', fn: (url: string) => `https://thingproxy.freeboard.io/fetch/${url}${url.includes('?') ? '&' : '?'}_t=${Date.now()}` },
    { name: 'cors.lol', fn: (url: string) => `https://api.cors.lol/?url=${encodeURIComponent(url)}&_t=${Date.now()}` },
    { name: 'corsproxy.org', fn: (url: string) => `https://corsproxy.org/?${encodeURIComponent(url + (url.includes('?') ? '&' : '?') + '_t=' + Date.now())}` },
];

// Timeout ile fetch
async function fetchWithTimeout(url: string, timeout = 15000): Promise<Response> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
        const response = await fetch(url, {
            signal: controller.signal,
            headers: {
                'Accept': 'application/json, text/html, */*',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36'
            }
        });
        return response;
    } finally {
        clearTimeout(timeoutId);
    }
}

async function fetchWithProxy(targetUrl: string): Promise<string> {
    const errors: string[] = [];

    for (const proxy of CORS_PROXIES) {
        try {
            const proxyUrl = proxy.fn(targetUrl);
            console.log(`ğŸ”„ Proxy deneniyor: ${proxy.name}...`);

            const response = await fetchWithTimeout(proxyUrl, 15000);

            if (!response.ok) {
                const err = `${proxy.name}: HTTP ${response.status}`;
                console.log(`âš ï¸ ${err}`);
                errors.push(err);
                continue;
            }

            const contentType = response.headers.get('content-type') || '';
            let html = '';

            if (contentType.includes('application/json')) {
                const json = await response.json();
                html = json.contents || json.body || '';
            } else {
                html = await response.text();
            }

            // Ä°Ã§erik yeterince uzun mu kontrol et
            if (html && html.length > 500) {
                console.log(`âœ… ${proxy.name} baÅŸarÄ±lÄ±: ${html.length} karakter`);
                return html;
            } else {
                const err = `${proxy.name}: Ä°Ã§erik Ã§ok kÄ±sa (${html?.length || 0} karakter)`;
                console.log(`âš ï¸ ${err}`);
                errors.push(err);
            }
        } catch (error: any) {
            const errMsg = error.name === 'AbortError'
                ? `${proxy.name}: Timeout (15s)`
                : `${proxy.name}: ${error.message}`;
            console.log(`âŒ ${errMsg}`);
            errors.push(errMsg);
            continue;
        }
    }

    throw new Error(`TÃ¼m proxy'ler baÅŸarÄ±sÄ±z oldu: ${errors.join(', ')}`);
}

async function fetchTelegramDeals(): Promise<ScrapedDeal[]> {
    const telegramUrl = 'https://t.me/s/onual_firsat';

    console.log('ğŸ“± Telegram verisi Ã§ekiliyor...');
    const html = await fetchWithProxy(telegramUrl);

    if (!html || html.length < 100) {
        throw new Error(`Empty response from Telegram (${html?.length || 0} bytes)`);
    }

    console.log(`ğŸ“„ HTML alÄ±ndÄ±: ${html.length} karakter`);

    // GeliÅŸtirilmiÅŸ HTML parsing
    const deals: ScrapedDeal[] = [];
    const priceRegex = /(\d[\d.,]*)\s*TL/i;

    // Daha esnek mesaj regex'i - farklÄ± Telegram HTML formatlarÄ±nÄ± yakala
    const messagePatterns = [
        // Pattern 1: Standart Telegram widget mesajÄ±
        /class="tgme_widget_message[^"]*"[\s\S]*?data-post="[^"]*\/(\d+)"[\s\S]*?<\/div>\s*<\/div>\s*<\/div>/g,
        // Pattern 2: Daha basit eÅŸleÅŸme
        /tgme_widget_message_wrap[\s\S]*?href="(https?:\/\/onu\.al\/[^"]+)"[\s\S]*?<\/div>\s*<\/div>/g,
    ];

    // TÃ¼m onu.al linklerini bul (yedek yÃ¶ntem)
    const allOnuAlLinks = html.matchAll(/href="(https?:\/\/onu\.al\/[^"]+)"/g);
    const linkSet = new Set<string>();
    for (const m of allOnuAlLinks) {
        linkSet.add(m[1]);
    }

    console.log(`ğŸ”— Toplam ${linkSet.size} benzersiz onu.al linki bulundu`);

    // Her link için mesaj bloğunu bul ve parse et
    let msgIndex = 0;
    for (const link of linkSet) {
        // Linki içeren mesaj bloğunu bul
        // ÖNEMLI: Görsel (photo_wrap) mesajın en üstünde, link ise en altta
        // Bu yüzden link'ten önceki 3000 karakter alıyoruz
        const linkIndex = html.indexOf(`href="${link}"`);
        if (linkIndex === -1) continue;

        const start = Math.max(0, linkIndex - 3000);
        const end = Math.min(html.length, linkIndex + 500);
        const msgBlock = html.substring(start, end);

        // Metin iÃ§eriÄŸini Ã§Ä±kar
        const textMatch = msgBlock.match(/tgme_widget_message_text[^>]*>([\s\S]*?)<\/div>/);
        const rawText = textMatch ? textMatch[1] : '';
        // HTML tag'lerini temizle VE HTML entity'lerini decode et
        const text = decodeHtmlEntities(rawText.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());

        // Fiyat Ã§Ä±kar
        const priceMatch = text.match(priceRegex);
        const price = priceMatch ? parseInt(priceMatch[1].replace(/[.,]/g, ''), 10) : 0;

        // Görsel URL çıkar - GELİŞTİRİLMİŞ PATTERN'LER
        let imageUrl: string | undefined;

        // Pattern 1: tgme_widget_message_photo_wrap içindeki background-image (EN GÜVENİLİR)
        const photoWrapMatch = msgBlock.match(/tgme_widget_message_photo_wrap[^>]*style=["'][^"']*background-image:\s*url\(['"]?(https?:\/\/[^'"\)]+)['"]?\)/i);
        if (photoWrapMatch) {
            imageUrl = photoWrapMatch[1];
            console.log(`📷 Photo wrap'dan görsel bulundu`);
        }

        // Pattern 2: Genel background-image url() - telesco.pe ve cdn-telegram.org
        if (!imageUrl) {
            const bgImageMatch = msgBlock.match(/background-image:\s*url\(['"]?(https?:\/\/cdn[0-9]*\.(?:telesco\.pe|cdn-telegram\.org)\/file\/[^'"\)\s]+)['"]?\)/i);
            if (bgImageMatch) {
                imageUrl = bgImageMatch[1];
                console.log(`📷 Background-image'dan görsel bulundu`);
            }
        }

        // Pattern 3: Telegram CDN doğrudan link
        if (!imageUrl) {
            const cdnMatch = msgBlock.match(/https:\/\/cdn[0-9]*\.(?:telesco\.pe|cdn-telegram\.org)\/file\/[^"'\s\)<>]+/i);
            if (cdnMatch) {
                imageUrl = cdnMatch[0];
                console.log(`📷 CDN linkinden görsel bulundu`);
            }
        }

        // Pattern 4: style attribute içinde herhangi bir url()
        if (!imageUrl) {
            const styleUrlMatch = msgBlock.match(/style=["'][^"']*url\(['"]?(https?:\/\/[^'"\)]+)['"]?\)/i);
            if (styleUrlMatch) {
                imageUrl = styleUrlMatch[1];
            }
        }

        // Pattern 5: data-thumb veya src attribute
        if (!imageUrl) {
            const thumbMatch = msgBlock.match(/(?:data-thumb|src)=["'](https?:\/\/[^"']+)["']/i);
            if (thumbMatch) imageUrl = thumbMatch[1];
        }

        // Log: Görsel durumu
        if (imageUrl) {
            console.log(`✅ Görsel URL: ${imageUrl.substring(0, 60)}...`);
        } else {
            console.log(`⚠️ Bu mesajda görsel bulunamadı`);
        }

        // BaÅŸlÄ±k Ã§Ä±kar (ilk satÄ±r)
        const lines = text.split(/[.\n]/).filter(l => l.trim().length > 3);
        let title = lines[0]?.replace(/^[ğŸ”¥ğŸ·ï¸ğŸ“¦ğŸ›ï¸â­ğŸ’¥ğŸğŸ›’ğŸ“¢âœ¨ğŸ’°]+\s*/, '').trim() || '';

        // BaÅŸlÄ±k Ã§ok kÄ±saysa veya yoksa atla
        if (!title || title.length < 5) continue;

        // BaÅŸlÄ±k 150 karakterden uzunsa kes
        if (title.length > 150) title = title.substring(0, 147) + '...';

        // Kaynak belirle
        let source: ScrapedDeal['source'] = 'other';
        const textLower = text.toLowerCase();
        if (textLower.includes('amazon')) source = 'amazon';
        else if (textLower.includes('trendyol')) source = 'trendyol';
        else if (textLower.includes('hepsiburada')) source = 'hepsiburada';
        else if (textLower.includes('n11')) source = 'n11';

        deals.push({
            id: `auto_${Date.now()}_${msgIndex++}`,
            title,
            price,
            source,
            onualLink: link,
            productLink: link,
            imageUrl,
            channelName: 'OnuAl'
        });
    }

    console.log(`âœ… Telegram'dan ${deals.length} fÄ±rsat parse edildi`);

    if (deals.length === 0) {
        console.log('âš ï¸ Parse baÅŸarÄ±sÄ±z - HTML Ã¶rneÄŸi:', html.substring(0, 500));
    }

    return deals.slice(0, 20); // Max 20 deals per run
}

// ===== ONU.AL LINK RESOLVER =====

/**
 * onu.al kısa linkini gerçek mağaza linkine çözümle.
 * CORS proxy kullanarak onu.al sayfasını alır ve gerçek mağaza linkini çıkarır.
 * OnuAl artık zxro.com/u/?redirect=1&url=ENCODED_URL formatı kullanıyor.
 */
async function resolveOnuAlLink(shortLink: string): Promise<string> {
    if (!shortLink || !shortLink.includes('onu.al')) {
        return shortLink;
    }

    console.log(`🔗 Link çözümleniyor: ${shortLink}`);

    try {
        // CORS proxy ile onu.al sayfasını al
        const proxyUrl = `https://api.allorigins.win/get?url=${encodeURIComponent(shortLink)}`;

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 15000);

        const response = await fetch(proxyUrl, {
            method: 'GET',
            signal: controller.signal,
            headers: {
                'Accept': 'application/json'
            }
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
            console.log(`❌ Proxy yanıt vermedi: HTTP ${response.status}`);
            return shortLink;
        }

        const json = await response.json();
        const html = json.contents || '';

        if (html.length < 100) {
            console.log(`⚠️ Sayfa içeriği çok kısa: ${html.length} karakter`);
            return shortLink;
        }

        console.log(`📄 Sayfa alındı: ${html.length} karakter`);

        // Pattern 1: zxro.com redirect URL (YENİ FORMAT - EN ÖNCELİKLİ)
        // Format: https://zxro.com/u/?redirect=1&url=https%3A%2F%2Fwww.n11.com%2F...
        const zxroMatch = html.match(/href=['\"]?(https?:\/\/zxro\.com\/u\/\?[^'\">\s]+)['\"]?/i);
        if (zxroMatch && zxroMatch[1]) {
            try {
                const zxroUrl = new URL(zxroMatch[1]);
                const encodedUrl = zxroUrl.searchParams.get('url');
                if (encodedUrl) {
                    const decodedUrl = decodeURIComponent(encodedUrl);
                    console.log(`✅ zxro.com'dan link çözümlendi: ${decodedUrl.substring(0, 60)}...`);
                    return decodedUrl;
                }
            } catch (e) {
                console.log(`⚠️ zxro.com URL parse hatası`);
            }
        }

        // Pattern 2: id="buton" elementi (ESKİ FORMAT)
        const butonMatch = html.match(/id=['"]buton['"][^>]*href=['"]([^'"]+)['"]/i) ||
            html.match(/href=['"]([^'"]+)['"][^>]*id=['"]buton['"]/i);
        if (butonMatch && butonMatch[1] && !butonMatch[1].includes('onual')) {
            console.log(`✅ #buton linki bulundu: ${butonMatch[1]}`);
            return butonMatch[1];
        }

        // Pattern 3: ty.gl linkleri (Trendyol affiliate)
        const tyMatch = html.match(/href=['"]?(https?:\/\/ty\.gl\/[A-Za-z0-9]+)['"]?/i);
        if (tyMatch && tyMatch[1]) {
            console.log(`✅ Trendyol affiliate linki: ${tyMatch[1]}`);
            return tyMatch[1];
        }

        // Pattern 4: app.hb.biz linkleri (Hepsiburada affiliate)
        const hbMatch = html.match(/href=['"]?(https?:\/\/app\.hb\.biz\/[A-Za-z0-9]+)['"]?/i);
        if (hbMatch && hbMatch[1]) {
            console.log(`✅ Hepsiburada affiliate linki: ${hbMatch[1]}`);
            return hbMatch[1];
        }

        // Pattern 5: Amazon affiliate linkleri
        const amzMatch = html.match(/href=['"]?(https?:\/\/(?:www\.)?amazon\.com\.tr\/[^'">\s]+)['"]?/i);
        if (amzMatch && amzMatch[1]) {
            console.log(`✅ Amazon linki: ${amzMatch[1]}`);
            return amzMatch[1];
        }

        // Pattern 6: n11 linkleri
        const n11Match = html.match(/href=['"]?(https?:\/\/(?:www\.)?n11\.com\/[^'">\s]+)['"]?/i);
        if (n11Match && n11Match[1]) {
            console.log(`✅ N11 linki: ${n11Match[1]}`);
            return n11Match[1];
        }

        // Pattern 7: Herhangi bir dış mağaza linki (class="btn")
        const btnMatch = html.match(/class=['"][^'"]*btn[^'"]*['"][^>]*href=['"]([^'"]+)['"]/i);
        if (btnMatch && btnMatch[1] && !btnMatch[1].includes('onual')) {
            console.log(`✅ Btn class linki: ${btnMatch[1]}`);
            return btnMatch[1];
        }

        console.log(`⚠️ Mağaza linki bulunamadı, orijinal kullanılıyor`);
        return shortLink;

    } catch (error: any) {
        const errMsg = error.name === 'AbortError' ? 'Timeout' : error.message;
        console.log(`❌ Link çözümleme hatası: ${errMsg}`);
        return shortLink;
    }
}

// ===== IMGBB UPLOAD =====

/**
 * GÃ¶rseli Ã¶nce indir, base64'e Ã§evir, sonra ImgBB'ye yÃ¼kle.
 * Bu yÃ¶ntem Telegram CDN gibi kÄ±sÄ±tlÄ± kaynaklardan bile gÃ¼venilir Ã§alÄ±ÅŸÄ±r.
 */
async function uploadToImgbb(imageUrl: string, apiKey: string): Promise<{ url: string; deleteUrl: string } | null> {
    if (!imageUrl || !apiKey) {
        console.log('âš ï¸ ImgBB: Eksik parametre', { hasUrl: !!imageUrl, hasKey: !!apiKey });
        return null;
    }

    // Telegram CDN URL'lerini temizle (bazÄ± karakterler sorun Ã§Ä±karabiliyor)
    const cleanUrl = imageUrl.trim();
    console.log(`ğŸ“· GÃ¶rsel indiriliyor: ${cleanUrl.substring(0, 80)}...`);

    try {
        // 1. Ã–nce gÃ¶rseli indir
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 saniye

        const imageResponse = await fetch(cleanUrl, {
            signal: controller.signal,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
                'Accept': 'image/webp,image/apng,image/*,*/*;q=0.8',
                'Referer': 'https://t.me/',
                'Accept-Language': 'tr-TR,tr;q=0.9,en-US;q=0.8,en;q=0.7'
            }
        });

        clearTimeout(timeoutId);

        if (!imageResponse.ok) {
            console.log(`âŒ GÃ¶rsel indirilemedi: HTTP ${imageResponse.status} - ${imageResponse.statusText}`);
            return null;
        }

        const contentType = imageResponse.headers.get('content-type') || '';
        if (!contentType.includes('image')) {
            console.log(`âš ï¸ Ä°Ã§erik tÃ¼rÃ¼ gÃ¶rsel deÄŸil: ${contentType}`);
        }

        // 2. ArrayBuffer olarak al ve Base64'e Ã§evir
        const arrayBuffer = await imageResponse.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);

        if (buffer.length < 1000) {
            console.log(`âŒ GÃ¶rsel Ã§ok kÃ¼Ã§Ã¼k: ${buffer.length} bytes (minimum 1KB)`);
            return null;
        }

        const base64 = buffer.toString('base64');
        console.log(`âœ… GÃ¶rsel indirildi: ${Math.round(buffer.length / 1024)}KB, ImgBB'ye yÃ¼kleniyor...`);

        // 3. ImgBB'ye base64 olarak yÃ¼kle
        const formData = new URLSearchParams();
        formData.append('image', base64);

        const uploadController = new AbortController();
        const uploadTimeoutId = setTimeout(() => uploadController.abort(), 45000); // 45 saniye

        const uploadResponse = await fetch(`https://api.imgbb.com/1/upload?key=${apiKey}`, {
            method: 'POST',
            body: formData,
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
            },
            signal: uploadController.signal
        });

        clearTimeout(uploadTimeoutId);

        if (!uploadResponse.ok) {
            const errorText = await uploadResponse.text();
            console.log(`âŒ ImgBB HTTP ${uploadResponse.status}: ${errorText.substring(0, 150)}...`);
            return null;
        }

        const data = await uploadResponse.json();

        if (data.success && data.data?.url) {
            console.log(`âœ… ImgBB baÅŸarÄ±lÄ±: ${data.data.url}`);
            return {
                url: data.data.url,
                deleteUrl: data.data.delete_url || ''
            };
        } else {
            console.log('âŒ ImgBB yanÄ±t baÅŸarÄ±sÄ±z:', JSON.stringify(data).substring(0, 150));
            return null;
        }
    } catch (error: any) {
        const errMsg = error.name === 'AbortError' ? 'Timeout (zaman aÅŸÄ±mÄ±)' : error.message;
        console.log(`âŒ GÃ¶rsel yÃ¼kleme hatasÄ±: ${errMsg}`);
        return null;
    }
}

// ===== DUPLICATE CHECK =====

async function getRecentTitles(): Promise<Set<string>> {
    const titles = new Set<string>();

    const yesterday = new Date();
    yesterday.setHours(yesterday.getHours() - 1); // Test iÃ§in 1 saat (24 yerine)

    const snapshot = await db.collection('discounts')
        .where('createdAt', '>=', Timestamp.fromDate(yesterday))
        .orderBy('createdAt', 'desc')
        .limit(200)
        .get();

    snapshot.docs.forEach((doc: FirebaseFirestore.QueryDocumentSnapshot) => {
        const data = doc.data();
        if (data.title) {
            titles.add(data.title.toLowerCase().replace(/[^a-z0-9Ã§ÄŸÄ±Ã¶ÅŸÃ¼]/gi, ''));
        }
    });

    return titles;
}

function isDuplicate(title: string, existingTitles: Set<string>): boolean {
    const normalized = title.toLowerCase().replace(/[^a-z0-9Ã§ÄŸÄ±Ã¶ÅŸÃ¼]/gi, '');
    return existingTitles.has(normalized);
}

// ===== SETTINGS =====

async function getSettings(): Promise<AutoPublishSettings> {
    const doc = await db.collection('settings').doc('autoPublish').get();
    if (doc.exists) {
        return doc.data() as AutoPublishSettings;
    }
    return {
        isActive: true,
        minConfidenceScore: 60,
        minPrice: 10,
        maxDailyPublish: 200, // Test iÃ§in artÄ±rÄ±ldÄ± (normalde 50)
        requireImage: true
    };
}

async function getTodayPublishCount(): Promise<number> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const snapshot = await db.collection('discounts')
        .where('createdAt', '>=', Timestamp.fromDate(today))
        .where('originalSource', '==', 'AutoPublish')
        .get();

    return snapshot.size;
}

// ===== MAIN HANDLER =====

export default async function handler(req: VercelRequest, res: VercelResponse) {
    // CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    // Security check
    const { secret } = req.query;
    const expectedSecret = process.env.AUTO_PUBLISH_SECRET;

    if (!expectedSecret || secret !== expectedSecret) {
        console.log('âŒ Unauthorized request');
        return res.status(401).json({ error: 'Unauthorized' });
    }

    // Gemini DEVRE DIŞI - AI kullanmıyoruz
    // const geminiKey = process.env.GEMINI_API_KEY;
    const imgbbKey = process.env.IMGBB_API_KEY;

    // Gemini artık zorunlu değil - temel verilerle çalışıyoruz
    console.log('ℹ️ Gemini API devre dışı - temel verilerle çalışılıyor');

    const result = {
        success: false,
        processed: 0,
        published: 0,
        skipped: 0,
        savedToReview: 0, // DÃ¼zenleme gereken kaydedilen sayÄ±sÄ±
        errors: [] as string[],
        skipReasons: [] as string[], // Debug: neden skip edildiÄŸi
        timestamp: new Date().toISOString()
    };

    try {
        // 1. Check settings
        const settings = await getSettings();

        if (!settings.isActive) {
            console.log('â¸ï¸ Auto-publish disabled');
            return res.status(200).json({ ...result, message: 'Auto-publish disabled' });
        }

        // 2. Check daily limit (GEÃ‡Ä°CÄ° OLARAK DEVRE DIÅI - TEST Ä°Ã‡Ä°N)
        const todayCount = await getTodayPublishCount();
        console.log(`ğŸ“Š BugÃ¼nkÃ¼ sayÄ±: ${todayCount}/${settings.maxDailyPublish}`);
        // if (todayCount >= settings.maxDailyPublish) {
        //     console.log(`ğŸš« Daily limit reached: ${todayCount}/${settings.maxDailyPublish}`);
        //     return res.status(200).json({ ...result, message: 'Daily limit reached' });
        // }

        const remainingSlots = settings.maxDailyPublish - todayCount;

        // 3. Fetch deals from Telegram
        console.log('ğŸ“± Fetching deals from Telegram...');
        const deals = await fetchTelegramDeals();

        if (deals.length === 0) {
            console.log('ğŸ“­ No deals found');
            return res.status(200).json({ ...result, message: 'No deals found' });
        }

        console.log(`ğŸ“¦ Found ${deals.length} deals`);

        // 4. Get existing titles for duplicate check
        const existingTitles = await getRecentTitles();

        // 5. Filter duplicates (GEÃ‡Ä°CÄ° OLARAK DEVRE DIÅI - TEST Ä°Ã‡Ä°N)
        // const newDeals = deals.filter(d => !isDuplicate(d.title, existingTitles));
        const newDeals = deals.slice(0, 5); // Test iÃ§in sadece ilk 5 ilan

        if (newDeals.length === 0) {
            console.log('ğŸ”„ All deals already published');
            return res.status(200).json({ ...result, skipped: deals.length, message: 'All duplicates' });
        }

        // 6. Process limited deals (TEST: 5 ilan iÅŸle, remainingSlots negatif olabilir)
        const dealsToProcess = newDeals.slice(0, 5);
        result.processed = dealsToProcess.length;

        // 7. Process each deal - AI OPSIYONEL
        for (const deal of dealsToProcess) {
            try {
                console.log(`ğŸ“¦ Ä°ÅŸleniyor: ${deal.title.substring(0, 50)}...`);

                // === ADIM 1: Temel deÄŸerler (AI'sÄ±z Ã§alÄ±ÅŸÄ±r) ===
                let cleanTitle = deal.title
                    .replace(/[ğŸ”¥ğŸ›ï¸â­ğŸ’¥ğŸğŸ›’ğŸ·ï¸ğŸ“¦ğŸ“¢âœ¨ğŸ’°]+/g, '')
                    .replace(/\b(FIRSAT|SÜPER|KAÇIRMA|İNANILMAZ|MEGA)\b/gi, '')
                    .replace(/\s+/g, ' ')
                    .trim();
                let category = 'Diğer';
                let brand = '';
                let description = deal.couponCode
                    ? `Kupon Kodu: ${deal.couponCode} - Bu fırsatı kaçırmayın!`
                    : 'Bu ürün için özel indirim fırsatı! Stoklar sınırlı.';
                let confidenceScore = 50;

                // === ADIM 2: AI DEVRE DIŞI ===
                // Gemini kullanılmıyor - temel verilerle devam
                console.log(`ℹ️ AI devre dışı - temel başlık ve açıklama kullanılıyor`);
                confidenceScore = 60;

                // === ADIM 3: Görseli doğrudan kullan (ImgBB devre dışı) ===
                // Telegram CDN görselleri kalıcı - doğrudan kullanıyoruz
                let finalImageUrl = deal.imageUrl || '';
                let deleteUrl = '';

                if (finalImageUrl) {
                    console.log(`📷 Görsel URL (Telegram CDN): ${finalImageUrl.substring(0, 80)}...`);
                } else {
                    console.log(`⚠️ Bu üründe görsel yok`);
                }

                // === ADIM 4: Link - onu.al'dan gerçek mağaza linkini çözümle ===
                let productLink = deal.productLink || deal.onualLink;
                try {
                    const resolvedLink = await resolveOnuAlLink(productLink);
                    if (resolvedLink && !resolvedLink.includes('onu.al') && !resolvedLink.includes('onual.com')) {
                        productLink = resolvedLink;
                        console.log(`✅ Link çözümlendi: ${productLink.substring(0, 60)}...`);
                    } else {
                        console.log(`⚠️ Link çözümlenemedi, orijinal kullanılıyor: ${productLink}`);
                    }
                } catch (linkError: any) {
                    console.log(`❌ Link çözümleme hatası: ${linkError.message}`);
                }
                // === ADIM 5: Firebase'e kaydet ===
                // Görsel yoksa düzenleme gerekir
                const needsReview = !finalImageUrl;

                await db.collection('discounts').add({
                    title: cleanTitle,
                    description: description,
                    brand: brand,
                    category: category,
                    link: productLink,
                    oldPrice: 0,
                    newPrice: deal.price || 0,
                    imageUrl: finalImageUrl,
                    deleteUrl,
                    submittedBy: 'AutoPublish',
                    originalSource: 'AutoPublish',
                    affiliateLinkUpdated: false,
                    aiConfidenceScore: confidenceScore,
                    needsReview,
                    createdAt: FieldValue.serverTimestamp()
                });


                if (needsReview) {
                    result.savedToReview++;
                    const reason = !finalImageUrl ? 'görsel yüklenemedi' : 'düzenleme gerekli';
                    result.skipReasons.push(`${cleanTitle.substring(0, 30)}: ${reason}`);
                    console.log(`📝 Kaydedildi (düzenleme gerekli): ${cleanTitle.substring(0, 40)}`);
                } else {
                    result.published++;
                    console.log(`âœ… YayÄ±nlandÄ±: ${cleanTitle.substring(0, 40)}`);
                }

                // Rate limiting - 2 saniye bekle
                await new Promise(r => setTimeout(r, 2000));

            } catch (error: any) {
                console.error(`âŒ Error: ${error.message}`);
                result.errors.push(`${deal.title.substring(0, 30)}: ${error.message}`);
            }
        }

        result.success = true;

        // Log result
        await db.collection('autoPublishLogs').add({
            logTimestamp: FieldValue.serverTimestamp(),
            ...result
        });

        console.log(`ğŸ“Š Result: ${result.published} published, ${result.skipped} skipped`);

        return res.status(200).json(result);

    } catch (error: any) {
        console.error('âŒ Auto-publish error:', error);
        result.errors.push(error.message);
        return res.status(500).json(result);
    }
}

