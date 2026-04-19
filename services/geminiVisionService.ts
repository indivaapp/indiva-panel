/**
 * Gemini Vision Service
 * ─────────────────────────────────────────────────────────────────────────────
 * Ekran görüntüsünden e-ticaret ürün bilgilerini çıkarır.
 * Güvenli proxy üzerinden çalışır — API key frontend'e gömülmez.
 */

const PROXY_VISION_URL = 'https://indiva-proxy.vercel.app/api/vision';

// ─── Tipler ───────────────────────────────────────────────────────────────────

export interface VisualProductData {
    title: string;
    newPrice: number;
    oldPrice: number;
    storeName: string;
    brand: string;
    category: string;
    discountPercent: number;
    confidence: number;
    /** Ürün görselinin bounding box'ı [y1,x1,y2,x2] 0-1000 normalize. Yoksa null. */
    productImageBox?: [number, number, number, number] | null;
}

// ─── Yardımcı ─────────────────────────────────────────────────────────────────

async function blobToBase64(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve((reader.result as string).split(',')[1]);
        reader.onerror = () => reject(new Error('FileReader hatası'));
        reader.readAsDataURL(blob);
    });
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    const chunk = 8192;
    for (let i = 0; i < bytes.length; i += chunk) {
        binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
    }
    return btoa(binary);
}

// ─── Ana Fonksiyon ────────────────────────────────────────────────────────────

export async function extractProductFromScreenshot(
    imageData: File | Blob | ArrayBuffer,
    mimeType: string = 'image/jpeg'
): Promise<VisualProductData> {

    // Base64'e çevir
    let imageBase64: string;
    if (imageData instanceof ArrayBuffer) {
        imageBase64 = arrayBufferToBase64(imageData);
    } else {
        imageBase64 = await blobToBase64(imageData as Blob);
    }

    if (!imageBase64 || imageBase64.length < 100) {
        throw new Error('Görüntü verisi çok küçük veya bozuk');
    }

    // Proxy'e gönder
    const response = await fetch(PROXY_VISION_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageBase64, mimeType }),
        signal: AbortSignal.timeout(30000),
    });

    if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.error || `Vision proxy HTTP ${response.status}`);
    }

    const data = await response.json();

    if (!data.success) {
        throw new Error(data.error || 'Vision proxy başarısız');
    }

    console.log('[Vision] Çıkarılan veriler:', data.product);
    return data.product as VisualProductData;
}
