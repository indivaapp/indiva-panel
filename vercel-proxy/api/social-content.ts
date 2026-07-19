import type { VercelRequest, VercelResponse } from '@vercel/node';
import { trackOpenRouterUsage } from './_aiUsageTracker';

/**
 * Social Content — İKİ MOD tek dosyada (Vercel Hobby planının 12 serverless
 * fonksiyon sınırı yüzünden ayrı bir social-candidates.ts dosyası eklenemedi —
 * fonksiyon sayısı aşıldığında "No more than 12 Serverless Functions" hatası
 * canlı testte gözlemlendi, bu yüzden birleştirildi):
 *
 * 1) ADAY PUANLAMA — POST { discounts: [...] } (son ~60 ilan)
 *    → { success, candidates: [{ productId, score, reasoning }, ...] } (en fazla 10)
 *    Henüz başlık/caption ÜRETİLMEZ, sadece puanlanır.
 *
 * 2) TEK ÜRÜN İÇERİK ÜRETİMİ — POST { discount: {...} } (adaylardan seçilen TEK ürün)
 *    → { success, title, caption }
 *    Admin bir aday seçtiğinde veya "Yeniden Üret" dediğinde çağrılır.
 *
 * Body'de "discounts" (dizi) mi "discount" (tekil) mi geldiğine göre mod seçilir.
 */

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || '';
const MODEL = 'deepseek/deepseek-v4-flash';

function corsHeaders(res: VercelResponse) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

async function handleCandidates(req: VercelRequest, res: VercelResponse) {
    const { discounts } = req.body || {};
    if (!Array.isArray(discounts) || discounts.length === 0) {
        return res.status(400).json({ success: false, error: 'discounts listesi boş olamaz' });
    }

    // NOT: 100 ürünle canlı testte gerçek (uzun) başlıklarla bazen Vercel
    // Hobby planının 60sn sunucusuz fonksiyon sınırını aşıp zaman aşımına
    // yol açtı — 60'a düşürüldü, hâlâ eski 3'lü sistemin (50) üzerinde.
    const compact = discounts.slice(0, 60).map((d: any, i: number) => ({
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
            'X-Title': 'INDIVA Panel Social Candidates',
        },
        body: JSON.stringify({
            model: MODEL,
            messages: [{ role: 'user', content: prompt }],
            temperature: 0.4,
            usage: { include: true },
        }),
        // Vercel Hobby planının 60sn sunucusuz fonksiyon sınırına karşı pay
        // bırakmak için 50sn'de kes — bu sayede fonksiyon zorla kesilmeden
        // önce kontrollü bir "Zaman aşımı" hatası dönebiliyoruz.
        signal: AbortSignal.timeout(50000),
    });

    if (!response.ok) {
        const errText = await response.text();
        return res.status(502).json({ success: false, error: `OpenRouter ${response.status}: ${errText.substring(0, 200)}` });
    }

    const data = await response.json();
    await trackOpenRouterUsage(data, 'social-candidates');
    const text = data?.choices?.[0]?.message?.content || '';
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
        return res.status(502).json({ success: false, error: 'AI JSON döndürmedi' });
    }

    const result = JSON.parse(jsonMatch[0]);
    if (!Array.isArray(result.candidates) || result.candidates.length === 0) {
        return res.status(502).json({ success: false, error: 'AI eksik veri döndürdü' });
    }

    const seenIndices = new Set<number>();
    const candidates = result.candidates
        .map((c: any) => {
            const idx = Number(c.index);
            if (!Number.isInteger(idx) || seenIndices.has(idx)) return null;
            const chosen = compact[idx - 1];
            if (!chosen) return null;
            seenIndices.add(idx);
            return {
                productId: chosen.id,
                score: Math.min(10, Math.max(1, Math.round(Number(c.score)) || 5)),
                reasoning: String(c.reasoning || '').slice(0, 200),
            };
        })
        .filter(Boolean)
        .sort((a: any, b: any) => b.score - a.score)
        .slice(0, 10);

    if (candidates.length === 0) {
        return res.status(502).json({ success: false, error: 'AI geçerli aday seçemedi' });
    }

    return res.status(200).json({ success: true, candidates });
}

