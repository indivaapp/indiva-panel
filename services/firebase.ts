
import { db, app } from '../firebaseConfig';
import {
    collection,
    addDoc,
    getDocs,
    getDoc,
    setDoc,
    doc,
    updateDoc,
    deleteDoc,
    serverTimestamp,
    query,
    orderBy,
    where,
    limit,
    Timestamp,
    writeBatch
} from 'firebase/firestore';
import type { Discount, Brochure, Advertisement, PendingDiscount, AdRequest, ScheduledNotification, StagingProduct, SocialContentItem } from '../types';
import { deleteFromImgbb } from './imgbb';

const ALLOWED_AFFILIATE_STORES = ['Trendyol', 'Hepsiburada', 'Amazon', 'Pazarama'];

// --- Discounts ---

export const addDiscount = async (discountData: Omit<Discount, 'id' | 'createdAt'>) => {
    const dataWithTimestamp = {
        ...discountData,
        createdAt: serverTimestamp(),
        expiresAt: Timestamp.fromDate(new Date(Date.now() + 12 * 60 * 60 * 1000)),
    };
    return await addDoc(collection(db, 'discounts'), dataWithTimestamp);
};

export const getDiscounts = async (): Promise<Discount[]> => {
    const q = query(collection(db, 'discounts'), orderBy('createdAt', 'desc'));
    const querySnapshot = await getDocs(q);
    return querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Discount));
};

export const updateDiscount = async (id: string, dataToUpdate: Partial<Omit<Discount, 'id'>>) => {
    const discountRef = doc(db, 'discounts', id);
    await updateDoc(discountRef, dataToUpdate);
};

export const deleteDiscount = async (id: string, deleteUrl?: string, screenshotDeleteUrl?: string) => {
    // Safe delete: Defer image deletion to next tick to ensure it NEVER blocks DB deletion
    if (deleteUrl) {
        setTimeout(() => deleteFromImgbb(deleteUrl), 0);
    }
    if (screenshotDeleteUrl) {
        setTimeout(() => deleteFromImgbb(screenshotDeleteUrl), 0);
    }

    try {
        await deleteDoc(doc(db, 'discounts', id));
    } catch (e) {
        throw e;
    }
};

/**
 * Süresi dolmuş ilanları toplu sil
 * 'İndirim Bitti' veya 'Sonlanıyor' statüsündeki tüm ilanları Firebase'den kaldır
 */
export const deleteExpiredDiscountsBatch = async (discounts: Discount[]): Promise<number> => {
    if (discounts.length === 0) return 0;

    const CHUNK_SIZE = 400;
    let deletedCount = 0;

    // Önce görselleri sil (fire-and-forget)
    discounts.forEach(d => {
        if (d.deleteUrl) setTimeout(() => deleteFromImgbb(d.deleteUrl), 0);
        if (d.screenshotDeleteUrl) setTimeout(() => deleteFromImgbb(d.screenshotDeleteUrl!), 0);
    });

    for (let i = 0; i < discounts.length; i += CHUNK_SIZE) {
        const batch = writeBatch(db);
        const chunk = discounts.slice(i, i + CHUNK_SIZE);
        for (const d of chunk) {
            batch.delete(doc(db, 'discounts', d.id));
        }
        await batch.commit();
        deletedCount += chunk.length;
    }

    return deletedCount;
};

// --- Fırsat Bulucu Toplu İşlemler ---

/**
 * Birden fazla indirimi toplu olarak ekle (batch write)
 * @param discounts Eklenecek indirimler
 * @returns Eklenen indirim sayısı
 */
export const addDiscountsBatch = async (discounts: Omit<Discount, 'id' | 'createdAt'>[]): Promise<number> => {
    if (discounts.length === 0) return 0;

    const CHUNK_SIZE = 400; // Firestore batch limit is 500
    let addedCount = 0;

    for (let i = 0; i < discounts.length; i += CHUNK_SIZE) {
        const batch = writeBatch(db);
        const chunk = discounts.slice(i, i + CHUNK_SIZE);

        for (const discount of chunk) {
            const docRef = doc(collection(db, 'discounts'));
            batch.set(docRef, {
                ...discount,
                createdAt: serverTimestamp(),
                importedAt: serverTimestamp(),
                affiliateLinkUpdated: false,
                expiresAt: Timestamp.fromDate(new Date(Date.now() + 12 * 60 * 60 * 1000)),
            });
        }

        await batch.commit();
        addedCount += chunk.length;
    }

    return addedCount;
};

