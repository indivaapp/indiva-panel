/**
 * sanitize-titles.js — İNDİVA Veri Temizleme Aracı
 * 
 * Mevcut aktif ilanlardaki "Son 6 Ayın En Düşük Fiyatı", "Sepette İndirim" gibi
 * pazarlama sloganlarını Gemini AI kullanarak temizler.
 */

import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { GoogleGenAI } from '@google/genai';
import * as fs from 'fs';
import * as path from 'path';

const ROOT_DIR = process.cwd();

// ─── .env Yükle ─────────────────────────────────────────────────────────────
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
        // Placeholder kontrolü: Eğer değer YOUR_... veya indiva-panel-... içeriyorsa atla
        if (val.includes('YOUR_') || val.includes('indiva-panel-...')) {
            continue;
        }
        if (!process.env[key]) process.env[key] = val;
    }
}

// ─── Firebase ────────────────────────────────────────────────────────────────
function initFirebase() {
    if (getApps().length > 0) return getFirestore();

    let serviceAccount;
    const envJson = process.env.FIREBASE_SERVICE_ACCOUNT;

    if (envJson && !envJson.includes('indiva-panel-...')) {
        serviceAccount = JSON.parse(envJson);
    } else {
        const localPath = path.join(ROOT_DIR, 'firebase-service-account.json');
        if (fs.existsSync(localPath)) {
            serviceAccount = JSON.parse(fs.readFileSync(localPath, 'utf8'));
        } else {
            throw new Error('Firebase service account bulunamadı.');
        }
    }

    // PEM formatı için private_key'deki kaçış karakterlerini (\n) GERÇEK satır başlarına çevir
    if (serviceAccount && serviceAccount.private_key) {
        // Hem \n hem de \\n durumlarını kapsayacak şekilde temizlik yap
        serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, '\n').replace(/\n\n/g, '\n');
    }

    initializeApp({ credential: cert(serviceAccount) });
    return getFirestore();
}

async function startCleanup() {
    const db = initFirebase();
    const apiKey = process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_API_KEY;
    
    if (!apiKey) {
        console.error("❌ GEMINI_API_KEY bulunamadı.");
        return;
    }

    const genAI = new GoogleGenAI({ apiKey });
    const MODEL = 'gemini-2.5-flash-lite';

    console.log("🔍 Aktif ilanlar taranıyor...");
    const snapshot = await db.collection('discounts')
        .where('status', '==', 'aktif')
        .get();

    console.log(`📊 ${snapshot.size} aktif ilan bulundu. İnceleme başlıyor...\n`);

    let fixCount = 0;

    for (const doc of snapshot.docs) {
        const data = doc.data();
        const title = data.title || "";
        
        // Şüpheli kelimeler veya çok kısa başlıklar
        const isBad = 
            title.toLowerCase().includes('son 6 ayin') || 
            title.toLowerCase().includes('sepette') || 
            title.toLowerCase().includes('fiyatı') ||
            title.toLowerCase().includes('indirim') ||
            title.length < 15;

        if (isBad) {
            console.log(`   🛠️  Düzeltiliyor: "${title.substring(0, 50)}..."`);
            
            try {
                const prompt = `GÖREV: Aşağıdaki ürün başlığındaki pazarlama sloganlarını ("Son 6 Ayın En Düşük Fiyatı", "Sepette %20 İndirim" vb.) TEMİZLE. 
                SADECE gerçek ÜRÜN ADI ve MODELİNİ (varsa Marka ile) döndür. 
                
                ÜRÜN BAŞLIĞI: "${title}"
                AÇIKLAMA: "${data.description || ''}"
                
                CEVAP SADECE TEMİZ BAŞLIK OLSUN (YALIN METİN):`;

                const response = await genAI.models.generateContent({
                    model: MODEL,
                    contents: [{ role: 'user', parts: [{ text: prompt }] }],
                    config: { temperature: 0.1 }
                });

                const cleanTitle = response.text.trim().replace(/^"|"$/g, '');
                
                if (cleanTitle && cleanTitle !== title) {
                    await doc.ref.update({ title: cleanTitle });
                    console.log(`      ✅ YENİ BAŞLIK: ${cleanTitle}`);
                    fixCount++;
                } else {
                    console.log(`      ⏭️  Değişiklik yapılmadı.`);
                }
            } catch (err) {
                console.warn(`      ❌ HATA: ${err.message}`);
            }
            
            // AI kota aşımı olmasın diye minik bir bekleme
            await new Promise(r => setTimeout(r, 1000));
        }
    }

    console.log(`\n🎉 TEMİZLİK TAMAMLANDI: ${fixCount} ilan düzeltildi.`);
}

startCleanup();
