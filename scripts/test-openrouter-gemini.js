
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

const apiKey = process.env.OPENROUTER_API_KEY || process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_API_KEY;

async function testOpenRouter(productTitle, discountPercent) {
    console.log(`\n--- Testing for: ${productTitle} (Discount: ${discountPercent}%) ---`);
    console.log('API Key check:', apiKey ? `Found (${apiKey.substring(0, 10)}...)` : 'Not found');

    if (!apiKey) {
        console.error('❌ API Key bulunamadı (.env dosyasını kontrol edin)');
        return 'ERROR: API Key not found';
    }

    const API_URL = 'https://openrouter.ai/api/v1/chat/completions';
    const MODEL = 'google/gemini-2.5-flash-lite';

    const systemInstruction = `Sen uzman bir fırsat avcısı ve ürün gurususun. Ürünleri türüne göre (Gıda, Elektronik, Moda vb.) ayırt edebilir ve her birine uygun samimi bir dil kullanabilirsin. 
KATEGORİ KURALLARI:
- Yenilebilir tüm ürünler (çikolata, bisküvi, kahve, gıda takviyesi vb.) kesinlikle "Gıda" kategorisindedir.
- Giyim, ayakkabı, çanta -> "Giyim & Ayakkabı".
- Telefon, bilgisayar, küçük ev aletleri -> "Elektronik".
- Diğerlerini en uygun kategoriye ata.

YASAKLI KELİMELER (Kesinlikle Kullanma): "günlük rutin", "yardımcı", "tasarım", "titizlik", "işlevsellik", "rutininde fark yaratacak", "tercih ediliyor".`;

    const prompt = `Aşağıdaki ürün için kategori tespiti yap ve heyecan verici bir tanıtım metni oluştur.

ÜRÜN: ${productTitle}
${discountPercent > 0 ? `İNDİRİM: %${discountPercent}` : ''}

METİN STRATEJİSİ:
1. Ürün eğer GIDA ise: Tadına, lezzetine, keyif anına odaklan. (Örn: "Tatlı krizlerine son!", "Kahve yanına efsane eşlikçi!")
2. Ürün eğer ELEKTRONİK/ALET ise: Performansına veya kattığı kolaylığa odaklan.
3. Ürün eğer GİYİM ise: Şıklığına ve stiline odaklan.

KURALLAR:
- Sadece 2-3 emoji kullan.
- "Robot gibi" konuşma; samimi, mahalledeki arkadaşın gibi konuş.
- Fiyat veya mağaza adı yazma.
- Yanıtı sadece JSON formatında ver.

JSON FORMATI:
{
  "category": "Gıda/Elektronik/Giyim & Ayakkabı/vb.",
  "description": "..."
}`;

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
                    { role: 'system', content: systemInstruction },
                    { role: 'user', content: prompt }
                ],
                temperature: 0.8,
                response_format: { type: 'json_object' }
            })
        });

        if (!res.ok) {
            const err = await res.text();
            console.error('❌ Hata:', err);
            return `ERROR: ${res.status} - ${err}`;
        }

        const data = await res.json();
        let content = data.choices?.[0]?.message?.content?.trim() || '';

        try {
            const parsed = JSON.parse(content);
            console.log('✅ Kategori:', parsed.category);
            console.log('✍️ Açıklama:', parsed.description);
            console.log('📊 Kullanılan Model:', data.model);
            return parsed;
        } catch (e) {
            const match = content.match(/\{[\s\S]*\}/);
            if (match) {
                const parsed = JSON.parse(match[0]);
                console.log('✅ Kategori (Parsed):', parsed.category);
                console.log('✍️ Açıklama (Parsed):', parsed.description);
                console.log('📊 Kullanılan Model:', data.model);
                return parsed;
            }
            throw new Error('Geçersiz JSON yanıtı');
        }
    } catch (err) {
        console.error('💥 Kritik Hata:', err.message);
        return `ERROR: ${err.message}`;
    }
}


const tests = [
    { title: "Ferrero Rocher Çikolata 200 Gr 8Li, Hediyelik Çikolata", discount: 60 },
    { title: "Nutella Kakaolu Fındık Kreması 750 Gr", discount: 15 },
    { title: "Logitech G915 X Lightspeed Tkl Klavye", discount: 0 },
    { title: "Mavi Logo Baskılı Antrasit Tişört", discount: 20 }
];

async function runTests() {
    for (const test of tests) {
        await testOpenRouter(test.title, test.discount);
    }
}

runTests();
