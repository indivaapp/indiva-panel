/**
 * auto-social-ai-suggest.js — Zamanlı sosyal medya AI önerisi
 *
 * Günde 3 kez (13:00/17:00/21:00 TR'den 3dk önce) son 100 ilanı tarar, AI ile
 * (OpenRouter, deepseek/deepseek-v4-flash) kalite/satış potansiyeli/ilgi
 * çekicilik kriterlerine göre EN İYİ 10 ürünü PUANLAR ve Firestore'a yazar,
 * admin'e ('panel_admin_alerts' topic) push bildirimi gönderir. Bu aşamada
 * HİÇBİR ürün için başlık/caption ÜRETİLMEZ — admin panelde bu 10 adaydan
 * birini seçtiğinde SADECE o ürün için içerik üretilir (10'unun tamamı için
 * gereksiz AI çağrısı yapılmaz, admin beğenmezse "Yeniden Üret" ile tekrar
 * dener). Panel açıldığında SocialContentManager.tsx bu hazır aday listesini
 * okuyup otomatik gösterir.
 *
 * NOT: Puanlama mantığı vercel-proxy/api/social-candidates.ts ile aynıdır
 * (admin panelindeki "AI ile Öner" butonuyla üretilen listeyle tutarlı olsun
 * diye). Orada değişiklik yaparsanız burada da güncelleyin.
 *
 * Çalıştırma: node scripts/auto-social-ai-suggest.js
 */

import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import * as fs from 'fs';
import * as path from 'path';
import { sendAdminNotification, sendAdminAlert } from './alertService.js';
import { trackOpenRouterUsage } from './aiUsageTracker.js';

// ─── .env Yükle (lokal geliştirme) ─────────────────────────────────────────
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

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || '';
const MODEL = 'deepseek/deepseek-v4-flash';

function initFirebase() {
    if (getApps().length > 0) return getFirestore();
    const envJson = process.env.FIREBASE_SERVICE_ACCOUNT;
    let serviceAccount;
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
    if (serviceAccount?.private_key) {
        serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, '\n').replace(/\n\n/g, '\n');
    }
    initializeApp({ credential: cert(serviceAccount) });
    return getFirestore();
}

async function fetchRecentDiscounts(db) {
    const snap = await db.collection('discounts').orderBy('createdAt', 'desc').limit(100).get();
    return snap.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .filter(d => !d.isAd);
}

