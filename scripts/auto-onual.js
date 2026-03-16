/**
 * auto-onual.js — INDIVA Otomatik Fırsat Pipeline
 * 
 * onual.com/fiyat/ sitesini tarar, Gemini 2.5 Flash Lite (OpenRouter) ile açıklama üretir,
 * gerçek mağaza linkini resolve ederek Firebase'e kaydeder.
 * 
 * Çalıştırma: node scripts/auto-onual.js
 */

import * as cheerio from 'cheerio';
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore, FieldValue, FieldPath } from 'firebase-admin/firestore';
import { getMessaging } from 'firebase-admin/messaging';
import * as fs from 'fs';
import * as path from 'path';



// ─── .env Yükle (lokal geliştirme) ─────────────────────────────────────────
// GitHub Actions'da ortam değişkenleri zaten set edilmiş olur
// Lokal'de .env dosyasını okuyoruz (dotenv paketi olmadan)
const ROOT_DIR = process.cwd(); // script her zaman proje kökünden çalıştırılmalı
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


// ─── Config ──────────────────────────────────────────────────────────────────

const ONUAL_URL = 'https://onual.com/fiyat/';
const MAX_NEW_PRODUCTS = 15; // Biraz artırılabilir, artık daha verimli
const REQUEST_DELAY_MS = 1000; // İstekler arası bekleme (ms)

// AI Config
const API_URL = 'https://openrouter.ai/api/v1/chat/completions';
// MiniMax M2.5 - Yüksek kaliteli ve yaratıcı e-ticaret açıklamaları için
const MODEL = 'minimax/minimax-m2.5';

// Kategorileri tespit için anahtar kelimeler
const CATEGORY_MAP = [
    { keywords: ['klavye', 'mouse', 'fare', 'monitör', 'bilgisayar', 'laptop', 'notebook', 'tablet', 'telefon', 'kulaklık', 'hoparlör', 'kamera', 'projeksiyon', 'ssd', 'harddisk', 'şarj', 'powerbank', 'kablo', 'adaptör'], category: 'Teknoloji' },
    { keywords: ['mont', 'ceket', 'kazak', 'gömlek', 'pantolon', 'şort', 'elbise', 'bluz', 'tişört', 'sweatshirt', 'polar', 'ayakkabı', 'sneaker', 'bot', 'sandalet', 'çanta', 'sırt çantası', 'bere', 'eldiven', 'çorap', 'yelek', 'kemer', 'cüzdan'], category: 'Giyim & Ayakkabı' },
    { keywords: ['şampuan', 'krem', 'losyon', 'maske', 'serum', 'parfüm', 'deodorant', 'saç', 'cilt', 'diş', 'tıraş', 'makyaj', 'ruj', 'oje', 'ped', 'orkid', 'hijyen', 'sabun', 'duş jeli', 'vücut spreyi'], category: 'Kozmetik & Kişisel Bakım' },
    { keywords: ['tencere', 'tava', 'çaydanlık', 'bıçak', 'kaşık', 'tabak', 'bardak', 'fincan', 'yemek takımı', 'çay takımı', 'mobilya', 'masa', 'sandalye', 'yatak', 'dolap', 'nevresim', 'perde', 'halı', 'kilim', 'aydınlatma', 'lamba'], category: 'Ev, Yaşam & Mutfak' },
    { keywords: ['deterjan', 'sabun', 'temizlik', 'bez', 'süpürge', 'mop', 'fırça', 'çöp', 'bakliyat', 'yağ', 'şeker', 'çay', 'kahve', 'atıştırmalık', 'makarna', 'peynir', 'süt', 'yoğurt'], category: 'Süpermarket' },
    { keywords: ['bebek', 'bez', 'emzik', 'biberon', 'oyuncak', 'lego', 'puzzle', 'bebek arabası'], category: 'Anne & Bebek' },
    { keywords: ['vitamini', 'takviye', 'kapsül', 'şurup', 'macun', 'sağlık', 'maske', 'eldiven'], category: 'Sağlık & Medikal' },
    { keywords: ['kalem', 'defter', 'boya', 'çizim', 'kağıt', 'resim', 'kitap', 'roman'], category: 'Kitap & Kırtasiye' },
    { keywords: ['kamp', 'spor', 'fitness', 'outdoor', 'bisiklet', 'top', 'forma'], category: 'Spor & Outdoor' },
    { keywords: ['kedi', 'köpek', 'mama', 'kum', 'tasma', 'kuş', 'balık'], category: 'Pet Shop' },
    { keywords: ['araba', 'otomobil', 'tekerlek', 'lastik', 'yağ', 'aksesuar', 'motosiklet', 'kask'], category: 'Otomotiv & Motosiklet' },
];

// Mağaza tespiti
const STORE_MAP = [
    { domain: 'trendyol.com', name: 'Trendyol' },
    { domain: 'hepsiburada.com', name: 'Hepsiburada' },
    { domain: 'amazon.com.tr', name: 'Amazon' },
    { domain: 'amazon.com', name: 'Amazon' },
    { domain: 'n11.com', name: 'n11' },
    { domain: 'gittigidiyor.com', name: 'GittiGidiyor' },
    { domain: 'pazarama.com', name: 'Pazarama' },
    { domain: 'ciceksepeti.com', name: 'ÇiçekSepeti' },
    { domain: 'teknosa.com', name: 'Teknosa' },
    { domain: 'vatan.com.tr', name: 'Vatan' },
    { domain: 'mediamarkt.com.tr', name: 'MediaMarkt' },
    { domain: 'boyner.com.tr', name: 'Boyner' },
    { domain: 'lcwaikiki.com', name: 'LC Waikiki' },
    { domain: 'zara.com', name: 'Zara' },
    { domain: 'koton.com', name: 'Koton' },
    { domain: 'morhipo.com', name: 'Morhipo' },
    { domain: 'defacto.com.tr', name: 'DeFacto' },
];

