/**
 * İNDİVA Uygulama Kategorileri
 * Bu liste D:\INDIVAAPP2026\constants\categories.ts ile birebir aynı olmalıdır.
 * Değişiklik yapılacaksa her iki dosya birlikte güncellenmelidir.
 */
export const CATEGORIES = [
    'Teknoloji',
    'Beyaz Eşya',
    'Giyim & Moda',
    'Ayakkabı & Çanta',
    'Ev & Yaşam',
    'Mobilya & Dekorasyon',
    'Spor & Outdoor',
    'Kozmetik & Bakım',
    'Süpermarket',
    'Anne & Bebek',
    'Kitap & Kırtasiye',
    'Oyun & Oyuncak',
    'Seyahat',
    'Yemek & İçecek',
    'Sağlık',
    'Otomotiv',
    'Pet Shop',
    'Bahçe & Yapı',
    'Diğer',
] as const;

export type Category = typeof CATEGORIES[number];
