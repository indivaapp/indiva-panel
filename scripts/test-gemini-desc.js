

import * as fs from 'fs';
import * as path from 'path';

// Parse .env
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

const apiKey = process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_API_KEY;

async function generateDescription(productTitle, discountPercent) {

    const API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent';





    const systemInstruction = "Sen bir ürün uzmanı ve yaratıcı bir Türk e-ticaret metin yazarısın. Görevin, ürün adından yola çıkarak o ürünü gerçekten deneyimlemiş gibi samimi, heyecan verici ve ikna edici bir açıklama yazmaktır. Kesinlikle emoji kullanma. Mağaza adından bahsetme. Her ürün için benzersiz ve farklı bir metin oluştur.";

    const prompt = `Aşağıdaki ürün için tam olarak 50-70 kelime uzunluğunda, eğlenceli ve ikna edici bir açıklama yaz.

ÜRÜN BİLGİLERİ:
- Ürün: ${productTitle}
${discountPercent > 0 ? `- İndirim Oranı: %${discountPercent}` : ''}

KURALLAR:
1. Kesinlikle emoji kullanma.
2. Fiyat veya rakam yazma.
3. Mağaza adını belirtme.
4. Önce ürünün ne işe yaradığını ve temel avantajını etkileyici bir dille anlat.
5. Sonra bu ürünün kullanıcının hayatında yaratacağı somut farkı samimi bir dille vurgula.
6. Son cümlede klişelerden uzak, yaratıcı bir 'sepete ekle' mesajı ver.
7. Metin tamamen özgün ve her seferinde farklı olsun.

Sadece açıklama metnini döndür.`;

    try {
        console.log(`\n🤖 Testing for: "${productTitle}"`);
        const res = await fetch(`${API_URL}?key=${apiKey}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{
                    role: 'user',
                    parts: [{ text: `${systemInstruction}\n\n${prompt}` }]
                }],
                generationConfig: {
                    temperature: 0.8,
                    maxOutputTokens: 250,
                }
            })
        });

        if (!res.ok) {
            const err = await res.text();
            return `ERROR: ${res.status} - ${err}`;
        }

        const data = await res.json();
        return data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || 'EMPTY RESPONSE';
    } catch (err) {
        return `ERROR: ${err.message}`;
    }
}


const tests = [
    { title: "Sony WH-1000XM5 Gürültü Engelleyici Kulaklık", discount: 15 },
    { title: "Nespresso F111 Lattissima One Kahve Makinesi", discount: 20 },
    { title: "Oral-B iO Series 9 Şarjlı Diş Fırçası", discount: 0 }
];

async function run() {
    if (!apiKey) {
        console.error("GEMINI_API_KEY not found!");
        return;
    }
    for (const test of tests) {
        const desc = await generateDescription(test.title, test.discount);
        console.log(`✅ Result:\n"${desc}"\n(Word count: ${desc.split(/\s+/).length})`);
    }
}

run();
