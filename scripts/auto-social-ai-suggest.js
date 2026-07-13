/**
 * auto-social-ai-suggest.js — Zamanlı sosyal medya AI önerisi
 *
 * Günde 3 kez (13:00/17:00/21:00 TR'den 3dk önce) son 50 ilanı tarar, AI ile
 * (OpenRouter, deepseek/deepseek-v4-flash) 3 FARKLI ürün + içerik önerisi
 * üretir, Firestore'a yazar ve admin'e ('panel_admin_alerts' topic) push
 * bildirimi gönderir. Panel açıldığında SocialContentManager.tsx bu hazır
 * öneriyi okuyup otomatik gösterir — admin AI çağrısını beklemez.
 *
 * NOT: Seçim/başlık mantığı vercel-proxy/api/social-content.ts ile aynıdır
 * (admin panelindeki "AI ile Öner" butonuyla üretilen içerikle tutarlı olsun
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
    const snap = await db.collection('discounts').orderBy('createdAt', 'desc').limit(50).get();
    return snap.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .filter(d => !d.isAd);
}

async function suggestThreeProducts(discounts, db) {
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

    const prompt = `Sen İNDİVA uygulamasının sosyal medya içerik editörüsün. Aşağıda son 50 indirim ilanı JSON olarak veriliyor.

GÖREV — 3 FARKLI EN İYİ ÜRÜNÜ SEÇ:
Sosyal medyada (Instagram story/post) paylaşılmaya değer, BİRBİRİNDEN FARKLI 3 ürün seç
(aynı ürünü iki kez seçme, mümkünse farklı kategorilerden çeşitlilik olsun). Her biri için şu 3
kriteri birlikte değerlendir:
- Satış/popülerlik potansiyeli yüksek olmalı (reviewCount, marka tanınırlığı, kategori popülerliği ipucu olarak kullanılabilir)
- İndirim oranı (discountPercent) yüksek olmalı
- Geniş kitleye hitap etmeli (çok nadir/niş bir ürün değil, mainstream bir kategori/marka)

Seçtiğin HER ürün için AYRI bir sosyal medya içeriği yaz:
- "title": max 60 karakter, ÜRÜNÜ TANIMLAYAN dikkat çekici bir başlık (marka/ürün adını içersin).
  SADECE indirim yüzdesini tekrar eden bir başlık YAZMA (örn. "%37 İndirim!" YANLIŞ) — indirim
  yüzdesi zaten görselde ayrı bir rozette gösteriliyor, başlık ürünün ne olduğunu anlatmalı.
- "caption": Instagram story/post metni (2-4 cümle + hashtag'ler), emoji kullanılabilir, sonunda
  İNDİVA'yı indirmeye teşvik eden bir cümle olsun

İLANLAR (her ilanın başındaki "index" numarasıyla referans ver, "id" alanını YAZMA/KOPYALAMA):
${JSON.stringify(compact)}

SADECE aşağıdaki JSON formatında cevap ver, başka hiçbir şey yazma. Her "index" MUTLAKA
yukarıdaki listeden seçtiğin ilanın "index" alanındaki TAM SAYI olmalı (1 ile ${compact.length} arası),
ve üç index birbirinden FARKLI olmalı:
{
  "picks": [
    {"index": 1, "reasoning": "neden bu ürünü seçtiğin, kısa Türkçe (max 100 karakter)", "title": "...", "caption": "..."},
    {"index": 2, "reasoning": "...", "title": "...", "caption": "..."},
    {"index": 3, "reasoning": "...", "title": "...", "caption": "..."}
  ]
}`;

    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
            'Content-Type': 'application/json',
            'HTTP-Referer': 'https://indiva-proxy.vercel.app',
            'X-Title': 'INDIVA Panel Social Content (Scheduled)',
        },
        body: JSON.stringify({
            model: MODEL,
            messages: [{ role: 'user', content: prompt }],
            temperature: 0.7,
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
    if (!Array.isArray(result.picks) || result.picks.length === 0) {
        throw new Error('AI eksik veri döndürdü');
    }

    const seen = new Set();
    const picks = result.picks
        .map(p => {
            const idx = Number(p.index);
            if (!Number.isInteger(idx) || seen.has(idx)) return null;
            const chosen = compact[idx - 1];
            if (!chosen) return null;
            seen.add(idx);
            const fullProduct = discounts[idx - 1];
            return {
                productId: chosen.id,
                reasoning: String(p.reasoning || '').slice(0, 200),
                title: String(p.title || '').slice(0, 100),
                caption: String(p.caption || ''),
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
        .slice(0, 3);

    if (picks.length === 0) throw new Error('AI geçerli ürün seçemedi');
    return picks;
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

        const picks = await suggestThreeProducts(discounts, db);
        console.log(`✅ ${picks.length} ürün önerisi üretildi:`);
        picks.forEach(p => console.log(`   - ${p.title}`));

        await db.collection('social_content_ai_suggestions').doc('latest').set({
            picks,
            createdAt: FieldValue.serverTimestamp(),
            opened: false,
        });

        await sendAdminNotification(
            '🤖 3 yeni sosyal medya önerisi hazır!',
            picks.map(p => p.title).join(' • '),
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
