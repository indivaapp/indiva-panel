
import type { Timestamp } from 'firebase/firestore';

// Sayfa tipleri - modal'lar sayfa olarak açılacak
export type ViewType =
    | 'dashboard'
    | 'discounts'
    | 'brochures'
    | 'submissions'
    | 'ads'
    | 'notifications'
    | 'manageDiscounts'
    | 'dealFinder'
    | 'editDiscount'      // İlan düzenleme sayfası
    | 'reviewSubmission'  // Onay sayfası
    | 'editDeal'          // Fırsat düzenleme sayfası
    | 'affiliateLinks'    // Affiliate link yönetim sayfası
    | 'autoDiscovery'     // Otomatik keşif sayfası (Tinder-style)
    | 'shareCapture';     // Ekran görüntüsü paylaşım overlay'i

// Using the actual Firestore Timestamp type for better integration
export type FirestoreTimestamp = Timestamp;

export interface Discount {
    id: string;
    title: string;
    description?: string;
    brand: string;
    category: string;
    link: string;
    oldPrice: number;
    newPrice: number;
    imageUrl: string;
    deleteUrl: string; // To track the file for deletion (e.g., ImgBB delete URL)
    screenshotUrl?: string; // New: Proof screenshot URL
    screenshotDeleteUrl?: string; // New: Proof screenshot delete URL
    submittedBy: string; // user id or name
    createdAt: FirestoreTimestamp;
    isAd?: boolean; // Reklam olup olmadığını belirler
    expiresAt?: FirestoreTimestamp | Date; // Reklamlar için bitiş tarihi
    adBadge?: string; // Reklamın sol üst köşesinde görünecek özel etiket (Örn: Kadın Girişimci)
    status?: string; // Örn: "İndirim Bitti"
    expiredAt?: FirestoreTimestamp; // İndirimin bittiği zaman

    // Fırsat Bulucu alanları
    affiliateLinkUpdated?: boolean; // Affiliate link güncellendi mi?
    originalSource?: string; // Kaynak site (OnuAl, vb.)
    importedAt?: FirestoreTimestamp; // Otomatik içe aktarma tarihi

    // Affiliate Link Yönetimi
    originalStoreLink?: string;       // Orijinal mağaza linki (salt okunur)
    adminAffiliateLink?: string;      // Admin'in koyduğu affiliate link
    linkUpdatedAt?: FirestoreTimestamp; // Link güncelleme zamanı

    // Otomatik Yayın Bilgisi
    autoPublishedAt?: FirestoreTimestamp; // Otomatik yayın zamanı
    telegramMessageId?: string;           // Kaynak Telegram mesaj ID'si
    storeName?: string;                   // Mağaza adı (Hepsiburada, Trendyol vb.)
    reviewCount?: string;                 // Yorum sayısı (400+ gibi)
}

export interface Brochure {
    id: string;
    marketName?: string;  // Eski uyumluluk için
    storeName: string;   // Yeni (Bim, A101, Sok)
    title: string;       // Örn: "23 Şubat Cuma"
    imageUrl: string;
    validityDate: string;// Örn: "27 Şubat - 6 Mart"
    publishDate?: FirestoreTimestamp; // Kataloğun başlangıç tarihi (Sıralama için)
    deleteUrl: string;   // Opsiyonel olabilir ama bot için gerekebilir
    createdAt: FirestoreTimestamp;
}

export interface Advertisement {
    id: string;
    productName: string;
    sellerName: string;
    link: string;
    imageUrl: string;
    deleteUrl: string;
    expiresAt: FirestoreTimestamp | Date;
}

export interface PendingDiscount {
    id: string;
    title: string;
    brand: string;
    description?: string;
    category: string;
    link?: string;
    oldPrice?: number;
    newPrice: number;
    imageBase64: string; // Mobil uygulamadan gelen Base64 resim verisi
    userId?: string; // Gönderen kullanıcı ID'si (opsiyonel)
    status: 'bekliyor' | 'rejected'; // Mobil uygulama 'bekliyor' gönderiyor
    createdAt: FirestoreTimestamp;
}

export interface AdRequest {
    id: string;
    type: 'product' | 'store';
    companyName: string;
    contactPerson: string;
    email: string;
    url: string;
    category: string;
    discountCode?: string;
    message?: string;
    createdAt: FirestoreTimestamp;
    status: 'pending' | 'reviewed' | 'rejected' | 'archived';
}

export interface ScheduledNotification {
    id: string;
    label: string; // Admin panelinde görünecek isim (örn: Sabah Hatırlatması)
    time: string; // "09:00" formatında saat
    title: string;
    message: string;
    image?: string; // Field name updated to match FCM guide
    url?: string; // Field name updated to match FCM guide
    isActive: boolean;
    createdAt: FirestoreTimestamp;
}