/**
 * Affiliate link güncellenmemiş indirimleri getir
 */
export const getDiscountsNeedingAffiliate = async (): Promise<Discount[]> => {
    const q = query(
        collection(db, 'discounts'),
        where('affiliateLinkUpdated', '==', false)
    );
    const querySnapshot = await getDocs(q);
    const discounts = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Discount));

    // Mağazaya göre filtrele
    const filteredDiscounts = discounts.filter(deal =>
        ALLOWED_AFFILIATE_STORES.some(store =>
            (deal.storeName || '').toLowerCase() === store.toLowerCase() ||
            (deal.brand || '').toLowerCase() === store.toLowerCase()
        )
    );

    // Client-side sıralama: en yeniden en eskiye
    return filteredDiscounts.sort((a, b) => {
        const timeA = a.createdAt?.seconds ?? 0;
        const timeB = b.createdAt?.seconds ?? 0;
        return timeB - timeA;
    });
};

/**
 * Bekleyen affiliate link sayısını getir (hızlı kontrol için)
 */
export const getPendingAffiliateCount = async (): Promise<number> => {
    const q = query(
        collection(db, 'discounts'),
        where('affiliateLinkUpdated', '==', false)
    );
    const querySnapshot = await getDocs(q);
    const allowedLower = ALLOWED_AFFILIATE_STORES.map(s => s.toLowerCase());
    let count = 0;
    for (const docSnap of querySnapshot.docs) {
        const data = docSnap.data();
        const store = (data.storeName || '').toLowerCase();
        const brand = (data.brand || '').toLowerCase();
        if (allowedLower.includes(store) || allowedLower.includes(brand)) {
            count++;
        }
    }
    return count;
};

/**
 * Affiliate linki güncelle - Admin'in kendi linkini ekler
 */
export const updateAffiliateLink = async (id: string, newLink: string): Promise<void> => {
    const discountRef = doc(db, 'discounts', id);
    await updateDoc(discountRef, {
        link: newLink,                    // Kullanıcıya gösterilecek link
        adminAffiliateLink: newLink,      // Admin'in affiliate linki
        affiliateLinkUpdated: true,       // Güncellendi olarak işaretle
        linkUpdatedAt: serverTimestamp(), // Güncelleme zamanı
    });
};

/**
 * Affiliate güncellemesini atla - Orijinal linkle devam et
 */
export const skipAffiliateUpdate = async (id: string): Promise<void> => {
    const discountRef = doc(db, 'discounts', id);
    await updateDoc(discountRef, {
        affiliateLinkUpdated: true,       // Artık listede görünmez
        linkUpdatedAt: serverTimestamp(),
    });
};

/**
 * Toplu affiliate linki atla
 */
export const skipAllAffiliateUpdates = async (ids: string[]): Promise<number> => {
    if (ids.length === 0) return 0;

    const CHUNK_SIZE = 400;
    let updatedCount = 0;

    for (let i = 0; i < ids.length; i += CHUNK_SIZE) {
        const batch = writeBatch(db);
        const chunk = ids.slice(i, i + CHUNK_SIZE);

        for (const id of chunk) {
            const docRef = doc(db, 'discounts', id);
            batch.update(docRef, {
                affiliateLinkUpdated: true,
                linkUpdatedAt: serverTimestamp(),
            });
        }

        await batch.commit();
        updatedCount += chunk.length;
    }

    return updatedCount;
};


// --- Circulars (Brochures) ---

const MARKET_KEY_MAP: { [key: string]: string } = {
    'BİM': 'bim',
    'A101': 'a101',
    'ŞOK': 'sok',
};