async function handleSingleContent(req: VercelRequest, res: VercelResponse) {
    const { discount } = req.body || {};
    if (!discount || !discount.title) {
        return res.status(400).json({ success: false, error: 'discount alanı (title dahil) zorunlu' });
    }

    const discountPercent = discount.oldPrice > discount.newPrice && discount.oldPrice > 0
        ? Math.round(((discount.oldPrice - discount.newPrice) / discount.oldPrice) * 100)
        : 0;

    const prompt = `Sen İNDİVA uygulamasının sosyal medya içerik editörüsün. Aşağıdaki TEK ürün için
Instagram story/post içeriği yaz.

ÜRÜN:
${JSON.stringify({
        title: discount.title,
        brand: discount.brand || '',
        category: discount.category || '',
        oldPrice: discount.oldPrice || 0,
        newPrice: discount.newPrice || 0,
        discountPercent,
        reviewCount: discount.reviewCount || '',
    })}

ÜRETMEN GEREKENLER:
- "title": max 60 karakter, ÜRÜNÜ TANIMLAYAN dikkat çekici bir başlık (marka/ürün adını içersin).
  SADECE indirim yüzdesini tekrar eden bir başlık YAZMA (örn. "%37 İndirim!" YANLIŞ) — indirim
  yüzdesi zaten görselde ayrı bir rozette gösteriliyor, başlık ürünün ne olduğunu anlatmalı.
  Örnek doğru başlık: "Samsung Galaxy Buds Yarı Fiyatına!"
- "caption": Instagram story/post metni (2-4 cümle + hashtag'ler), emoji kullanılabilir, sonunda
  İNDİVA'yı indirmeye teşvik eden bir cümle olsun
- "voiceover": Bu ürünü tanıtan bir VİDEO SESLENDİRME METNİ (script). Bu metin doğrudan bir
  metinden-sese (ElevenLabs) aracına yapıştırılıp seslendirilecek — SADECE konuşulacak metni
  yaz, sahne yönergesi/parantez/emoji/hashtag YAZMA, doğal konuşma diliyle Türkçe yaz.

  UZUNLUK — SIKI KURAL: TOPLAM 35-50 KELİME (kesinlikle 55 kelimeyi geçme). Bu bir video altyazı
  metni değil, kısa ve vurucu bir reklam spotu — gereksiz cümle EKLEME, her kelimeyi say.

  TON — profesyonel bir reklam seslendirme sanatçısı gibi yaz: sıcak, kendinden emin, doğrudan.
  Yapay zekâ tarafından üretilmiş gibi HİSSETTİRMEMELİ — kalıp cümlelerden kaçın:
  - "...seviyorsanız tam size göre", "Dikkat!", "Müjde!", "Müthiş fırsat" gibi klişe açılışlarla
    BAŞLAMA. Doğrudan ürünle veya faydayla aç.
  - Kapanışı her seferinde aynı kalıpla ("bu fırsatı kaçırmayın") YAZMA — çeşitlendir: bazen
    aciliyet, bazen merak, bazen doğrudan davet kullan.
  - Ürün özelliklerini teknik bir liste okur gibi sıralama (örn. "IP67 sertifikası sayesinde"
    değil, faydasını günlük dille anlat: "suya, toza aldırmadan her yere götür" gibi).

  İÇERMESİ GEREKENLER (bu sırayla değil, doğal bir akışa yedirilmiş şekilde):
  - Ürün ne, kime/ne işe yarıyor — tek doğal cümlede.
  - Eski ve yeni fiyat + indirim yüzdesi NET söylenmeli (örn. "739 lira yerine şimdi 199 lira,
    yüzde 73 indirimli").
  - Öne çıkan TEK bir fayda (özellik değil, faydası — varsa reviewCount/kategori ipucu olabilir).
  - Kısa, enerjik bir İNDİVA çağrısı — ama klişe değil, doğal.

SADECE aşağıdaki JSON formatında cevap ver, başka hiçbir şey yazma:
{"title": "...", "caption": "...", "voiceover": "..."}`;

    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
            'Content-Type': 'application/json',
            'HTTP-Referer': 'https://indiva-proxy.vercel.app',
            'X-Title': 'INDIVA Panel Social Content',
        },
        body: JSON.stringify({
            model: MODEL,
            messages: [{ role: 'user', content: prompt }],
            // "Yeniden Üret" her seferinde farklı bir sonuç versin diye
            // aday-puanlama modundan (0.4) biraz daha yüksek sıcaklık.
            temperature: 0.85,
            usage: { include: true },
        }),
        signal: AbortSignal.timeout(30000),
    });

    if (!response.ok) {
        const errText = await response.text();
        return res.status(502).json({ success: false, error: `OpenRouter ${response.status}: ${errText.substring(0, 200)}` });
    }

    const data = await response.json();
    await trackOpenRouterUsage(data, 'social-content');
    const text = data?.choices?.[0]?.message?.content || '';
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
        return res.status(502).json({ success: false, error: 'AI JSON döndürmedi' });
    }

    const parsed = JSON.parse(jsonMatch[0]);
    const title = String(parsed.title || '').slice(0, 100);
    const caption = String(parsed.caption || '');
    const voiceover = String(parsed.voiceover || '');
    if (!title || !caption) {
        return res.status(502).json({ success: false, error: 'AI eksik içerik döndürdü' });
    }

    return res.status(200).json({ success: true, title, caption, voiceover });
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
    corsHeaders(res);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'Sadece POST destekleniyor' });

    if (!OPENROUTER_API_KEY) {
        return res.status(500).json({ success: false, error: 'OPENROUTER_API_KEY tanımlı değil' });
    }

    try {
        const isCandidatesMode = Array.isArray((req.body || {}).discounts);
        if (isCandidatesMode) {
            return await handleCandidates(req, res);
        }
        return await handleSingleContent(req, res);
    } catch (err: any) {
        if (err?.name === 'AbortError' || err?.name === 'TimeoutError') {
            return res.status(504).json({ success: false, error: 'Zaman aşımı' });
        }
        return res.status(500).json({ success: false, error: err?.message || 'Bilinmeyen hata' });
    }
}
