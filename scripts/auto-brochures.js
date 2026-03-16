/**
 * auto-brochures.js — INDIVA Aktüel Afiş Otomasyonu
 * 
 * aktuelbul.com üzerinden BİM, A101 ve ŞOK aktüel afişlerini çeker.
 * Gemini 3 Flash ile analiz ederek kategori, başlık ve geçerlilik tarihini belirler.
 * Firestore'daki ilgili market koleksiyonlarına kaydeder.
 */

import * as cheerio from 'cheerio';
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import * as fs from 'fs';
import * as path from 'path';

// ─── .env Yükle ─────────────────────────────────────────────────────────────
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

const AI_API_KEY = process.env.GEMINI_API_KEY || process.env.OPENROUTER_API_KEY;
const MODEL = 'google/gemini-3-flash-preview';

// ─── Firebase ────────────────────────────────────────────────────────────────
function initFirebase() {
    if (getApps().length > 0) return getFirestore();
    let serviceAccount;
    const envJson = process.env.FIREBASE_SERVICE_ACCOUNT;
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
    initializeApp({ credential: cert(serviceAccount) });
    return getFirestore();
}

// ─── HTTP Utilities ──────────────────────────────────────────────────────────
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36';

async function fetchHtml(url, timeoutMs = 15000) {
    try {
        const res = await fetch(url, {
            headers: { 'User-Agent': USER_AGENT },
            signal: AbortSignal.timeout(timeoutMs)
        });
        if (!res.ok) return null;
        return await res.text();
    } catch (e) {
        console.error(`   ⚠️ Fetch Hatası (${url}): ${e.message}`);
        return null;
    }
}

