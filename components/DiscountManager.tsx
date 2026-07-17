import React, { useState, useEffect, useCallback, useRef } from 'react';
import { getDiscountsPage, deleteDiscount, DiscountsPage } from '../services/firebase';
import type { Discount, ViewType } from '../types';
import EditDiscountModal from './EditDiscountModal';
import type { QueryDocumentSnapshot, DocumentData } from 'firebase/firestore';

const PAGE_SIZE = 6;

// ─── Kart Bileşeni ────────────────────────────────────────────────────────────
interface CardProps {
    d: Discount;
    pct: number;
    isExpired: boolean;
    onEdit: () => void;
    onDelete: () => Promise<void>;
}

const DiscountCard: React.FC<CardProps> = ({ d, pct, isExpired, onEdit, onDelete }) => {
    const [isDeleting, setIsDeleting] = useState(false);

    const handleDelete = async (e: React.MouseEvent) => {
        e.stopPropagation();
        if (isDeleting) return;
        setIsDeleting(true);
        try {
            await onDelete();
        } catch {
            setIsDeleting(false);
        }
    };

    const formatPrice = (p: number) =>
        Math.floor(p).toLocaleString('tr-TR', { minimumFractionDigits: 0, maximumFractionDigits: 0 });

    return (
        <div className={`bg-gray-800 rounded-2xl overflow-hidden border flex flex-col transition-all ${isExpired ? 'border-red-800/50 opacity-70' : d.isAd ? 'border-yellow-500/40' : 'border-gray-700'} ${isDeleting ? 'opacity-30 pointer-events-none' : ''}`}>
            {/* Görsel — kare */}
            <div className="relative aspect-square w-full bg-gray-900">
                <img
                    src={d.imageUrl}
                    alt={d.title}
                    className="absolute inset-0 w-full h-full object-cover"
                    onError={e => { (e.target as HTMLImageElement).src = 'https://placehold.co/400x400/1f2937/6b7280?text=Görsel'; }}
                />
                {/* İndirim rozeti */}
                {pct > 0 && (
                    <span className="absolute top-2 left-2 bg-orange-500 text-white text-[10px] font-black px-1.5 py-0.5 rounded-lg">
                        %{pct} İND
                    </span>
                )}
                {d.isAd && (
                    <span className="absolute top-2 left-2 bg-yellow-400 text-yellow-900 text-[9px] font-extrabold px-1.5 py-0.5 rounded uppercase">
                        REKLAM
                    </span>
                )}
                {/* İndirim bitti overlay */}
                {isExpired && (
                    <div className="absolute inset-0 bg-black/55 flex items-center justify-center">
                        <span className="text-red-400 text-[10px] font-extrabold uppercase tracking-wide border border-red-500/60 px-2 py-1 rounded">
                            İndirim Bitti
                        </span>
                    </div>
                )}
                {/* Zaman rozeti */}
                <span className="absolute bottom-1.5 right-2 text-[10px] text-gray-300 bg-black/60 px-1.5 py-0.5 rounded">
                    {timeAgo(d.createdAt)}
                </span>
            </div>

            {/* İçerik */}
            <div className="p-2.5 flex flex-col flex-1">
                <p className="text-[11px] text-orange-400 font-semibold truncate">
                    {[d.category, d.brand].filter(Boolean).join(' · ')}
                </p>
                <p className="text-white text-[13px] font-bold leading-tight line-clamp-2 mt-0.5 flex-1">
                    {d.title}
                </p>
                <div className="flex items-center gap-1.5 mt-1.5">
                    {d.isAd ? (
                        <span className="text-xs text-gray-400 italic">Sponsorlu</span>
                    ) : (
                        <>
                            {d.oldPrice > 0 && (
                                <span className="text-gray-500 line-through text-[11px]">{formatPrice(d.oldPrice)}₺</span>
                            )}
                            {d.newPrice > 0 && (
                                <span className="text-orange-400 font-extrabold text-sm">{formatPrice(d.newPrice)}₺</span>
                            )}
                        </>
                    )}
                </div>
            </div>

            {/* Aksiyon butonları */}
            <div className="flex border-t border-gray-700 mt-auto">
                <button
                    type="button"
                    onClick={e => { e.stopPropagation(); onEdit(); }}
                    className="flex-1 py-2.5 text-xs font-bold text-indigo-400 hover:bg-indigo-900/30 hover:text-indigo-300 transition-colors flex items-center justify-center gap-1"
                >
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                    </svg>
                    Düzenle
                </button>
                <div className="w-px bg-gray-700" />
                <button
                    type="button"
                    onClick={handleDelete}
                    disabled={isDeleting}
                    className="flex-1 py-2.5 text-xs font-bold text-red-400 hover:bg-red-900/30 hover:text-red-300 transition-colors flex items-center justify-center gap-1 disabled:opacity-40"
                >
                    {isDeleting ? (
                        <div className="w-3.5 h-3.5 border-2 border-red-400/30 border-t-red-400 rounded-full animate-spin" />
                    ) : (
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                    )}
                    Sil
                </button>
            </div>
        </div>
    );
};

