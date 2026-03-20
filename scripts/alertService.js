/**
 * alertService.js - System Alerting Service for İNDİVA Panel
 * 
 * Sends push notifications to the Panel App (admin) for critical system events.
 */

import { getMessaging } from 'firebase-admin/messaging';

/**
 * Send an alert to the İNDİVA Panel App
 * @param {string} title Alert title
 * @param {string} body Alert message
 * @param {object} data Optional metadata
 */
export async function sendAdminAlert(title, body, data = {}) {
    console.log(`[Alert] 🚨 Sending alert: ${title}`);

    const message = {
        notification: {
            title: `🚨 PANEL ALERTI: ${title}`,
            body: body
        },
        data: {
            ...data,
            type: 'system_alert',
            timestamp: new Date().toISOString()
        },
        topic: 'panel_admin_alerts',
        android: {
            priority: 'high',
            notification: {
                channel_id: 'admin_alerts',
                sound: 'default'
            }
        }
    };

    try {
        const response = await getMessaging().send(message);
        console.log('[Alert] ✅ Alert sent successfully:', response);
        return response;
    } catch (error) {
        console.error('[Alert] ❌ Failed to send alert:', error);
        // We don't throw here to avoid crashing the main process
        return null;
    }
}
