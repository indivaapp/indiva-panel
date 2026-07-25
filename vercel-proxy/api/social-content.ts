import type { VercelRequest, VercelResponse } from '@vercel/node';
import { trackOpenRouterUsage } from './_aiUsageTracker';

/**
 * Social Content — ÜÇ MOD tek dosyada (Vercel Hobby planının 12 serverless
 * fonksiyon sınırı yüzünden ayrı dosyalara bölünemedi — fonksiyon sayısı
 * aşıldığında "No more than 12 Serverless Functions" hatası canlı testte
 * gözlemlendi, bu yüzden birleştirildi):
 *
 * 1) ADAY PUANLAMA — POST { discounts: [...] } (son ~60 ilan)
 *    → { success, candidates: [{ productId, score, reasoning }, ...] } (en fazla 20)
 *    Henüz başlık/caption ÜRETİLMEZ, sadece puanlanır.
 *
 * 2) TEK ÜRÜN İÇERİK ÜRETİMİ — POST { discount: {...} } (adaylardan seçilen TEK ürün)
 *    → { success, title, caption, voiceover }
 *    Admin bir aday seçtiğinde veya "Yeniden Üret" dediğinde çağrılır.
 *
 * 3) ÇOKLU ÜRÜN İÇERİK ÜRETİMİ — POST { products: [...] } (2-3 ürün, 3'lü vitrin
 *    videosu için) → { success, caption, voiceover } — ürünlerin TAMAMINI tek
 *    caption/seslendirme metninde tanıtan içerik üretir.
 *
 * Body'de "discounts" (dizi), "discount" (tekil) veya "products" (dizi) hangisi
 * geldiğine göre mod seçilir.
 */

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || '';
const MODEL = 'deepseek/deepseek-v4-flash';

function corsHeaders(res: VercelResponse) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

// Aynı ürün, scraper tarafından neredeyse birebir aynı başlıkla (farklı "id"
// ile) birden çok kez kaydedilebiliyor — canlı veriyle test edildiğinde bu,
// AI'nın top-20 listesinin birkaç slotunu aynı ürünün varyantlarıyla
// (örn. aynı vücut kreminin 3 farklı kokusu) doldurmasına yol açtığı
// görüldü. Modele gitmeden ÖNCE normalize edilmiş başlığa göre tekilleştirip
// (aynı başlıktan en yüksek indirimli olanı tutarak) havuzu temizliyoruz —
// modelin talimata uyup uymamasına bağlı kalmadan garanti bir çözüm.
function normalizeTitleForDedup(title: string): string {
    return String(title || '').toLowerCase().trim().replace(/\s+/g, ' ');
}

function dedupeByTitle(discounts: any[]): any[] {
    const bestByTitle = new Map<string, { discount: any; pct: number }>();
    for (const d of discounts) {
        const key = normalizeTitleForDedup(d.title);
        const pct = d.oldPrice > d.newPrice && d.oldPrice > 0 ? (d.oldPrice - d.newPrice) / d.oldPrice : 0;
        const existing = bestByTitle.get(key);
        if (!existing || pct > existing.pct) bestByTitle.set(key, { discount: d, pct });
    }
    return Array.from(bestByTitle.values()).map(v => v.discount);
}

