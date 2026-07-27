
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { getRecentDiscounts, getProductFeedbackMap, saveProductFeedback, deleteProductFeedback } from '../services/firebase';
import type { Discount, ProductFeedback as ProductFeedbackType } from '../types';
import { useToast } from './ToastProvider';

type RatingFilter = 'all' | 'rated' | 'unrated' | 'positive' | 'negative';

const formatPrice = (price: number) =>
    Math.floor(price).toLocaleString('tr-TR', { minimumFractionDigits: 0, maximumFractionDigits: 0 });

interface FeedbackCardProps {
    discount: Discount;
    feedback: ProductFeedbackType | undefined;
    onSaved: (discountId: string, feedback: ProductFeedbackType | null) => void;
}

const FeedbackCard: React.FC<FeedbackCardProps> = ({ discount, feedback, onSaved }) => {
    const { showToast } = useToast();
    const [rating, setRating] = useState<'positive' | 'negative' | null>(feedback?.rating ?? null);
    const [reason, setReason] = useState(feedback?.reason || '');
    const [isSaving, setIsSaving] = useState(false);
    const [showReasonBox, setShowReasonBox] = useState(!!feedback?.reason);
    const [isSavingReason, setIsSavingReason] = useState(false);
    const [reasonJustSaved, setReasonJustSaved] = useState(false);

    // Firestore'dan gelen feedback değişirse (ör. sayfa filtre değişince yeniden yüklendiğinde) senkronize et
    useEffect(() => {
        setRating(feedback?.rating ?? null);
        setReason(feedback?.reason || '');
        setShowReasonBox(!!feedback?.reason);
    }, [feedback]);

    const reasonDirty = reason.trim() !== (feedback?.reason || '').trim();

    const handleRate = async (next: 'positive' | 'negative') => {
        if (isSaving) return;
        // Aynı butona tekrar basınca değerlendirmeyi kaldır (geri al)
        if (rating === next) {
            setIsSaving(true);
            try {
                await deleteProductFeedback(discount.id);
                setRating(null);
                setReason('');
                setShowReasonBox(false);
                onSaved(discount.id, null);
                showToast('Değerlendirme kaldırıldı.', 'success');
            } catch {
                showToast('İşlem başarısız oldu.', 'error');
            } finally {
                setIsSaving(false);
            }
            return;
        }
        setRating(next);
        setIsSaving(true);
        try {
            await saveProductFeedback(discount, next, reason);
            onSaved(discount.id, {
                id: discount.id, discountId: discount.id, rating: next, reason,
                title: discount.title, brand: discount.brand, category: discount.category,
                storeName: discount.storeName, oldPrice: discount.oldPrice, newPrice: discount.newPrice,
                imageUrl: discount.imageUrl, link: discount.link,
                ratedAt: feedback?.ratedAt as any, updatedAt: undefined,
            });
            showToast(next === 'positive' ? '👍 Kaydedildi' : '👎 Kaydedildi', 'success');
        } catch {
            showToast('Değerlendirme kaydedilemedi.', 'error');
            setRating(feedback?.rating ?? null);
        } finally {
            setIsSaving(false);
        }
    };

    const handleReasonSave = async () => {
        if (!rating || isSavingReason) return;
        if (reason.trim() === (feedback?.reason || '').trim()) return;
        setIsSavingReason(true);
        try {
            await saveProductFeedback(discount, rating, reason);
            onSaved(discount.id, {
                id: discount.id, discountId: discount.id, rating, reason,
                title: discount.title, brand: discount.brand, category: discount.category,
                storeName: discount.storeName, oldPrice: discount.oldPrice, newPrice: discount.newPrice,
                imageUrl: discount.imageUrl, link: discount.link,
                ratedAt: feedback?.ratedAt as any, updatedAt: undefined,
            });
            showToast('Sebep kaydedildi.', 'success');
            setReasonJustSaved(true);
            setTimeout(() => setReasonJustSaved(false), 2500);
        } catch {
            showToast('Sebep kaydedilemedi.', 'error');
        } finally {
            setIsSavingReason(false);
        }
    };

    return (
        <div className={`bg-gray-800 rounded-xl overflow-hidden border flex flex-col ${
            rating === 'positive' ? 'border-green-600/60' : rating === 'negative' ? 'border-red-600/60' : 'border-gray-700'
        }`}>
            <div className="relative aspect-square w-full bg-gray-900">
                <img src={discount.imageUrl} alt={discount.title} className="absolute inset-0 w-full h-full object-cover" loading="lazy" />
                {discount.oldPrice > 0 && discount.newPrice > 0 && (
                    <span className="absolute top-1.5 right-1.5 bg-orange-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded">
                        %{Math.round(((discount.oldPrice - discount.newPrice) / discount.oldPrice) * 100)}
                    </span>
                )}
            </div>

            <div className="p-2.5 flex flex-col flex-1 gap-1">
                {(discount.category || discount.brand) && (
                    <p className="text-[10px] text-orange-400 font-bold uppercase tracking-wide truncate">
                        {[discount.category, discount.brand].filter(Boolean).join(' · ')}
                    </p>
                )}
                <p className="text-sm font-semibold text-white leading-tight line-clamp-2 flex-1">{discount.title}</p>
                <div className="flex items-center gap-1.5 mt-1">
                    {discount.oldPrice > 0 && <span className="text-xs text-gray-500 line-through">{formatPrice(discount.oldPrice)}₺</span>}
                    <span className="text-sm font-extrabold text-orange-400">{formatPrice(discount.newPrice)}₺</span>
                </div>
            </div>

            <div className="border-t border-gray-700 p-2 flex flex-col gap-2">
                <div className="flex gap-2">
                    <button
                        type="button"
                        disabled={isSaving}
                        onClick={() => handleRate('positive')}
                        className={`flex-1 py-2 rounded-lg text-sm font-bold transition-colors disabled:opacity-50 ${
                            rating === 'positive' ? 'bg-green-600 text-white' : 'bg-gray-700 text-gray-300 hover:bg-green-900/40 hover:text-green-300'
                        }`}
                    >
                        👍 Beğendim
                    </button>
                    <button
                        type="button"
                        disabled={isSaving}
                        onClick={() => handleRate('negative')}
                        className={`flex-1 py-2 rounded-lg text-sm font-bold transition-colors disabled:opacity-50 ${
                            rating === 'negative' ? 'bg-red-600 text-white' : 'bg-gray-700 text-gray-300 hover:bg-red-900/40 hover:text-red-300'
                        }`}
                    >
                        👎 Beğenmedim
                    </button>
                </div>

                {rating && !showReasonBox && (
                    <button
                        type="button"
                        onClick={() => setShowReasonBox(true)}
                        className="text-xs text-gray-500 hover:text-gray-300 text-left"
                    >
                        + Sebep ekle (opsiyonel)
                    </button>
                )}
                {rating && showReasonBox && (
                    <div className="flex flex-col gap-1">
                        <textarea
                            value={reason}
                            onChange={(e) => { setReason(e.target.value); setReasonJustSaved(false); }}
                            onBlur={handleReasonSave}
                            placeholder={rating === 'positive' ? 'Neden beğendin? (opsiyonel)' : 'Neden yayınlanmamalıydı? (opsiyonel)'}
                            rows={2}
                            className="w-full bg-gray-900 border border-gray-700 rounded-lg px-2 py-1.5 text-xs text-gray-200 resize-none focus:outline-none focus:border-blue-500"
                        />
                        <div className="flex items-center justify-between gap-2">
                            {reasonJustSaved ? (
                                <span className="text-[11px] text-green-400 font-semibold">✓ Kaydedildi</span>
                            ) : <span />}
                            <button
                                type="button"
                                disabled={!reasonDirty || isSavingReason}
                                onClick={handleReasonSave}
                                className="text-[11px] font-bold px-2.5 py-1 rounded-md bg-blue-600 text-white disabled:opacity-40 disabled:cursor-not-allowed hover:bg-blue-500 transition-colors"
                            >
                                {isSavingReason ? 'Kaydediliyor…' : 'Kaydet'}
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

const ProductFeedback: React.FC = () => {
    const [discounts, setDiscounts] = useState<Discount[]>([]);
    const [feedbackMap, setFeedbackMap] = useState<Map<string, ProductFeedbackType>>(new Map());
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [searchQuery, setSearchQuery] = useState('');
    const [ratingFilter, setRatingFilter] = useState<RatingFilter>('all');

    const load = useCallback(async () => {
        setIsLoading(true);
        setError(null);
        try {
            const list = (await getRecentDiscounts(3)).filter(d => !d.isAd);
            setDiscounts(list);
            const map = await getProductFeedbackMap(list.map(d => d.id));
            setFeedbackMap(map);
        } catch {
            setError('Ürünler yüklenemedi.');
        } finally {
            setIsLoading(false);
        }
    }, []);

    useEffect(() => { load(); }, [load]);

    const handleSaved = useCallback((discountId: string, feedback: ProductFeedbackType | null) => {
        setFeedbackMap(prev => {
            const next = new Map(prev);
            if (feedback) next.set(discountId, feedback);
            else next.delete(discountId);
            return next;
        });
    }, []);

    const filtered = useMemo(() => {
        let result = discounts;
        switch (ratingFilter) {
            case 'rated':    result = result.filter(d => feedbackMap.has(d.id)); break;
            case 'unrated':  result = result.filter(d => !feedbackMap.has(d.id)); break;
            case 'positive': result = result.filter(d => feedbackMap.get(d.id)?.rating === 'positive'); break;
            case 'negative': result = result.filter(d => feedbackMap.get(d.id)?.rating === 'negative'); break;
        }
        if (searchQuery.trim()) {
            const q = searchQuery.toLowerCase().trim();
            result = result.filter(d =>
                d.title?.toLowerCase().includes(q) ||
                d.brand?.toLowerCase().includes(q) ||
                d.category?.toLowerCase().includes(q)
            );
        }
        return result;
    }, [discounts, feedbackMap, ratingFilter, searchQuery]);

    const ratedCount = discounts.filter(d => feedbackMap.has(d.id)).length;
    const positiveCount = discounts.filter(d => feedbackMap.get(d.id)?.rating === 'positive').length;
    const negativeCount = discounts.filter(d => feedbackMap.get(d.id)?.rating === 'negative').length;

    const filterButtons: { id: RatingFilter; label: string; count: number }[] = [
        { id: 'all',      label: 'Tümü',          count: discounts.length },
        { id: 'unrated',  label: 'Değerlendirilmemiş', count: discounts.length - ratedCount },
        { id: 'rated',    label: 'Değerlendirilmiş',   count: ratedCount },
        { id: 'positive', label: '👍 Beğenilen',   count: positiveCount },
        { id: 'negative', label: '👎 Beğenilmeyen', count: negativeCount },
    ];

    return (
        <div>
            <div className="mb-6">
                <h2 className="text-3xl font-bold text-white">Ürün Değerlendirme</h2>
                <p className="text-sm text-gray-400 mt-1">
                    Yayınlanan ürünleri beğen/beğenme — bu değerlendirmeler, gelecekte AI'nın benzer ürünleri
                    değerlendirmesi için eğitim verisi olarak kullanılacak.
                </p>
            </div>

            <div className="flex flex-wrap gap-2 mb-4">
                {filterButtons.map(btn => (
                    <button
                        key={btn.id}
                        onClick={() => setRatingFilter(btn.id)}
                        className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${
                            ratingFilter === btn.id ? 'bg-blue-600 text-white' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
                        }`}
                    >
                        {btn.label} ({btn.count})
                    </button>
                ))}
            </div>

            <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Ürün, marka veya kategori ara..."
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 mb-6 focus:outline-none focus:border-blue-500"
            />

            {isLoading ? (
                <div className="flex justify-center py-24">
                    <div className="w-6 h-6 border-2 border-gray-600 border-t-blue-500 rounded-full animate-spin" />
                </div>
            ) : error ? (
                <p className="text-red-400 text-center py-12">{error}</p>
            ) : filtered.length === 0 ? (
                <p className="text-gray-500 text-center py-12">Bu filtreye uyan ürün yok.</p>
            ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
                    {filtered.map(d => (
                        <FeedbackCard key={d.id} discount={d} feedback={feedbackMap.get(d.id)} onSaved={handleSaved} />
                    ))}
                </div>
            )}
        </div>
    );
};

export default ProductFeedback;
