import { GoogleGenAI } from '@google/genai';

/**
 * Link Analyzer Service - Jina Reader + Google Gemini SDK + Microlink Image
 */

export interface AnalyzedProduct {
    title: string;
    brand: string;
    store: string;
    category: string;
    description?: string;
    oldPrice: number;
    newPrice: number;
    imageUrl: string;
    discountPercent: number;
    link: string;
    error?: string;
}

const MICROLINK_API_URL = 'https://api.microlink.io';

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
    // NOT: Vercel proxy (fetchProductDataFromVercel) zaten og:image ve daha fazlasını
    // profesyonelce çekiyor. Bu fonksiyon sadece yapısal bütünlük için duruyor.
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

        // Bu kelimeleri içeren URL'leri atla
        const skipPatterns = [
            'icon', 'logo', 'avatar', 'badge', 'sprite', 'button', 'arrow', 
            'star', 'rating', 'flag', 'payment', 'cargo', 'kargo', 'shipping',
            'banner', 'promo', 'favicon', 'thumb', 'tiny', 'mini', 'small',
            'loading', 'lazy', 'social', 'facebook', 'instagram', 'twitter'
        ];

        if (skipPatterns.some(p => lowerUrl.includes(p))) continue;

        // URL minimum uzunluk kontrolü (küçük ikonlar kısa olur)
        if (url.length < 40) continue;

        // Boyut belirten negatif filtreler (örn: /50x50/, /100/)
        if (lowerUrl.match(/\b\d{1,2}x\d{1,2}\b/) || lowerUrl.match(/[\/_]\d{1,2}[\/_]/)) continue;

        // Ürün görseli olabilecek pozitif kalıplar
        const goodPatterns = ['product', 'urun', 'detail', 'big', 'large', '800', '1200', 'cdn', 'dsmcdn', 'productimages'];
        if (goodPatterns.some(p => lowerUrl.includes(p))) {
            return url;
        }
    }

    // Pozitif eşleşme yoksa, ilk "mantıklı" URL'yi dön (çok küçük değilse)
    return allImageUrls.find(u => u.length > 60) || '';

    // Hiçbir şey bulamazsa boş döndür
    return '';
}

/**
 * Vercel Serverless API üzerinden fiyat ve görsel çıkar (CORS bypass)
 */
async function fetchProductDataFromVercel(url: string): Promise<{
    title: string;
    brand: string;
    newPrice: number;
    oldPrice: number;
    imageUrl: string;
}> {
    console.log('🚀 Vercel API ile ürün analiz ediliyor...');

    try {
        const apiUrl = `https://indiva-proxy.vercel.app/api/scrape?action=analyze&url=${encodeURIComponent(url)}`;

        const response = await fetch(apiUrl, {
            signal: AbortSignal.timeout(30000)
        });

        if (!response.ok) {
            console.warn('Vercel API hatası:', response.status);
            return { title: '', brand: '', newPrice: 0, oldPrice: 0, imageUrl: '' };
        }

        const result = await response.json();

        if (result.success && result.data) {
            console.log(`✅ Vercel API başarılı: ${result.data.newPrice} TL, görsel: ${result.data.imageUrl ? '✓' : '✗'}`);
            return {
                title: result.data.title || '',
                brand: result.data.brand || '',
                newPrice: result.data.newPrice || 0,
                oldPrice: result.data.oldPrice || 0,
                imageUrl: result.data.imageUrl || ''
            };
        }

        return { title: '', brand: '', newPrice: 0, oldPrice: 0, imageUrl: '' };

    } catch (err) {
        console.warn('Vercel API hatası:', err);
        return { title: '', brand: '', newPrice: 0, oldPrice: 0, imageUrl: '' };
    }
}

/**
 * Google Gemini SDK ile analiz et
 */