async function handleCandidates(req: VercelRequest, res: VercelResponse) {
    const { discounts } = req.body || {};
    if (!Array.isArray(discounts) || discounts.length === 0) {
        return res.status(400).json({ success: false, error: 'discounts listesi boş olamaz' });
    }

    // NOT: 100 ürünle canlı testte gerçek (uzun) başlıklarla bazen Vercel
    // Hobby planının 60sn sunucusuz fonksiyon sınırını aşıp zaman aşımına
    // yol açtı — 60'a düşürüldü, hâlâ eski 3'lü sistemin (50) üzerinde.
    const compact = dedupeByTitle(discounts).slice(0, 60).map((d: any, i: number) => ({
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

GÖREV — EN İYİ 20 ADAYI PUANLA VE SIRALA:
Her ürünü sosyal medyada (Instagram story/post) paylaşılmaya UYGUNLUK açısından 1-10 arası puanla.
Puanlarken şu kriterleri birlikte değerlendir:
- Satış/popülerlik potansiyeli (reviewCount, marka tanınırlığı, kategori popülerliği ipucu olarak kullanılabilir)
- İndirim oranı (discountPercent) — yüksek indirim daha çekici; discountPercent 0 ise (veriye eski
  fiyat girilmemiş) bu ürünü GERÇEK bir indirim olarak SAYMA, sadece marka/ürün ilgi çekiciliğine
  göre değerlendir, asla sırf tanınmış marka diye yüksek puan verme
- İlgi çekicilik — geniş kitleye hitap eden, mainstream bir ürün/kategori/marka (çok nadir/niş bir ürün düşük puan almalı)
- ÇEŞİTLİLİK — aynı ürün ailesinden (aynı marka + aynı ürün tipi, sadece renk/beden/koku/desen
  farklı — örn. aynı vücut kreminin farklı kokuları, aynı tişörtün farklı renkleri) BİRDEN FAZLA
  ürünü seçme; bu tarz bir kümede sadece EN İYİ tekini seç, gerisini listeye alma

En yüksek puanlı 20 FARKLI ürünü seç (mümkünse farklı kategorilerden çeşitlilik olsun, aynı ürünü iki kez seçme).
Bu aşamada başlık veya sosyal medya metni YAZMA — sadece puanla ve kısa bir gerekçe ver.

İLANLAR (her ilanın başındaki "index" numarasıyla referans ver, "id" alanını YAZMA/KOPYALAMA):
${JSON.stringify(compact)}

SADECE aşağıdaki JSON formatında cevap ver, başka hiçbir şey yazma. Her "index" MUTLAKA
yukarıdaki listeden seçtiğin ilanın "index" alanındaki TAM SAYI olmalı (1 ile ${compact.length} arası),
"score" 1-10 arası tam sayı olmalı, "candidates" en yüksek puandan en düşüğe sıralı olmalı ve
en fazla 20 eleman içermeli, tüm index'ler birbirinden FARKLI olmalı. "reasoning" ÇOK KISA olsun
(en fazla 6-8 kelime, 50 karakteri GEÇME) — 20 eleman üretilecek, uzun gerekçe yazma:
{
  "candidates": [
    {"index": 1, "score": 9, "reasoning": "kısa Türkçe gerekçe, max 50 karakter"},
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
            // NOT (canlı testte bulundu): max_tokens verilmeden 20 aday isteği
            // bazen yanıtı yarıda keserek geçersiz JSON'a ("AI JSON döndürmedi")
            // yol açtı, bazen de üretim süresi zaman aşımına çok yaklaştı. Kısa
            // gerekçe kuralıyla birlikte üretimi hem hızlandırmak hem de asla
            // yarıda kesilmemesini garantilemek için sınır konuldu (20 eleman ×
            // ~50 karakterlik gerekçe + JSON overhead için bolca pay bırakıyor).
            max_tokens: 2000,
            usage: { include: true },
        }),
        // 20 aday (önceden 10) modele daha fazla çıktı ürettiriyor — canlı
        // veriyle test edildiğinde gerçek süre 50-55sn sınırına ulaşıp zaman
        // aşımına yol açtı. Kısa gerekçe + max_tokens ile üretim hızlandırıldı,
        // yine de Vercel Hobby'nin 60sn sınırına ~5sn pay bırakacak şekilde
        // 55sn'de tutuluyor.
        signal: AbortSignal.timeout(55000),
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
        .slice(0, 20);

    if (candidates.length === 0) {
        return res.status(502).json({ success: false, error: 'AI geçerli aday seçemedi' });
    }

    return res.status(200).json({ success: true, candidates });
}

async function handleMultiContent(req: VercelRequest, res: VercelResponse) {
    const { products } = req.body || {};
    if (!Array.isArray(products) || products.length < 2 || products.length > 3) {
        return res.status(400).json({ success: false, error: 'products dizisi 2 veya 3 ürün içermeli' });
    }

    const compact = products.map((p: any) => ({
        title: p.title,
        brand: p.brand || '',
        category: p.category || '',
        oldPrice: p.oldPrice || 0,
        newPrice: p.newPrice || 0,
        discountPercent: p.oldPrice > p.newPrice && p.oldPrice > 0
            ? Math.round(((p.oldPrice - p.newPrice) / p.oldPrice) * 100) : 0,
    }));

    const prompt = `Sen İNDİVA uygulamasının sosyal medya içerik editörüsün. Aşağıda AYNI VİDEODA
birlikte gösterilecek ${compact.length} farklı ürün var (bir "günün fırsatları" vitrin videosu).

ÜRÜNLER:
${JSON.stringify(compact)}

ÜRETMEN GEREKENLER:
- "caption": Instagram story/post metni (2-4 cümle + hashtag'ler), ${compact.length} ürünün
  TAMAMINI kısaca anan, emoji kullanılabilir, sonunda İNDİVA'yı indirmeye teşvik eden bir cümle olsun.
- "voiceover": Bu ${compact.length} ürünü TEK VİDEODA tanıtan bir VİDEO SESLENDİRME METNİ (script).
  Bu metin doğrudan bir metinden-sese (ElevenLabs) aracına yapıştırılıp seslendirilecek — SADECE
  konuşulacak metni yaz, sahne yönergesi/parantez/emoji/hashtag YAZMA, doğal konuşma diliyle Türkçe yaz.

  UZUNLUK — SIKI KURAL: TOPLAM 50-80 KELİME (kesinlikle 90 kelimeyi geçme). ${compact.length} ürünü
  sırayla, HER BİRİ İÇİN TEK KISA CÜMLE ile tanıt — uzun açıklamalara girme.

  TON — profesyonel bir reklam seslendirme sanatçısı gibi yaz: sıcak, kendinden emin, doğrudan,
  bir üründen diğerine akıcı şekilde geçsin. Yapay zekâ tarafından üretilmiş gibi HİSSETTİRMEMELİ —
  klişe açılış/kapanışları TEKRARLAMA ("Müjde!", "Dikkat!", "Bu fırsatı kaçırmayın" gibi kalıplardan kaçın).

  SESLENDİRME DOSTU YAZIM — ElevenLabs bu metni hiç zorlanmadan, doğal bir tonlamayla okuyabilmeli:
  "%", kısaltma, parantez, tire, üç nokta, birden fazla ünlem/soru işareti KULLANMA — sadece tek
  nokta/virgül/ünlem; BÜYÜK HARFLE vurgu YAPMA.

  İÇERMESİ GEREKENLER:
  - Kısa, doğal bir açılış (İNDİVA'da bugünün öne çıkan fırsatları gibi, klişe olmayan).
  - Her ürün için SADECE ürünün ne olduğunu ve YENİ fiyatını doğal bir cümlede söyle — eski
    fiyatı veya indirim yüzdesini SÖYLEME (görselde zaten ayrıca gösteriliyor, seslendirmede
    tekrarlanınca kulağa formülsel/yapay geliyor).
  - Kapanış — SIKI KURAL: "indirimi kaçırmayın, İNDİVA'yı hemen indirin" tarzı kısa, kaba, tek
    cümlelik bir çağrıyla YETİNME. En az 2 cümlelik, eğlenceli, sıcak ve gerçekten ikna edici bir
    kapanış yaz: dinleyiciyle sohbet eder gibi, İNDİVA'da bunun gibi onlarca fırsat daha olduğunu
    hissettir, uygulamayı indirip bu fırsatları kaçırmamaya davet et — enerjik ama samimi olsun,
    reklam spikeri gibi bağırarak değil.

SADECE aşağıdaki JSON formatında cevap ver, başka hiçbir şey yazma:
{"caption": "...", "voiceover": "..."}`;

    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
            'Content-Type': 'application/json',
            'HTTP-Referer': 'https://indiva-proxy.vercel.app',
            'X-Title': 'INDIVA Panel Social Multi Content',
        },
        body: JSON.stringify({
            model: MODEL,
            messages: [{ role: 'user', content: prompt }],
            temperature: 0.85,
            usage: { include: true },
        }),
        // 30sn çok az kalıyordu — 3 ürünü tek metinde birleştirmek modele daha
        // uzun sürüyor, bu yüzden admin sık sık "Zaman aşımı" alıp elle 2-3 kez
        // tekrar denemek zorunda kalıyordu (kullanıcı geri bildirimi). Vercel
        // Hobby'nin 60sn sınırına karşı pay bırakmak için 45sn'e çıkarıldı —
        // aday-puanlama modundaki (50sn) kadar geniş değil çünkü bu istek daha
        // küçük/basit, ama önceki 30sn'den belirgin şekilde daha toleranslı.
        signal: AbortSignal.timeout(45000),
    });

    if (!response.ok) {
        const errText = await response.text();
        return res.status(502).json({ success: false, error: `OpenRouter ${response.status}: ${errText.substring(0, 200)}` });
    }

    const data = await response.json();
    await trackOpenRouterUsage(data, 'social-multi-content');
    const text = data?.choices?.[0]?.message?.content || '';
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
        return res.status(502).json({ success: false, error: 'AI JSON döndürmedi' });
    }

    const parsed = JSON.parse(jsonMatch[0]);
    const caption = String(parsed.caption || '');
    const voiceover = String(parsed.voiceover || '');
    if (!caption) {
        return res.status(502).json({ success: false, error: 'AI eksik içerik döndürdü' });
    }

    return res.status(200).json({ success: true, caption, voiceover });
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

  TON — profesyonel bir reklam seslendirme sanatçısı gibi yaz, ama AMATÖR/YAVAN değil: sıcak,
  coşkulu, indirim heyecanı hissettiren, alışverişe gerçekten teşvik eden bir enerjisi olsun —
  bir radyo/TV alışveriş reklamı dinliyormuş gibi hissettirmeli, düz bir bilgilendirme metni gibi
  DEĞİL. Bunu abartılı bağırarak değil, kendinden emin ve akıcı bir coşkuyla yap.
  Yapay zekâ tarafından üretilmiş gibi HİSSETTİRMEMELİ — kalıp cümlelerden kaçın:
  - "...seviyorsanız tam size göre", "Dikkat!", "Müjde!", "Müthiş fırsat" gibi klişe açılışlarla
    BAŞLAMA. Doğrudan ürünle, faydayla veya heyecanla aç.
  - Kapanışı her seferinde aynı kalıpla ("bu fırsatı kaçırmayın") YAZMA — çeşitlendir: bazen
    aciliyet, bazen merak, bazen doğrudan davet kullan; ama her seferinde satın almaya/indirmeye
    net bir çağrıyla bitir.
  - Ürün özelliklerini teknik bir liste okur gibi sıralama (örn. "IP67 sertifikası sayesinde"
    değil, faydasını günlük dille anlat: "suya, toza aldırmadan her yere götür" gibi).

  SESLENDİRME DOSTU YAZIM — ElevenLabs bu metni HİÇ ZORLANMADAN, doğal bir tonlamayla okuyabilmeli:
  - Sadece düz, tam cümleler kur; kısa cümle/virgülle doğal nefes payı bırak — TEK bir cümleyi
    bağlaçlarla uzatıp sarmalama.
  - "%", kısaltma, parantez, tire, üç nokta, birden fazla ünlem/soru işareti (!!!, ???) KULLANMA —
    sadece tek nokta/virgül/ünlem; yüzdeyi ve fiyatı HER ZAMAN yazıyla söylenecek şekilde yaz
    (örn. "yüzde yetmiş üç indirim", "yüz doksan dokuz lira").
  - BÜYÜK HARFLE vurgu YAPMA (TTS'i garip okutur) — vurguyu kelime seçimiyle/cümle yapısıyla ver.
  - Sayıları TTS'in doğru telaffuz edeceği şekilde yaz: rakamla da yazsan sorun değil (örn. "199
    lira"), ama asla "199₺" gibi sembol+rakam bitişik yazma.

  İÇERMESİ GEREKENLER (bu sırayla değil, doğal bir akışa yedirilmiş şekilde):
  - Ürünü GENEL olarak tanıt: ne olduğu, kime/hangi ihtiyaca hitap ettiği, öne çıkan 1-2
    özelliği/faydası — sadece fiyata atlama, önce dinleyiciye ürün hakkında gerçek bir fikir ver.
  - Fiyatı doğal bir cümle akışında MUTLAKA belirt, ama HER SEFERİNDE "eski fiyat X, şimdi Y,
    yüzde Z indirimli" kalıbını TEKRARLAMA — bu formülsel ve yapay duruyor, kulağa hoş gelmiyor.
    Ürüne göre çeşitlendir: bazen sadece yeni fiyatı vurgula ("sadece 380 liraya sahip ol"),
    bazen indirim oranını farklı bir cümle yapısıyla ver, bazen tasarruf miktarını söyle, bazen
    eski/yeni fiyatı doğal bir karşılaştırmaya göm — ama HİÇBİR ZAMAN aynı kalıp cümleyi kelimesi
    kelimesine tekrar etme.
  - Öne çıkan TEK bir fayda (özellik değil, faydası — varsa reviewCount/kategori ipucu olabilir).
  - Coşkulu, enerjik, indirimli alışverişe teşvik eden bir İNDİVA çağrısıyla kapat — ama klişe
    değil, doğal ve inandırıcı olsun.

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
        const body = req.body || {};
        if (Array.isArray(body.discounts)) {
            return await handleCandidates(req, res);
        }
        if (Array.isArray(body.products)) {
            return await handleMultiContent(req, res);
        }
        return await handleSingleContent(req, res);
    } catch (err: any) {
        if (err?.name === 'AbortError' || err?.name === 'TimeoutError') {
            return res.status(504).json({ success: false, error: 'Zaman aşımı' });
        }
        return res.status(500).json({ success: false, error: err?.message || 'Bilinmeyen hata' });
    }
}
