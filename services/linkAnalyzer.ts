import { CATEGORIES } from '../constants/categories';

const AI_SCRAPE_URL = 'https://indiva-proxy.vercel.app/api/ai-scrape';

export interface AnalyzedProduct {
    title: string;
    brand: string;
    store: string;
    category: string;
    oldPrice: number;
    newPrice: number;
    imageUrl: string;
    discountPercent: number;
    link: string;
    aiPriceFallback?: boolean;
    priceNotFound?: boolean;
    error?: string;
}

// ─── Mağaza Tespiti ───────────────────────────────────────────────────────────

function detectStore(url: string): string {
    const u = url.toLowerCase();
    if (u.includes('trendyol') || u.includes('ty.gl')) return 'Trendyol';
    if (u.includes('hepsiburada') || u.includes('hb.biz')) return 'Hepsiburada';
    if (u.includes('amazon') || u.includes('amzn.to')) return 'Amazon';
    if (u.includes('n11.com')) return 'N11';
    if (u.includes('ciceksepeti')) return 'Çiçeksepeti';
    return 'Online Mağaza';
}

// ─── Keyword ile Kategori Tespiti ─────────────────────────────────────────────

const CATEGORY_KEYWORDS: { keywords: string[]; category: string }[] = [
    { keywords: ['laptop', 'notebook', 'bilgisayar', 'tablet', 'telefon', 'iphone', 'samsung', 'xiaomi', 'klavye', 'mouse', 'kulaklık', 'hoparlör', 'kamera', 'ssd', 'harddisk', 'şarj', 'powerbank', 'drone', 'tv ', 'televizyon', 'router', 'modem', 'monitör', 'usb', 'hdmi', 'webcam', 'akıllı'], category: 'Teknoloji' },
    { keywords: ['buzdolabı', 'çamaşır makinesi', 'bulaşık makinesi', 'fırın', 'ocak', 'davlumbaz', 'klima', 'süpürge', 'robot süpürge', 'beyaz eşya', 'ankastre', 'derin dondurucu'], category: 'Beyaz Eşya' },
    { keywords: ['mont', 'ceket', 'kazak', 'gömlek', 'pantolon', 'elbise', 'bluz', 'tişört', 't-shirt', 'sweatshirt', 'hoodie', 'bere', 'eldiven', 'çorap', 'kemer', 'pijama', 'iç giyim', 'giyim', 'boxer', 'külot', 'atlet', 'mayo', 'bikini', 'şort', 'tayt', 'etek'], category: 'Giyim & Moda' },
    { keywords: ['ayakkabı', 'sneaker', 'bot', 'sandalet', 'çizme', 'terlik', 'spor ayakkabı', 'çanta', 'sırt çantası', 'el çantası', 'valiz', 'bavul', 'cüzdan', 'kartlık', 'kemer'], category: 'Ayakkabı & Çanta' },
    { keywords: ['tencere', 'tava', 'çaydanlık', 'bıçak', 'tabak', 'bardak', 'nevresim', 'perde', 'halı', 'kilim', 'lamba', 'havlu', 'yastık', 'yorgan', 'çarşaf', 'mutfak', 'ev ', 'kupa', 'çatal', 'kaşık'], category: 'Ev & Yaşam' },
    { keywords: ['mobilya', 'masa', 'sandalye', 'yatak', 'dolap', 'raf', 'koltuk', 'çekyat', 'gardırop', 'dekorasyon', 'tablo', 'çerçeve', 'ayna', 'sehpa'], category: 'Mobilya & Dekorasyon' },
    { keywords: ['kamp', 'fitness', 'bisiklet', 'top', 'forma', 'pilates', 'spor', 'outdoor', 'yürüyüş', 'koşu', 'dumbbell', 'halter', 'trekking', 'yoga', 'squat', 'antrenman'], category: 'Spor & Outdoor' },
    { keywords: ['şampuan', 'krem', 'losyon', 'maske', 'serum', 'parfüm', 'deodorant', 'saç', 'cilt', 'diş', 'tıraş', 'makyaj', 'ruj', 'oje', 'sabun', 'duş jeli', 'vücut', 'fondöten', 'maskara', 'nemlendirici'], category: 'Kozmetik & Bakım' },
    { keywords: ['deterjan', 'temizlik', 'bakliyat', 'yağ', 'şeker', 'çay', 'kahve', 'atıştırmalık', 'makarna', 'peynir', 'süt', 'yoğurt', 'çikolata', 'gıda', 'bisküvi', 'nutella', 'market', 'zeytinyağı', 'un '], category: 'Süpermarket' },
    { keywords: ['bebek', 'bez', 'emzik', 'biberon', 'mama', 'bebek arabası', 'çocuk bezi', 'oyun halısı'], category: 'Anne & Bebek' },
    { keywords: ['kalem', 'defter', 'boya', 'çizim', 'kağıt', 'kitap', 'roman', 'kırtasiye', 'okul'], category: 'Kitap & Kırtasiye' },
    { keywords: ['lego', 'puzzle', 'oyuncak', 'oyun', 'hobi', 'maket', 'araba oyuncak', 'bebek oyuncak'], category: 'Oyun & Oyuncak' },
    { keywords: ['uçak bileti', 'otel', 'tatil', 'seyahat', 'tur ', 'rezervasyon', 'turizm'], category: 'Seyahat' },
    { keywords: ['restoran', 'yemek siparişi', 'yemek kupon', 'içecek', 'kafe'], category: 'Yemek & İçecek' },
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

// ─── Vercel Proxy ile Ürün Verisi ─────────────────────────────────────────────

interface ProxyProduct {
    title: string;
    brand: string;
    newPrice: number;
    oldPrice: number;
    imageUrl: string;
    resolvedUrl: string;
    category?: string;
    aiPriceFallback?: boolean;
    priceNotFound?: boolean;
}

async function fetchProductFromProxy(url: string): Promise<ProxyProduct> {
    const geminiKey = (import.meta as any).env?.VITE_GEMINI_API_KEY || '';
    const res = await fetch(AI_SCRAPE_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, geminiKey }),
        signal: AbortSignal.timeout(60000),
    });
    if (!res.ok) throw new Error(`AI Scrape HTTP ${res.status}`);
    const json = await res.json();
    if (!json.success) throw new Error(json.error || 'AI Scrape hatası');
    return json.product as ProxyProduct;
}

// ─── Ana Fonksiyon ────────────────────────────────────────────────────────────

export async function analyzeProductLink(link: string): Promise<AnalyzedProduct> {
    const storeName = detectStore(link);

    // Proxy'den ürün verisini çek
    const product = await fetchProductFromProxy(link);

    const newPrice = product.newPrice || 0;
    const oldPrice = product.oldPrice > 0
        ? product.oldPrice
        : newPrice > 0 ? Math.round(newPrice * 1.3) : 0;

    const discountPercent = oldPrice > newPrice && newPrice > 0
        ? Math.round(((oldPrice - newPrice) / oldPrice) * 100)
        : 0;

    const category = product.category || detectCategory(product.title || '', product.brand || '');

    return {
        title: product.title || '',
        brand: storeName,
        store: storeName,
        category,
        newPrice,
        oldPrice,
        imageUrl: product.imageUrl || '',
        discountPercent,
        link,
        aiPriceFallback: product.aiPriceFallback || false,
        priceNotFound: !newPrice,
    };
}

export function isValidProductLink(link: string): boolean {
    return !!link?.startsWith('http');
}
