
import * as fs from 'fs';
import * as path from 'path';

// Parse .env
const ROOT_DIR = process.cwd();
const envPath = path.join(ROOT_DIR, '.env');
let apiKey = '';
if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf8');
    for (const line of envContent.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eqIdx = trimmed.indexOf('=');
        if (eqIdx < 0) continue;
        const key = trimmed.substring(0, eqIdx).trim();
        const val = trimmed.substring(eqIdx + 1).trim().replace(/^["']|["']$/g, '');
        if (key === 'OPENROUTER_API_KEY') apiKey = val;
    }
}

async function testKey() {
    console.log('Testing with Key:', apiKey.substring(0, 10) + '...');
    const API_URL = 'https://openrouter.ai/api/v1/chat/completions';
    
    // User specifically wants google/gemini-2.5-flash-lite
    const MODEL = 'google/gemini-2.5-flash-lite';

    try {
        const res = await fetch(API_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`
            },
            body: JSON.stringify({
                model: MODEL,
                messages: [
                    { role: 'user', content: 'Say "Working!" if you are Gemini 2.5.' }
                ]
            })
        });

        if (!res.ok) {
            const err = await res.text();
            console.error('❌ Hata:', res.status, err);
            return;
        }

        const data = await res.json();
        console.log('✅ Response:', data.choices?.[0]?.message?.content);
        console.log('📊 Actual Model Used:', data.model);
    } catch (err) {
        console.error('💥 Error:', err.message);
    }
}

testKey();