const formatMarketKey = (marketName: string): string => {
    const trimmedName = (marketName || '').trim();
    return MARKET_KEY_MAP[trimmedName] || trimmedName.toLowerCase();
};


const getCircularsCollectionRef = (marketName: string) => {
    const formattedMarketName = formatMarketKey(marketName);
    return collection(db, 'circulars', formattedMarketName, 'brochures');
}

export const addBrochure = async (brochureData: Omit<Brochure, 'id' | 'createdAt'>) => {
    const { storeName, imageUrl, deleteUrl, title, validityDate } = brochureData;
    if (!storeName) {
        throw new Error("Market adı (storeName) afiş eklemek için zorunludur.");
    }
    const collectionRef = getCircularsCollectionRef(storeName);

    const dataToSave = {
        storeName: storeName,
        marketName: storeName, // Eski uyumluluk için ikisini de kaydedelim
        title: title || '',
        imageUrl: imageUrl,
        validityDate: validityDate || '',
        publishDate: brochureData.publishDate || serverTimestamp(), // Akıllı sıralama için
        deleteUrl: deleteUrl || '',
        createdAt: serverTimestamp(),
    };
    return await addDoc(collectionRef, dataToSave);
};

export const getBrochures = async (marketName: string): Promise<Brochure[]> => {
    if (!marketName) return [];
    const collectionRef = getCircularsCollectionRef(marketName);
    const q = query(collectionRef, orderBy('createdAt', 'desc'));
    const querySnapshot = await getDocs(q);

    return querySnapshot.docs.map(doc => {
        const data = doc.data();
        return {
            id: doc.id,
            storeName: data.storeName || data.marketName || marketName,
            marketName: data.marketName || data.storeName || marketName,
            title: data.title || '',
            validityDate: data.validityDate || '',
            publishDate: data.publishDate || data.createdAt,
            imageUrl: data.imageUrl,
            deleteUrl: data.deleteUrl,
            createdAt: data.createdAt,
        } as Brochure;
    })
        .sort((a: any, b: any) => {
            // Manuel sıralama varsa ona göre, yoksa createdAt'e göre sırala
            const aHasOrder = a.order !== undefined && a.order !== null;
            const bHasOrder = b.order !== undefined && b.order !== null;
            if (aHasOrder && bHasOrder) return (a.order as number) - (b.order as number);
            if (aHasOrder) return -1;
            if (bHasOrder) return 1;
            const dateA = (a as any).publishDate?.seconds ?? (a as any).createdAt?.seconds ?? 0;
            const dateB = (b as any).publishDate?.seconds ?? (b as any).createdAt?.seconds ?? 0;
            return dateB - dateA;
        });
};

/** Aktüel görsellerinin sırasını Firestore'a toplu yazar (order: 0, 1, 2, ...) */
export const updateBrochureOrder = async (marketName: string, orderedIds: string[]) => {
    const marketKey = formatMarketKey(marketName);
    const batch = writeBatch(db);
    orderedIds.forEach((id, index) => {
        const docRef = doc(db, 'circulars', marketKey, 'brochures', id);
        batch.update(docRef, { order: index });
    });
    await batch.commit();
};

export const deleteBrochure = async (id: string, marketName: string, deleteUrl?: string) => {
    if (!marketName || !id) {
        throw new Error("Market adı ve afiş ID'si silme işlemi için zorunludur.");
    }

    if (deleteUrl) {
        setTimeout(() => deleteFromImgbb(deleteUrl), 0);
    }

    try {
        const marketKey = formatMarketKey(marketName);
        const docRef = doc(db, "circulars", marketKey, "brochures", id);
        await deleteDoc(docRef);
    } catch (e) {
        throw e;
    }
};

