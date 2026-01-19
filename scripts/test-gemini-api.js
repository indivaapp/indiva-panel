// Gemini API Test Script
// node scripts/test-gemini-api.js

const API_KEY = 'AIzaSyBb3aYRtZdH3ttCS19zu7XnFcu4fKSypyk';
const API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent';

async function testGeminiAPI() {
    console.log('🧪 Gemini API Test Başlıyor...\n');

    const testUrl = 'https://www.n11.com/urun/bingo-akilli-kapsul-pro-bulasik-makinesi-deterjani-80-tablet';

    const prompt = `Sen bir e-ticaret ürün analizcisisin. Aşağıdaki N11 ürün linkini analiz et.

URL: ${testUrl}

Bu linkteki ürün hakkında aşağıdaki bilgileri JSON formatında döndür:
1. title: Ürün başlığı 
2. brand: Marka
3. store: Mağaza adı (N11)
4. category: Kategori (Ev & Yaşam, Elektronik, Giyim vb.)
5. description: 50-80 kelimelik pazarlama açıklaması (emoji'li, çekici)
6. oldPrice: Eski fiyat (tahmin - eğer bilinmiyorsa 0)
7. newPrice: Yeni/güncel fiyat (tahmin)
8. discountPercent: İndirim oranı tahmini

SADECE JSON DÖNDÜR, başka bir şey yazma:`;

    try {
        const response = await fetch(`${API_URL}?key=${API_KEY}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                contents: [{
                    parts: [{ text: prompt }]
                }],
                generationConfig: {
                    temperature: 0.7,
                    maxOutputTokens: 1024,
                }
            })
        });

        console.log('Status:', response.status);

        if (!response.ok) {
            const error = await response.text();
            console.error('❌ Hata:', error);
            return;
        }

        const data = await response.json();
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text;

        console.log('✅ API Yanıtı:\n');
        console.log(text);

        // JSON parse dene
        try {
            let jsonStr = text.trim();
            if (jsonStr.startsWith('```json')) jsonStr = jsonStr.slice(7);
            if (jsonStr.startsWith('```')) jsonStr = jsonStr.slice(3);
            if (jsonStr.endsWith('```')) jsonStr = jsonStr.slice(0, -3);

            const parsed = JSON.parse(jsonStr.trim());
            console.log('\n📦 Parse Edilmiş Veri:');
            console.log(JSON.stringify(parsed, null, 2));
        } catch (e) {
            console.log('\n⚠️ JSON parse hatası, raw text döndü');
        }

    } catch (err) {
        console.error('❌ Fetch hatası:', err.message);
    }
}

testGeminiAPI();
