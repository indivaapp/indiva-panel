import type { AnalyzedProduct } from './linkAnalyzer';

const PROXY_URL = 'https://indiva-proxy.vercel.app/api/scrape';

// ─── Kategori Tespiti (linkAnalyzer ile aynı tablo) ───────────────────────────

const CATEGORY_KEYWORDS: { keywords: string[]; category: string }[] = [
    { keywords: ['laptop', 'notebook', 'bilgisayar', 'tablet', 'telefon', 'iphone', 'samsung', 'xiaomi', 'klavye', 'mouse', 'kulaklık', 'hoparlör', 'kamera', 'ssd', 'harddisk', 'şarj', 'powerbank', 'drone', 'tv ', 'televizyon', 'router', 'modem', 'monitör', 'usb', 'hdmi', 'webcam', 'akıllı'], category: 'Teknoloji' },
    { keywords: ['buzdolabı', 'çamaşır makinesi', 'bulaşık makinesi', 'fırın', 'ocak', 'davlumbaz', 'klima', 'süpürge', 'robot süpürge', 'beyaz eşya', 'ankastre', 'derin dondurucu'], category: 'Beyaz Eşya' },
    { keywords: ['mont', 'ceket', 'kazak', 'gömlek', 'pantolon', 'elbise', 'bluz', 'tişört', 't-shirt', 'sweatshirt', 'hoodie', 'bere', 'eldiven', 'çorap', 'kemer', 'pijama', 'iç giyim', 'giyim', 'boxer', 'külot', 'atlet', 'mayo', 'bikini', 'şort', 'tayt', 'etek'], category: 'Giyim & Moda' },
    { keywords: ['ayakkabı', 'sneaker', 'bot', 'sandalet', 'çizme', 'terlik', 'spor ayakkabı', 'çanta', 'sırt çantası', 'el çantası', 'valiz', 'bavul', 'cüzdan', 'kartlık'], category: 'Ayakkabı & Çanta' },
    { keywords: ['tencere', 'tava', 'çaydanlık', 'bıçak', 'tabak', 'bardak', 'nevresim', 'perde', 'halı', 'kilim', 'lamba', 'havlu', 'yastık', 'yorgan', 'çarşaf', 'mutfak', 'ev ', 'kupa', 'çatal', 'kaşık'], category: 'Ev & Yaşam' },
    { keywords: ['mobilya', 'masa', 'sandalye', 'yatak', 'dolap', 'raf', 'koltuk', 'çekyat', 'gardırop', 'dekorasyon', 'tablo', 'çerçeve', 'ayna', 'sehpa'], category: 'Mobilya & Dekorasyon' },
    { keywords: ['kamp', 'fitness', 'bisiklet', 'top', 'forma', 'pilates', 'spor', 'outdoor', 'yürüyüş', 'koşu', 'dumbbell', 'halter', 'trekking', 'yoga', 'squat', 'antrenman'], category: 'Spor & Outdoor' },
    { keywords: ['şampuan', 'krem', 'losyon', 'maske', 'serum', 'parfüm', 'deodorant', 'saç', 'cilt', 'diş', 'tıraş', 'makyaj', 'ruj', 'oje', 'sabun', 'duş jeli', 'vücut', 'fondöten', 'maskara', 'nemlendirici'], category: 'Kozmetik & Bakım' },
    { keywords: ['deterjan', 'temizlik', 'bakliyat', 'yağ', 'şeker', 'çay', 'kahve', 'atıştırmalık', 'makarna', 'peynir', 'süt', 'yoğurt', 'çikolata', 'gıda', 'bisküvi', 'nutella', 'market', 'zeytinyağı', 'un '], category: 'Süpermarket' },
    { keywords: ['bebek', 'bez', 'emzik', 'biberon', 'mama', 'bebek arabası', 'çocuk bezi', 'oyun halısı'], category: 'Anne & Bebek' },
    { keywords: ['kalem', 'defter', 'boya', 'çizim', 'kağıt', 'kitap', 'roman', 'kırtasiye', 'okul'], category: 'Kitap & Kırtasiye' },
    { keywords: ['lego', 'puzzle', 'oyuncak', 'oyun', 'hobi', 'maket', 'araba oyuncak', 'bebek oyuncak'], category: 'Oyun & Oyuncak' },
    { keywords: ['vitamin', 'takviye', 'kapsül', 'şurup', 'ilaç', 'tansiyon', 'şeker ölçer', 'nebülizatör', 'sağlık', 'medikal', 'terapi'], category: 'Sağlık' },
    { keywords: ['araba', 'otomobil', 'tekerlek', 'lastik', 'motosiklet', 'kask', 'oto ', 'motor yağı', 'araç'], category: 'Otomotiv' },
    { keywords: ['kedi', 'köpek', 'kuş', 'hayvan maması', 'tasma', 'pet ', 'akvaryum', 'hamster'], category: 'Pet Shop' },
    { keywords: ['bahçe', 'çiçek', 'saksı', 'hırdavat', 'yapı', 'alet', 'matkap', 'tornavida', 'boya '], category: 'Bahçe & Yapı' },
];