// ─── AI Analiz ──────────────────────────────────────────────────────────────
async function analyzeBrochureWithAI(pageTitle, pageContent) {
    if (!AI_API_KEY) return null;

    const systemInstruction = `Sen bir aktüel ürünler uzmanısın. Sana sunulan bir web sayfasının başlığını ve içeriğini analiz ederek, bu sayfanın hangi markaya (BİM, A101, ŞOK) ait olduğunu, katalog başlığını ve geçerlilik tarihini belirleyeceksin.
    
GÜNCEL TARİH: ${new Date().toLocaleDateString('tr-TR')}

KURALLAR:
1. Sadece GÜNCEL veya GELECEK tarihli katalogları belirle.
2. "validityDate" formatı gün/ay/yıl bazlı anlaşılır olmalı (Örn: "27 Şubat - 6 Mart 2026").
3. Eğer katalog 2 haftadan daha eskiyse (geçmişte kalmışsa), bunu analiz sonucunda belirtme veya storeName'i null döndür.

JSON formatında yanıt ver:
{
  "storeName": "bim" | "a101" | "sok" | null,
  "title": "Katalog Başlığı (Örn: 23 Şubat Cuma)",
  "validityDate": "Geçerlilik Tarihi (Örn: 27 Şubat - 6 Mart 2026)",
  "startDate": "YYYY-MM-DD",
  "isExpired": boolean
}`;

    const prompt = `Sayfa Başlığı: ${pageTitle}\n\nSayfa İçeriği Önizleme: ${pageContent.substring(0, 1500)}`;

    try {
        const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${AI_API_KEY}`,
                'Content-Type': 'application/json',
                'HTTP-Referer': 'https://indiva.app',
                'X-Title': 'Indiva Admin Panel'
            },
            body: JSON.stringify({
                model: MODEL,
                messages: [
                    { role: 'system', content: systemInstruction },
                    { role: 'user', content: prompt }
                ],
                response_format: { type: 'json_object' }
            })
        });

        const data = await response.json();
        const content = data.choices[0].message.content;
        return JSON.parse(content);
    } catch (e) {
        console.error('   ⚠️ AI Analiz Hatası:', e.message);
        return null;
    }
}

// ─── Main Logic ──────────────────────────────────────────────────────────────

async function autoCollectBrochures() {
    console.log(`\n🚀 Aktüel Afiş Otomasyonu Başlatıldı: ${new Date().toLocaleString('tr-TR')}`);
    const db = initFirebase();
    const BASE_URL = 'https://www.aktuelbul.com/';

    const html = await fetchHtml(BASE_URL);
    if (!html) {
        console.error('❌ Ana sayfa yüklenemedi.');
        return;
    }

    const $ = cheerio.load(html);
    const catalogLinks = [];
    const currentYear = new Date().getFullYear();
    const currentMonth = new Date().getMonth() + 1; // 1-12

    // Ana sayfadaki son katalog linklerini topla (BİM, A101, ŞOK olanlar)
    $('a').each((_, el) => {
        const link = $(el).attr('href');
        const text = $(el).text().toUpperCase();

        if (link && (text.includes('BİM') || text.includes('A101') || text.includes('ŞOK')) && text.includes('KATALOĞU')) {
            // Basit Tarih Filtresi: Başlıkta geçen ayı kontrol et (Sadece bu ay veya geçen ayın son 2 haftası gibi)
            // Daha garanti olması için link listesini AI analizinden önce çok kısıtlamıyoruz ama aşırı eski yılları eliyoruz
            if (text.includes(String(currentYear)) || text.includes(String(currentYear - 1))) {
                if (!catalogLinks.includes(link)) {
                    catalogLinks.push(link);
                }
            }
        }
    });

    console.log(`📊 Toplam ${catalogLinks.length} potansiyel katalog linki bulundu.`);

    for (const link of catalogLinks.slice(0, 8)) { // Biraz daha geniş bir yelpazeye bakıp AI ile eleyeceğiz
        console.log(`\n📄 İnceleniyor: ${link}`);
        const pageHtml = await fetchHtml(link);
        if (!pageHtml) continue;

        const $p = cheerio.load(pageHtml);
        const title = $p('h1').first().text().trim();
        const contentText = $p('article').text().trim() || $p('body').text().trim();

        // 1. AI ile Analiz Et
        const aiInfo = await analyzeBrochureWithAI(title, contentText);

        // KRİTİK: Tarih Kontrolü ve Geçersizlik Filtresi
        if (!aiInfo || !aiInfo.storeName || aiInfo.isExpired) {
            console.log('   ⏭️ Atlanıyor: AI bu kataloğun eski veya geçersiz olduğuna karar verdi.');
            continue;
        }

        console.log(`   🔸 Market: ${aiInfo.storeName.toUpperCase()} | Başlık: ${aiInfo.title}`);

        // 2. Görselleri Çek (Sayfadaki ana katalog görsellerini bul)
        const images = [];
        $p('img').each((_, img) => {
            const src = $(img).attr('src');
            // Afiş görselleri genellikle daha büyük ve katalog kelimesini barındıran isimlere sahiptir
            if (src && (src.includes('bim') || src.includes('a101') || src.includes('sok') || src.includes('aktuel')) && (src.endsWith('.jpg') || src.endsWith('.webp') || src.endsWith('.png'))) {
                const fullSrc = src.startsWith('http') ? src : new URL(src, BASE_URL).href;
                if (!images.includes(fullSrc) && !fullSrc.includes('logo') && !fullSrc.includes('banner')) {
                    images.push(fullSrc);
                }
            }
        });

        if (images.length === 0) {
            console.log('   ⚠️ Görsel bulunamadı, atlanıyor.');
            continue;
        }

        console.log(`   📸 ${images.length} adet görsel bulundu.`);

        // 3. Firestore'a Kaydet (Mükerrer kontrolü ile)
        const storeKey = aiInfo.storeName.toLowerCase();
        const collectionPath = `circulars/${storeKey}/brochures`;

        for (const imageUrl of images) {
            // Görsel URL'sine göre mükerrer kontrolü
            const existing = await db.collection(collectionPath).where('imageUrl', '==', imageUrl).limit(1).get();

            if (existing.empty) {
                const brochureData = {
                    storeName: storeKey,
                    marketName: storeKey,
                    title: aiInfo.title,
                    validityDate: aiInfo.validityDate,
                    publishDate: aiInfo.startDate ? new Date(aiInfo.startDate) : FieldValue.serverTimestamp(),
                    imageUrl: imageUrl,
                    deleteUrl: '',
                    createdAt: FieldValue.serverTimestamp()
                };

                await db.collection(collectionPath).add(brochureData);
                console.log(`   ✅ Yeni afiş eklendi: ${aiInfo.title} (${imageUrl.substring(imageUrl.lastIndexOf('/') + 1)})`);
            } else {
                console.log(`   ⏭️ Afiş zaten mevcut: ${imageUrl.substring(imageUrl.lastIndexOf('/') + 1)}`);
            }
        }

        // Sunucu yormamak için kısa bekleme
        await new Promise(r => setTimeout(r, 1000));
    }

    console.log('\n✨ İşlem tamamlandı.');
}

autoCollectBrochures().catch(err => {
    console.error(`💥 KRİTİK HATA: ${err.message}`);
    process.exit(1);
});
