/**
 * Auto-Publish Service
 * Otomatik yayınlama mantığı ve kontrolleri
 */

import { db } from '../firebaseConfig';
import {
    collection,
    addDoc,
    getDocs,
    doc,
    getDoc,
    setDoc,
    updateDoc,
    query,
    where,
    orderBy,
    limit,
    serverTimestamp,
    Timestamp
} from 'firebase/firestore';
import type { Discount } from '../types';
import { fetchDealsFromChannel, resolveOnuAlLink, type ScrapedDeal } from './dealFinder';
import { enrichDealWithAI, batchEnrichDeals, canAutoPublish, type EnrichedDeal } from './aiService';
import { uploadImageFromUrl } from './dealFinder';

// ===== TİPLER =====

export interface AutoPublishSettings {
    isActive: boolean;
    minConfidenceScore: number;
    minPrice: number;
    maxDailyPublish: number;
    requireImage: boolean;
    lastUpdated: Timestamp;
    updatedBy: string;
}

export interface AutoPublishLog {
    id?: string;
    timestamp: Timestamp;
    dealsProcessed: number;
    dealsPublished: number;
    dealsSkipped: number;
    errors: string[];
    publishedDeals: string[]; // ID listesi
}

export interface AutoPublishResult {
    success: boolean;
    processed: number;
    published: number;
    skipped: number;
    errors: string[];
    publishedDeals: EnrichedDeal[];
}

// ===== VARSAYILAN AYARLAR =====

const DEFAULT_SETTINGS: AutoPublishSettings = {
    isActive: true,
    minConfidenceScore: 60,
    minPrice: 10,
    maxDailyPublish: 50,
    requireImage: true,
    lastUpdated: Timestamp.now(),
    updatedBy: 'system'
};

// ===== AYARLAR =====

/**
 * Otomatik yayınlama ayarlarını getir
 */
export async function getAutoPublishSettings(): Promise<AutoPublishSettings> {
    try {
        const docRef = doc(db, 'settings', 'autoPublish');
        const docSnap = await getDoc(docRef);

        if (docSnap.exists()) {
            return docSnap.data() as AutoPublishSettings;
        }

        // Varsayılan ayarları oluştur
        await setDoc(docRef, DEFAULT_SETTINGS);
        return DEFAULT_SETTINGS;
    } catch (error) {
        console.error('Ayarlar alınamadı:', error);
        return DEFAULT_SETTINGS;
    }
}

/**
 * Otomatik yayınlama ayarlarını güncelle
 */
export async function updateAutoPublishSettings(
    updates: Partial<AutoPublishSettings>,
    updatedBy: string = 'admin'
): Promise<void> {
    const docRef = doc(db, 'settings', 'autoPublish');
    await setDoc(docRef, {
        ...updates,
        lastUpdated: serverTimestamp(),
        updatedBy
    }, { merge: true });
}

/**
 * Otomatik yayınlamayı aç/kapat
 */
export async function toggleAutoPublish(isActive: boolean): Promise<void> {
    await updateAutoPublishSettings({ isActive });
    console.log(`🔄 Otomatik yayınlama: ${isActive ? 'AKTİF' : 'DURDURULDU'}`);
}

// ===== DUPLICATE KONTROLÜ =====

/**
 * Son 24 saatte yayınlanan fırsatların başlıklarını getir
 */
async function getRecentPublishedTitles(): Promise<Set<string>> {
    const titles = new Set<string>();

    try {
        const yesterday = new Date();
        yesterday.setHours(yesterday.getHours() - 24);

        const q = query(
            collection(db, 'discounts'),
            where('createdAt', '>=', Timestamp.fromDate(yesterday)),
            orderBy('createdAt', 'desc'),
            limit(200)
        );

        const snapshot = await getDocs(q);
        snapshot.docs.forEach(doc => {
            const data = doc.data();
            if (data.title) {
                // Başlığı normalize et
                titles.add(normalizeTitle(data.title));
            }
        });
    } catch (error) {
        console.error('Recent titles alınamadı:', error);
    }

    return titles;
}

/**
 * Başlığı karşılaştırma için normalize et
 */
