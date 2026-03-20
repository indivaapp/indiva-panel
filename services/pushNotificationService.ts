import { PushNotifications } from '@capacitor/push-notifications';
import { Capacitor } from '@capacitor/core';

/**
 * Push Notification Service for INDIVA Panel App
 * Handles registration and subscription to admin alert topics.
 */
export const initializePushNotifications = async () => {
    if (Capacitor.getPlatform() === 'web') {
        console.warn('[Push] Web platform detected. Push notifications are only supported on native devices.');
        return;
    }

    console.log('[Push] Initializing...');

    // Request permissions
    let permStatus = await PushNotifications.checkPermissions();
    
    if (permStatus.receive === 'prompt') {
        permStatus = await PushNotifications.requestPermissions();
    }

    if (permStatus.receive !== 'granted') {
        console.error('[Push] User denied permissions!');
        return;
    }

    // Register with FCM
    await PushNotifications.register();

    // Listeners
    PushNotifications.addListener('registration', (token) => {
        console.log('[Push] Registration successful, token:', token.value);
        // Topic subscription is usually handled via FCM HTTP API or Firebase Console for Capacitor.
        // However, we can use a server-side script to subscribe this token to 'panel_admin_alerts'
        // OR use a plugin if available. For now, we log the token.
    });

    PushNotifications.addListener('registrationError', (err) => {
        console.error('[Push] Registration error:', err.error);
    });

    PushNotifications.addListener('pushNotificationReceived', (notification) => {
        console.log('[Push] Notification received:', notification);
    });

    PushNotifications.addListener('pushNotificationActionPerformed', (notification) => {
        console.log('[Push] Action performed:', notification.actionId, notification.notification);
    });
};

/**
 * Note: Topic subscription in Capacitor typically requires an additional plugin 
 * or a backend call to the FCM server using the device token.
 * 
 * Strategy: We will send alerts to the topic 'panel_admin_alerts'. 
 * The user must ensure the Panel App is registered in the Firebase console 
 * and this token is subscribed.
 */