export const deleteAllByMarket = async (marketName: string) => {
    if (!marketName) {
        throw new Error("Toplu silme için market adı zorunludur.");
    }

    const collectionRef = getCircularsCollectionRef(marketName);
    const q = query(collectionRef);
    const querySnapshot = await getDocs(q);
    const docs = querySnapshot.docs;

    if (docs.length === 0) {
        return;
    }

    // Batch image deletion safely
    docs.forEach(docSnapshot => {
        const data = docSnapshot.data();
        if (data.deleteUrl) {
            setTimeout(() => deleteFromImgbb(data.deleteUrl), 0);
        }
    });

    const CHUNK_SIZE = 400;
    for (let i = 0; i < docs.length; i += CHUNK_SIZE) {
        const batch = writeBatch(db);
        const chunk = docs.slice(i, i + CHUNK_SIZE);
        for (const docSnapshot of chunk) {
            batch.delete(docSnapshot.ref);
        }
        await batch.commit();
    }
};


// --- Pending Discounts (Submission from Users) ---

export const getPendingDiscounts = async (): Promise<PendingDiscount[]> => {
    // Collection is 'pendingDiscounts' based on your requirement
    const q = query(collection(db, 'pendingDiscounts'), orderBy('createdAt', 'desc'));
    const querySnapshot = await getDocs(q);
    return querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as PendingDiscount));
};

// We delete the pending discount after approving/moving it to the main 'discounts' collection
export const deletePendingDiscount = async (id: string) => {
    await deleteDoc(doc(db, 'pendingDiscounts', id));
};


// --- Advertisements (Stored as Discounts with isAd: true) ---

export const addAdvertisement = async (adData: Omit<Discount, 'id' | 'createdAt' | 'isAd' | 'submittedBy'> & { expiresAt: Date, adBadge: string }) => {
    // We now save advertisements into the 'discounts' collection but mark them as ads.
    // This ensures they appear in the main feed.

    const discountData: any = {
        ...adData,
        isAd: true, // CRITICAL FLAG
        adBadge: adData.adBadge, // Save the specific badge (e.g., "Kadın Girişimci")
        expiresAt: Timestamp.fromDate(adData.expiresAt),
        createdAt: serverTimestamp(),
        submittedBy: 'admin-ad',
    };

    return await addDoc(collection(db, 'discounts'), discountData);
};


export const getAdvertisements = async (): Promise<Discount[]> => {
    // Query 'discounts' collection where isAd is true
    const q = query(
        collection(db, 'discounts'),
        where('isAd', '==', true)
    );
    const querySnapshot = await getDocs(q);
    const ads = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Discount));

    // --- AUTO DELETE EXPIRED ADS LOGIC ---
    const now = new Date();
    const validAds: Discount[] = [];

    for (const ad of ads) {
        let expiryDate: Date | null = null;

        if (ad.expiresAt) {
            // Handle Firestore Timestamp or standard JS Date
            expiryDate = ad.expiresAt instanceof Timestamp ? ad.expiresAt.toDate() : new Date(ad.expiresAt as any);
        }

        if (expiryDate && expiryDate < now) {
            // Ad is expired. Delete it automatically.
            // Fire and forget deletion
            deleteDiscount(ad.id, ad.deleteUrl, ad.screenshotDeleteUrl).catch(() => {});
        } else {
            validAds.push(ad);
        }
    }

    // Client-side sorting by createdAt desc
    return validAds.sort((a, b) => {
        const timeA = a.createdAt?.seconds ?? 0;
        const timeB = b.createdAt?.seconds ?? 0;
        return timeB - timeA;
    });
};

export const deleteAdvertisement = async (id: string, deleteUrl?: string, screenshotDeleteUrl?: string) => {
    // Since ads are now in discounts collection, we reuse deleteDiscount
    await deleteDiscount(id, deleteUrl, screenshotDeleteUrl);
};


// --- Ad Requests (Applications from App) ---

export const getAdRequests = async (): Promise<AdRequest[]> => {
    // adRequests collection
    const q = query(collection(db, 'adRequests'), orderBy('createdAt', 'desc'));
    const querySnapshot = await getDocs(q);
    // Client side filtering for archived status to simplify indices
    return querySnapshot.docs
        .map(doc => ({ id: doc.id, ...doc.data() } as AdRequest))
        .filter(req => req.status !== 'archived');
};

export const updateAdRequestStatus = async (id: string, status: 'reviewed' | 'rejected' | 'pending' | 'archived') => {
    const docRef = doc(db, 'adRequests', id);
    await updateDoc(docRef, { status });
};