function detectCategory(title: string, brand: string): string {
    const lower = (title + ' ' + brand).toLowerCase();
    for (const { keywords, category } of CATEGORY_KEYWORDS) {
        if (keywords.some(kw => lower.includes(kw))) return category;
    }
    return 'Diğer';
}

// ─── Trendyol URL Doğrulama ───────────────────────────────────────────────────

export function isValidTrendyolLink(url: string): boolean {
    if (!url?.startsWith('http')) return false;
    const lower = url.toLowerCase();
    return lower.includes('trendyol.com') || lower.includes('ty.gl');
}

// ─── Proxy üzerinden Trendyol API ────────────────────────────────────────────

interface TrendyolProxyProduct {
    title: string;
    brand: string;
    newPrice: number;
    oldPrice: number;
    imageUrl: string;
    resolvedUrl: string;
}

async function fetchFromProxy(endpoint: string): Promise<TrendyolProxyProduct> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);

    try {
        const res = await fetch(endpoint, { signal: controller.signal });
        clearTimeout(timeout);

        if (!res.ok) throw new Error(`Proxy HTTP ${res.status}`);

        const json = await res.json();
        if (!json.success) throw new Error(json.error || 'Proxy hatası');

        return json.product as TrendyolProxyProduct;
    } catch (err: unknown) {
        clearTimeout(timeout);
        if (err instanceof Error && err.name === 'AbortError') {
            throw new Error('Bağlantı zaman aşımına uğradı (30s). Tekrar deneyin.');
        }
        throw err;
    }
}

async function fetchTrendyolFromProxy(url: string): Promise<TrendyolProxyProduct> {
    // Önce özel Trendyol endpoint'ini dene (deploy edilmişse çalışır)
    try {
        const trendyolEndpoint = `${PROXY_URL}?action=trendyol&url=${encodeURIComponent(url)}`;
        return await fetchFromProxy(trendyolEndpoint);
    } catch (err: unknown) {
        // action=trendyol henüz deploy edilmemişse generic action=product'a düş
        const msg = err instanceof Error ? err.message : '';
        if (msg.includes('400') || msg.includes('Invalid action') || msg.includes('proxy hatası')) {
            const productEndpoint = `${PROXY_URL}?action=product&url=${encodeURIComponent(url)}`;
            return await fetchFromProxy(productEndpoint);
        }
        throw err;
    }
}

// ─── Ana Fonksiyon ────────────────────────────────────────────────────────────

export async function analyzeTrendyolProduct(link: string): Promise<AnalyzedProduct> {
    if (!isValidTrendyolLink(link)) {
        throw new Error('Geçerli bir Trendyol linki girin (trendyol.com veya ty.gl)');
    }

    const product = await fetchTrendyolFromProxy(link);

    const newPrice = product.newPrice || 0;
    // Proxy tarafında zaten %30 markup uygulanıyor, ama burada da kontrol et
    const oldPrice = product.oldPrice > 0
        ? product.oldPrice
        : newPrice > 0 ? Math.round(newPrice * 1.3) : 0;

    const discountPercent = oldPrice > newPrice && newPrice > 0
        ? Math.round(((oldPrice - newPrice) / oldPrice) * 100)
        : 0;

    const category = detectCategory(product.title || '', product.brand || '');

    return {
        title: product.title || '',
        brand: product.brand || 'Trendyol',
        store: 'Trendyol',
        category,
        newPrice,
        oldPrice,
        imageUrl: product.imageUrl || '',
        discountPercent,
        link,
        aiPriceFallback: false,
        priceNotFound: !newPrice,
    };
}
