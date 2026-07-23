
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
    startAfter,
    Timestamp,
    writeBatch,
    getCountFromServer,
    documentId,
    QueryDocumentSnapshot,
    DocumentData
} from 'firebase/firestore';
import type { Discount, Brochure, Advertisement, PendingDiscount, AdRequest, ScheduledNotification, StagingProduct, SocialContentItem } from '../types';
import { deleteFromImgbb } from './imgbb';

// Gerçek affiliate link üretimi şu an sadece Trendyol/Hepsiburada için
// çalışıyor (AffiliateLinkManager.tsx'in isSupportedStore'u ile birebir
// aynı olmalı — storeName/brand alanı genelde doğru olsa da asıl gerçeği
// link URL'i söylüyor, ikisi arasında sapma bu yüzden sayaç/liste
// uyumsuzluğuna yol açıyordu).
const isSupportedAffiliateLink = (deal: Pick<Discount, 'link' | 'originalStoreLink'>): boolean => {
    const url = deal.originalStoreLink || deal.link || '';
    return url.includes('trendyol.com') || url.includes('ty.gl')
        || url.includes('hepsiburada.com') || url.includes('hb.biz');
};

// --- Discounts ---

export const addDiscount = async (discountData: Omit<Discount, 'id' | 'createdAt'>) => {
    const dataWithTimestamp = {
        ...discountData,
        createdAt: serverTimestamp(),
        expiresAt: Timestamp.fromDate(new Date(Date.now() + 12 * 60 * 60 * 1000)),
    };
    return await addDoc(collection(db, 'discounts'), dataWithTimestamp);
};

/**
 * "İlanları Yönet" ekranı için — TÜM geçmişi (getDiscounts gibi sınırsız)
 * çekmek yerine yalnızca son `days` gün içinde oluşturulanları okur. İlanlar
 * zaten 24 saat içinde süresi doluyor ve temizlik script'i düzenli siliyor,
 * bu yüzden birkaç günlük pencere yönetim ekranı için fazlasıyla yeterli —
 * arama/filtre/sayaç davranışı birebir aynı kalır, sadece okunan veri
 * koleksiyonun tüm geçmişi yerine son birkaç güne sınırlanır.
 */
export const getRecentDiscounts = async (days: number = 3): Promise<Discount[]> => {
    const cutoff = Timestamp.fromDate(new Date(Date.now() - days * 24 * 60 * 60 * 1000));
    const q = query(
        collection(db, 'discounts'),
        where('createdAt', '>=', cutoff),
        orderBy('createdAt', 'desc'),
        // Sabit üst sınır: temizlik script'i (cleanup-discounts.js) eksik composite
        // index yüzünden aylarca hiçbir şey silmemiş, koleksiyon ~14K belgeye
        // şişmişti — bu limit'siz sorgu tek bir "İlanları Yönet" ziyaretinde
        // binlerce okuma tüketip günlük Firestore kotasını (50K) tek başına
        // aşabiliyordu (2026-07-17'de gerçekleşti). İndex artık var ve temizlik
        // çalışıyor ama bu limit, aynı tür maliyet patlamasına karşı kalıcı bir
        // güvenlik payı olarak kalıyor.
        limit(500)
    );
    const querySnapshot = await getDocs(q);
    return querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Discount));
};

/** Bildirim/sosyal içerik seçici pencereleri için — sadece ihtiyaç kadar okur. */
export const getDiscountsForPicker = async (limitCount: number = 60): Promise<Discount[]> => {
    const q = query(collection(db, 'discounts'), orderBy('createdAt', 'desc'), limit(limitCount));
    const querySnapshot = await getDocs(q);
    return querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Discount));
};

export interface DiscountsPage {
    discounts: Discount[];
    lastDoc: QueryDocumentSnapshot<DocumentData> | null;
    hasMore: boolean;
}

/**
 * "Düzenle" sayfası için sayfalı (cursor tabanlı) sorgu — tüm koleksiyonu
 * çekmek yerine her seferinde sadece pageSize kadar okur.
 */
