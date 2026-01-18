// ===== GEMINI API TEST SCRIPT =====
// Bu script'i Gemini API bağlantısını test etmek için kullanın
// Kullanım: GEMINI_API_KEY=your-key node scripts/test-gemini.js

const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent';

async function testGemini() {
    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {
        console.log('❌ GEMINI_API_KEY environment variable tanımlı değil!');
        console.log('\nKullanım:');
        console.log('  Windows: set GEMINI_API_KEY=your-key && node scripts/test-gemini.js');
        console.log('  Linux/Mac: GEMINI_API_KEY=your-key node scripts/test-gemini.js');
        process.exit(1);
    }

    console.log('🤖 Gemini API Test Başlıyor...\n');

    // Test 1: Basit bağlantı testi
    console.log('📡 Test 1: API Bağlantısı');
    try {
        const response = await fetch(`${GEMINI_API_URL}?key=${apiKey}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ parts: [{ text: 'Merhaba! Sadece "Bağlantı başarılı!" yaz.' }] }],
                generationConfig: { maxOutputTokens: 50 }
            })
        });

        if (!response.ok) {
            const error = await response.text();
            console.log(`❌ HTTP ${response.status}: ${error.substring(0, 200)}`);
            process.exit(1);
        }

        const data = await response.json();
        const result = data.candidates?.[0]?.content?.parts?.[0]?.text;
        console.log(`✅ Yanıt: ${result}\n`);
    } catch (error) {
        console.log(`❌ Hata: ${error.message}`);
        process.exit(1);
    }

    // Test 2: Ürün açıklaması oluşturma
    console.log('📝 Test 2: Ürün Açıklaması Oluşturma');
    try {
        const prompt = `Sen deneyimli bir e-ticaret içerik yazarısın.

ÜRÜN:
- Başlık: "🔥 SÜPER FIRSAT Apple AirPods Pro 2. Nesil"
- Fiyat: 4999 TL
- Mağaza: Trendyol

GÖREVLER:
1. BAŞLIK: Emojiyi ve pazarlama kelimelerini kaldır
2. KATEGORİ: Elektronik/Giyim/Kozmetik/Diğer
3. AÇIKLAMA (50-100 kelime): Eğlenceli ve teşvik edici yaz

SADECE JSON DÖNDÜR:
{"title":"temiz başlık","category":"kategori","description":"açıklama"}`;

        const response = await fetch(`${GEMINI_API_URL}?key=${apiKey}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ parts: [{ text: prompt }] }],
                generationConfig: { temperature: 0.8, maxOutputTokens: 500 }
            })
        });

        const data = await response.json();
        const result = data.candidates?.[0]?.content?.parts?.[0]?.text;

        console.log('Ham yanıt:', result);

        // JSON parse
        let jsonStr = result.trim();
        if (jsonStr.startsWith('```json')) jsonStr = jsonStr.slice(7);
        if (jsonStr.startsWith('```')) jsonStr = jsonStr.slice(3);
        if (jsonStr.endsWith('```')) jsonStr = jsonStr.slice(0, -3);

        const parsed = JSON.parse(jsonStr.trim());
        console.log('\n✅ Parse edilmiş:');
        console.log(`   Başlık: ${parsed.title}`);
        console.log(`   Kategori: ${parsed.category}`);
        console.log(`   Açıklama: ${parsed.description}\n`);

    } catch (error) {
        console.log(`⚠️ Parse hatası: ${error.message}\n`);
    }

    console.log('🎉 Gemini API testi tamamlandı!');
    console.log('\n📋 Sonraki adımlar:');
    console.log('1. GitHub repository settings → Secrets → New secret');
    console.log('2. Name: GEMINI_API_KEY');
    console.log('3. Value: API key\'inizi yapıştırın');
}

testGemini();
