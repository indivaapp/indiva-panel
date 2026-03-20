/**
 * test-ai.js - Gemini AI entegrasyon testi
 * Çalıştır: node scripts/test-ai.js
 */
import { GoogleGenAI } from '@google/genai';
import * as fs from 'fs';
import * as path from 'path';

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

const MODEL = 'gemini-2.5-flash';
const apiKey = process.env.GEMINI_API_KEY;

console.log(`\n🔑 API Key: ${apiKey ? apiKey.substring(0, 15) + '...' : 'EKSİK!'}`);
console.log(`🤖 Model: ${MODEL}\n`);

if (!apiKey) {
    console.error('❌ GEMINI_API_KEY bulunamadı!');
    process.exit(1);
}

const genAI = new GoogleGenAI({ apiKey });

try {
    const response = await genAI.models.generateContent({
        model: MODEL,
        contents: [{
            role: 'user',
            parts: [{ text: 'Ürün: "Philips 5000 Serisi Robot Süpürge" - Fiyat: 2500 TL\nSADECE JSON döndür: {"title":"...", "category":"...", "aiFomoScore": 7}' }]
        }],
        config: { temperature: 0.1 }
    });

    const text = response.text || '';
    console.log('✅ AI Yanıt alındı:');
    console.log(text.substring(0, 500));
    console.log('\n🎉 Gemini 2.5 Flash entegrasyonu BAŞARIYLA ÇALIŞIYOR!');
} catch (err) {
    console.error(`\n❌ AI Hata: ${err.message}`);
    process.exit(1);
}