export const getDiscountsPage = async (
    pageSize: number = 6,
    cursor: QueryDocumentSnapshot<DocumentData> | null = null
): Promise<DiscountsPage> => {
    const q = cursor
        ? query(collection(db, 'discounts'), orderBy('createdAt', 'desc'), startAfter(cursor), limit(pageSize))
        : query(collection(db, 'discounts'), orderBy('createdAt', 'desc'), limit(pageSize));
    const querySnapshot = await getDocs(q);
    return {
        discounts: querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Discount)),
        lastDoc: querySnapshot.docs.length > 0 ? querySnapshot.docs[querySnapshot.docs.length - 1] : null,
        hasMore: querySnapshot.docs.length === pageSize,
    };
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

    // Sadece gerçekten affiliate linki üretilebilen mağazalar (Trendyol/Hepsiburada)
    const filteredDiscounts = discounts.filter(isSupportedAffiliateLink);

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
    let count = 0;
    for (const docSnap of querySnapshot.docs) {
        if (isSupportedAffiliateLink(docSnap.data() as Discount)) count++;
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

// getCountFromServer: sunucudan sadece sayı ister, doküman içeriği hiç indirilmez —
// koleksiyon büyüklüğünden bağımsız olarak 1 read maliyetiyle çalışır. App.tsx bu
// fonksiyonları 30sn'de bir çağırıyor, bu yüzden burada tam doküman okumak
// (getDocs) yerine sayaç kullanmak read maliyetini büyük ölçüde düşürür.
export const getPendingAdRequestCount = async (): Promise<number> => {
    const snap = await getCountFromServer(
        query(collection(db, 'adRequests'), where('status', '==', 'pending'))
    );
    return snap.data().count;
};

export const getPendingDiscountCount = async (): Promise<number> => {
    const snap = await getCountFromServer(collection(db, 'pendingDiscounts'));
    return snap.data().count;
};

// --- Sosyal Medya İçerik Kuyruğu ---
// Otomatik pipeline'lar (auto-onual, trendyol-scraper) yüksek puanlı fırsatları
// buraya yazar. Status client-side filtrelenir (composite index gerektirmesin diye).
// NOT: getSocialContentQueue() tam liste için (SocialContentManager.tsx), sadece
// oradan çağrıldığında tüm dokümanları okur. Rozet sayacı (getPendingSocialContentCount)
// ise bunu ÇAĞIRMAZ — ayrı, ucuz bir getCountFromServer sorgusu kullanır.

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
    const snap = await getCountFromServer(
        query(collection(db, 'social_content_queue'), where('status', '==', 'pending'))
    );
    return snap.data().count;
};

// --- AI Kullanım/Maliyet İstatistikleri ---
// scripts/*.js, functions/index.js ve vercel-proxy/api/*.ts her AI çağrısından
// sonra 'aiUsage/daily_YYYY-MM-DD' ve 'aiUsage/monthly_YYYY-MM' dokümanlarını
// increment ile günceller. Burada sadece 2 doküman okunur.
export interface AiUsageSourceStats {
    calls: number;
    inputTokens: number;
    outputTokens: number;
    costUsd: number;
}

export interface AiUsageStats extends AiUsageSourceStats {
    bySource: Record<string, AiUsageSourceStats>;
}

const emptyAiUsage: AiUsageStats = { calls: 0, inputTokens: 0, outputTokens: 0, costUsd: 0, bySource: {} };

