import { GoogleGenAI } from '@google/genai';
import fs from 'fs';
import path from 'path';

// Load .env
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

const TEST_DATA = [
    {
      "id": "onual_105680",
      "title": "Ogx Argan Oil Of Morocco Onarıcı Sülfatsız Saç Bakım Kremi 385 Ml",
      "link": "https://www.trendyol.com/p-4569877",
      "newPrice": 300,
      "brand": "Trendyol"
    },
    {
      "id": "onual_10633",
      "title": "Stanley Growler Vakumlu Çelik Termos, Yeşil (Hammertone Green), 0.7 Litre",
      "link": "https://www.amazon.com.tr/dp/B07P9JHDS7",
      "newPrice": 2743,
      "brand": "Amazon"
    },
    {
      "id": "onual_1162111",
      "title": "Gillette Blue2 Kullan At Tıraş Bıçağı 20'li Extra Büyük Paket",
      "link": "https://www.hepsiburada.com/gillette-blue2-kullan-at-tiras-bicagi-20-li-p-HBC00000FIAMC",
      "newPrice": 324,
      "brand": "Hepsiburada"
    },
    {
      "id": "onual_1168277",
      "title": "Arzum Ar1035 Prochopp Eco Doğrayıcı",
      "link": "https://www.hepsiburada.com/arzum-ar1035-p-HB000001TQBJ",
      "newPrice": 1199,
      "brand": "Hepsiburada"
    },
    {
      "id": "onual_1172659",
      "title": "Mikro Damla Sulama Spagetti Hortum Ve Ek Parçaları-Saksı Sulama",
      "link": "https://www.n11.com/urun/mikro-damla-sulama-spagetti-p-34138676",
      "newPrice": 99,
      "brand": "n11"
    },
    {
      "id": "onual_1179659",
      "title": "Fifine Ampligame A6T Twitch - Youtuber - Gamer - Tiktok - Yayıncı Usb Mikrofon Seti",
      "link": "https://www.amazon.com.tr/dp/B09R6L96Z9",
      "newPrice": 3198,
      "brand": "Amazon"
    },
    {
      "id": "onual_1187724",
      "title": "2.5X5 Silinmiş Çita 10'Ar Adet",
      "link": "https://www.n11.com/urun/25x5-silinmis-cita-p-46481710",
      "newPrice": 100,
      "brand": "n11"
    },
    {
      "id": "onual_1192634",
      "title": "Arzum Ar1035 Prochopp Eco 600 W Doğrayıcı",
      "link": "https://www.n11.com/urun/arzum-ar1035-p-13835773",
      "newPrice": 1175,
      "brand": "n11"
    },
    {
      "id": "onual_1201597",
      "title": "Gillette Fusion Proglide 5 Bıçaklı Tıraş Ürünü 2'li Paket Hassas Cilt Dostu Erkekler İçin",
      "link": "https://www.hepsiburada.com/gillette-fusion-p-SGGIL5897",
      "newPrice": 399,
      "brand": "Hepsiburada"
    },
    {
      "id": "onual_1222350",
      "title": "Plastik Hasır,Outdoor Mats,Piknik,Plaj,Kamp,Bahçe Veranda Halı Ki",
      "link": "https://www.n11.com/urun/plastik-hasir-p-473000049",
      "newPrice": 399,
      "brand": "n11"
    }
];

async function checkWithJina(url) {
    const jinaUrl = `https://r.jina.ai/${url}`;
    try {
        const response = await fetch(jinaUrl, {
            headers: { 'X-Retain-Images': 'none' }
        });
        if (!response.ok) return { success: false, error: `Jina HTTP ${response.status}` };
        return { success: true, text: await response.text() };
    } catch (e) {
        return { success: false, error: e.message };
    }
}

async function verifyWithAI(product, jinaContent) {
    const apiKey = process.env.VITE_GROQ_API_KEY || process.env.GROQ_API_KEY;
    if (!apiKey) return { error: 'No Groq API Key' };

    const prompt = `Ürün: "${product.title}"
Beklenen Fiyat: ${product.newPrice} TL
Mağaza Sayfası İçeriği (Markdown):
---
${jinaContent.substring(0, 15000)}
---

GÖREV:
Bu ürünün güncel durumunu belirle.
1. Ürün hala stokta mı?
2. Güncel fiyatı nedir (TL)?
3. İndirim bitmiş mi? (Fiyat önemli ölçüde artmışsa veya stok yoksa true)

SADECE JSON döndür:
{
  "expired": boolean,
  "currentPrice": number,
  "inStock": boolean,
  "reason": "kısa açıklama (Türkçe)"
}`;

    const url = `https://api.groq.com/openai/v1/chat/completions`;

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`
            },
            body: JSON.stringify({
                model: "llama-3.3-70b-versatile", 
                messages: [{ role: "user", content: prompt }],
                temperature: 0.1,
                response_format: { type: "json_object" }
            })
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Groq API error: ${response.status} ${errorText.substring(0, 100)}`);
        }

        const data = await response.json();
        const content = data.choices?.[0]?.message?.content || '';
        return JSON.parse(content);
    } catch (e) {
        return { error: e.message };
    }
}

async function runPilot() {
    console.log("🚀 Pilot İndirim Kontrolü Başlatıldı (10 Ürün)\n");
    console.log("--------------------------------------------------");
    
    const results = [];

    for (const product of TEST_DATA) {
        console.log(`\n📦 [${product.brand}] ${product.title.substring(0, 60)}...`);
        console.log(`🔗 Link: ${product.link}`);
        console.log(`💰 Kayıtlı Fiyat: ${product.newPrice} TL`);

        // Step 1: Fetch via Jina
        console.log("⏳ Sayfa taranıyor (Jina Reader)...");
        const jinaResult = await checkWithJina(product.link);
        
        if (!jinaResult.success) {
            console.log(`❌ Hata: ${jinaResult.error}`);
            results.push({ ...product, status: 'error', error: jinaResult.error });
            continue;
        }

        // Step 2: AI Verification
        console.log("🧠 AI analizi yapılıyor...");
        const aiResult = await verifyWithAI(product, jinaResult.text);

        if (aiResult.error) {
            console.log(`❌ AI Hatası: ${aiResult.error}`);
            results.push({ ...product, status: 'ai_error', error: aiResult.error });
            continue;
        }

        console.log(`✅ Sonuç: ${aiResult.expired ? '🚩 İNDİRİM BİTTİ' : '🎉 AKTİF'}`);
        console.log(`💸 Güncel Fiyat: ${aiResult.currentPrice} TL`);
        console.log(`📦 Stok: ${aiResult.inStock ? 'Var' : 'Yok'}`);
        console.log(`📝 Sebep: ${aiResult.reason}`);

        results.push({
            ...product,
            status: aiResult.expired ? 'expired' : 'active',
            currentPrice: aiResult.currentPrice,
            reason: aiResult.reason
        });

        // Large delay to avoid Jina Reader rate limits (Free tier)
        console.log("⏳ 10 saniye bekleniyor...");
        await new Promise(r => setTimeout(r, 10000));
    }

    console.log("\n\n" + "=".repeat(50));
    console.log("📊 PİLOT TEST ÖZETİ");
    console.log("=".repeat(50));
    const active = results.filter(r => r.status === 'active').length;
    const expired = results.filter(r => r.status === 'expired').length;
    const errors = results.filter(r => r.status.includes('error')).length;

    console.log(`✅ Aktif: ${active}`);
    console.log(`🚩 İndirim Bitti: ${expired}`);
    console.log(`❌ Hatalı: ${errors}`);
    console.log("=".repeat(50));
}

runPilot();
