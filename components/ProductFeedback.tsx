
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { getDiscountsPage, getProductFeedbackMap, saveProductFeedback, deleteProductFeedback } from '../services/firebase';
import type { Discount, ProductFeedback as ProductFeedbackType } from '../types';
import { useToast } from './ToastProvider';
import type { QueryDocumentSnapshot, DocumentData } from 'firebase/firestore';

const PAGE_SIZE = 6;
// Kuyrukta bu kadar veya daha az ürün kalınca sessizce bir sayfa daha çekilir
// — kullanıcı butona basmadan "Tinder" akışı asla durmasın.
const PREFETCH_THRESHOLD = 2;

const formatPrice = (price: number) =>
    Math.floor(price).toLocaleString('tr-TR', { minimumFractionDigits: 0, maximumFractionDigits: 0 });

interface SwipeCardProps {
    discount: Discount;
    feedback: ProductFeedbackType | undefined;
    onAdvance: (discountId: string, feedback: ProductFeedbackType | null) => void;
}

const SwipeCard: React.FC<SwipeCardProps> = ({ discount, feedback, onAdvance }) => {
    const { showToast } = useToast();
    const [rating, setRating] = useState<'positive' | 'negative' | null>(feedback?.rating ?? null);
    const [reason, setReason] = useState(feedback?.reason || '');
    const [isSaving, setIsSaving] = useState(false);

    // NOT: Kart bileşeni her ürün için parent'ta key={discount.id} ile
    // yeniden mount ediliyor, bu yüzden yukarıdaki useState başlangıç
    // değerleri her yeni kart için doğru şekilde sıfırlanıyor. `feedback`
    // prop'una bağlı bir senkronizasyon effect'i BİLEREK yok — handleRate'in
    // optimistic güncellemesi parent'ta yeni bir `feedback` referansı
    // üretiyor; buna bağlı bir effect, kullanıcı sebep kutusuna yazarken
    // (kart değişmemişken) yazdığını sessizce silerdi.

    const persist = async (nextRating: 'positive' | 'negative') => {
        await saveProductFeedback(discount, nextRating, reason);
        return {
            id: discount.id, discountId: discount.id, rating: nextRating, reason,
            title: discount.title, brand: discount.brand, category: discount.category,
            storeName: discount.storeName, oldPrice: discount.oldPrice, newPrice: discount.newPrice,
            imageUrl: discount.imageUrl, link: discount.link,
            ratedAt: feedback?.ratedAt as any, updatedAt: undefined,
        } as ProductFeedbackType;
    };

    const handleRate = async (next: 'positive' | 'negative') => {
        if (isSaving) return;
        setIsSaving(true);
        try {
            const saved = await persist(next);
            setRating(next);
            showToast(next === 'positive' ? '👍 Kaydedildi' : '👎 Kaydedildi', 'success');
            // Sadece rating'i güncelle; ekrandan çıkmadan (sebep yazma imkanı kalsın)
            onAdvance('__update__' as any, saved as any);
        } catch {
            showToast('Değerlendirme kaydedilemedi.', 'error');
        } finally {
            setIsSaving(false);
        }
    };

    const handleSaveAndNext = async () => {
        if (isSaving) return;
        setIsSaving(true);
        try {
            if (rating) {
                const saved = await persist(rating);
                onAdvance(discount.id, saved);
            } else {
                onAdvance(discount.id, feedback ?? null);
            }
        } catch {
            showToast('Kaydedilemedi.', 'error');
        } finally {
            setIsSaving(false);
        }
    };

    const handleSkip = () => {
        if (isSaving) return;
        onAdvance(discount.id, feedback ?? null);
    };

    const handleClear = async () => {
        if (isSaving) return;
        setIsSaving(true);
        try {
            await deleteProductFeedback(discount.id);
            setRating(null);
            setReason('');
            onAdvance(discount.id, null);
            showToast('Değerlendirme kaldırıldı.', 'success');
        } catch {
            showToast('İşlem başarısız oldu.', 'error');
        } finally {
            setIsSaving(false);
        }
    };

    const discountPct = discount.oldPrice > 0 && discount.newPrice > 0
        ? Math.round(((discount.oldPrice - discount.newPrice) / discount.oldPrice) * 100)
        : 0;

    return (
        <div className={`w-full max-w-md mx-auto bg-gray-800 rounded-2xl overflow-hidden border-2 transition-colors ${
            rating === 'positive' ? 'border-green-600/70' : rating === 'negative' ? 'border-red-600/70' : 'border-gray-700'
        }`}>
            <div className="relative aspect-square w-full bg-gray-900">
                <img src={discount.imageUrl} alt={discount.title} className="absolute inset-0 w-full h-full object-cover" />
                {discountPct > 0 && (
                    <span className="absolute top-3 right-3 bg-orange-500 text-white text-sm font-bold px-2.5 py-1 rounded-lg shadow">
                        %{discountPct}
                    </span>
                )}
                {rating && (
                    <span className={`absolute top-3 left-3 text-white text-sm font-bold px-2.5 py-1 rounded-lg shadow ${
                        rating === 'positive' ? 'bg-green-600' : 'bg-red-600'
                    }`}>
                        {rating === 'positive' ? '👍 Beğenildi' : '👎 Beğenilmedi'}
                    </span>
                )}
            </div>

            <div className="p-4 flex flex-col gap-1.5">
                {(discount.category || discount.brand) && (
                    <p className="text-xs text-orange-400 font-bold uppercase tracking-wide truncate">
                        {[discount.category, discount.brand, discount.storeName].filter(Boolean).join(' · ')}
                    </p>
                )}
                {discount.aiSimilarityJudgment && discount.aiSimilarityJudgment.decision !== 'unknown' && discount.aiSimilarityJudgment.matchCount > 0 && (
                    <p className="text-[11px] text-gray-500">
                        🤖 AI önerisi: {discount.aiSimilarityJudgment.decision === 'positive' ? '👍 benzerdi beğenmiştin' : '👎 benzerini beğenmemiştin'}
                        {' '}({discount.aiSimilarityJudgment.matchCount} benzer üründen — sadece öneri, kararı sen veriyorsun)
                    </p>
                )}
                <p className="text-base font-semibold text-white leading-snug">{discount.title}</p>
                <div className="flex items-center gap-2 mt-1">
                    {discount.oldPrice > 0 && <span className="text-sm text-gray-500 line-through">{formatPrice(discount.oldPrice)}₺</span>}
                    <span className="text-lg font-extrabold text-orange-400">{formatPrice(discount.newPrice)}₺</span>
                </div>
            </div>

            <div className="border-t border-gray-700 p-4 flex flex-col gap-3">
                <div className="flex gap-3">
                    <button
                        type="button"
                        disabled={isSaving}
                        onClick={() => handleRate('negative')}
                        className={`flex-1 py-3.5 rounded-xl text-base font-bold transition-colors disabled:opacity-50 ${
                            rating === 'negative' ? 'bg-red-600 text-white' : 'bg-gray-700 text-gray-300 hover:bg-red-900/40 hover:text-red-300'
                        }`}
                    >
                        👎 Beğenmedim
                    </button>
                    <button
                        type="button"
                        disabled={isSaving}
                        onClick={() => handleRate('positive')}
                        className={`flex-1 py-3.5 rounded-xl text-base font-bold transition-colors disabled:opacity-50 ${
                            rating === 'positive' ? 'bg-green-600 text-white' : 'bg-gray-700 text-gray-300 hover:bg-green-900/40 hover:text-green-300'
                        }`}
                    >
                        👍 Beğendim
                    </button>
                </div>

                {rating && (
                    <textarea
                        value={reason}
                        onChange={(e) => setReason(e.target.value)}
                        placeholder={rating === 'positive' ? 'Neden beğendin? (opsiyonel)' : 'Neden yayınlanmamalıydı? (opsiyonel)'}
                        rows={2}
                        className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 resize-none focus:outline-none focus:border-blue-500"
                    />
                )}

                <div className="flex items-center gap-2">
                    {rating && (
                        <button
                            type="button"
                            onClick={handleClear}
                            disabled={isSaving}
                            className="text-xs text-gray-500 hover:text-gray-300 disabled:opacity-50 shrink-0"
                        >
                            Kaldır
                        </button>
                    )}
                    <div className="flex-1" />
                    <button
                        type="button"
                        onClick={handleSkip}
                        disabled={isSaving}
                        className="px-4 py-2.5 rounded-xl text-sm font-bold bg-gray-700 text-gray-300 hover:bg-gray-600 disabled:opacity-50 transition-colors"
                    >
                        Atla
                    </button>
                    <button
                        type="button"
                        onClick={handleSaveAndNext}
                        disabled={isSaving || !rating}
                        className="px-5 py-2.5 rounded-xl text-sm font-bold bg-blue-600 text-white hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                    >
                        {isSaving ? 'Kaydediliyor…' : 'Kaydet ve İleri →'}
                    </button>
                </div>
            </div>
        </div>
    );
};

