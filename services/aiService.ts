/**
 * AI Service - Gemini Pro API Entegrasyonu
 * Fırsatları AI ile zenginleştirir ve güven skoru hesaplar
 */

import type { ScrapedDeal } from './dealFinder';
import { isSystemEnabled } from '../utils/systemStatus';

// Gemini API endpoint - gemini-2.0-flash en hızlı ve güncel stabil model
const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent';

// API Key (Vercel environment variable)
const GEMINI_API_KEY = (import.meta as any).env.VITE_GEMINI_API_KEY || '';

import { CATEGORIES } from '../constants/categories';

// Zenginleştirilmiş fırsat tipi
export interface EnrichedDeal extends ScrapedDeal {
    cleanTitle: string;
    category: string;
    brand: string;
    confidenceScore: number;
    aiProcessed: boolean;
}

// AI yanıt tipi
interface AIResponse {
    cleanTitle: string;
    category: string;
    brand: string;
    confidence: number;
}

/**
 * Gemini API'ye istek gönder
 */
async function callGeminiAPI(prompt: string): Promise<string> {
    if (!isSystemEnabled()) {
        throw new Error('Sistem kapalı');
    }

    if (!GEMINI_API_KEY) {
        throw new Error('GEMINI_API_KEY tanımlı değil');
    }

    const response = await fetch(`${GEMINI_API_URL}?key=${GEMINI_API_KEY}`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            contents: [{
                parts: [{
                    text: prompt
                }]
            }],
            generationConfig: {
                temperature: 0.3, // Daha tutarlı sonuçlar için düşük
                topK: 40,
                topP: 0.95,
                maxOutputTokens: 512,
            }
        })
    });

    if (!response.ok) {
        throw new Error(`Gemini API hatası: ${response.status}`);
    }

    const data = await response.json();

    // Yanıttan metni çıkar
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) {
        throw new Error('Gemini yanıtı boş');
    }

    return text;
}

/**
 * JSON yanıtını parse et (markdown code block içinde olabilir)
 */
function parseAIResponse(text: string): AIResponse {
    // Markdown code block'u temizle
    let jsonStr = text.trim();
    if (jsonStr.startsWith('```json')) {
        jsonStr = jsonStr.slice(7);
    } else if (jsonStr.startsWith('```')) {
        jsonStr = jsonStr.slice(3);
    }
    if (jsonStr.endsWith('```')) {
        jsonStr = jsonStr.slice(0, -3);
    }
    jsonStr = jsonStr.trim();

    try {
        const parsed = JSON.parse(jsonStr);
        return {
            cleanTitle: parsed.cleanTitle || '',
            category: CATEGORIES.includes(parsed.category) ? parsed.category : 'Diğer',
            brand: parsed.brand || '',
            confidence: Math.min(100, Math.max(0, parsed.confidence || 50))
        };
    } catch {
        throw new Error('AI yanıtı parse edilemedi');
    }
}

/**
 * Tek bir fırsatı AI ile zenginleştir
 * VITE_AI_ENABLED=true olmadığı sürece AI çağrısı yapılmaz, temel temizleme kullanılır.
 */
export async function enrichDealWithAI(deal: ScrapedDeal): Promise<EnrichedDeal> {
    if ((import.meta as any).env.VITE_AI_ENABLED !== 'true') {
        return {
            ...deal,
            cleanTitle: cleanTitleBasic(deal.title),
            category: 'Diğer',
            brand: '',
            confidenceScore: 30,
            aiProcessed: false,
        };
    }
    const prompt = `Sen bir e-ticaret pazarlama uzmanısın. Aşağıdaki indirim bilgisini analiz et ve JSON formatında döndür.

ÜRÜN BİLGİSİ:
Başlık: "${deal.title}"
Fiyat: ${deal.price} TL
Kaynak: ${deal.source}
${deal.couponCode ? `Kupon Kodu: ${deal.couponCode}` : ''}

GÖREV:
1. Başlığı temizle: Emoji, "FIRSAT", "SÜPER", "KAÇIRMA" gibi gereksiz kelimeleri kaldır. Sadece ürün adını bırak.

2. Kategori belirle (SADECE listedekilerden en uygun olanı seç): ${CATEGORIES.filter(c => c !== 'Diğer').join(', ')}. "Diğer" veya "Genel" KESİNLİKLE kullanma.

3. Marka tespit et: Başlıktan markayı çıkar (yoksa boş bırak)

5. Güven skoru ver: 0-100 (tüm bilgiler net ve eksiksizse yüksek)

SADECE JSON DÖNDÜR:
{
  "cleanTitle": "temiz ürün başlığı",
  "category": "kategori",
  "brand": "marka",
  "confidence": 85
}`;

    try {
        const responseText = await callGeminiAPI(prompt);
        const aiResponse = parseAIResponse(responseText);

        return {
            ...deal,
            cleanTitle: aiResponse.cleanTitle || deal.title,
            category: aiResponse.category,
            brand: aiResponse.brand,
            confidenceScore: aiResponse.confidence,
            aiProcessed: true
        };
    } catch {
        // Fallback: Temel temizleme
        return {
            ...deal,
            cleanTitle: cleanTitleBasic(deal.title),
            category: 'Diğer',
            brand: '',
            confidenceScore: 30, // Düşük skor - manuel kontrol gerekli
            aiProcessed: false
        };
    }
}

/**
 * Birden fazla fırsatı batch olarak zenginleştir
 * Rate limiting için sıralı işlem
 */
export async function batchEnrichDeals(deals: ScrapedDeal[]): Promise<EnrichedDeal[]> {
    const enrichedDeals: EnrichedDeal[] = [];

    for (let i = 0; i < deals.length; i++) {
        const deal = deals[i];
        try {
            const enriched = await enrichDealWithAI(deal);
            enrichedDeals.push(enriched);

            // Rate limit - 1 saniye bekle (60 istek/dakika limitini aşmamak için)
            if (i < deals.length - 1) {
                await new Promise(r => setTimeout(r, 1000));
            }
        } catch {
            // Hatalı olanı düşük skorla ekle
            enrichedDeals.push({
                ...deal,
                cleanTitle: cleanTitleBasic(deal.title),
                category: 'Diğer',
                brand: '',
                confidenceScore: 0,
                aiProcessed: false
            });
        }
    }

    return enrichedDeals;
}

/**
 * Temel başlık temizleme (AI başarısız olursa)
 */
function cleanTitleBasic(title: string): string {
    return title
        // Emojileri kaldır
        .replace(/[\u{1F300}-\u{1F9FF}]/gu, '')
        // Gereksiz kelimeleri kaldır
        .replace(/\b(FIRSAT|SÜPER|KAÇIRMA|İNANILMAZ|MEGA|HARİKA|MÜTHİŞ)\b/gi, '')
        // Fazla boşlukları temizle
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * Güven skoru kontrolü
 */
export function isHighConfidence(deal: EnrichedDeal, threshold: number = 80): boolean {
    return deal.confidenceScore >= threshold;
}

/**
 * Yayınlanabilir mi kontrolü
 */
export function canAutoPublish(deal: EnrichedDeal): { canPublish: boolean; reason?: string } {
    // Minimum güven skoru
    if (deal.confidenceScore < 80) {
        return { canPublish: false, reason: `Düşük güven skoru: ${deal.confidenceScore}` };
    }

    // Minimum fiyat
    if (deal.price < 10) {
        return { canPublish: false, reason: 'Fiyat 10₺ altında' };
    }

    // Görsel zorunlu
    if (!deal.imageUrl) {
        return { canPublish: false, reason: 'Görsel yok' };
    }

    return { canPublish: true };
}
