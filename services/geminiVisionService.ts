/**
 * Gemini Vision Service
 * ─────────────────────────────────────────────────────────────────────────────
 * Ekran görüntüsünden e-ticaret ürün bilgilerini otomatik olarak çıkarır.
 * Desteklenen bilgiler: başlık, yeni fiyat, eski fiyat, mağaza, marka, kategori.
 */

import { CATEGORIES } from '../constants/categories';

// Gemini 2.0 Flash — en hızlı multimodal model
const GEMINI_VISION_URL =
    'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent';

const GEMINI_API_KEY = (import.meta as any).env?.VITE_GEMINI_API_KEY || '';

// ─── Tipler ───────────────────────────────────────────────────────────────────

export interface VisualProductData {
    title: string;
    newPrice: number;
    oldPrice: number;
    storeName: string;
    brand: string;
    category: string;
    discountPercent: number;
    confidence: number; // 0-100
}

const EMPTY_RESULT: VisualProductData = {
    title: '',
    newPrice: 0,
    oldPrice: 0,
    storeName: '',
    brand: '',
    category: 'Diğer',
    discountPercent: 0,
    confidence: 0,
};

// ─── Yardımcı Fonksiyonlar ────────────────────────────────────────────────────

/**
 * File veya Blob'u base64'e çevirir
 */
async function blobToBase64(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
            const result = reader.result as string;
            // "data:image/jpeg;base64,XXXX" → sadece "XXXX" kısmını al
            const base64 = result.split(',')[1];
            resolve(base64);
        };
        reader.onerror = () => reject(new Error('FileReader hatası'));
        reader.readAsDataURL(blob);
    });
}

/**
 * ArrayBuffer'ı base64'e çevirir
 */
function arrayBufferToBase64(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    // 8KB'lık parçalar halinde işle (stack overflow önlemi)
    const chunkSize = 8192;
    for (let i = 0; i < bytes.length; i += chunkSize) {
        const chunk = bytes.subarray(i, i + chunkSize);
        binary += String.fromCharCode(...chunk);
    }
    return btoa(binary);
}

/**
 * Sayısal fiyat değeri parse eder
 * "1.159,00" → 1159, "428.05" → 428.05, "428,05" → 428.05
 */
function parsePrice(value: unknown): number {
    if (value === null || value === undefined) return 0;
    if (typeof value === 'number') return value > 0 ? value : 0;
    const str = String(value).replace(/[^\d.,]/g, '');
    if (!str) return 0;
    // Türkçe format: nokta binlik ayırıcı, virgül ondalık
    const normalized = str.includes(',')
        ? str.replace(/\./g, '').replace(',', '.')
        : str.replace(/,/g, '');
    const num = parseFloat(normalized);
    return isNaN(num) ? 0 : Math.abs(num);
}

/**
 * Kategoriyi bilinen listeden normalize eder
 */
function normalizeCategory(rawCategory: string): string {
    if (!rawCategory) return 'Diğer';
    const lower = rawCategory.toLowerCase();
    const match = CATEGORIES.find(c => c.toLowerCase().includes(lower) || lower.includes(c.toLowerCase()));
    return match || 'Diğer';
}

// ─── Ana Fonksiyon ────────────────────────────────────────────────────────────

/**
 * Ekran görüntüsünden ürün bilgilerini çıkarır.
 *
 * @param imageData  - File, Blob veya ArrayBuffer olarak görüntü
 * @param mimeType   - MIME tipi (varsayılan: image/jpeg)
 */