function normalizeTitle(title: string): string {
    return title
        .toLowerCase()
        .replace(/[^a-z0-9çğıöşü]/gi, '') // Sadece harfler ve rakamlar
        .trim();
}

/**
 * Fırsat daha önce yayınlanmış mı kontrol et
 */
export function isDuplicate(deal: ScrapedDeal | EnrichedDeal, publishedTitles: Set<string>): boolean {
    const normalizedTitle = normalizeTitle('cleanTitle' in deal ? deal.cleanTitle : deal.title);
    return publishedTitles.has(normalizedTitle);
}

// ===== BUGÜNKÜ YAYINLAR =====

/**
 * Bugün kaç fırsat yayınlandığını say
 */
export async function getTodayPublishCount(): Promise<number> {
    try {
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const q = query(
            collection(db, 'discounts'),
            where('createdAt', '>=', Timestamp.fromDate(today)),
            where('originalSource', '==', 'AutoPublish')
        );

        const snapshot = await getDocs(q);
        return snapshot.size;
    } catch (error) {
        console.error('Bugünkü yayın sayısı alınamadı:', error);
        return 0;
    }
}

// ===== LOG =====

/**
 * Otomatik yayınlama log'u kaydet
 */
async function saveAutoPublishLog(result: AutoPublishResult): Promise<void> {
    try {
        await addDoc(collection(db, 'autoPublishLogs'), {
            timestamp: serverTimestamp(),
            dealsProcessed: result.processed,
            dealsPublished: result.published,
            dealsSkipped: result.skipped,
            errors: result.errors,
            publishedDeals: result.publishedDeals.map(d => d.cleanTitle || d.title)
        });
    } catch (error) {
        console.error('Log kaydedilemedi:', error);
    }
}

/**
 * Son log'ları getir
 */
export async function getRecentLogs(count: number = 10): Promise<AutoPublishLog[]> {
    try {
        const q = query(
            collection(db, 'autoPublishLogs'),
            orderBy('timestamp', 'desc'),
            limit(count)
        );

        const snapshot = await getDocs(q);
        return snapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data()
        })) as AutoPublishLog[];
    } catch (error) {
        console.error('Loglar alınamadı:', error);
        return [];
    }
}

// ===== REVIEW QUEUE =====

/**
 * Düzenleme bekleyen ilanları getir
 */
export async function getDealsNeedingReview(): Promise<(Discount & { id: string })[]> {
    try {
        const q = query(
            collection(db, 'discounts'),
            where('needsReview', '==', true),
            orderBy('createdAt', 'desc'),
            limit(50)
        );

        const snapshot = await getDocs(q);
        return snapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data()
        })) as (Discount & { id: string })[];
    } catch (error) {
        console.error('Review bekleyen ilanlar alınamadı:', error);
        return [];
    }
}

/**
 * İlanı incelendi olarak işaretle
 */
export async function markAsReviewed(discountId: string): Promise<void> {
    const docRef = doc(db, 'discounts', discountId);
    await updateDoc(docRef, { needsReview: false });
}

// ===== ANA FONKSİYON =====

/**
 * Otomatik yayınlama çalıştır
 * Telegram'dan çek → AI ile zenginleştir → Yayınla
 */