export const getAiUsageStats = async (): Promise<{ today: AiUsageStats; month: AiUsageStats }> => {
    const now = new Date();
    const dayId = now.toISOString().slice(0, 10);
    const monthId = now.toISOString().slice(0, 7);

    const [dailySnap, monthlySnap] = await Promise.all([
        getDoc(doc(db, 'aiUsage', `daily_${dayId}`)),
        getDoc(doc(db, 'aiUsage', `monthly_${monthId}`)),
    ]);

    const toStats = (d: typeof dailySnap): AiUsageStats => {
        if (!d.exists()) return { ...emptyAiUsage, bySource: {} };
        const data = d.data() as any;
        const bySource: Record<string, AiUsageSourceStats> = {};
        for (const [key, val] of Object.entries<any>(data.bySource || {})) {
            bySource[key] = {
                calls: val?.calls || 0,
                inputTokens: val?.inputTokens || 0,
                outputTokens: val?.outputTokens || 0,
                costUsd: val?.costUsd || 0,
            };
        }
        return {
            calls: data.calls || 0,
            inputTokens: data.inputTokens || 0,
            outputTokens: data.outputTokens || 0,
            costUsd: data.costUsd || 0,
            bySource,
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
// Admin tetikler: son 60 ilanı okuyup (tek Firestore sorgusu), OpenRouter proxy'sine
// gönderir. AI satış potansiyeli + indirim oranı + ilgi çekicilik kriterlerine
// göre EN İYİ 10 ürünü PUANLAR (henüz içerik üretmez). Admin bu 10 adaydan
// birini seçtiğinde generateSocialContentForProduct SADECE o ürün için
// başlık+caption üretir — beğenilmezse aynı fonksiyon "Yeniden Üret" ile
// tekrar çağrılır.
// NOT: 100 ürünle canlı testte gerçek (uzun) başlıklarla bazen Vercel Hobby
// planının 60sn sunucusuz fonksiyon sınırını aşıp zaman aşımına yol açtı —
// 60'a düşürüldü, hâlâ eski 3'lü sistemin (50) üzerinde.

/** Sosyal medya AI önerisi için son N ilanı getirir (reklamlar hariç, varsayılan 60). */
export const getRecentDiscountsForSocialAi = async (limitCount: number = 60): Promise<Discount[]> => {
    const q = query(collection(db, 'discounts'), orderBy('createdAt', 'desc'), limit(limitCount));
    const querySnapshot = await getDocs(q);
    return querySnapshot.docs
        .map(doc => ({ id: doc.id, ...doc.data() } as Discount))
        .filter(d => !d.isAd);
};

export interface SocialContentCandidate {
    productId: string;
    score: number;
    reasoning: string;
}

/** Son ~100 ilan içinden en iyi 10 adayı puanlatır — henüz başlık/caption üretilmez. */
export const suggestSocialCandidates = async (discounts: Discount[]): Promise<SocialContentCandidate[]> => {
    // NOT: social-content.ts ile aynı uç (ayrı bir dosya Vercel Hobby planının
    // 12 fonksiyon sınırını aşıyordu) — body'de "discounts" (dizi) gönderilirse
    // aday puanlama moduna, "discount" (tekil) gönderilirse tek ürün içerik
    // üretme moduna girer.
    const attempt = async (): Promise<SocialContentCandidate[]> => {
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
            signal: AbortSignal.timeout(65000),
        });

        const raw = await res.text();
        let data: any;
        try {
            data = JSON.parse(raw);
        } catch {
            throw new Error(res.ok ? 'AI sunucudan geçersiz yanıt geldi' : `Sunucu hatası (${res.status}) — tekrar deneyin`);
        }
        if (!data.success) throw new Error(data.error || 'AI önerisi alınamadı');
        return data.candidates as SocialContentCandidate[];
    };

    // Kullanıcı geri bildirimi: "AI ile Öner" ilk tıkta zaman aşımı hatası
    // veriyor, 2-3 kez tıklayınca çalışıyordu — AI sağlayıcısının ara sıra
    // yaşadığı geçici (transient) hatalar/zaman aşımları içindi. Kullanıcının
    // elle tekrar tıklamasına gerek kalmasın diye burada otomatik yeniden
    // deniyoruz (kısa bir bekleme ile, art arda 3 deneme).
    let lastErr: unknown;
    for (let i = 0; i < 3; i++) {
        try {
            return await attempt();
        } catch (e) {
            lastErr = e;
            if (i < 2) await new Promise(r => setTimeout(r, 1200));
        }
    }
    throw lastErr;
};

/** Seçilen TEK ürün için başlık+caption+seslendirme metni üretir. "Yeniden Üret"
 *  butonu da aynı fonksiyonu tekrar çağırır — her seferinde farklı bir sonuç döner.
 *  "voiceover": ElevenLabs gibi bir metinden-sese aracına doğrudan yapıştırılacak,
 *  ürünü/fiyatı/indirimi anlatıp İNDİVA'yı indirmeye teşvik eden konuşma script'i. */
export const generateSocialContentForProduct = async (
    discount: Pick<Discount, 'id' | 'title' | 'brand' | 'category' | 'oldPrice' | 'newPrice' | 'reviewCount'>
): Promise<{ title: string; caption: string; voiceover: string }> => {
    const res = await fetch('https://indiva-proxy.vercel.app/api/social-content', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            discount: {
                id: discount.id,
                title: discount.title,
                brand: discount.brand,
                category: discount.category,
                oldPrice: discount.oldPrice,
                newPrice: discount.newPrice,
                reviewCount: discount.reviewCount,
            },
        }),
        signal: AbortSignal.timeout(35000),
    });

    // Fonksiyon zaman aşımına uğrarsa Vercel JSON olmayan bir hata sayfası
    // döndürebilir — res.json() burada anlaşılmaz bir "Unexpected token" hatası
    // fırlatmasın diye önce metin olarak okuyup kendimiz parse ediyoruz.
    const raw = await res.text();
    let data: any;
    try {
        data = JSON.parse(raw);
    } catch {
        throw new Error(res.ok ? 'AI sunucudan geçersiz yanıt geldi' : `Sunucu hatası (${res.status}) — tekrar deneyin`);
    }
    if (!data.success) throw new Error(data.error || 'İçerik üretilemedi');
    // Şeffaflık/uyum için: henüz bir marka ile ücretli reklam anlaşmamız yok, ama
    // affiliate linkler zaten kullanılıyor — ticari ilişkiyi belirtmek için her
    // paylaşıma sabit bir #işbirliği etiketi ekleniyor (AI'nın ürettiği metne
    // dokunmadan, sona eklenir). Önizlemede de aynı hâliyle görünsün diye burada.
    return { title: data.title, caption: `${data.caption}\n\n#işbirliği`, voiceover: data.voiceover || '' };
};

