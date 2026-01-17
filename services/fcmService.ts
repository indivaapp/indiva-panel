/**
 * FCM v1 API Service
 * Sends push notifications using Firebase Cloud Messaging v1 API with Service Account authentication.
 * This method works without Cloud Functions and is free to use.
 */

// Service Account credentials (from Firebase Console)
const SERVICE_ACCOUNT = {
    project_id: "indiva-expo",
    private_key: "-----BEGIN PRIVATE KEY-----\nMIIEvwIBADANBgkqhkiG9w0BAQEFAASCBKkwggSlAgEAAoIBAQCkogKlKcgOkgln\nItubtk1BSlNtUuhyxpNSDmtB29FMPv4tHokk/LNwCBgQ8BRAFBXdXTYMeqQsECMc\nd2tjfsHehb75xP6gcnu4ec+rzhOY9hf2QwxBG5DngHBafFDtSL4BvWG42hu2T1AR\n/870Wvadp66JwRpCqP1Q/f+usHQmExknVkLiFR+Q1ZLmB/JHYOCRb7uyevGnwxlP\nNU5uBtuCGIqNVik2KojahWBshrtSJV2hcXLQ9lpFbMzZKeweoFoL59cEAm0GskeM\n6hmSxyxLoU7EG9+YIKadY1Am0xw6F51GkuMLh+EELkf2OyHtgz725H4TDylHIkCt\n71HCU4kJAgMBAAECggEAIxHR324BjD0GnL47qrVQSqazE9gz5PMxAatJpMtXD9dh\nXKojC8p6zNQkkEMcBTRiHfgTod/kJfDAEfnMWfLwCF9UOa+BkBsjCL6GAvKQkSZn\nH1HUA/CD0xS0mkneEVXMB+HYNcDcY18MzvC/nKTd4OKN1xFX7zhBUeXxd7xl2ZAi\n89us8NFTE3/Y6zTKCvc3x3O2NUPdiE/eFYRzF7cNhLUSj5vtgkJdaGbzzEPmTksI\nklehzhQDxn+rJsNOHWQ0+gYtdaa9cHUYPdKzILGYBQW7k8ZwxU9Yoqcxtd9NxA64\n0txLI402PoGPoTCXZ2AnyH/Ih/3D49FLH5148CBGiQKBgQDkrqwx1kIHB7xUIupv\nOEgTVijA7FoHPVvd7QQ2qbOZWWiE/r044xpTuq3BNi6XkSPv0AWNmc1bcuh8mEke\n1mqgCcaripVRl+j3fRRiNzPq4QZjOVDLEQIejuv3hgwi8X3lpNH3nsR//ispIxt8\n+LCx0OGbt3fIZ7Oui11PDGZ+vQKBgQC4TKSWXmcGqOWsLkaJlRop0HGFAIgyKFzd\nMgJuYX4sRw/ZKvq68NKePSqauYuOe8jenS75xJT1t7Cv945/GMPVyQrRF5ecmSB+\nmDrZIyM8v1aAUFLxB/TAJpn17OxaJQH3yK6N/5Wx6kfF+aMrA0x+FNif/6kFbnqg\n+MJbNu0OPQKBgQDVHN9GVokT6iadNijJ22Z39rxmBh1kT89UQ3TAyGeiSos4HfoT\nkLlRPFB/FdJX15/o9jCmpKWXSr/UlUrXXTTizhmCddTvxCUMt1kOqqlMg8ajI5/i\njoguGD1ZYGfhDLKqF27BWAmByklIvfn4/f4UyDfoGROdBN+Tkzcy2riN9QKBgQCB\nWlnSqGOLSxQYa0pa2mnIm2JxxVPSUH4NSkJmksrp7N50wDPG7awGIEw82KnY0YzE\nonIMICuk4s6CUzCSiCE7daW/590jrl4ePF5hdMYQpwLhgH8WaU0haHZ7I1UoV/0v\nmozZYWABxbumenZJhEE15Q++DMTm6Qns3WwcdUqgyQKBgQDIsf52NX/x0RtDFAsT\nj4xkWW1OIebeOxmRf+XtrwMnOpdOrtThSdP9AwvSaFcJyUzf8rrhpoce0KqTE5/b\nFTbEnb0OgIwNLnq2dRoLjpXOnOWeytNstggyrgcbQO5zEmTBOJ3czlLvcsOnkkHB\nJoRinjW2qwkun5PC8lz+27tZjA==\n-----END PRIVATE KEY-----\n",
    client_email: "firebase-adminsdk-fbsvc@indiva-expo.iam.gserviceaccount.com"
};

const FCM_ENDPOINT = `https://fcm.googleapis.com/v1/projects/${SERVICE_ACCOUNT.project_id}/messages:send`;
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';

// Cache for access token
let cachedToken: { token: string; expiry: number } | null = null;

/**
 * Converts PEM private key to CryptoKey for signing
 */