export async function runAutoPublish(channelId: string = 'onual'): Promise<AutoPublishResult> {
    const result: AutoPublishResult = {
        success: false,
        processed: 0,
        published: 0,
        skipped: 0,
        errors: [],
        publishedDeals: []
    };

    try {
        // 1. Ayarları kontrol et
        const settings = await getAutoPublishSettings();

        if (!settings.isActive) {
            console.log('⏸️ Otomatik yayınlama devre dışı');
            result.errors.push('Otomatik yayınlama devre dışı');
            return result;
        }

        // 2. Günlük limit kontrolü
        const todayCount = await getTodayPublishCount();
        if (todayCount >= settings.maxDailyPublish) {
            console.log(`🚫 Günlük limit aşıldı: ${todayCount}/${settings.maxDailyPublish}`);
            result.errors.push(`Günlük limit aşıldı: ${todayCount}/${settings.maxDailyPublish}`);
            return result;
        }

        const remainingSlots = settings.maxDailyPublish - todayCount;

        // 3. Telegram'dan fırsatları çek
        console.log('📱 Telegram\'dan fırsatlar çekiliyor...');
        const deals = await fetchDealsFromChannel(channelId, true);

        if (deals.length === 0) {
            console.log('📭 Yeni fırsat bulunamadı');
            return result;
        }

        console.log(`📦 ${deals.length} fırsat bulundu`);

        // 4. Yayınlanmış başlıkları al (duplicate kontrolü için)
        const publishedTitles = await getRecentPublishedTitles();

        // 5. Duplicate'leri filtrele
        const newDeals = deals.filter(deal => !isDuplicate(deal, publishedTitles));

        if (newDeals.length === 0) {
            console.log('🔄 Tüm fırsatlar zaten yayınlanmış');
            result.skipped = deals.length;
            return result;
        }

        console.log(`🆕 ${newDeals.length} yeni fırsat (${deals.length - newDeals.length} duplicate atlandı)`);

        // 6. Limit kadar fırsatı işle
        const dealsToProcess = newDeals.slice(0, Math.min(remainingSlots, 10)); // Max 10 fırsat/çağrı
        result.processed = dealsToProcess.length;

        // 7. AI ile zenginleştir
        console.log('🤖 AI ile zenginleştiriliyor...');
        const enrichedDeals = await batchEnrichDeals(dealsToProcess);

        // 8. Her fırsatı yayınla
        for (const deal of enrichedDeals) {
            const { canPublish, reason } = canAutoPublish(deal);

            if (!canPublish) {
                console.log(`⏭️ Atlandı: ${deal.cleanTitle} - ${reason}`);
                result.skipped++;
                continue;
            }

            try {
                // Görseli ImgBB'ye yükle
                let imageUrl = deal.imageUrl || '';
                let deleteUrl = '';

                if (deal.imageUrl) {
                    try {
                        const imgResult = await uploadImageFromUrl(deal.imageUrl);
                        if (imgResult) {
                            imageUrl = imgResult.downloadURL;
                            deleteUrl = imgResult.deleteUrl;
                        }
                    } catch (imgError) {
                        console.warn('Görsel yüklenemedi:', imgError);
                    }
                }

                // Firebase'e kaydet - needsReview: true ile
                // Gerçek ürün linkini çözümle
                let finalLink = deal.productLink || deal.onualLink;
                if (finalLink.includes('onu.al')) {
                    try {
                        const resolved = await resolveOnuAlLink(finalLink);
                        if (resolved && !resolved.includes('onu.al')) {
                            finalLink = resolved;
                        }
                    } catch (e) {
                        console.warn('Link çözümlenemedi:', e);
                    }
                }

                await addDoc(collection(db, 'discounts'), {
                    title: deal.cleanTitle,
                    description: deal.description || (deal.couponCode ? `🎫 Kupon: ${deal.couponCode}` : ''),
                    brand: deal.brand,
                    category: deal.category,
                    link: finalLink,
                    oldPrice: 0,
                    newPrice: deal.price,
                    imageUrl,
                    deleteUrl,
                    submittedBy: 'AI AutoPublish',
                    originalSource: 'AutoPublish',
                    affiliateLinkUpdated: false,
                    aiConfidenceScore: deal.confidenceScore,
                    needsReview: true, // Manuel düzenleme için işaretle
                    createdAt: serverTimestamp()
                });

                result.published++;
                result.publishedDeals.push(deal);
                console.log(`✅ Yayınlandı: ${deal.cleanTitle}`);

                // Rate limiting
                await new Promise(r => setTimeout(r, 500));

            } catch (publishError: any) {
                console.error(`❌ Yayınlama hatası: ${deal.cleanTitle}`, publishError);
                result.errors.push(`${deal.cleanTitle}: ${publishError.message}`);
            }
        }

        result.success = true;

        // Log kaydet
        await saveAutoPublishLog(result);

        console.log(`📊 Sonuç: ${result.published} yayınlandı, ${result.skipped} atlandı`);

    } catch (error: any) {
        console.error('❌ Otomatik yayınlama hatası:', error);
        result.errors.push(error.message);
    }

    return result;
}
