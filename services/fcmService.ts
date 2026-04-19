/**
 * FCM v1 API Service
 * Sends push notifications using Firebase Cloud Messaging v1 API with Service Account authentication.
 * This method works without Cloud Functions and is free to use.
 */

// Service Account credentials — .env dosyasından okunuyor
const SERVICE_ACCOUNT = {
    project_id: import.meta.env.VITE_FIREBASE_PROJECT_ID as string,
    private_key: (import.meta.env.VITE_FIREBASE_PRIVATE_KEY as string)?.replace(/\\n/g, '\n'),
    client_email: import.meta.env.VITE_FIREBASE_CLIENT_EMAIL as string,
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
    const pemContents = pem
        .replace(/-----BEGIN PRIVATE KEY-----/g, '')
        .replace(/-----END PRIVATE KEY-----/g, '')
        .replace(/\r/g, '')
        .replace(/\n/g, '')
        .replace(/\s/g, '');

    const binaryDer = Uint8Array.from(atob(pemContents), c => c.charCodeAt(0));

    return await crypto.subtle.importKey(
        'pkcs8',
        binaryDer,
        { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
        false,
        ['sign']
    );
}

/**
 * Creates a signed JWT for Google OAuth2
 */
async function createSignedJWT(): Promise<string> {
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
    const key = await importPrivateKey(SERVICE_ACCOUNT.private_key);
    const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, encoder.encode(signatureInput));

    const signatureB64 = btoa(String.fromCharCode(...new Uint8Array(signature)))
        .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');

    return `${signatureInput}.${signatureB64}`;
}

/**
 * Gets an access token using the service account
 */
async function getAccessToken(): Promise<string> {
    if (cachedToken && cachedToken.expiry > Date.now() + 60000) {
        return cachedToken.token;
    }

    const jwt = await createSignedJWT();

    const response = await fetch(TOKEN_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`
    });

    if (!response.ok) {
        const error = await response.text();
        throw new Error(`Token alma hatası: ${error}`);
    }

    const data = await response.json();

    cachedToken = {
        token: data.access_token,
        expiry: Date.now() + (data.expires_in * 1000)
    };

    return data.access_token;
}

/**
 * Sends a push notification to all İNDİVA users via FCM v1 API.
 */
export const sendDirectPushNotification = async (
    title: string,
    body: string,
    imageUrl?: string,
    url?: string,
    discountId?: string
): Promise<{ success: boolean; messageId?: string; error?: string }> => {
    if (!title || !body) {
        throw new Error('Başlık ve mesaj zorunludur.');
    }

    try {
        const accessToken = await getAccessToken();

        const message = {
            message: {
                topic: 'all_users',
                notification: {
                    title,
                    body,
                    ...(imageUrl && { image: imageUrl })
                },
                data: {
                    url: url || '',
                    click_action: 'OPEN_APP',
                    ...(discountId && { discountId })
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

        const response = await fetch(FCM_ENDPOINT, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${accessToken}`
            },
            body: JSON.stringify(message)
        });

        const result = await response.json();

        if (response.ok && result.name) {
            return { success: true, messageId: result.name };
        } else {
            return {
                success: false,
                error: result.error?.message || result.error?.status || 'Bildirim gönderilemedi.'
            };
        }
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Bildirim gönderilirken hata oluştu.';
        return { success: false, error: message };
    }
};