// Soft delete (Archive)
export const archiveAdRequest = async (id: string) => {
    await updateAdRequestStatus(id, 'archived');
}

// Hard delete
export const deleteAdRequest = async (id: string) => {
    const docRef = doc(db, 'adRequests', id);
    await deleteDoc(docRef);
};

export const getPendingAdRequestCount = async (): Promise<number> => {
    const q = query(collection(db, 'adRequests'), where('status', '==', 'pending'));
    const snap = await getDocs(q);
    return snap.size;
};

export const getPendingDiscountCount = async (): Promise<number> => {
    const snap = await getDocs(collection(db, 'pendingDiscounts'));
    return snap.size;
};

// --- Sosyal Medya İçerik Kuyruğu ---
// Otomatik pipeline'lar (auto-onual, trendyol-scraper) yüksek puanlı fırsatları
// buraya yazar. Status client-side filtrelenir (composite index gerektirmesin diye).

export const getSocialContentQueue = async (): Promise<SocialContentItem[]> => {
    const q = query(collection(db, 'social_content_queue'), orderBy('createdAt', 'desc'));
    const snap = await getDocs(q);
    return snap.docs
        .map(d => ({ id: d.id, ...d.data() } as SocialContentItem))
        .filter(item => item.status === 'pending');
};

export const markSocialContentPosted = async (id: string) => {
    const docRef = doc(db, 'social_content_queue', id);
    await updateDoc(docRef, { status: 'posted' });
};

export const getPendingSocialContentCount = async (): Promise<number> => {
    const items = await getSocialContentQueue();
    return items.length;
};

// --- AI Kullanım/Maliyet İstatistikleri ---
// scripts/*.js, functions/index.js ve vercel-proxy/api/*.ts her AI çağrısından
// sonra 'aiUsage/daily_YYYY-MM-DD' ve 'aiUsage/monthly_YYYY-MM' dokümanlarını
// increment ile günceller. Burada sadece 2 doküman okunur.
export interface AiUsageStats {
    calls: number;
    inputTokens: number;
    outputTokens: number;
    costUsd: number;
}

const emptyAiUsage: AiUsageStats = { calls: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 };

export const getAiUsageStats = async (): Promise<{ today: AiUsageStats; month: AiUsageStats }> => {
    const now = new Date();
    const dayId = now.toISOString().slice(0, 10);
    const monthId = now.toISOString().slice(0, 7);

    const [dailySnap, monthlySnap] = await Promise.all([
        getDoc(doc(db, 'aiUsage', `daily_${dayId}`)),
        getDoc(doc(db, 'aiUsage', `monthly_${monthId}`)),
    ]);

    const toStats = (d: typeof dailySnap): AiUsageStats => {
        if (!d.exists()) return { ...emptyAiUsage };
        const data = d.data() as any;
        return {
            calls: data.calls || 0,
            inputTokens: data.inputTokens || 0,
            outputTokens: data.outputTokens || 0,
            costUsd: data.costUsd || 0,
        };
    };

    return { today: toStats(dailySnap), month: toStats(monthlySnap) };
};

// Admin panelden elle seçilen bir fırsat için, puan eşiği beklemeden anında
// içerik kuyruğuna ekler. Caption, tarayıcıda Gemini anahtarı ifşa etmemek
// için sunucu tarafındaki (Vercel) generate-caption fonksiyonu üzerinden
// satış diliyle AI ile üretilir; uç nokta ulaşılamazsa şablona düşer.
export const addManualSocialContent = async (discount: Discount): Promise<void> => {
    const discountPct = discount.oldPrice > 0 && discount.newPrice > 0
        ? Math.round(((discount.oldPrice - discount.newPrice) / discount.oldPrice) * 100)
        : 0;
    let caption = `🔥 %${discountPct} indirim: ${discount.title}\n${Math.floor(discount.newPrice)} TL — ${discount.brand}\n\nSen de İNDİVA'yı indir, fırsatları kaçırma! 📲\n\n#indirim #firsat #kampanya #indivaapp`;

    try {
        const res = await fetch('https://indiva-proxy.vercel.app/api/generate-caption', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                title: discount.title,
                newPrice: discount.newPrice,
                oldPrice: discount.oldPrice,
                category: discount.category || '',
                storeName: discount.brand || '',
            }),
            signal: AbortSignal.timeout(20000),
        });
        if (res.ok) {
            const data = await res.json();
            if (data?.caption) caption = data.caption;
        }
    } catch {
        // Ağ/servis hatasında yukarıdaki şablon caption ile devam edilir
    }

    await addDoc(collection(db, 'social_content_queue'), {
        discountId: discount.id,
        title: discount.title,
        imageUrl: discount.imageUrl,
        category: discount.category || '',
        storeName: discount.brand || '',
        newPrice: discount.newPrice,
        oldPrice: discount.oldPrice,
        score: 10,
        caption,
        source: 'manual',
        status: 'pending',
        createdAt: serverTimestamp(),
    });
};