// ─── Firebase ────────────────────────────────────────────────────────────────

function initFirebase() {
    if (getApps().length > 0) return getFirestore();

    let serviceAccount;
    const envJson = process.env.FIREBASE_SERVICE_ACCOUNT;

    if (envJson) {
        serviceAccount = JSON.parse(envJson);
    } else {
        // Lokal geliştirme için service account dosyası
        const localPath = path.join(ROOT_DIR, 'firebase-service-account.json');
        if (fs.existsSync(localPath)) {
            serviceAccount = JSON.parse(fs.readFileSync(localPath, 'utf8'));
        } else {
            throw new Error('Firebase service account bulunamadı. FIREBASE_SERVICE_ACCOUNT env değişkenini ayarlayın veya firebase-service-account.json dosyasını ekleyin.');
        }
    }

    initializeApp({ credential: cert(serviceAccount) });
    return getFirestore();
}

// ─── OpenRouter AI ───────────────────────────────────────────────────────────

function getGeminiKey() {
    // OpenRouter Key'ini önceliklendir (Çünkü Gemini Lite paketimiz OpenRouter üzerinde)
    const key = process.env.OPENROUTER_API_KEY || process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_API_KEY;
    if (!key) throw new Error('API Key (OPENROUTER_API_KEY veya GEMINI_API_KEY) env değişkeni eksik');
    return key;
}


/**
 * Ürün başlığındaki gereksiz kodları ve numaraları temizle
 */
