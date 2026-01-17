
import { db, app } from '../firebaseConfig';
import {
    collection,
    addDoc,
    getDocs,
    doc,
    updateDoc,
    deleteDoc,
    serverTimestamp,
    query,
    orderBy,
    where,
    Timestamp,
    writeBatch
} from 'firebase/firestore';
import type { Discount, Brochure, Advertisement, PendingDiscount, AdRequest, ScheduledNotification } from '../types';
import { deleteFromImgbb } from './imgbb';

// --- Discounts ---

export const addDiscount = async (discountData: Omit<Discount, 'id' | 'createdAt'>) => {
    const dataWithTimestamp = {
        ...discountData,
        createdAt: serverTimestamp(),
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
        console.error("Error deleting discount from DB:", e);
        throw e;
    }
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
    // Not: orderBy kaldırıldı - composite index gerektirmemesi için
    // Client-side sıralama yapılıyor
    const q = query(
        collection(db, 'discounts'),
        where('affiliateLinkUpdated', '==', false)
    );
    const querySnapshot = await getDocs(q);
    const discounts = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Discount));

    // Client-side sıralama: en yeniden en eskiye
    return discounts.sort((a, b) => {
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
    return querySnapshot.size;
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

export const addBrochure = async (brochureData: { marketName: string, imageUrl: string, deleteUrl: string }) => {
    const { marketName, imageUrl, deleteUrl } = brochureData;
    if (!marketName) {
        throw new Error("Market adı afiş eklemek için zorunludur.");
    }
    const collectionRef = getCircularsCollectionRef(marketName);

    const dataToSave = {
        marketName: marketName,
        imageUrl: imageUrl,
        deleteUrl: deleteUrl,
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
            marketName: data.marketName || marketName, // Fallback to requested market name if missing in doc
            imageUrl: data.imageUrl,
            deleteUrl: data.deleteUrl,
            createdAt: data.createdAt,
        } as Brochure;
    });
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
        console.error("Error deleting brochure from DB:", e);
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
            deleteDiscount(ad.id, ad.deleteUrl, ad.screenshotDeleteUrl).catch(err => console.error("Auto-delete failed", err));
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
    // Basit ve net silme işlemi
    const docRef = doc(db, 'adRequests', id);
    await deleteDoc(docRef);
};


// --- Notifications (Instant) ---

// Updated to match Android App expectation: title, body, url, image
export const sendNotification = async (title: string, message: string, imageUrl?: string, link?: string) => {
    if (!title || !message) {
        throw new Error("Title and message are required for notifications.");
    }

    // The payload must match exactly what the Android Cloud Function expects.
    await addDoc(collection(db, 'notifications'), {
        title: title,
        body: message,
        url: link || null,     // Maps 'link' input to 'url' field in DB
        image: imageUrl || null, // Maps 'imageUrl' input to 'image' field in DB
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
