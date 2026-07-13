import { Capacitor } from '@capacitor/core';
import { PushNotifications } from '@capacitor/push-notifications';

/**
 * Push Notification Service — İNDİVA Panel (admin cihazı)
 *
 * Bu sadece admin'in KENDİ telefonuna giden bildirimler için — tüketici
 * uygulamasına giden 'all_users' topic'inden tamamen ayrı, 'panel_admin_alerts'
 * topic'i kullanılıyor (bkz. scripts/alertService.js).
 *
 * ⚠️ ÇALIŞMASI İÇİN android/app/google-services.json GEREKLİ. Dosya yoksa
 * (henüz Firebase Console'dan indirilmediyse) bu fonksiyon sessizce hiçbir
 * şey yapmadan çıkar — build.gradle zaten google-services.json yoksa
 * google-services eklentisini uygulamıyor, yani native FCM hiç başlamaz.
 *
 * Bildirime tıklanınca 'openSocialAiSuggestion' custom event'i dispatch
 * edilir — App.tsx bunu dinleyip 'socialContent' sayfasına yönlendirir.
 */
export const initializePushNotifications = async (): Promise<void> => {
    if (Capacitor.getPlatform() === 'web') {
        return; // Web'de Capacitor push desteklenmez
    }

    try {
        // Android bildirim kanalı — scripts/alertService.js'in gönderdiği
        // mesajlardaki channel_id: 'admin_alerts' ile eşleşmeli.
        await PushNotifications.createChannel({
            id: 'admin_alerts',
            name: 'Admin Bildirimleri',
            description: 'Panel uyarıları ve zamanlı öneri bildirimleri',
            importance: 5,
            visibility: 1,
            sound: 'default',
        });
    } catch (e) {
        console.warn('[Push] Kanal oluşturulamadı (google-services.json eksik olabilir):', e);
        return;
    }

    const perm = await PushNotifications.requestPermissions();
    if (perm.receive !== 'granted') {
        console.info('[Push] Bildirim izni verilmedi.');
        return;
    }

    await PushNotifications.register();

    PushNotifications.addListener('registrationError', (err) => {
        console.warn('[Push] Kayıt hatası:', err);
    });

    // Bildirime tıklanınca (uygulama kapalıyken veya arka plandayken) tetiklenir.
    PushNotifications.addListener('pushNotificationActionPerformed', (action) => {
        const data = (action.notification?.data || {}) as Record<string, string>;
        if (data.type === 'SOCIAL_AI_READY') {
            window.dispatchEvent(new CustomEvent('openSocialAiSuggestion'));
        }
    });

    console.info('[Push] Push bildirimleri etkin.');
};