/** Seçilen ürün + üretilen içerik doğrudan kuyruğa eklenir. */
export const addSocialContentFromAiSuggestion = async (
    discount: Pick<Discount, 'id' | 'title' | 'imageUrl' | 'category' | 'brand' | 'newPrice' | 'oldPrice'>,
    content: { title: string; caption: string; voiceover?: string }
): Promise<void> => {
    await addDoc(collection(db, 'social_content_queue'), {
        discountId: discount.id,
        title: content.title || discount.title,
        imageUrl: discount.imageUrl,
        category: discount.category || '',
        storeName: discount.brand || '',
        newPrice: discount.newPrice,
        oldPrice: discount.oldPrice,
        score: 10,
        caption: content.caption,
        voiceover: content.voiceover || '',
        source: 'manual',
        status: 'pending',
        createdAt: serverTimestamp(),
    });
};

// --- Zamanlı Sosyal Medya AI Önerisi (scripts/auto-social-ai-suggest.js) ---
// Günde 3 kez (13:00/17:00/21:00 TR'den 3dk önce) sunucu tarafında üretilip
// 'social_content_ai_suggestions/latest' dokümanına yazılır + admin'e push
// bildirimi gönderilir. Panel açıldığında bu doküman okunur — AI çağrısı
// tekrar yapılmaz, hazır aday listesi gösterilir (henüz içerik üretilmemiştir).

export interface StoredSocialContentCandidate extends SocialContentCandidate {
    product: {
        id: string; title: string; imageUrl: string; link: string;
        category: string; brand: string; oldPrice: number; newPrice: number;
    };
}

export const getLatestAiSocialSuggestion = async (): Promise<{
    candidates: StoredSocialContentCandidate[];
    createdAtMs: number;
    opened: boolean;
} | null> => {
    const snap = await getDoc(doc(db, 'social_content_ai_suggestions', 'latest'));
    if (!snap.exists()) return null;
    const data = snap.data() as any;
    return {
        candidates: data.candidates || [],
        createdAtMs: data.createdAt?.toMillis ? data.createdAt.toMillis() : 0,
        opened: !!data.opened,
    };
};

export const markAiSocialSuggestionOpened = async (): Promise<void> => {
    await updateDoc(doc(db, 'social_content_ai_suggestions', 'latest'), { opened: true });
};

// --- AI Analist Raporları (scripts/auto-ai-analyst.js) ---
// Günde 2 kez (14:00/22:00 TR) ve haftada 1 kez sunucu tarafında üretilen
// detaylı analiz + öncelikli öneri raporları. Panel sadece okur.

export interface AiAnalystSection {
    severity: 'ok' | 'warning' | 'critical';
    findings: string[];
}

export interface AiAnalystRecommendation {
    priority: number;
    title: string;
    detail: string;
}

export interface AiAnalystReport {
    id: string;
    mode: 'daily' | 'weekly';
    periodStart: string;
    summary: string;
    sections: {
        teknik_saglik?: AiAnalystSection;
        operasyon?: AiAnalystSection;
        buyume?: AiAnalystSection;
    };
    recommendations: AiAnalystRecommendation[];
    createdAtMs: number;
    read: boolean;
}

