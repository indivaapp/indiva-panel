/**
 * Push bildirim gönderme — Cloud Function üzerinden.
 *
 * GÜVENLİK: Bu dosya eskiden Firebase servis hesabının ÖZEL ANAHTARINI
 * (VITE_FIREBASE_PRIVATE_KEY) doğrudan tarayıcı/APK paketine gömüp FCM v1
 * API'yi istemci tarafından imzalıyordu — APK'yı inceleyen biri bu anahtarı
 * çıkarıp tüm kullanıcılara istediği bildirimi gönderebilirdi. Artık gönderme
 * işlemi sunucu tarafında, Cloud Function içinde yapılıyor (indiva app
 * reposu, functions/src/index.ts → sendPushNotification). Bu dosya sadece o
 * fonksiyonu çağırır; hiçbir kimlik bilgisi istemciye inmez.
 */

import { httpsCallable } from 'firebase/functions';
import { functions } from '../firebaseConfig';

interface SendPushResult {
    success: boolean;
    messageId?: string;
}

const sendPushNotificationFn = httpsCallable<
    { title: string; body: string; imageUrl?: string; discountId?: string; storyId?: string },
    SendPushResult
>(functions, 'sendPushNotification');

/**
 * Sends a push notification to all İNDİVA users via the sendPushNotification Cloud Function.
 */
export const sendDirectPushNotification = async (
    title: string,
    body: string,
    imageUrl?: string,
    _url?: string,
    discountId?: string,
    storyId?: string,
): Promise<{ success: boolean; messageId?: string; error?: string }> => {
    if (!title || !body) {
        throw new Error('Başlık ve mesaj zorunludur.');
    }

    try {
        const result = await sendPushNotificationFn({ title, body, imageUrl, discountId, storyId });
        return { success: true, messageId: result.data.messageId };
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Bildirim gönderilirken hata oluştu.';
        return { success: false, error: message };
    }
};