function cleanProductTitle(title) {
    return title
        // Sondaki uzun sayısal ürün kodları (066842-70758, 207900-7459)
        .replace(/\s+\d{5,}[-]\d+\s*$/g, '')
        // Sondaki alfanumerik model kodları (Ch-91D401L-Tr, Ccb001Btbk, 000Cg20917)
        .replace(/\s+[A-Z]{1,3}[-][A-Z0-9]{3,}[-]?[A-Z0-9]*\s*$/gi, '')
        // Sondaki ürün kodlarını sil (örn: "Ürün Adı - ABC123", "Ürün Adı 50276557-VR090")
        .replace(/[-–]\s*[A-Z0-9]{4,}(?:[\-_][A-Z0-9]+)*\s*$/i, '')
        // Parantez içindeki kodları sil (örn: "(HB000018U0DJ)")
        .replace(/\([A-Z0-9]{5,}\)\s*$/i, '')
        // Sondaki kısa model kodları (Eld01, Pb-70, Ap12T)
        .replace(/\s+[A-Z][a-z]?[0-9]{1,2}[A-Z]?\s*$/g, '')
        // Sondaki "Pack Of X" ifadelerini temizle
        .replace(/,?\s*Pack Of \d+\s*$/gi, '')
        // Sondaki virgül ve boşlukları temizle
        .replace(/[,\s]+$/g, '')
        // Çift boşlukları temizle
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * Eski fiyat yoksa yeni fiyattan %20-%60 arası rastgele simüle et
 */
function simulateOldPrice(newPrice) {
    const discountRatio = 0.20 + Math.random() * 0.40; // %20 ile %60 arası
    const oldPrice = Math.round(newPrice / (1 - discountRatio));
    // 5'e yuvarla (daha gerçekçi görünsün)
    return Math.round(oldPrice / 5) * 5;
}

/**
 * OpenRouter üzerinden AI ile Türkçe ürün açıklaması oluştur
 * Birincil model: Gemini 2.5 Flash Lite (OpenRouter)
 */
/**
 * AI üzerinden hem kategori hem de açıklama oluştur (JSON formatında)
 */
async function generateAISentiments(apiKey, productTitle, newPrice, oldPrice, metaDescription = '') {
    const discountPercent = oldPrice > 0 ? Math.round(((oldPrice - newPrice) / oldPrice) * 100) : 0;

    const CATEGORY_MAPPING = {
        "Elektronik": "Teknoloji",
        "Cep Telefonu": "Teknoloji",
        "Bilgisayar": "Teknoloji",
        "Mutfak": "Ev, Yaşam & Mutfak",
        "Ev Aletleri": "Ev, Yaşam & Mutfak",
        "Giyim": "Giyim & Ayakkabı",
        "Ayakkabı": "Giyim & Ayakkabı",
        "Aksesuar": "Giyim & Ayakkabı", // Genel aksesuar, teknoloji aksesuarı değil
        "Kozmetik": "Kozmetik & Kişisel Bakım",
        "Kişisel Bakım": "Kozmetik & Kişisel Bakım",
        "Market": "Süpermarket",
        "Gıda": "Süpermarket",
        "Anne & Bebek": "Anne & Bebek",
        "Oyuncak": "Oyuncak & Hobi",
        "Spor": "Spor & Outdoor",
        "Kitap": "Kitap & Kırtasiye",
        "Sağlık": "Sağlık & Medikal",
        "Evcil Hayvan": "Pet Shop",
        "Otomotiv": "Otomotiv & Motosiklet",
        "Bahçe": "Bahçe & Yapı Market",
        "Hobi": "Oyuncak & Hobi",
        "Ofis": "Ofis & Kırtasiye",
        "Takı": "Takı & Aksesuar",
        "Çanta": "Çanta & Valiz",
        "Saat": "Saat & Gözlük",
        "Hediyelik": "Hediyelik Eşya"
    };

    const systemInstruction = `Sen alanında uzman bir Teknik Ürün Analisti ve Veri Odaklı Alışveriş Rehberisin. Görevin, sıradan reklam cümlelerinden kaçınarak, kullanıcıya ürün hakkında gerçek, teknik ve faydalı bilgiler sunmaktır.

KESİNLİKLE YASAKLI KELİMELER VE KALIPLAR (Kullanırsan sistem hata verir):
- "Modern çizgileri", "kullanıcı dostu", "harika bir deneyim", "estetik tasarım", "beklentilerin ötesinde", "hayatınızı kolaylaştıracak", "bir parça", "şık görünüm", "performans vaad ediyor", "seni bekliyor", "kendine bir iyilik yap".

TEMEL KURALLAR:
1. İNTERNET ERİŞİMİ/KNOWLEDGE BASE: Bu ürün hakkındaki tüm dahili bilgilerini (marka geçmişi, malzeme kalitesi, teknik spesifikasyonlar, kullanım alanları) kullan.
2. SOMUT VERİ ŞARTI: Her açıklamada ürünün teknik bir detayına (gramaj, malzeme türü, işlemci modeli, içerik maddesi, bağlantı tipi vb.) yer ver.
3. TONLAMA: Bilgilendirici, ciddi ama akıcı bir uzman dili kullan. Pazarlamacı gibi değil, bir bilirkişi gibi konuş.
4. KATEGORİ: Ürünü aşağıdaki listeden en doğru kategoriye ata.
KATEGORİ LİSTESİ: ${Object.values(CATEGORY_MAPPING).filter((v, i, a) => a.indexOf(v) === i).map(c => `"${c}"`).join(', ')}.`;

    let prompt = `Aşağıdaki ürünün teknik özelliklerini analiz et ve kullanıcının ürün hakkında gerçek bilgi sahibi olmasını sağlayacak, teknik derinliği olan bir açıklama yaz.

ÜRÜN: ${productTitle}
${metaDescription ? `EK VERİ: ${metaDescription}` : ''}
${discountPercent > 0 ? `AVANTAJ: %${discountPercent} indirim` : ''}

TALİMATLAR:
- Metne direkt ürünün teknik bir özelliği veya markanın uzmanlık alanıyla başla.
- Ürün başlığında yazmayan ama bu modelin/ürünün sahip olduğu en az 2 gerçek teknik bilgiyi (Örn: Köpek mamasıysa protein kaynağı/oranı, teknolojik ürünse panel tipi veya batarya detayı) ekle.
- "Neden bu fiyata değer?" sorusunu teknik bir avantajla açıkla.
- 50-70 kelime arası, tek paragraf olsun.
- Sadece somut gerçeklere odaklan, boş övgü yapma.

JSON FORMATI:
{
  "category": "Kategori",
  "aiFomoScore": 9,
  "description": "Teknik olarak doyurucu ve bilgilendirici metin..."
}`;

    try {
        const modelsToTry = [
            'google/gemini-2.5-flash',
            'google/gemini-2.0-flash-001',
            'google/gemini-flash-1.5-8b'
        ];

        let lastErr = null;
        for (const currentModel of modelsToTry) {
            try {
                console.log(`      🤖 AI analiz yapıyor (${currentModel})...`);
                const res = await fetch(API_URL, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${apiKey}`,
                        'HTTP-Referer': 'https://indiva.app',
                        'X-Title': 'INDIVA Admin Panel'
                    },
                    body: JSON.stringify({
                        model: currentModel,
                        messages: [
                            { role: 'system', content: systemInstruction },
                            { role: 'user', content: prompt }
                        ],
                        temperature: 0.8,
                        response_format: { type: 'json_object' }
                    }),
                    signal: AbortSignal.timeout(12000) // Timeout 12 saniyeye düşürüldü
                });

                if (!res.ok) {
                    const errText = await res.text();
                    throw new Error(`Model ${currentModel} hatası: ${res.status} - ${errText.substring(0, 100)}`);
                }

                const data = await res.json();
                const content = data.choices?.[0]?.message?.content?.trim() || '';

                if (content) {
                    const match = content.match(/\{[\s\S]*\}/);
                    if (match) {
                        const parsed = JSON.parse(match[0]);
                        if (parsed.category && parsed.description) {
                            // Ensure aiFomoScore exists and is a number between 1-10
                            parsed.aiFomoScore = Number.isFinite(parsed.aiFomoScore) ? Math.max(1, Math.min(10, parsed.aiFomoScore)) : 5;
                            console.log(`      ✅ AI Başarılı [${currentModel}]: [${parsed.category}] - FOMO Puanı: ${parsed.aiFomoScore}`);
                            return parsed;
                        }
                    }
                }
                throw new Error(`Model ${currentModel} geçersiz yanıt döndürdü`);
            } catch (err) {
                console.warn(`      ⚠️  ${err.message}`);
                lastErr = err;
                continue; // Bir sonraki modeli dene
            }
        }
        throw lastErr || new Error('Tüm modeller denendi ama sonuç alınamadı');

    } catch (err) {
        console.warn(`      ⚠️  AI Hatası: ${err.message}. Fallback kullanılıyor.`);
        return {
            category: detectCategory(productTitle),
            description: generateFallbackDescription(productTitle, discountPercent),
            aiFomoScore: discountPercent >= 50 ? 8 : (discountPercent > 20 ? 6 : 4) // Fallback score based on mathematical discount
        };
    }
}

/**
 * AI to generate push notifications (short, humorous, urgent)
 */
async function generatePushNotifications(apiKey, productTitle, discountPercent) {
    if (discountPercent < 10) return []; // Only generate for good deals

    const prompt = `Şu e-ticaret ürünü için uygulamamın kullanıcılarına göndereceğim 3 farklı Push Bildirimi (mobil bildirim mesajı) oluştur:
Ürün: "${productTitle}"
İndirim: %${discountPercent}

Format:
1. Kısa ve Öz (Sadece en önemli bilgiyi ver, clickbait yapma)
2. Mizahi/Eğlenceli (Kullanıcıda tebessüm yaratacak, zekice bir bağlantı kur)
3. Aciliyet/FOMO Bildiren (Fırsatı kaçırmaktan korkutacak, hemen tıklamaya itecek)

Lütfen sadece bir JSON array'i döndür. Array içinde string'ler olsun. Örnek: ["Kısa metin", "Komik metin", "Acil metin"]`;

    try {
        console.log(`      📢 AI Bildirimleri Üretiyor...`);
        const res = await fetch(API_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`,
                'HTTP-Referer': 'https://indiva.app',
                'X-Title': 'INDIVA Admin Panel'
            },
            body: JSON.stringify({
                model: 'google/gemini-2.5-flash',
                messages: [{ role: 'user', content: prompt }]
            }),
            signal: AbortSignal.timeout(10000)
        });

        if (!res.ok) throw new Error('API Hatası');
        const data = await res.json();
        const content = data.choices?.[0]?.message?.content?.trim() || '';
        
        const match = content.match(/\[[\s\S]*\]/);
        if (match) {
            const parsed = JSON.parse(match[0]);
            if (Array.isArray(parsed) && parsed.length > 0) {
                console.log(`      ✅ 3 Adet Push Notifikasyonu üretildi`);
                return parsed;
            }
        }
        return [];
    } catch (err) {
        console.warn(`      ⚠️  Bildirim Üretme Hatası: ${err.message}`);
        return [];
    }
}


/**
 * AI başarısız olduğunda ürüne özel bir fallback açıklama oluştur
 */
function generateFallbackDescription(productTitle, discountPercent) {
    const templates = [
        `İnanılmaz bir fırsat! ${productTitle} şimdi stoklarda ve fiyatı gerçekten şaka gibi. Kalitesini anlatmaya gerek yok, kullananlar bilir. ${discountPercent > 0 ? `%${discountPercent} indirimle` : 'Bu fiyata'} kaçırılmayacak bir parça. Hemen incele ve tükenmeden kap! 🔥`,
        `Fırsat avcıları buraya! ${productTitle} için beklenen indirim nihayet geldi. Hem kullanışlı hem de çok kaliteli bu ürünü bu fiyata bulmak imkansız. Bizden söylemesi, bu ürün çok hızlı tükenir. Şimdiden iyi alışverişler! ✨`,
        `Koleksiyonun eksik parçası burada: ${productTitle}! Hem performansı hem de duruşuyla herkesin dilinde olan bu ürün şimdi kaçmaz bir fiyata düştü. Kendine bir iyilik yap ve bu fırsatı sakın atlama. Çabuk olan alır! 🚀`,
        `Biri indirim mi dedi? ${productTitle} fiyatı düştü ve biz şoktayız! Her eve lazım olan bu kaliteyi bu fiyata yakalamışken stoklamak lazım. Sepete ekle ve bu keyfin tadını çıkar, pişman olmayacaksın. ✅`,
        `İşte o efsane ürün: ${productTitle}! Uzun zamandır radarımızdaydı ve beklediğimiz o büyük fırsat geldi. Kaliteyi uygun fiyata almak isteyenler için tam bir altın değerinde. Stoklar sınırlı, elini çabuk tut! ⚡`
    ];

    const hash = productTitle.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
    return templates[hash % templates.length];
}

/**
 * Otomatik olarak Tüm Kullanıcılara FCM Push Bildirimi Gönderir
 */
async function sendFomoPushNotification(title, body, docId, imageUrl = '') {
    console.log(`\n      🚨 OTOMATİK PUSH BİLDİRİMİ GÖNDERİLİYOR! 🚨`);
    console.log(`        Başlık: ${title}`);
    console.log(`        Mesaj: ${body}`);
    console.log(`        URL: https://indiva.app/discount/${docId}`);
    
    try {
        const message = {
            notification: {
                title,
                body,
                ...(imageUrl ? { image: imageUrl } : {})
            },
            topic: 'all_users',
            data: {
                url: `https://indiva.app/discount/${docId}`
            },
            android: {
                priority: 'high',
                notification: {
                    channelId: 'indiva_notifications',
                    sound: 'default'
                }
            }
        };

        const response = await getMessaging().send(message);
        console.log(`      ✅ Push Başarıyla Gönderildi! FCM Sonucu: ${response}`);
    } catch (error) {
        console.error(`      ❌ Push Gönderilemedi: ${error.message}`);
    }
}

// ─── HTTP Utilities ──────────────────────────────────────────────────────────

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36';

/**
 * URL'ye GET isteği at, HTML döndür
 */
async function fetchHtml(url, timeoutMs = 15000, retries = 2) {
    for (let i = 0; i <= retries; i++) {
        try {
            const res = await fetch(url, {
                headers: {
                    'User-Agent': USER_AGENT,
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                    'Accept-Language': 'tr-TR,tr;q=0.9,en;q=0.7',
                    'Referer': 'https://onual.com/',
                    'Cache-Control': 'no-cache'
                },
                signal: AbortSignal.timeout(timeoutMs),
                redirect: 'follow',
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            return await res.text();
        } catch (err) {
            if (i === retries) throw err;
            console.log(`      ⚠️  İstek hatası, yeniden deneniyor (${i + 1}/${retries})...`);
            await sleep(2000);
        }
    }
}

/**
 * Redirect zincirini takip ederek gerçek mağaza URL'sini bul
 * Strateji 1: zxro.com/u/?url=ENCODED_URL → parametredeki URL'yi decode et (en hızlı yol)
 * Strateji 2: HTTP follow redirect → final URL mağaza ise kullan
 * Strateji 3: HTML içinde meta refresh veya JS redirect ara
 */
async function resolveStoreLink(intermediateUrl, timeoutMs = 12000) {
    try {
        // ── Strateji 1: zxro.com ve benzeri aracılardaki url= parametresini oku ──
        // Örnek: https://zxro.com/u/?redirect=1&url=https%3A%2F%2Fwww.amazon.com.tr%2F...
        const urlObj = new URL(intermediateUrl);
        const encodedTarget = urlObj.searchParams.get('url');
        if (encodedTarget) {
            const decoded = decodeURIComponent(encodedTarget);
            const isStore = STORE_MAP.some(s => decoded.includes(s.domain));
            if (isStore) {
                console.log(`   ✅ URL param'dan mağaza linki alındı: ${decoded.substring(0, 80)}...`);
                return decoded;
            }
        }

        // ── Strateji 2: HTTP redirect follow ────────────────────────────────────
        const response = await fetch(intermediateUrl, {
            method: 'GET',
            headers: {
                'User-Agent': USER_AGENT,
                'Accept': 'text/html,application/xhtml+xml,*/*',
            },
            signal: AbortSignal.timeout(timeoutMs),
            redirect: 'follow',
        });

        const finalUrl = response.url;
        const isStore = STORE_MAP.some(s => finalUrl.includes(s.domain));
        if (isStore) {
            console.log(`   ✅ HTTP redirect ile mağaza linki: ${finalUrl.substring(0, 80)}...`);
            return finalUrl;
        }

        // ── Strateji 3: HTML içindeki meta/JS redirect ───────────────────────────
        const html = await response.text();

        const metaRefresh = html.match(/url=["']?(https?:\/\/[^"'\s>]+)/i);
        if (metaRefresh) {
            const targetUrl = metaRefresh[1];
            if (STORE_MAP.some(s => targetUrl.includes(s.domain))) {
                console.log(`   ✅ Meta refresh ile mağaza linki: ${targetUrl.substring(0, 80)}...`);
                return targetUrl;
            }
        }

        const jsRedirect = html.match(/(?:window\.location(?:\.href)?\s*=\s*|location\.replace\()\s*["']?(https?:\/\/[^"'\s)]+)/i);
        if (jsRedirect) {
            const targetUrl = jsRedirect[1];
            if (STORE_MAP.some(s => targetUrl.includes(s.domain))) {
                console.log(`   ✅ JS redirect ile mağaza linki: ${targetUrl.substring(0, 80)}...`);
                return targetUrl;
            }
        }

        console.warn(`   ⚠️  Mağaza linki çözülemedi: ${intermediateUrl} → ${finalUrl}`);
        return null;
    } catch (err) {
        console.warn(`   ⚠️  Link resolve hatası: ${err.message}`);
        return null;
    }
}

/**
 * Gecikme fonksiyonu
 */
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// ─── Onual Parser ────────────────────────────────────────────────────────────

/**
 * onual.com/fiyat/ ana sayfasını parse et
 * Ürün adı, URL, yeni fiyat ver
 */
async function fetchProductList() {
    console.log('📡 onual.com/fiyat/ çekiliyor...');
    const html = await fetchHtml(ONUAL_URL);
    const $ = cheerio.load(html);
    const products = [];

    const allLinks = $('a[href*="/fiyat/"]');
    console.log(`🔍 Sayfada toplam ${allLinks.length} adet /fiyat/ linki bulundu.`);

    allLinks.each((_, el) => {
        const href = $(el).attr('href');
        if (!href) return;

        // Debug: Sadece ilk 5 linki logla (Pattern testi için)
        // if (products.length < 5) console.log(`   🔗 Link adayı: ${href}`);

        if (!href.match(/\/fiyat\/[^/]+-p-\d+\.html/i)) return;

        const fullUrl = href.startsWith('http') ? href : `https://onual.com${href}`;
        const priceMatch = href.match(/#fiyat=(\d+)/);
        const price = priceMatch ? parseInt(priceMatch[1]) : 0;
        const title = $(el).text().trim() || $(el).attr('title') || '';
        const cleanTitle = title.replace(/\s+/g, ' ').trim();

        if (!cleanTitle || cleanTitle.length < 3) return;

        const idMatch = fullUrl.match(/-p-(\d+)\.html/);
        const productId = idMatch ? idMatch[1] : null;
        if (!productId) return;

        products.push({
            id: productId,
            title: cleanTitle,
            url: fullUrl.split('#')[0],
            newPrice: price,
            rawUrl: href,
        });
    });

    const seen = new Set();
    const unique = products.filter(p => {
        if (seen.has(p.id)) return false;
        seen.add(p.id);
        return true;
    });

    console.log(`✅ ${unique.length} benzersiz ürün parse edildi.`);
    return unique;
}

/**
 * Onual ürün detay sayfasını parse et
 * Görsel, eski fiyat, mağaza linki al
 */
async function fetchProductDetails(product) {
    try {
        const html = await fetchHtml(product.url);
        const $ = cheerio.load(html);

        // 1. Mağaza Linkini Bul (id="buton" en güvenilir olandır)
        const button = $('#buton');
        let intermediateLink = button.attr('href') || product.url;

        // 2. Fiyatları Bul
        let newPrice = product.newPrice || 0;
        let oldPrice = 0;

        // JSON-LD'den fiyat çek
        $('script[type="application/ld+json"]').each((_, el) => {
            try {
                const data = JSON.parse($(el).html() || '{}');
                if (data['@type'] === 'Product' || data.offers) {
                    const offers = data.offers || data;
                    if (offers.price && !newPrice) {
                        newPrice = parseFloat(String(offers.price).replace(',', '.'));
                    }
                    if (offers.highPrice) {
                        oldPrice = parseFloat(String(offers.highPrice).replace(',', '.'));
                    }
                }
            } catch { }
        });

        // HTML'den eski fiyat çek (genellikle üstü çizili)
        if (!oldPrice) {
            const strikeText = $('del, s, .old-price, .price-old, .original-price, [class*="crossed"], [class*="line-through"]').first().text().replace(/[^\d.,]/g, '').trim();
            if (strikeText) {
                oldPrice = parseFloat(strikeText.replace(',', '.')) || 0;
            }
        }

        // HTML'den yeni fiyat çek
        if (!newPrice) {
            const priceText = $('.current-price, .new-price, .sale-price, [class*="current"], [itemprop="price"]').first().text().replace(/[^\d.,]/g, '').trim();
            if (priceText) {
                newPrice = parseFloat(priceText.replace(',', '.')) || 0;
            }
        }

        // ── Görsel ──────────────────────────────────────────────────────
        let imageUrl = '';

        // 1. OG image (en güvenilir)
        const ogImage = $('meta[property="og:image"]').attr('content');
        if (ogImage && ogImage.startsWith('http')) {
            imageUrl = ogImage;
        }

        // 2. Twitter card image
        if (!imageUrl) {
            const twitterImage = $('meta[name="twitter:image"]').attr('content');
            if (twitterImage && twitterImage.startsWith('http')) imageUrl = twitterImage;
        }

        // 3. Ana ürün görseli
        if (!imageUrl) {
            const mainImg = $('img[class*="product"], img[id*="product"], .product-image img, .main-image img').first().attr('src');
            if (mainImg && mainImg.startsWith('http')) imageUrl = mainImg;
        }

        // ── Ürün başlığı ─────────────────────────────────────────────────
        let title = product.title;
        const h1Title = $('h1').first().text().trim();
        if (h1Title && h1Title.length > title.length) {
            title = h1Title;
        }
        const titleFromOg = $('meta[property="og:title"]').attr('content') || '';
        if (titleFromOg && titleFromOg.length > title.length) {
            title = titleFromOg;
        }

        // ── Sonlanmış İndirim Kontrolü ──────────────────────────────────
        let isExpired = false;
        const buttonText = button.text().toLowerCase();
        const wholeText = $('body').text().toLowerCase();
        
        if (
            buttonText.includes('tükendi') ||
            buttonText.includes('sonlandı') ||
            buttonText.includes('bitti') ||
            wholeText.includes('bu fırsat sonlandı') ||
            wholeText.includes('stokta yok')
        ) {
            isExpired = true;
        }

        // ── Meta Açıklamasını Yedek Olarak Al ───────────────────────────
        const metaDesc = $('meta[name="description"]').attr('content') || '';


        // Eğer burada /git/ path'i varsa tam URL'ye çevir
        if (intermediateLink && !intermediateLink.startsWith('http')) {
            intermediateLink = `https://onual.com${intermediateLink}`;
        }

        return {
            imageUrl,
            newPrice,
            oldPrice,
            intermediateLink,
            title,
            metaDescription: metaDesc,
            isExpired
        };
    } catch (err) {
        console.warn(`   ⚠️  Detay sayfası parse hatası (${product.url}): ${err.message}`);
        // Detay hatası olsa bile ürünü temel verilerle kurtarmaya çalış (en azından linki varsa)
        const $ = cheerio.load(''); // Boş cheerio objesi oluştur
        const titleFromOg = $('meta[property="og:title"]').attr('content') || '';
        const metaDesc = $('meta[name="description"]').attr('content') || '';
        return {
            imageUrl: '',
            newPrice: product.newPrice || 0,
            oldPrice: 0,
            intermediateLink: product.url,
            title: titleFromOg || product.title,
            metaDescription: metaDesc,
            parsingError: err.message,
            isExpired: false
        };
    }
}

/**
 * Mağaza adını URL'den tespit et
 */
function detectStore(storeUrl) {
    if (!storeUrl) return { name: 'Online Mağaza', domain: '' };
    for (const store of STORE_MAP) {
        if (storeUrl.includes(store.domain)) return store;
    }
    return { name: 'Online Mağaza', domain: '' };
}

/**
 * Ürün kategorisini başlıktan tespit et
 */
function detectCategory(title) {
    const lower = title.toLowerCase();
    for (const { keywords, category } of CATEGORY_MAP) {
        if (keywords.some(kw => lower.includes(kw))) return category;
    }
    return 'Ev, Yaşam & Mutfak'; // default fallback if everything else fails
}

// ─── QUOTA OPTIMIZATION: Batch Check ─────────────────────────────────────────

/**
 * Birden fazla dokümanın var olup olmadığını tek sorguda (batch) kontrol et
 * Firebase Read kotasını korur (30 ürün = 1 read)
 */
async function filterExistingIds(db, docIds) {
    if (docIds.length === 0) return new Set();
    const existing = new Set();

    // Firestore 'in' operasyonu max 30 öğe alabilir
    for (let i = 0; i < docIds.length; i += 30) {
        const chunk = docIds.slice(i, i + 30);
        try {
            const snapshot = await db.collection('discounts')
                .where(FieldPath.documentId(), 'in', chunk)
                .select() // Sadece varlığına bakıyoruz, veriyi çekmiyoruz (ekonomi)
                .get();

            snapshot.docs.forEach(doc => existing.add(doc.id));
        } catch (e) {
            console.warn(`   ⚠️ Batch check hatası: ${e.message}`);
        }
    }
    return existing;
}

// ─── Main Pipeline ───────────────────────────────────────────────────────────

async function main() {
    console.log('\n🚀 INDIVA Auto-Onual Pipeline Başlatıldı');
    console.log('═══════════════════════════════════════════');
    console.log(`⏰ ${new Date().toLocaleString('tr-TR')}\n`);

    // Bağımlılıkları başlat
    console.log('🏗️  Servisler başlatılıyor...');
    const db = initFirebase();
    const aiKey = getGeminiKey();
    console.log('✅ Servisler hazır.');
    // 1. Ürün listesini çek (onual.com/fiyat/)
    const allProducts = await fetchProductList();

    // ── CACHE OPTIMIZATION ──────────────────────────────────────────────────
    // Daha önce işlediğimiz ID'leri yerel bir dosyada tutarak Firebase Read kotasını koruyoruz.
    const CACHE_DIR = path.join(ROOT_DIR, 'data');
    const CACHE_FILE = path.join(CACHE_DIR, 'processed_onual_ids.json');
    if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR);

    let idCache = { ids: {}, lastUpdate: new Date().toISOString() };
    if (fs.existsSync(CACHE_FILE)) {
        try {
            idCache = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
            // Cache 7 günden eskiyse temizle
            const cacheAgeDays = (new Date() - new Date(idCache.lastUpdate)) / (1000 * 60 * 60 * 24);
            if (cacheAgeDays > 7) idCache = { ids: {}, lastUpdate: new Date().toISOString() };
        } catch (e) { console.error("Cache okuma hatası:", e.message); }
    }

    // YENİ MANTIK: onual.com en yeni ürünleri sayfanın en başına koyar (ID'leri küçük olsa bile).
    // O yüzden ID'ye göre sıralamak yerine, sayfadaki orijinal sırayı koruyoruz (en baştakiler en yeni).
    // Firebase'de yayınlanma sırasını korumak için, alacağımız listeyi ters çeviriyoruz ki ilk önce en eski eklensin.
    const toProcess = allProducts.slice(0, MAX_NEW_PRODUCTS).reverse();

    console.log(`\n📊 Durum: ${allProducts.length} ürün bulundu, en üstteki ${toProcess.length} aday işlenecek\n`);

    if (toProcess.length === 0) {
        console.log('✅ İşlenecek yeni ürün yok. Pipeline tamamlandı.');
        return;
    }

    // ── 3. Her ürünü işle ─────────────────────────────────────────────────
    let successCount = 0;
    let failCount = 0;

    // QUOTA SAVING: Önce yerel cache ile ele
    const uncachedProducts = toProcess.filter(p => !idCache.ids[`onual_${p.id}`]);
    const skippedLocal = toProcess.length - uncachedProducts.length;
    if (skippedLocal > 0) console.log(`   ⏭️  ${skippedLocal} ürün yerel cache'den dolayı elendi.`);

    // QUOTA SAVING: Cache'de olmayıp Firebase'de olanları BATCH sorguyla tespit et
    const uncachedIds = uncachedProducts.map(p => `onual_${p.id}`);
    const existingIdsInDb = await filterExistingIds(db, uncachedIds);

    if (existingIdsInDb.size > 0) {
        console.log(`   ⏭️  ${existingIdsInDb.size} ürün Firebase'de zaten var, cache'e alınıyor.`);
        existingIdsInDb.forEach(id => idCache.ids[id] = true);
    }

    // Gerçekten işlenecekler: Ne cache'de ne de DB'de olanlar
    const finalToProcess = uncachedProducts.filter(p => !existingIdsInDb.has(`onual_${p.id}`));
    console.log(`   🆕 İşlenecek net yeni ürün sayısı: ${finalToProcess.length}\n`);

    for (let i = 0; i < finalToProcess.length; i++) {
        const product = finalToProcess[i];
        const docId = `onual_${product.id}`;

        try {
            console.log(`\n[${i + 1}/${finalToProcess.length}] 📦 ${product.title.substring(0, 60)}...`);

            const docRef = db.collection('discounts').doc(docId);

            await sleep(REQUEST_DELAY_MS);

            // Detay sayfasını çek
            const details = await fetchProductDetails(product);
            if (!details) {
                console.warn(`   ⚠️  Detay sayfası çekilemedi, atlanıyor`);
                failCount++;
                continue;
            }

            // Görsel yoksa atla
            if (!details.imageUrl) {
                console.warn(`   ⚠️  Görsel bulunamadı, atlanıyor`);
                failCount++;
                continue;
            }

            // Mağaza linkini çöz
            let storeLink = null;
            if (details.intermediateLink) {
                const isDirectStore = STORE_MAP.some(s => details.intermediateLink.includes(s.domain)) &&
                    !details.intermediateLink.includes('zxro.com') &&
                    !details.intermediateLink.includes('onu.al') &&
                    !details.intermediateLink.includes('knv.al');

                if (isDirectStore) {
                    storeLink = details.intermediateLink;
                } else {
                    console.log(`   🔄 Linki çözüyorum: ${details.intermediateLink.substring(0, 70)}...`);
                    storeLink = await resolveStoreLink(details.intermediateLink);
                }
            }

            if (!storeLink) {
                console.warn(`   ⚠️  Mağaza linki çözülemedi, atlanıyor`);
                failCount++;
                continue;
            }

            const newPrice = details.newPrice || product.newPrice || 0;
            const oldPrice = details.oldPrice || simulateOldPrice(newPrice);
            const store = detectStore(storeLink);

            console.log(`   💰 Fiyat: ${oldPrice} TL -> ${newPrice} TL | Mağaza: ${store.name}`);

            // ── AI Analiz (Açıklama ve Kategori) ─────────────────────────
            const aiData = await generateAISentiments(
                aiKey,
                details.title || product.title,
                details.newPrice || product.newPrice,
                details.oldPrice || 0,
                details.metaDescription || ''
            );

            // ── AI Push Notifications ─────────────────────────────────────
            const discountPercent = oldPrice > 0 ? Math.round(((oldPrice - newPrice) / oldPrice) * 100) : 0;
            let pushNotifications = [];
            
            if (!details.isExpired) {
                pushNotifications = await generatePushNotifications(
                    aiKey,
                    details.title || product.title,
                    discountPercent
                );
            } else {
                console.log(`   ⚠️ İndirim bittiği için Push Notification CANCEL edildi.`);
            }

            // Firebase'e kaydet
            const cleanedTitle = cleanProductTitle(details.title || product.title);
            const discountData = {
                title: cleanedTitle.substring(0, 200),
                description: aiData.description || `${cleanedTitle} - bu fiyata bu kalite kaçmaz! Hemen incele, bu fırsat çok sürmez.`,
                brand: store.name || 'Mağaza',
                category: aiData.category || 'Ev, Yaşam & Mutfak',
                link: storeLink,
                originalStoreLink: storeLink,
                oldPrice: oldPrice || 0,
                newPrice,
                imageUrl: details.imageUrl,
                deleteUrl: '',
                submittedBy: 'auto-onual-bot',
                isAd: false,
                affiliateLinkUpdated: false,
                originalSource: 'onual.com',
                storeName: store.name,
                status: details.isExpired ? 'İndirim Bitti' : 'aktif', // 'active' yerine 'aktif' kullanıyoruz (Panel uyumu için)
                telegramMessageId: `onual_${product.id}`,
                pushNotifications: pushNotifications, // Array of AI generated notifications
                lastPriceCheck: FieldValue.serverTimestamp(), // Fiyat takibi için başlangıç zamanı
                autoPublishedAt: FieldValue.serverTimestamp(),
                createdAt: FieldValue.serverTimestamp(),
                aiFomoScore: aiData.aiFomoScore || 5, // AI Fırsat Puanını veritabanına kaydet
            };

            await docRef.set(discountData);
            console.log(`   🔥 Firebase'e kaydedildi ✅ (ID: ${docId}) - AI FOMO Puanı: ${discountData.aiFomoScore}`);

            // Eğer fırsat puanı >= 9 ise anında otomatik push bildirimi at! (VE SÜRESİ DOLMADIYSA)
            if (!details.isExpired && discountData.aiFomoScore >= 9 && pushNotifications.length >= 3) {
                const urgentBody = pushNotifications[2]; // Index 2: Aciliyet/FOMO bildiren metin
                const title = "🚨 İNDİVA FIRSAT ALARMI 🚨";
                await sendFomoPushNotification(title, urgentBody, docId, details.imageUrl);
            }

            // Cache'e ekle
            idCache.ids[docId] = true;
            successCount++;

        } catch (itemErr) {
            console.error(`   ❌ Ürün işleme hatası: ${itemErr.message}`);
            failCount++;
        }
    }

    // Cache'i kaydet
    try {
        idCache.lastUpdate = new Date().toISOString();
        fs.writeFileSync(CACHE_FILE, JSON.stringify(idCache, null, 2));
        console.log(`💾 ID Cache güncellendi (${Object.keys(idCache.ids).length} ürün)`);
    } catch (e) { console.error("Cache kaydetme hatası:", e.message); }

    // ── 4. Özet ───────────────────────────────────────────────────────────
    console.log('\n═══════════════════════════════════════════');
    console.log('📊 PIPELINE TAMAMLANDI');
    console.log(`   ✅ Başarılı: ${successCount}`);
    console.log(`   ❌ Başarısız: ${failCount}`);
    console.log(`   ⏰ ${new Date().toLocaleString('tr-TR')}`);
    console.log('═══════════════════════════════════════════\n');
}

main().catch(err => {
    console.error('\n💥 KRİTİK HATA:', err.message);
    process.exit(1);
});
