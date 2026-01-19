/**
 * Link Analyzer Service - Jina Reader + Groq + Microlink Image
 */

export interface AnalyzedProduct {
    title: string;
    brand: string;
    store: string;
    category: string;
    description: string;
    oldPrice: number;
    newPrice: number;
    imageUrl: string;
    discountPercent: number;
    link: string;
}

const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_MODEL = 'llama-3.3-70b-versatile';

/**
 * Jina Reader ile sayfa içeriğini çek
 */
async function fetchPageWithJina(url: string): Promise<string> {
    console.log('📖 Jina Reader ile sayfa okunuyor...');

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 25000);

    try {
        const jinaUrl = `https://r.jina.ai/${url}`;

        const response = await fetch(jinaUrl, {
            signal: controller.signal,
            headers: { 'Accept': 'text/plain' }
        });

        clearTimeout(timeoutId);

        if (!response.ok) throw new Error(`Jina hatası: ${response.status}`);

        const content = await response.text();
        console.log(`✅ Sayfa okundu (${content.length} karakter)`);
        return content;
    } catch (err: any) {
        clearTimeout(timeoutId);
        if (err.name === 'AbortError') throw new Error('Zaman aşımı');
        throw err;
    }
}

/**
 * Doğrudan HTML'den og:image çıkar (Gemini'nin yaptığı gibi)
 */
