/**
 * extract-creds.js — FCM servisinden key çeker ve service account dosyası oluşturur.
 */
import * as fs from 'fs';
import * as path from 'path';

const fcmPath = 'services/fcmService.ts';
const content = fs.readFileSync(fcmPath, 'utf8');

const projectMatch = content.match(/project_id:\s*"(.*)"/);
const keyMatch = content.match(/private_key:\s*"(.*)"/);
const emailMatch = content.match(/client_email:\s*"(.*)"/);

if (projectMatch && keyMatch && emailMatch) {
    const creds = {
        "type": "service_account",
        "project_id": projectMatch[1],
        "private_key_id": "extracted-from-fcm",
        "private_key": keyMatch[1].replace(/\\n/g, '\n'),
        "client_email": emailMatch[1],
        "client_id": "100000000000000000000",
        "auth_uri": "https://accounts.google.com/o/oauth2/auth",
        "token_uri": "https://oauth2.googleapis.com/token",
        "auth_provider_x509_cert_url": "https://www.googleapis.com/oauth2/v1/certs",
        "client_x509_cert_url": `https://www.googleapis.com/robot/v1/metadata/x509/${encodeURIComponent(emailMatch[1])}`
    };

    fs.writeFileSync('firebase-service-account.json', JSON.stringify(creds, null, 2));
    console.log("✅ Credentials extracted and saved to firebase-service-account.json");
} else {
    console.error("❌ Credentials could not be extracted.");
}
