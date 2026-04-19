import { Capacitor } from '@capacitor/core';

/**
 * Push Notification Service for INDIVA Panel App
 *
 * ⚠️ ŞU AN DEVRE DIŞI — google-services.json eksik.
 *
 * ETKİNLEŞTİRMEK İÇİN:
 * 1. Firebase Console → "indiva-expo" projesi → Proje Ayarları
 * 2. Android uygulaması ekle (com.indiva.panel) → google-services.json indir
 * 3. Dosyayı: android/app/google-services.json olarak kaydet
 * 4. npx cap sync android
 * 5. Bu dosyadaki return satırını kaldır
 */
export const initializePushNotifications = async (): Promise<void> => {
    if (Capacitor.getPlatform() === 'web') {
        return; // Web'de Capacitor push desteklenmez
    }

    // google-services.json eksik — aktif edilene kadar devre dışı
    console.info('[Push] Push bildirimleri yapılandırılmamış (google-services.json gerekli).');
    return;
};