async function importPrivateKey(pem: string): Promise<CryptoKey> {
    console.log('[FCM] 🔑 Private key import başlıyor...');

    const pemContents = pem
        .replace(/-----BEGIN PRIVATE KEY-----/g, '')
        .replace(/-----END PRIVATE KEY-----/g, '')
        .replace(/\r/g, '')  // Windows satır sonu karakterlerini temizle
        .replace(/\n/g, '')  // Tüm satır sonlarını temizle
        .replace(/\s/g, ''); // Tüm boşlukları temizle

    console.log('[FCM] 🔑 PEM temizlendi, uzunluk:', pemContents.length);

    try {
        const binaryDer = Uint8Array.from(atob(pemContents), c => c.charCodeAt(0));
        console.log('[FCM] 🔑 Binary DER oluşturuldu, uzunluk:', binaryDer.length);

        const key = await crypto.subtle.importKey(
            'pkcs8',
            binaryDer,
            { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
            false,
            ['sign']
        );

        console.log('[FCM] ✅ Private key başarıyla import edildi');
        return key;
    } catch (err) {
        console.error('[FCM] ❌ Private key import hatası:', err);
        throw err;
    }
}

/**
 * Creates a signed JWT for Google OAuth2
 */
async function createSignedJWT(): Promise<string> {
    console.log('[FCM] 📝 JWT oluşturuluyor...');

    const now = Math.floor(Date.now() / 1000);
    const expiry = now + 3600;

    const header = { alg: 'RS256', typ: 'JWT' };
    const payload = {
        iss: SERVICE_ACCOUNT.client_email,
        sub: SERVICE_ACCOUNT.client_email,
        aud: TOKEN_ENDPOINT,
        iat: now,
        exp: expiry,
        scope: SCOPE
    };

    const encoder = new TextEncoder();
    const headerB64 = btoa(JSON.stringify(header)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
    const payloadB64 = btoa(JSON.stringify(payload)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');

    const signatureInput = `${headerB64}.${payloadB64}`;

    try {
        const key = await importPrivateKey(SERVICE_ACCOUNT.private_key);
        const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, encoder.encode(signatureInput));

        const signatureB64 = btoa(String.fromCharCode(...new Uint8Array(signature)))
            .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');

        const jwt = `${signatureInput}.${signatureB64}`;
        console.log('[FCM] ✅ JWT oluşturuldu');
        return jwt;
    } catch (err) {
        console.error('[FCM] ❌ JWT oluşturma hatası:', err);
        throw err;
    }
}

/**
 * Gets an access token using the service account
 */
async function getAccessToken(): Promise<string> {
    console.log('[FCM] 🔐 Access token alınıyor...');

    if (cachedToken && cachedToken.expiry > Date.now() + 60000) {
        console.log('[FCM] ✅ Cached token kullanılıyor');
        return cachedToken.token;
    }

    try {
        const jwt = await createSignedJWT();
        console.log('[FCM] 📤 Token endpoint\'e istek gönderiliyor...');

        const response = await fetch(TOKEN_ENDPOINT, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`
        });

        console.log('[FCM] 📥 Token yanıtı alındı, status:', response.status);

        if (!response.ok) {
            const error = await response.text();
            console.error('[FCM] ❌ Token alma hatası:', error);
            throw new Error(`Token alma hatası: ${error}`);
        }

        const data = await response.json();
        console.log('[FCM] ✅ Access token başarıyla alındı');

        cachedToken = {
            token: data.access_token,
            expiry: Date.now() + (data.expires_in * 1000)
        };

        return data.access_token;
    } catch (err) {
        console.error('[FCM] ❌ Access token hatası:', err);
        throw err;
    }
}

/**
 * Sends a push notification to all İNDİVA users via FCM v1 API.
 */
export const sendDirectPushNotification = async (
    title: string,
    body: string,
    imageUrl?: string,
    url?: string
): Promise<{ success: boolean; messageId?: string; error?: string }> => {

    console.log('[FCM] 🚀 Bildirim gönderme başlatılıyor...');
    console.log('[FCM] 📋 Başlık:', title);
    console.log('[FCM] 📋 Mesaj:', body);

    if (!title || !body) {
        console.error('[FCM] ❌ Başlık veya mesaj eksik');
        throw new Error('Başlık ve mesaj zorunludur.');
    }

    try {
        const accessToken = await getAccessToken();
        console.log('[FCM] 🔑 Access token hazır');

        const message = {
            message: {
                topic: 'all_users',
                notification: {
                    title: title,
                    body: body,
                    ...(imageUrl && { image: imageUrl })
                },
                data: {
                    url: url || '',
                    click_action: 'OPEN_APP'
                },
                android: {
                    priority: 'high' as const,
                    notification: {
                        channel_id: 'indiva_notifications',
                        sound: 'default',
                        default_sound: true
                    }
                }
            }
        };

        console.log('[FCM] 📤 FCM API\'ye istek gönderiliyor...');
        console.log('[FCM] 📋 Endpoint:', FCM_ENDPOINT);
        console.log('[FCM] 📋 Message:', JSON.stringify(message, null, 2));

        const response = await fetch(FCM_ENDPOINT, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${accessToken}`
            },
            body: JSON.stringify(message)
        });

        console.log('[FCM] 📥 FCM yanıtı alındı, status:', response.status);

        const result = await response.json();
        console.log('[FCM] 📋 FCM yanıt içeriği:', JSON.stringify(result, null, 2));

        if (response.ok && result.name) {
            console.log('[FCM] ✅ BİLDİRİM BAŞARIYLA GÖNDERİLDİ!');
            console.log('[FCM] 📋 Message ID:', result.name);
            return { success: true, messageId: result.name };
        } else {
            console.error('[FCM] ❌ FCM Hatası:', result);
            return {
                success: false,
                error: result.error?.message || result.error?.status || 'Bildirim gönderilemedi.'
            };
        }
    } catch (error: any) {
        console.error('[FCM] ❌ Genel Hata:', error);
        console.error('[FCM] ❌ Hata mesajı:', error.message);
        console.error('[FCM] ❌ Hata stack:', error.stack);
        return {
            success: false,
            error: error.message || 'Bildirim gönderilirken hata oluştu.'
        };
    }
};