// --- AI Sosyal Medya İçerik Önerisi ---
// Admin tetikler: son 50 ilanı okuyup (tek Firestore sorgusu), OpenRouter proxy'sine
// gönderir. AI satış potansiyeli + indirim oranı + geniş kitleye hitap etme
// kriterlerine göre TEK ürün seçer ve 3 farklı içerik varyasyonu döndürür.

/** Sosyal medya AI önerisi için son 50 ilanı getirir (reklamlar hariç). */
export const getRecentDiscountsForSocialAi = async (): Promise<Discount[]> => {
    const q = query(collection(db, 'discounts'), orderBy('createdAt', 'desc'), limit(50));
    const querySnapshot = await getDocs(q);
    return querySnapshot.docs
        .map(doc => ({ id: doc.id, ...doc.data() } as Discount))
        .filter(d => !d.isAd);
};

export interface SocialContentOption {
    title: string;
    caption: string;
}

export interface SocialContentSuggestion {
    productId: string;
    reasoning: string;
    options: SocialContentOption[];
}

export const suggestSocialContent = async (discounts: Discount[]): Promise<SocialContentSuggestion> => {
    const res = await fetch('https://indiva-proxy.vercel.app/api/social-content', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            discounts: discounts.map(d => ({
                id: d.id,
                title: d.title,
                brand: d.brand,
                category: d.category,
                oldPrice: d.oldPrice,
                newPrice: d.newPrice,
                reviewCount: d.reviewCount,
            })),
        }),
        signal: AbortSignal.timeout(50000),
    });

    const data = await res.json();
    if (!data.success) throw new Error(data.error || 'AI önerisi alınamadı');
    return data as SocialContentSuggestion;
};

/** AI önerisinden seçilen içerik doğrudan kuyruğa eklenir — generate-caption.ts'i
 *  tekrar çağırmaz, zaten üretilmiş caption'ı kullanır. */
export const addSocialContentFromAiSuggestion = async (
    discount: Discount,
    option: SocialContentOption
): Promise<void> => {
    await addDoc(collection(db, 'social_content_queue'), {
        discountId: discount.id,
        title: option.title || discount.title,
        imageUrl: discount.imageUrl,
        category: discount.category || '',
        storeName: discount.brand || '',
        newPrice: discount.newPrice,
        oldPrice: discount.oldPrice,
        score: 10,
        caption: option.caption,
        source: 'manual',
        status: 'pending',
        createdAt: serverTimestamp(),
    });
};


// --- Notifications (Instant) ---

// Updated to match Android App expectation: title, body, url, image
export const sendNotification = async (
    title: string,
    message: string,
    imageUrl?: string,
    link?: string,
    discountId?: string,
    storyId?: string,
) => {
    if (!title || !message) {
        throw new Error("Title and message are required for notifications.");
    }
    await addDoc(collection(db, 'notifications'), {
        title,
        body: message,
        url: link || null,
        image: imageUrl || null,
        discountId: discountId || null,
        storyId: storyId || null,
        target: 'all',
        status: 'pending',
        createdAt: serverTimestamp(),
    });
};


// --- Scheduled Notifications (Recurring) ---