const toAiAnalystReport = (id: string, data: any): AiAnalystReport => ({
    id,
    mode: data.mode || 'daily',
    periodStart: data.periodStart || '',
    summary: data.summary || '',
    sections: data.sections || {},
    recommendations: data.recommendations || [],
    createdAtMs: data.createdAt?.toMillis ? data.createdAt.toMillis() : 0,
    read: !!data.read,
});

export const getAiAnalystReport = async (id: string): Promise<AiAnalystReport | null> => {
    const snap = await getDoc(doc(db, 'ai_analyst_reports', id));
    if (!snap.exists()) return null;
    return toAiAnalystReport(snap.id, snap.data());
};

/** Son N raporu getirir (varsayılan 20) — geçmiş rapor listesi için. */
export const getAiAnalystReports = async (limitCount: number = 20): Promise<AiAnalystReport[]> => {
    const q = query(collection(db, 'ai_analyst_reports'), orderBy('createdAt', 'desc'), limit(limitCount));
    const snap = await getDocs(q);
    return snap.docs.map(d => toAiAnalystReport(d.id, d.data()));
};

export const markAiAnalystReportRead = async (id: string): Promise<void> => {
    await updateDoc(doc(db, 'ai_analyst_reports', id), { read: true });
};

/** AI Analist raporunu elle (anlık) tetikler — GitHub Actions workflow'unu
 *  workflow_dispatch ile başlatır. Rapor senkron dönmez, birkaç dakika
 *  içinde push bildirimi + yeni rapor olarak Firestore'a düşer. */
export const triggerAiAnalystReport = async (mode: 'daily' | 'weekly' = 'daily'): Promise<void> => {
    const res = await fetch('https://indiva-proxy.vercel.app/api/trigger-ai-analyst', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode }),
        signal: AbortSignal.timeout(20000),
    });
    const raw = await res.text();
    let data: any;
    try {
        data = JSON.parse(raw);
    } catch {
        throw new Error(res.ok ? 'Sunucudan geçersiz yanıt geldi' : `Sunucu hatası (${res.status}) — tekrar deneyin`);
    }
    if (!data.success) throw new Error(data.error || 'Tetikleme başarısız oldu');
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

// Belirli ID'lere ait staging ürünlerini getirir (tüm koleksiyonu çekmek yerine
// yalnızca istenenleri okur — "Sırada" listesi 6'lı sayfalar halinde açıldığında
// gereksiz Firestore okumasını önlemek için kullanılır). Firestore 'in' filtresi
// en fazla 10 ID kabul ettiği için 10'luk gruplara bölünür.
export const getStagingProductsByIds = async (ids: string[]): Promise<StagingProduct[]> => {
    if (!ids.length) return [];
    const CHUNK = 10;
    const results: StagingProduct[] = [];
    for (let i = 0; i < ids.length; i += CHUNK) {
        const chunk = ids.slice(i, i + CHUNK);
        const q = query(collection(db, 'trendyol_staging'), where(documentId(), 'in', chunk));
        const snap = await getDocs(q);
        results.push(...snap.docs.map(d => ({ id: d.id, ...d.data() } as StagingProduct)));
    }
    return results;
};

// Bilgisayardaki scraper'ın (scrape.js:enqueueAutoPublish) kalite kapısından
// geçip henüz yayınlanmamış, sırada bekleyen ürünleri — her birinin tahmini
// yayın zamanını hesaplamak için nextAt/intervalMs ile birlikte döner.
export interface AutoPublishQueueStatus {
    ids: string[];
    nextAt: number;
    intervalMs: number;
    status: string;
    done: number;
    failed: number;
    total: number;
}

export const getAutoPublishQueue = async (): Promise<AutoPublishQueueStatus | null> => {
    const snap = await getDoc(doc(db, 'scraper_control', 'auto_publish_queue'));
    if (!snap.exists()) return null;
    const d = snap.data() as any;
    const ids = Array.isArray(d.ids) ? d.ids : [];
    const done = typeof d.done === 'number' ? d.done : 0;
    const failed = typeof d.failed === 'number' ? d.failed : 0;
    return {
        ids,
        nextAt: typeof d.nextAt === 'number' ? d.nextAt : 0,
        intervalMs: typeof d.intervalMs === 'number' ? d.intervalMs : 0,
        status: d.status || 'done',
        done,
        failed,
        // Eski (total alanı olmayan) kayıtlarla geriye dönük uyumluluk için hesaplanan yedek.
        total: typeof d.total === 'number' ? d.total : done + failed + ids.length,
    };
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

