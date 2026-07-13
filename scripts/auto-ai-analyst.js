/**
 * auto-ai-analyst.js — İNDİVA AI Analist giriş noktası
 *
 * scripts/aiAnalystCore.js'deki mantığı çalıştırır. Mod, ANALYST_MODE ortam
 * değişkeniyle belirlenir ('daily' | 'weekly') — aynı script iki farklı
 * GitHub Actions workflow'undan (.github/workflows/auto-ai-analyst-*.yml)
 * farklı env değeriyle çağrılır.
 *
 * Çalıştırma: ANALYST_MODE=daily node scripts/auto-ai-analyst.js
 */

import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import * as fs from 'fs';
import * as path from 'path';
import { runAnalyst, reportAnalystFailure } from './aiAnalystCore.js';

const ROOT_DIR = process.cwd();
const envPath = path.join(ROOT_DIR, '.env');
if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf8');
    for (const line of envContent.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eqIdx = trimmed.indexOf('=');
        if (eqIdx < 0) continue;
        const key = trimmed.substring(0, eqIdx).trim();
        const val = trimmed.substring(eqIdx + 1).trim().replace(/^["']|["']$/g, '');
        if (!process.env[key]) process.env[key] = val;
    }
}

function initFirebase() {
    if (getApps().length > 0) return getFirestore();
    const envJson = process.env.FIREBASE_SERVICE_ACCOUNT;
    let serviceAccount;
    if (envJson) {
        serviceAccount = JSON.parse(envJson);
    } else {
        const localPath = path.join(ROOT_DIR, 'firebase-service-account.json');
        if (fs.existsSync(localPath)) {
            serviceAccount = JSON.parse(fs.readFileSync(localPath, 'utf8'));
        } else {
            throw new Error('Firebase service account bulunamadı.');
        }
    }
    if (serviceAccount?.private_key) {
        serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, '\n').replace(/\n\n/g, '\n');
    }
    initializeApp({ credential: cert(serviceAccount) });
    return getFirestore();
}

async function main() {
    const mode = process.env.ANALYST_MODE === 'weekly' ? 'weekly' : 'daily';
    console.log(`\n🧠 İNDİVA AI Analist (${mode}): ${new Date().toLocaleString('tr-TR')}`);

    const db = initFirebase();
    try {
        const { reportId } = await runAnalyst(db, mode);
        console.log(`✅ Rapor kaydedildi: ${reportId}`);
    } catch (err) {
        await reportAnalystFailure(db, mode, err);
        process.exit(1);
    }
}

main().then(() => process.exit(0));