export const getScheduledNotifications = async (): Promise<ScheduledNotification[]> => {
    const q = query(collection(db, 'scheduled_notifications'), orderBy('time', 'asc'));
    const querySnapshot = await getDocs(q);
    return querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as ScheduledNotification));
};

export const addScheduledNotification = async (data: Omit<ScheduledNotification, 'id' | 'createdAt'>) => {
    return await addDoc(collection(db, 'scheduled_notifications'), {
        ...data,
        createdAt: serverTimestamp()
    });
};

export const toggleScheduledNotification = async (id: string, isActive: boolean) => {
    const docRef = doc(db, 'scheduled_notifications', id);
    await updateDoc(docRef, { isActive });
};

export const deleteScheduledNotification = async (id: string) => {
    const docRef = doc(db, 'scheduled_notifications', id);
    await deleteDoc(docRef);
};

// ─── Influencer Stories ───────────────────────────────────────────────────────

export const getInfluencerStories = async () => {
    const q = query(collection(db, 'influencerStories'), orderBy('createdAt', 'desc'));
    const snap = await getDocs(q);
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
};

export const addInfluencerStory = async (data: Omit<any, 'id' | 'createdAt'>) => {
    return await addDoc(collection(db, 'influencerStories'), {
        ...data,
        createdAt: serverTimestamp(),
    });
};

export const updateInfluencerStory = async (id: string, data: Partial<any>) => {
    await updateDoc(doc(db, 'influencerStories', id), data);
};

export const deleteInfluencerStory = async (id: string) => {
    await deleteDoc(doc(db, 'influencerStories', id));
};

// --- Trendyol Staging ---

export const getStagingProducts = async (): Promise<StagingProduct[]> => {
    const q = query(
        collection(db, 'trendyol_staging'),
        where('status', '==', 'pending'),
        orderBy('importedAt', 'desc')
    );
    const snap = await getDocs(q);
    return snap.docs.map(d => ({ id: d.id, ...d.data() } as StagingProduct));
};

export const publishStagingProducts = async (products: StagingProduct[]): Promise<number> => {
    if (products.length === 0) return 0;
    const CHUNK = 200; // her ürün 2 op: set + delete
    let published = 0;

    for (let i = 0; i < products.length; i += CHUNK) {
        const batch = writeBatch(db);
        const chunk = products.slice(i, i + CHUNK);
        for (const p of chunk) {
            const discountRef = doc(collection(db, 'discounts'));
            batch.set(discountRef, {
                title: p.title,
                brand: p.brand,
                category: p.category,
                newPrice: p.newPrice,
                oldPrice: p.oldPrice,
                imageUrl: p.imageUrl,
                link: p.link,
                deleteUrl: '',
                submittedBy: 'trendyol-scraper',
                storeName: p.storeName,
                originalSource: p.originalSource,
                reviewCount: p.reviewCount || '',
                affiliateLinkUpdated: false,
                importedAt: p.importedAt,
                createdAt: serverTimestamp(),
                expiresAt: Timestamp.fromDate(new Date(Date.now() + 12 * 60 * 60 * 1000)),
            });
            batch.delete(doc(db, 'trendyol_staging', p.id));
            published++;
        }
        await batch.commit();
    }
    return published;
};

// AI kalite kapısından geçip otomatik yayınlanan Trendyol/Cimri ürünleri.
// Tek alan where + client-side sıralama (composite index gerektirmez).
export interface AutoPublishedProduct {
    id: string;
    title: string;
    brand?: string;
    imageUrl: string;
    link: string;
    newPrice: number;
    oldPrice: number;
    site?: string;
    storeName?: string;
    qualityScore: number;
    satisPotansiyeli?: number | null;
    ilgiCekicilik?: number | null;
    qualityReason?: string;
    autoPublishedAt?: any;
}