async function analyzeWithGemini(content: string, url: string, storeName: string): Promise<{
    title: string;
    brand: string;
    category: string;
    description?: string;
    oldPrice: number;
    newPrice: number;
    discountPercent: number;
    imageUrl: string;
}> {
    // @ts-ignore  
    const GEMINI_API_KEY = (import.meta as any).env?.VITE_GEMINI_API_KEY || '';

    if (!GEMINI_API_KEY) throw new Error('Gemini API anahtarı bulunamadı.');

    const genAI = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
    const MODEL = 'gemini-2.5-flash-lite';

    const prompt = `Sen INDIVA uygulamasının kıdemli Teknik Ürün Analisti ve e-ticaret metin yazarı uzmanısın. 
    Görevin, paylaşılan ürün sayfasını derinlemesine analiz ederek kullanıcılar için "profesyonel bir inceleme ve fırsat paylaşımı" hazırlamaktır.

    SAYFA İÇERİĞİ:
    ${content.slice(0, 9000)}

    GÖREV: Ürün bilgilerini JSON formatında teknik bir ciddiyetle döndür.

    KRİTİK PAZARLAMA KURALLARI:
    1. TEKNİK ANALİZ: Sadece başlıktaki metni süsleme. Ürün sayfasındaki teknik verileri (malzeme kalitesi, pil ömrü, motor gücü, ekran teknolojisi, gramaj, içerik vb.) ayıkla ve metne yedir.
    2. BİLİRKİŞİ TONU: Bir pazarlamacı gibi değil, o alanda uzman bir bilirkişi gibi konuş. "Harika", "muhteşem" gibi boş kelimeler yerine "yüksek performanslı", "dayanıklı yapı", "profesyonel çözüm" gibi somut ifadeler kullan.
    3. EYLEM ÇAĞRISI: Metnin sonunda samimi ama ikna edici bir neden sun.
    4. KISITLAMA: Metin 45-60 kelime arası, tek paragraf ve akıcı olmalı. Emocileri (2-4 adet) stratejik kullan.

    İÇERİK DOĞRULAMA KURALI: 
    Eğer içerikte "captcha", "robot", "access denied", "site error" gibi hata mesajları görüyorsan veya içerik çok boşsa KESİNLİKLE uydurma veri üretme! Bu durumda SADECE şunu döndür: {"error": "INVALID_CONTENT"}

    JSON YAPISI:
    - title: Ürünün TAM ve resmi adı (gereksiz kampanya kodları hariç)
    - brand: Kesin marka adı
    - category: Listedeki en uygun kategori (Teknoloji, Giyim, Ev, Kozmetik, Anne/Bebek, Spor, Pet vb.)
    - oldPrice: Tespit edilen piyasa fiyatı (Sadece sayı)
    - newPrice: Güncel kampanya fiyatı (Sadece sayı)
    - discountPercent: Hesaplanan indirim (Sadece sayı)
    - category: Tespit edilen en uygun kategori.
    
    YALNIZCA JSON DÖNDÜR (Açıklama profesyonel ve teknik bir inceleme olmalıdır, pazarlama sloganlarından kaçın):
    {"title":"","brand":"","category":"","oldPrice":0,"newPrice":0,"discountPercent":0,"imageUrl":""}`;

    let text = '';

    try {
        const systemInstruction = `Sen INDIVA uygulamasının kıdemli Teknik Ürün Analisti ve e-ticaret metin yazarı uzmanısın. 
        Görevin, paylaşılan ürün sayfasını derinlemesine analiz ederek kullanıcılar için "profesyonel bir inceleme ve fırsat paylaşımı" hazırlamaktır.`;

        const userPrompt = `SAYFA İÇERİĞİ:
        ${content.slice(0, 15000)}

        GÖREV: Ürün bilgilerini JSON formatında teknik bir ciddiyetle döndür.
        
        JSON YAPISI:
        - title: Ürünün TAM ve resmi adı
        - brand: Kesin marka adı
        - category: Listedeki en uygun kategori (Teknoloji, Giyim, Ev, Kozmetik, Anne/Bebek, Spor, Pet vb.)
        - oldPrice: Tespit edilen piyasa fiyatı (Sadece sayı)
        - newPrice: Güncel kampanya fiyatı (Sadece sayı)
        - discountPercent: Hesaplanan indirim (Sadece sayı)
        - category: Tespit edilen en uygun kategori.
        
        Açıklama profesyonel ve teknik bir inceleme olmalıdır. Sadece JSON döndür.`;

        const response = await genAI.models.generateContent({
            model: MODEL,
            contents: [{ role: 'user', parts: [{ text: `${systemInstruction}\n\n${userPrompt}` }] }],
            config: {
                temperature: 0.1
            }
        });

        text = response.text || '';
    } catch (err) {
        console.warn('Gemini SDK Hatası:', err);
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

    if (parsed.error === 'INVALID_CONTENT') {
        throw new Error('Ürün içeriği analiz edilemedi (AI reddetti).');
    }

    // Fiyatları parse et
    const newPrice = parseFloat(String(parsed.newPrice).replace(/[^\d.]/g, '')) || 0;
    let oldPrice = parseFloat(String(parsed.oldPrice).replace(/[^\d.]/g, '')) || 0;

    // Eğer eski fiyat bulunamadıysa, yeni fiyatın %30 fazlasını kullan
    if (oldPrice === 0 && newPrice > 0) {
        oldPrice = Math.round(newPrice * 1.3);
    }

    return {
        title: parsed.title || 'Ürün',
        brand: parsed.brand || '',
        category: parsed.category || 'Diğer',
        oldPrice: oldPrice,
        newPrice: newPrice,
        discountPercent: parseInt(String(parsed.discountPercent).replace(/[^\d]/g, '')) || 0,
        imageUrl: parsed.imageUrl || '',
    };
}

/**
 * Ana fonksiyon
 */
export async function analyzeProductLink(link: string): Promise<AnalyzedProduct> {
    // Mağaza tespiti - URL pattern'lerine göre (kısa linkler dahil)
    // ty.gl = Trendyol, hb.biz/app.hb = Hepsiburada, amzn.to = Amazon
    let storeName = 'Online Mağaza';
    const lowerLink = link.toLowerCase();

    if (lowerLink.includes('trendyol') || lowerLink.includes('ty.gl')) {
        storeName = 'Trendyol';
    } else if (lowerLink.includes('hepsiburada') || lowerLink.includes('hb.biz') || lowerLink.includes('app.hb')) {
        storeName = 'Hepsiburada';
    } else if (lowerLink.includes('n11.com') || lowerLink.includes('sl.n11')) {
        storeName = 'N11';
    } else if (lowerLink.includes('amazon') || lowerLink.includes('amzn.to')) {
        storeName = 'Amazon';
    }

    console.log(`🏪 Mağaza tespiti: ${storeName} (link: ${link.substring(0, 50)}...)`);

    // 1. Önce Vercel üzerinden analiz et (URL çözmek ve temel verileri almak için)
    const vercelData = await fetchProductDataFromVercel(link);
    const resolvedUrl = (vercelData as any).url || link;

    // 2. Çözülmüş URL ile Jina Reader'dan içerik çek
    const pageContent = await fetchPageWithJina(resolvedUrl);

    // İçerik çok kısaysa veya hata sayfasıysa dur
    if (pageContent.length < 500) {
        throw new Error('Ürün sayfası okunamadı. Lütfen direkt ürün linkini kullanmayı deneyin.');
    }

    // 3. AI ile analiz et
    const aiResult = await analyzeWithGemini(pageContent, resolvedUrl, storeName);

    // 3. Fiyatları belirle - Vercel API öncelikli, sonra AI
    let finalNewPrice = vercelData.newPrice || aiResult.newPrice;
    let finalOldPrice = vercelData.oldPrice || aiResult.oldPrice;

    // Eğer hala eski fiyat yoksa, yeni fiyatın %30 fazlasını kullan
    if (finalOldPrice === 0 && finalNewPrice > 0) {
        finalOldPrice = Math.round(finalNewPrice * 1.3);
    }

    // 4. Görsel - Çoklu fallback mekanizması (Vercel > og:image > AI > Jina)
    let imageUrl = vercelData.imageUrl || '';

    // Fallback 1: og:image meta tag'inden çek (Hepsiburada 403 bypass için)
    if (!imageUrl) {
        console.log('⚠️ Vercel API görsel döndürmedi, og:image deneniyor...');
        imageUrl = await fetchOgImage(link);
    }

    // Fallback 2: AI sonucundan al
    if (!imageUrl && aiResult.imageUrl) {
        console.log('⚠️ og:image bulunamadı, AI sonucundan alınıyor...');
        imageUrl = aiResult.imageUrl;
    }

    // Fallback 3: Jina content'inden çıkar
    if (!imageUrl && pageContent) {
        console.log('⚠️ AI görseli yok, Jina content\'inden çıkarılıyor...');
        imageUrl = extractImageFromContent(pageContent);
    }

    // Log sonuçları
    console.log(`📊 Analiz sonucu: Fiyat=${finalNewPrice}, Görsel=${imageUrl ? '✓' : '✗'}, Mağaza=${storeName}`);

    // 5. Marka - Vercel API öncelikli, sonra AI
    const brand = vercelData.brand || aiResult.brand;

    // 6. Başlık - Vercel API öncelikli, sonra AI  
    const title = vercelData.title || aiResult.title;

    // İndirim hesapla
    let discountPercent = aiResult.discountPercent;
    if (!discountPercent && finalOldPrice > 0 && finalNewPrice > 0) {
        discountPercent = Math.round(((finalOldPrice - finalNewPrice) / finalOldPrice) * 100);
    }

    return {
        title: title,
        brand: brand,
        category: aiResult.category,
        oldPrice: finalOldPrice,
        newPrice: finalNewPrice,
        store: storeName,
        imageUrl: imageUrl,
        discountPercent: discountPercent,
        link: link
    };
}

export function isValidProductLink(link: string): boolean {
    return link?.startsWith('http') || false;
}