async function suggestTenCandidates(discounts, db) {
    const compact = discounts.map((d, i) => ({
        index: i + 1,
        id: d.id,
        title: d.title,
        brand: d.brand,
        category: d.category,
        oldPrice: d.oldPrice || 0,
        newPrice: d.newPrice || 0,
        discountPercent: d.oldPrice > d.newPrice && d.oldPrice > 0
            ? Math.round(((d.oldPrice - d.newPrice) / d.oldPrice) * 100) : 0,
        reviewCount: d.reviewCount || '',
    }));

    const prompt = `Sen İNDİVA uygulamasının sosyal medya içerik editörüsün. Aşağıda son ${compact.length} indirim ilanı JSON olarak veriliyor.

GÖREV — EN İYİ 10 ADAYI PUANLA VE SIRALA:
Her ürünü sosyal medyada (Instagram story/post) paylaşılmaya UYGUNLUK açısından 1-10 arası puanla.
Puanlarken şu kriterleri birlikte değerlendir:
- Satış/popülerlik potansiyeli (reviewCount, marka tanınırlığı, kategori popülerliği ipucu olarak kullanılabilir)
- İndirim oranı (discountPercent) — yüksek indirim daha çekici
- İlgi çekicilik — geniş kitleye hitap eden, mainstream bir ürün/kategori/marka (çok nadir/niş bir ürün düşük puan almalı)

En yüksek puanlı 10 FARKLI ürünü seç (mümkünse farklı kategorilerden çeşitlilik olsun, aynı ürünü iki kez seçme).
Bu aşamada başlık veya sosyal medya metni YAZMA — sadece puanla ve kısa bir gerekçe ver.

İLANLAR (her ilanın başındaki "index" numarasıyla referans ver, "id" alanını YAZMA/KOPYALAMA):
${JSON.stringify(compact)}

SADECE aşağıdaki JSON formatında cevap ver, başka hiçbir şey yazma. Her "index" MUTLAKA
yukarıdaki listeden seçtiğin ilanın "index" alanındaki TAM SAYI olmalı (1 ile ${compact.length} arası),
"score" 1-10 arası tam sayı olmalı, "candidates" en yüksek puandan en düşüğe sıralı olmalı ve
en fazla 10 eleman içermeli, tüm index'ler birbirinden FARKLI olmalı:
{
  "candidates": [
    {"index": 1, "score": 9, "reasoning": "neden bu puanı verdiğin, kısa Türkçe (max 100 karakter)"},
    {"index": 2, "score": 8, "reasoning": "..."}
  ]
}`;

    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
            'Content-Type': 'application/json',
            'HTTP-Referer': 'https://indiva-proxy.vercel.app',
            'X-Title': 'INDIVA Panel Social Candidates (Scheduled)',
        },
        body: JSON.stringify({
            model: MODEL,
            messages: [{ role: 'user', content: prompt }],
            temperature: 0.4,
            usage: { include: true },
        }),
        signal: AbortSignal.timeout(50000),
    });

    if (!response.ok) {
        const errText = await response.text();
        throw new Error(`OpenRouter ${response.status}: ${errText.substring(0, 200)}`);
    }

    const data = await response.json();
    await trackOpenRouterUsage(db, data, 'auto-social-ai-suggest');
    const text = data?.choices?.[0]?.message?.content || '';
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('AI JSON döndürmedi');

    const result = JSON.parse(jsonMatch[0]);
    if (!Array.isArray(result.candidates) || result.candidates.length === 0) {
        throw new Error('AI eksik veri döndürdü');
    }

    const seen = new Set();
    const candidates = result.candidates
        .map(c => {
            const idx = Number(c.index);
            if (!Number.isInteger(idx) || seen.has(idx)) return null;
            const chosen = compact[idx - 1];
            if (!chosen) return null;
            seen.add(idx);
            const fullProduct = discounts[idx - 1];
            return {
                productId: chosen.id,
                score: Math.min(10, Math.max(1, Math.round(Number(c.score)) || 5)),
                reasoning: String(c.reasoning || '').slice(0, 200),
                product: {
                    id: fullProduct.id,
                    title: fullProduct.title || '',
                    imageUrl: fullProduct.imageUrl || '',
                    link: fullProduct.link || '',
                    category: fullProduct.category || '',
                    brand: fullProduct.brand || '',
                    oldPrice: fullProduct.oldPrice || 0,
                    newPrice: fullProduct.newPrice || 0,
                },
            };
        })
        .filter(Boolean)
        .sort((a, b) => b.score - a.score)
        .slice(0, 10);

    if (candidates.length === 0) throw new Error('AI geçerli aday seçemedi');
    return candidates;
}

async function main() {
    console.log(`\n🤖 Zamanlı Sosyal Medya AI Önerisi: ${new Date().toLocaleString('tr-TR')}`);
    const db = initFirebase();

    if (!OPENROUTER_API_KEY) {
        console.error('❌ OPENROUTER_API_KEY tanımlı değil.');
        process.exit(1);
    }

    try {
        const discounts = await fetchRecentDiscounts(db);
        if (discounts.length === 0) {
            console.log('⏭️  Analiz edilecek ilan yok, atlanıyor.');
            return;
        }

        const candidates = await suggestTenCandidates(discounts, db);
        console.log(`✅ ${candidates.length} aday puanlandı:`);
        candidates.forEach(c => console.log(`   - [${c.score}/10] ${c.product.title}`));

        await db.collection('social_content_ai_suggestions').doc('latest').set({
            candidates,
            createdAt: FieldValue.serverTimestamp(),
            opened: false,
        });

        await sendAdminNotification(
            '🤖 10 yeni sosyal medya önerisi hazır!',
            'Beğendiğiniz ürünü seçin, içeriği o an üretilsin.',
            { type: 'SOCIAL_AI_READY' }
        );

        console.log('✅ Firestore\'a yazıldı ve admin bildirimi gönderildi.');
    } catch (err) {
        console.error(`💥 HATA: ${err.message}`);
        await sendAdminAlert('Sosyal Medya AI Önerisi Hatası', err.message);
        process.exit(1);
    }
}

main().then(() => process.exit(0));