export const getAutoPublishedProducts = async (limitCount = 30): Promise<AutoPublishedProduct[]> => {
    const q = query(
        collection(db, 'discounts'),
        where('submittedBy', '==', 'trendyol-scraper')
    );
    const snap = await getDocs(q);
    return snap.docs
        .map(d => ({ id: d.id, ...d.data() } as AutoPublishedProduct))
        .filter(p => typeof p.qualityScore === 'number')
        .sort((a, b) => {
            const am = a.autoPublishedAt?.toMillis?.() ?? 0;
            const bm = b.autoPublishedAt?.toMillis?.() ?? 0;
            return bm - am;
        })
        .slice(0, limitCount);
};

export const clearStagingProducts = async (site?: string): Promise<void> => {
    const q = query(collection(db, 'trendyol_staging'), where('status', '==', 'pending'));
    const snap = await getDocs(q);
    // site verilirse yalnızca o sitenin ürünleri silinir (client-side filtre → index gerekmez)
    const docs = site ? snap.docs.filter(d => (d.data().site || 'trendyol') === site) : snap.docs;
    if (!docs.length) return;
    const CHUNK = 450;
    for (let i = 0; i < docs.length; i += CHUNK) {
        const batch = writeBatch(db);
        docs.slice(i, i + CHUNK).forEach(d => batch.delete(d.ref));
        await batch.commit();
    }
};

// --- Scraper Kontrol (GitHub Actions) ---
// Scraper artık GitHub Actions'ta çalışır; durumu ve config'i Firestore üzerinden okur/yazar.

export interface ScraperStatusDoc {
    isRunning?: boolean;
    lastRunTime?: Timestamp;
    lastRunCount?: number;
    lastError?: string | null;
    startedAt?: Timestamp;
}

export interface ScraperConfigDoc {
    sources: {
        id: string;
        site?: string;
        label: string;
        description: string;
        pages: number;
        enabled: boolean;
    }[];
    sites?: { id: string; label: string }[];
}

export const getScraperStatus = async (): Promise<ScraperStatusDoc | null> => {
    const snap = await getDoc(doc(db, 'scraper_control', 'status'));
    return snap.exists() ? (snap.data() as ScraperStatusDoc) : null;
};

export const getScraperConfig = async (): Promise<ScraperConfigDoc | null> => {
    const snap = await getDoc(doc(db, 'scraper_control', 'config'));
    return snap.exists() ? (snap.data() as ScraperConfigDoc) : null;
};

export const toggleScraperSource = async (sourceId: string): Promise<void> => {
    const ref = doc(db, 'scraper_control', 'config');
    const snap = await getDoc(ref);
    if (!snap.exists()) return;
    const cfg = snap.data() as ScraperConfigDoc;
    const sources = cfg.sources.map(s =>
        s.id === sourceId ? { ...s, enabled: !s.enabled } : s
    );
    await setDoc(ref, { sources }, { merge: true });
};

// Telefon/panel "Veri Çek" → PC'deki dinleyici bunu görüp taramayı başlatır.
// site verilirse yalnızca o site taranır ('trendyol' | 'cimri'); yoksa tümü.
export const triggerScrape = async (site?: string): Promise<void> => {
    await setDoc(
        doc(db, 'scraper_control', 'trigger'),
        { requestedAt: serverTimestamp(), source: 'panel', site: site || null },
        { merge: true }
    );
};

// Çöz & Yayınla: seçilen ürünleri PC'ye gönderir. Cimri ürünlerinde PC gerçek
// mağaza linkini çözüp discounts'a yayınlar (panel doğrudan yapamaz).
export interface PublishRequestDoc {
    status?: string;
    total?: number;
    done?: number;
    failed?: number;
}

// interval (dakika): 0 = hemen hepsi; >0 = her N dakikada bir ürün (PC kuyruğu işler)
export const requestResolvePublish = async (ids: string[], interval = 0): Promise<void> => {
    await setDoc(
        doc(db, 'scraper_control', 'publish_request'),
        { requestedAt: serverTimestamp(), ids, interval, status: 'processing', total: ids.length, done: 0, failed: 0, nextAt: 0 },
        { merge: true }
    );
};

export const getPublishStatus = async (): Promise<PublishRequestDoc | null> => {
    const snap = await getDoc(doc(db, 'scraper_control', 'publish_request'));
    return snap.exists() ? (snap.data() as PublishRequestDoc) : null;
};
