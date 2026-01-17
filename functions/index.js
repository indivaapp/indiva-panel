
const functions = require('firebase-functions');
const admin = require('firebase-admin');
admin.initializeApp();

/**
 * Trigger: When a new document is created in 'notifications' collection.
 * Action: Sends FCM multicast message to all tokens in 'fcmTokens'.
 */
exports.sendPushNotification = functions.firestore
    .document('notifications/{docId}')
    .onCreate(async (snap, context) => {
        const data = snap.data();
        
        // 1. Get all tokens
        // Note: In a production app with >1000 users, you should fetch in batches or use topics.
        const tokensSnap = await admin.firestore().collection('fcmTokens').get();
        
        // Assuming document ID is the token string as per user description
        const tokens = tokensSnap.docs.map(doc => doc.id);

        if (tokens.length === 0) {
            console.log('No tokens found. Aborting.');
            return;
        }

        // 2. Construct FCM Payload
        const payload = {
            notification: {
                title: data.title,
                body: data.body,
                image: data.image || "" // Some SDKs display this in the system tray
            },
            data: {
                // Custom data for the Android app to handle deep linking and large images
                url: data.url || "",
                image: data.image || "",
                click_action: "FLUTTER_NOTIFICATION_CLICK" // Common for cross-platform, or handle in onResume
            },
            android: {
                notification: {
                    channelId: "fcm_default_channel", // Critical: Must match Android manifest
                    priority: "high",
                    defaultSound: true,
                }
            },
            tokens: tokens // Send to all tokens found
        };

        try {
            // 3. Send Multicast
            const response = await admin.messaging().sendMulticast(payload);
            
            // 4. Log results
            console.log(`Successfully sent ${response.successCount} messages.`);
            if (response.failureCount > 0) {
                const failedTokens = [];
                response.responses.forEach((resp, idx) => {
                    if (!resp.success) {
                        failedTokens.push(tokens[idx]);
                    }
                });
                console.log('List of tokens that caused failures: ' + failedTokens);
                // Optional: Delete invalid tokens here
            }
            
            // 5. Update status in Firestore
            return snap.ref.update({ status: 'sent', sentAt: admin.firestore.FieldValue.serverTimestamp() });

        } catch (error) {
            console.error('Error sending notification:', error);
            return snap.ref.update({ status: 'failed', error: error.message });
        }
    });


/**
 * Trigger: Scheduled (Cron) function running every minute.
 * Action: Checks 'scheduled_notifications' for items matching current time and creates a 'notification' doc.
 */
exports.checkScheduledNotifications = functions.pubsub.schedule('every 1 minutes').onRun(async (context) => {
    const now = new Date();
    // Format time as HH:mm in Turkey timezone (UTC+3)
    const timeString = now.toLocaleTimeString('tr-TR', { 
        timeZone: 'Europe/Istanbul', 
        hour: '2-digit', 
        minute: '2-digit', 
        hour12: false 
    });

    console.log(`Checking schedule for time: ${timeString}`);

    const snapshot = await admin.firestore().collection('scheduled_notifications')
        .where('isActive', '==', true)
        .where('time', '==', timeString)
        .get();

    if (snapshot.empty) {
        console.log('No scheduled notifications for this time.');
        return null;
    }

    const batch = admin.firestore().batch();
    const notificationsRef = admin.firestore().collection('notifications');

    snapshot.forEach(doc => {
        const data = doc.data();
        const newNotifRef = notificationsRef.doc();
        batch.set(newNotifRef, {
            title: data.title,
            body: data.message,
            url: data.url || null,
            image: data.image || null,
            target: 'all',
            status: 'pending',
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            scheduledSourceId: doc.id // Tracking
        });
    });

    await batch.commit();
    console.log(`Triggered ${snapshot.size} scheduled notifications.`);
    return null;
});