async function fetchOgImage(url: string): Promise<string> {
    console.log('🖼️ HTML\'den og:image çıkarılıyor...');

    try {
        // CORS proxy ile HTML çek
        const proxyUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`;

        const response = await fetch(proxyUrl, {
            signal: AbortSignal.timeout(10000) // 10 saniye timeout
        });

        if (!response.ok) {
            console.warn('HTML çekme hatası:', response.status);
            return '';
        }

        const html = await response.text();

        // 1. og:image meta etiketini ara (en güvenilir)
        const ogImageMatch = html.match(/<meta[^>]*property=["']og:image["'][^>]*content=["']([^"']+)["']/i) ||
            html.match(/<meta[^>]*content=["']([^"']+)["'][^>]*property=["']og:image["']/i);

        if (ogImageMatch && ogImageMatch[1]) {
            console.log('✅ og:image bulundu');
            return ogImageMatch[1];
        }

        // 2. Twitter card image
        const twitterMatch = html.match(/<meta[^>]*name=["']twitter:image["'][^>]*content=["']([^"']+)["']/i);
        if (twitterMatch && twitterMatch[1]) {
            console.log('✅ twitter:image bulundu');
            return twitterMatch[1];
        }

        // 3. Schema.org Product image
        const schemaMatch = html.match(/"image"\s*:\s*"(https?:\/\/[^"]+)"/i) ||
            html.match(/"image"\s*:\s*\[\s*"(https?:\/\/[^"]+)"/i);
        if (schemaMatch && schemaMatch[1]) {
            console.log('✅ Schema.org image bulundu');
            return schemaMatch[1];
        }

        // 4. Main product image class
        const mainImgMatch = html.match(/<img[^>]*class=["'][^"']*(?:main|product|hero)[^"']*["'][^>]*src=["']([^"']+)["']/i) ||
            html.match(/<img[^>]*src=["']([^"']+)["'][^>]*class=["'][^"']*(?:main|product|hero)[^"']*["']/i);
        if (mainImgMatch && mainImgMatch[1]) {
            console.log('✅ Ana ürün görseli bulundu');
            return mainImgMatch[1];
        }

    } catch (err) {
        console.warn('OG image çıkarma hatası:', err);
    }

    return '';
}

/**
 * İçerikten ÜRÜN görselini çıkar (ikonları atla)
 */
function extractImageFromContent(content: string): string {
    // Tüm resim URL'lerini bul
    const allImageUrls: string[] = [];

    // Markdown format: ![alt](url)
    const mdMatches = content.matchAll(/!\[.*?\]\((https?:\/\/[^\s\)]+)\)/gi);
    for (const m of mdMatches) {
        if (m[1]) allImageUrls.push(m[1]);
    }

    // Direkt URL'ler
    const urlMatches = content.matchAll(/(https?:\/\/[^\s"'\)]+\.(?:jpg|jpeg|png|webp)[^\s"'\)]*)/gi);
    for (const m of urlMatches) {
        if (m[1]) allImageUrls.push(m[1]);
    }

    // Filtreleme - gerçek ürün görselini bul
    for (const url of allImageUrls) {
        const lowerUrl = url.toLowerCase();

        // Bu kelimeleri içeren URL'leri atla (ikon, logo, badge vb.)
        const skipPatterns = [
            'icon', 'logo', 'avatar', 'badge', 'sprite',
            'button', 'arrow', 'star', 'rating', 'flag',
            'payment', 'cargo', 'kargo', 'shipping',
            'banner', 'ad-', 'ads-', 'promo',
            'favicon', 'thumb', 'tiny', 'mini', 'small',
            '/a1/', '/s1/', '/t1/',  // N11 küçük resim formatları
            '30x', '50x', '100x', 'x30', 'x50', 'x100', // Boyut belirten
            'placeholder', 'loading', 'lazy',
            'facebook', 'twitter', 'instagram', 'whatsapp', 'social'
        ];

        let shouldSkip = false;
        for (const pattern of skipPatterns) {
            if (lowerUrl.includes(pattern)) {
                shouldSkip = true;
                break;
            }
        }

        if (shouldSkip) continue;

        // URL minimum uzunluk kontrolü
        if (url.length < 50) continue;

        // Ürün görseli olabilecek kalıpları tercih et
        const goodPatterns = ['product', 'urun', 'img', 'image', 'media', '/n11/', 'cdn', 'static'];
        let isLikelyProduct = false;
        for (const pattern of goodPatterns) {
            if (lowerUrl.includes(pattern)) {
                isLikelyProduct = true;
                break;
            }
        }

        // Büyük resim formatını tercih et (örn: /450/, /600/, /800/)
        if (lowerUrl.match(/\/[456789]\d\d\//)) {
            return url;
        }

        if (isLikelyProduct) {
            return url;
        }
    }

    // Hiçbir şey bulamazsa boş döndür
    return '';
}

/**
 * Groq API ile analiz et
 */
async function analyzeWithGroq(content: string, url: string, storeName: string): Promise<{
    title: string;
    brand: string;
    category: string;
    description: string;
    oldPrice: number;
    newPrice: number;
    discountPercent: number;
    imageUrl: string;
}> {
    // @ts-ignore
    const GROQ_API_KEY = (import.meta as any).env?.VITE_GROQ_API_KEY || '';
    // @ts-ignore  
    const GEMINI_API_KEY = (import.meta as any).env?.VITE_GEMINI_API_KEY || '';

    const prompt = `Sen profesyonel bir e-ticaret pazarlama uzmanısın. Ürün sayfası içeriğini analiz et.

SAYFA İÇERİĞİ:
${content.slice(0, 7000)}

GÖREV: Ürün bilgilerini JSON formatında döndür.

KURALLAR:
- title: Ürünün TAM başlığı
- brand: Marka adı
- category: Kategori (Elektronik, Giyim, Ev & Yaşam, Kozmetik, Mutfak, Spor, Gıda, Diğer)
- oldPrice: Eski/liste fiyatı (SADECE SAYI)
- newPrice: İndirimli fiyat (SADECE SAYI)
- discountPercent: İndirim oranı (SADECE SAYI)
- description: MUTLAKA 60-80 KELİME ARASI satış açıklaması yaz! Bu zorunlu:
  * Ürünün özelliklerini ve faydalarını DETAYLI anlat
  * 4-5 emoji kullan: 🔥💰⭐✨🎁🛒💪👍🎯
  * "Kaçırmayın!", "Stoklar sınırlı!", "Hemen alın!", "Bu fiyata bu kalite!" gibi satış cümleleri ekle
  * İkna edici, samimi ve profesyonel bir dil kullan
  * KISA AÇIKLAMA KABUL EDİLMEZ - minimum 60 kelime!

SADECE JSON:
{"title":"","brand":"","category":"","oldPrice":0,"newPrice":0,"discountPercent":0,"imageUrl":"","description":""}`;


    let text = '';

    if (GROQ_API_KEY) {
        try {
            const response = await fetch(GROQ_API_URL, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${GROQ_API_KEY}`
                },
                body: JSON.stringify({
                    model: GROQ_MODEL,
                    messages: [{ role: 'user', content: prompt }],
                    temperature: 0.7,
                    max_tokens: 1000
                })
            });

            if (response.ok) {
                const data = await response.json();
                text = data.choices?.[0]?.message?.content || '';
            }
        } catch (err) {
            console.warn('Groq hatası:', err);
        }
    }

    if (!text && GEMINI_API_KEY) {
        try {
            const response = await fetch(
                `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        contents: [{ parts: [{ text: prompt }] }],
                        generationConfig: { temperature: 0.7, maxOutputTokens: 1000 }
                    })
                }
            );

            if (response.ok) {
                const data = await response.json();
                text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
            }
        } catch (err) {
            console.warn('Gemini hatası:', err);
        }
    }

    if (!text) throw new Error('AI yanıt vermedi');

    // JSON parse
    let jsonStr = text;
    if (jsonStr.includes('```')) {
        jsonStr = jsonStr.replace(/```json?\n?/g, '').replace(/```/g, '');
    }
    const jsonMatch = jsonStr.match(/\{[\s\S]*\}/);
    if (jsonMatch) jsonStr = jsonMatch[0];

    const parsed = JSON.parse(jsonStr.trim());

    return {
        title: parsed.title || 'Ürün',
        brand: parsed.brand || '',
        category: parsed.category || 'Diğer',
        description: parsed.description || `${storeName}'da harika fırsat! 🔥`,
        oldPrice: parseFloat(String(parsed.oldPrice).replace(/[^\d.]/g, '')) || 0,
        newPrice: parseFloat(String(parsed.newPrice).replace(/[^\d.]/g, '')) || 0,
        discountPercent: parseInt(String(parsed.discountPercent).replace(/[^\d]/g, '')) || 0,
        imageUrl: parsed.imageUrl || '',
    };
}

/**
 * Ana fonksiyon
 */
export async function analyzeProductLink(link: string): Promise<AnalyzedProduct> {
    let storeName = 'Online Mağaza';
    if (link.includes('trendyol')) storeName = 'Trendyol';
    else if (link.includes('hepsiburada')) storeName = 'Hepsiburada';
    else if (link.includes('n11')) storeName = 'N11';
    else if (link.includes('amazon')) storeName = 'Amazon';

    // 1. Sayfayı oku
    const pageContent = await fetchPageWithJina(link);

    // 2. AI ile analiz et
    const aiResult = await analyzeWithGroq(pageContent, link, storeName);

    // NOT: Görsel çıkarma güvenilir çalışmıyor (tracking pixel'ler geliyor)
    // Kullanıcı mobilden manuel ekleyecek
    const imageUrl = '';

    // İndirim hesapla
    let discountPercent = aiResult.discountPercent;
    if (!discountPercent && aiResult.oldPrice > 0 && aiResult.newPrice > 0) {
        discountPercent = Math.round(((aiResult.oldPrice - aiResult.newPrice) / aiResult.oldPrice) * 100);
    }

    return {
        title: aiResult.title,
        brand: aiResult.brand,
        category: aiResult.category,
        description: aiResult.description,
        oldPrice: aiResult.oldPrice,
        newPrice: aiResult.newPrice,
        store: storeName,
        imageUrl: imageUrl,
        discountPercent: discountPercent,
        link: link
    };
}

export function isValidProductLink(link: string): boolean {
    return link?.startsWith('http') || false;
}