export async function extractProductFromScreenshot(
    imageData: File | Blob | ArrayBuffer,
    mimeType: string = 'image/jpeg'
): Promise<VisualProductData> {

    if (!GEMINI_API_KEY) {
        throw new Error('VITE_GEMINI_API_KEY tanımlı değil');
    }

    // Base64'e çevir
    let base64: string;
    if (imageData instanceof ArrayBuffer) {
        base64 = arrayBufferToBase64(imageData);
    } else {
        base64 = await blobToBase64(imageData as Blob);
    }

    if (!base64 || base64.length < 100) {
        throw new Error('Görüntü verisi çok küçük veya bozuk');
    }

    const categoriesList = CATEGORIES.join(' / ');

    const prompt = `Bu ekran görüntüsü bir e-ticaret ürün sayfasına ait.
Lütfen aşağıdaki bilgileri ekrana bakarak çıkar:

1. title: Tam ürün adı (modeli ve özellikleriyle birlikte)
2. newPrice: İndirimli / güncel satış fiyatı (sadece sayı, TL cinsinden)
3. oldPrice: Orijinal / eski fiyat (üstü çizili veya daha önce gösterilen fiyat, varsa)
4. storeName: Mağaza adı (Trendyol, Hepsiburada, N11, Amazon, Çiçeksepeti, Migros, Şok, BİM, A101 vb.)
5. brand: Ürün markası
6. category: Şu kategorilerden en uygun olanı seç: ${categoriesList}
7. discountPercent: İndirim yüzdesi (ekranda gösterilen veya hesaplanan)
8. confidence: Bu bilgileri ne kadar güvenle çıkardığını 0-100 arası puan

SADECE aşağıdaki JSON formatında yanıt ver, başka hiçbir şey yazma:
{
  "title": "ürün adı",
  "newPrice": 428.05,
  "oldPrice": 1159.00,
  "storeName": "Trendyol",
  "brand": "marka",
  "category": "Giyim & Moda",
  "discountPercent": 63,
  "confidence": 95
}

Eğer bir bilgi görünmüyorsa veya belirlenemiyorsa: sayısal alanlar için 0, metin alanları için "" kullan.`;

    let response: Response;
    try {
        response = await fetch(`${GEMINI_VISION_URL}?key=${GEMINI_API_KEY}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{
                    parts: [
                        { text: prompt },
                        {
                            inlineData: {
                                mimeType,
                                data: base64,
                            }
                        }
                    ]
                }],
                generationConfig: {
                    temperature: 0.1,     // Tutarlılık için düşük
                    topK: 32,
                    topP: 0.95,
                    maxOutputTokens: 300,
                },
                safetySettings: [
                    { category: 'HARM_CATEGORY_HARASSMENT',        threshold: 'BLOCK_NONE' },
                    { category: 'HARM_CATEGORY_HATE_SPEECH',       threshold: 'BLOCK_NONE' },
                    { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
                    { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
                ],
            }),
            signal: AbortSignal.timeout(20000), // 20 saniye timeout
        });
    } catch (fetchErr: any) {
        if (fetchErr.name === 'TimeoutError') {
            throw new Error('Gemini API zaman aşımı (20s). Tekrar deneyin.');
        }
        throw new Error(`Gemini API bağlantı hatası: ${fetchErr.message}`);
    }

    if (!response.ok) {
        const errText = await response.text().catch(() => '');
        throw new Error(`Gemini API hatası: HTTP ${response.status} — ${errText.slice(0, 100)}`);
    }

    const data = await response.json();
    const rawText: string = data.candidates?.[0]?.content?.parts?.[0]?.text || '';

    if (!rawText) {
        throw new Error('Gemini boş yanıt döndü');
    }

    // JSON parse
    const jsonMatch = rawText.match(/\{[\s\S]*?\}/);
    if (!jsonMatch) {
        console.warn('[Vision] JSON bulunamadı. Ham yanıt:', rawText.slice(0, 200));
        throw new Error('Gemini yanıtından JSON çıkarılamadı');
    }

    let parsed: Record<string, unknown>;
    try {
        parsed = JSON.parse(jsonMatch[0]);
    } catch {
        throw new Error('JSON parse hatası: ' + jsonMatch[0].slice(0, 100));
    }

    // Fiyat hesaplama
    const newPrice = parsePrice(parsed.newPrice);
    const oldPrice = parsePrice(parsed.oldPrice);

    // İndirim yüzdesini hesapla (Gemini vermemişse kendin hesapla)
    let discountPercent = Number(parsed.discountPercent) || 0;
    if (!discountPercent && oldPrice > 0 && newPrice > 0 && oldPrice > newPrice) {
        discountPercent = Math.round(((oldPrice - newPrice) / oldPrice) * 100);
    }

    const result: VisualProductData = {
        title:          String(parsed.title || '').trim(),
        newPrice,
        oldPrice,
        storeName:      String(parsed.storeName || '').trim(),
        brand:          String(parsed.brand || '').trim(),
        category:       normalizeCategory(String(parsed.category || '')),
        discountPercent,
        confidence:     Math.min(100, Math.max(0, Number(parsed.confidence) || 50)),
    };

    console.log('[Vision] Çıkarılan veriler:', result);
    return result;
}