const ProductFeedback: React.FC = () => {
    const [discounts, setDiscounts] = useState<Discount[]>([]);
    const [feedbackMap, setFeedbackMap] = useState<Map<string, ProductFeedbackType>>(new Map());
    const [currentIndex, setCurrentIndex] = useState(0);
    const [isLoading, setIsLoading] = useState(true);
    const [isFetchingMore, setIsFetchingMore] = useState(false);
    const [hasMore, setHasMore] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const cursorRef = useRef<QueryDocumentSnapshot<DocumentData> | null>(null);
    const [sessionPositive, setSessionPositive] = useState(0);
    const [sessionNegative, setSessionNegative] = useState(0);

    // Reklamlar (isAd) VE daha önce (bu oturumda veya geçmiş bir oturumda)
    // zaten değerlendirilmiş ürünler kuyruğa hiç girmiyor — kullanıcı isteği:
    // "değerlendirdiğim ürünler tekrar önüme çıkmamalı". Bir sayfa tamamen
    // reklam/değerlendirilmişten oluşursa kuyruk boş görünmesin diye otomatik
    // bir sonraki sayfayla tamamlanıyor (en fazla 5 tur, sonsuz döngü olmasın).
    const fetchPage = useCallback(async (): Promise<void> => {
        let addedAny = false;
        for (let attempt = 0; attempt < 5 && !addedAny; attempt++) {
            const { discounts: items, lastDoc, hasMore: more } = await getDiscountsPage(PAGE_SIZE, cursorRef.current);
            cursorRef.current = lastDoc;
            setHasMore(more);
            const nonAd = items.filter(d => !d.isAd);
            if (nonAd.length > 0) {
                const map = await getProductFeedbackMap(nonAd.map(d => d.id));
                const unrated = nonAd.filter(d => !map.has(d.id));
                if (unrated.length > 0) {
                    addedAny = true;
                    setDiscounts(prev => [...prev, ...unrated]);
                }
            }
            if (!more) break;
        }
    }, []);

    const load = useCallback(async () => {
        setIsLoading(true);
        setError(null);
        setDiscounts([]);
        setFeedbackMap(new Map());
        setCurrentIndex(0);
        setSessionPositive(0);
        setSessionNegative(0);
        cursorRef.current = null;
        setHasMore(true);
        try {
            await fetchPage();
        } catch {
            setError('Ürünler yüklenemedi.');
        } finally {
            setIsLoading(false);
        }
    }, [fetchPage]);

    useEffect(() => { load(); }, [load]);

    // Kuyrukta az ürün kalınca sessizce arkadan yenisini çek — "Tinder" akışı
    // kullanıcı elle bir şey yapmadan devam etsin.
    useEffect(() => {
        if (isLoading || isFetchingMore || !hasMore) return;
        if (discounts.length - currentIndex > PREFETCH_THRESHOLD) return;
        setIsFetchingMore(true);
        fetchPage().finally(() => setIsFetchingMore(false));
    }, [currentIndex, discounts.length, hasMore, isLoading, isFetchingMore, fetchPage]);

    const handleAdvance = useCallback((discountId: string, feedback: ProductFeedbackType | null) => {
        const isUpdateOnly = discountId === '__update__';
        setFeedbackMap(prev => {
            const next = new Map(prev);
            const id = isUpdateOnly ? feedback?.discountId : discountId;
            if (id) {
                if (feedback) next.set(id, feedback); else next.delete(id);
            }
            return next;
        });
        if (isUpdateOnly) return; // sadece rating güncellendi, kart değişmedi (kullanıcı sebep yazabilsin)
        if (feedback?.rating === 'positive') setSessionPositive(v => v + 1);
        else if (feedback?.rating === 'negative') setSessionNegative(v => v + 1);
        setCurrentIndex(i => i + 1);
    }, []);

    const current = discounts[currentIndex];
    const totalRatedThisSession = sessionPositive + sessionNegative;

    return (
        <div>
            <div className="mb-6 text-center">
                <h2 className="text-3xl font-bold text-white">Ürün Değerlendirme</h2>
                <p className="text-sm text-gray-400 mt-1">
                    Yayınlanan ürünleri tek tek beğen/beğenme — bu değerlendirmeler, gelecekte AI'nın benzer
                    ürünleri değerlendirmesi için eğitim verisi olarak kullanılacak.
                </p>
                {totalRatedThisSession > 0 && (
                    <p className="text-xs text-gray-500 mt-1">
                        Bu oturumda: 👍 {sessionPositive} · 👎 {sessionNegative}
                    </p>
                )}
            </div>

            {isLoading ? (
                <div className="flex justify-center py-24">
                    <div className="w-6 h-6 border-2 border-gray-600 border-t-blue-500 rounded-full animate-spin" />
                </div>
            ) : error ? (
                <p className="text-red-400 text-center py-12">{error}</p>
            ) : current ? (
                <SwipeCard key={current.id} discount={current} feedback={feedbackMap.get(current.id)} onAdvance={handleAdvance} />
            ) : hasMore || isFetchingMore ? (
                <div className="flex justify-center py-24">
                    <div className="w-6 h-6 border-2 border-gray-600 border-t-blue-500 rounded-full animate-spin" />
                </div>
            ) : (
                <div className="text-center py-24">
                    <p className="text-4xl mb-3">🎉</p>
                    <p className="text-gray-300 font-semibold">Yayınlanan tüm ürünleri değerlendirdin.</p>
                    <button
                        type="button"
                        onClick={load}
                        className="mt-4 px-4 py-2 rounded-lg text-sm font-bold bg-gray-800 text-gray-300 hover:bg-gray-700 transition-colors"
                    >
                        Baştan Başla
                    </button>
                </div>
            )}
        </div>
    );
};

export default ProductFeedback;
