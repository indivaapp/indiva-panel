import type { VercelRequest, VercelResponse } from '@vercel/node';

/**
 * Image Upload API - Telegram CDN'den görsel alıp ImgBB'ye yükler
 * 
 * Bu endpoint CORS sorununu aşmak için server-side görsel işleme yapar.
 * Telegram CDN görselleri tarayıcıdan çekilemiyor, bu endpoint ile çözülür.
 * 
 * Query Params:
 * - imageUrl: Yüklenecek görsel URL'si (zorunlu)
 * 
 * Environment Variables:
 * - IMGBB_API_KEY: ImgBB API anahtarı
 */

const IMGBB_API_KEY = process.env.IMGBB_API_KEY || '';

interface ImgBBResponse {
    success: boolean;
    data?: {
        url: string;
        delete_url: string;
        display_url: string;
        thumb?: {
            url: string;
        };
    };
    error?: {
        message: string;
    };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    const { imageUrl } = req.query;

    if (!imageUrl || typeof imageUrl !== 'string') {
        return res.status(400).json({
            success: false,
            error: 'imageUrl parametresi gerekli'
        });
    }

    console.log(`📷 Görsel indiriliyor: ${imageUrl.substring(0, 80)}...`);

    try {
        // 1. Görseli server-side olarak indir
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 saniye timeout

        const imageResponse = await fetch(imageUrl, {
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
            console.log(`❌ Görsel indirilemedi: HTTP ${imageResponse.status}`);
            return res.status(400).json({
                success: false,
                error: `Görsel indirilemedi: HTTP ${imageResponse.status}`
            });
        }

        // 2. ArrayBuffer olarak al ve Base64'e çevir
        const arrayBuffer = await imageResponse.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);

        if (buffer.length < 1000) {
            console.log(`❌ Görsel çok küçük: ${buffer.length} bytes`);
            return res.status(400).json({
                success: false,
                error: 'Görsel çok küçük veya geçersiz'
            });
        }

        const base64 = buffer.toString('base64');
        console.log(`✅ Görsel indirildi: ${Math.round(buffer.length / 1024)}KB`);

        // 3. ImgBB'ye yükle
        console.log('📤 ImgBB\'ye yükleniyor...');

        const formData = new URLSearchParams();
        formData.append('image', base64);

        const uploadController = new AbortController();
        const uploadTimeoutId = setTimeout(() => uploadController.abort(), 45000); // 45 saniye

        const uploadResponse = await fetch(`https://api.imgbb.com/1/upload?key=${IMGBB_API_KEY}`, {
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
            console.log(`❌ ImgBB yükleme hatası: HTTP ${uploadResponse.status}`);
            return res.status(500).json({
                success: false,
                error: `ImgBB yükleme hatası: ${errorText.substring(0, 100)}`
            });
        }

        const data: ImgBBResponse = await uploadResponse.json();

        if (data.success && data.data?.url) {
            console.log(`✅ ImgBB yükleme başarılı: ${data.data.url}`);
            return res.status(200).json({
                success: true,
                downloadURL: data.data.url,
                deleteUrl: data.data.delete_url || '',
                displayUrl: data.data.display_url || data.data.url,
                thumbUrl: data.data.thumb?.url || ''
            });
        } else {
            console.log(`❌ ImgBB yanıt hatası:`, JSON.stringify(data).substring(0, 200));
            return res.status(500).json({
                success: false,
                error: data.error?.message || 'ImgBB yükleme başarısız'
            });
        }

    } catch (error: any) {
        const errorMsg = error.name === 'AbortError' ? 'İstek zaman aşımına uğradı' : error.message;
        console.error(`❌ Hata: ${errorMsg}`);
        return res.status(500).json({
            success: false,
            error: errorMsg
        });
    }
}