interface DiscountManagerProps {
    setActiveView: (view: ViewType) => void;
    isAdmin: boolean;
}

const timeAgo = (ts: any): string => {
    if (!ts) return '';
    const ms = typeof ts.toMillis === 'function' ? ts.toMillis() : ts.seconds ? ts.seconds * 1000 : 0;
    if (!ms) return '';
    const diff = Math.floor((Date.now() - ms) / 60000);
    if (diff < 1) return 'Az önce';
    if (diff < 60) return `${diff} dk önce`;
    const h = Math.floor(diff / 60);
    if (h < 24) return `${h} sa önce`;
    return `${Math.floor(h / 24)} gün önce`;
};

const DiscountManager: React.FC<DiscountManagerProps> = ({ setActiveView, isAdmin }) => {
    const [discounts, setDiscounts] = useState<Discount[]>([]);
    const [filtered, setFiltered] = useState<Discount[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isLoadingMore, setIsLoadingMore] = useState(false);
    const [hasMore, setHasMore] = useState(true);
    const [search, setSearch] = useState('');
    const [selectedDiscount, setSelectedDiscount] = useState<Discount | null>(null);
    const lastDocRef = useRef<QueryDocumentSnapshot<DocumentData> | null>(null);
    const sentinelRef = useRef<HTMLDivElement | null>(null);

    // İlk sayfayı yükle (baştan)
    const loadFirstPage = useCallback(async () => {
        setIsLoading(true);
        try {
            const page: DiscountsPage = await getDiscountsPage(PAGE_SIZE, null);
            lastDocRef.current = page.lastDoc;
            setHasMore(page.hasMore);
            setDiscounts(page.discounts);
        } catch {/* sessiz */}
        finally { setIsLoading(false); }
    }, []);

    // Aşağı kaydırınca bir sonraki sayfayı ekle
    const loadMore = useCallback(async () => {
        if (isLoadingMore || !hasMore || !lastDocRef.current) return;
        setIsLoadingMore(true);
        try {
            const page: DiscountsPage = await getDiscountsPage(PAGE_SIZE, lastDocRef.current);
            lastDocRef.current = page.lastDoc;
            setHasMore(page.hasMore);
            setDiscounts(prev => [...prev, ...page.discounts]);
        } catch {/* sessiz */}
        finally { setIsLoadingMore(false); }
    }, [isLoadingMore, hasMore]);

    useEffect(() => { loadFirstPage(); }, [loadFirstPage]);

    // Sayfanın sonuna yaklaşınca otomatik yeni sayfa yükle.
    // NOT: sentinel div'i sadece !isLoading iken render ediliyor (bkz. JSX).
    // İlk yüklemede efekt mount anında çalışıyor ve o an sentinelRef.current
    // hâlâ null oluyor — isLoading bağımlılığı olmadan observer BİR DAHA HİÇ
    // kurulmuyordu (loadMore referansı değişmediği sürece), bu yüzden sonsuz
    // kaydırma hiç tetiklenmiyor ve sadece ilk 6 ilan görünüyordu.
    useEffect(() => {
        const el = sentinelRef.current;
        if (!el) return;
        const observer = new IntersectionObserver(entries => {
            if (entries[0].isIntersecting) loadMore();
        }, { rootMargin: '400px' });
        observer.observe(el);
        return () => observer.disconnect();
    }, [loadMore, isLoading]);

    useEffect(() => {
        const q = search.trim().toLowerCase();
        setFiltered(q ? discounts.filter(d =>
            d.title.toLowerCase().includes(q) ||
            d.brand?.toLowerCase().includes(q)
        ) : discounts);
    }, [search, discounts]);

    const handleSaveSuccess = () => {
        setSelectedDiscount(null);
        loadFirstPage();
    };

    const handleDelete = async (d: Discount) => {
        await deleteDiscount(d.id, d.deleteUrl, d.screenshotDeleteUrl);
        setDiscounts(prev => prev.filter(x => x.id !== d.id));
        setFiltered(prev => prev.filter(x => x.id !== d.id));
        setSelectedDiscount(null);
    };

    return (
        <div>
            {/* Header */}
            <div className="flex items-center justify-between mb-4 gap-3">
                <h2 className="text-2xl font-bold text-white shrink-0">İlanları Düzenle</h2>
                <div className="flex items-center gap-2 shrink-0">
                    <button
                        onClick={() => loadFirstPage()}
                        disabled={isLoading}
                        title="Listeyi yenile"
                        className="flex items-center justify-center bg-gray-700 hover:bg-gray-600 disabled:opacity-50 text-white font-bold w-10 h-10 rounded-xl transition-colors"
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" className={`h-5 w-5 ${isLoading ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                        </svg>
                    </button>
                    <button
                        onClick={() => setActiveView('addDiscount')}
                        className="flex items-center gap-2 bg-green-600 hover:bg-green-500 text-white font-bold px-4 py-2 rounded-xl transition-colors"
                    >
                        <span className="text-lg">➕</span>
                        <span className="text-sm">Yeni İlan</span>
                    </button>
                </div>
            </div>

            {/* Search */}
            <div className="relative mb-4">
                <svg className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
                <input
                    type="text"
                    placeholder="İlan ara..."
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    className="w-full pl-9 pr-4 py-2.5 bg-gray-800 border border-gray-700 rounded-xl text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-orange-500"
                />
            </div>

            {/* Count */}
            {!isLoading && (
                <p className="text-xs text-gray-500 mb-3">{filtered.length} ilan</p>
            )}

            {/* Grid */}
            {isLoading ? (
                <div className="grid grid-cols-2 gap-3">
                    {[...Array(6)].map((_, i) => (
                        <div key={i} className="bg-gray-800 rounded-2xl overflow-hidden animate-pulse">
                            <div className="bg-gray-700 aspect-square w-full" />
                            <div className="p-2.5 space-y-2">
                                <div className="bg-gray-700 h-3 rounded w-3/4" />
                                <div className="bg-gray-700 h-3 rounded w-1/2" />
                            </div>
                        </div>
                    ))}
                </div>
            ) : filtered.length === 0 ? (
                <div className="text-center py-16 text-gray-500">
                    <p className="text-4xl mb-3">📭</p>
                    <p>Sonuç bulunamadı</p>
                </div>
            ) : (
                <div className="grid grid-cols-2 gap-3">
                    {filtered.map(d => {
                        const pct = d.oldPrice > 0 && d.newPrice > 0
                            ? Math.round(((d.oldPrice - d.newPrice) / d.oldPrice) * 100) : 0;
                        const isExpired = d.status === 'İndirim Bitti';
                        return (
                            <DiscountCard
                                key={d.id}
                                d={d}
                                pct={pct}
                                isExpired={isExpired}
                                onEdit={() => setSelectedDiscount(d)}
                                onDelete={() => handleDelete(d)}
                            />
                        );
                    })}
                </div>
            )}

            {/* Sonsuz kaydırma tetikleyici + yükleniyor göstergesi */}
            {!isLoading && !search.trim() && (
                <div ref={sentinelRef} className="py-6 flex justify-center">
                    {isLoadingMore ? (
                        <div className="w-5 h-5 border-2 border-orange-500/30 border-t-orange-500 rounded-full animate-spin" />
                    ) : !hasMore && discounts.length > 0 ? (
                        <p className="text-xs text-gray-600">Tüm ilanlar yüklendi</p>
                    ) : null}
                </div>
            )}

            {/* Edit Modal */}
            {selectedDiscount && (
                <EditDiscountModal
                    discount={selectedDiscount}
                    onClose={() => setSelectedDiscount(null)}
                    onSaveSuccess={handleSaveSuccess}
                    onDelete={handleDelete}
                    isAdmin={isAdmin}
                />
            )}
        </div>
    );
};

export default DiscountManager;
