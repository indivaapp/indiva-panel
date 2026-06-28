
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { getDiscounts, deleteDiscount, deleteExpiredDiscountsBatch } from '../services/firebase';
import type { Discount, ViewType } from '../types';
import EditDiscountModal from './EditDiscountModal';
import { useToast } from './ToastProvider';

// ─── Admin Kart Bileşeni ──────────────────────────────────────────────────────
interface DiscountAdminCardProps {
    discount: Discount;
    onEdit: () => void;
    onDelete: () => void;
}

const DiscountAdminCard: React.FC<DiscountAdminCardProps> = ({ discount, onEdit, onDelete }) => {
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

    const formatPrice = (price: number) =>
        Math.floor(price).toLocaleString('tr-TR', { minimumFractionDigits: 0, maximumFractionDigits: 0 });

    return (
        <div className={`bg-gray-800 rounded-xl overflow-hidden border flex flex-col ${discount.isAd ? 'border-yellow-500/40' : 'border-gray-700'} ${isDeleting ? 'opacity-40 pointer-events-none' : ''}`}>
            {/* Görsel */}
            <div className="relative aspect-square w-full bg-gray-900">
                <img
                    src={discount.imageUrl}
                    alt={discount.title}
                    className="absolute inset-0 w-full h-full object-cover"
                    loading="lazy"
                />
                {/* Üst rozetler */}
                {discount.isAd && (
                    <span className="absolute top-1.5 left-1.5 bg-yellow-400 text-yellow-900 text-[9px] font-extrabold px-1.5 py-0.5 rounded uppercase">
                        REKLAM
                    </span>
                )}
                {discount.status === 'İndirim Bitti' && (
                    <div className="absolute inset-0 bg-black/60 flex flex-col items-center justify-center gap-1">
                        <span className="text-red-400 text-[10px] font-bold uppercase">İndirim Bitti</span>
                        <CountdownTimer expiredAt={discount.expiredAt} />
                    </div>
                )}
                {discount.screenshotUrl && (
                    <span className="absolute bottom-1.5 left-1.5 bg-green-600/90 text-white text-[9px] font-bold px-1.5 py-0.5 rounded">
                        ✔ Kanıtlı
                    </span>
                )}
                <div className="absolute top-1.5 right-1.5">
                    <ExpiryBadge createdAt={discount.createdAt} />
                </div>
            </div>

            {/* İçerik */}
            <div className="p-2.5 flex flex-col flex-1 gap-1">
                {(discount.category || discount.brand) && (
                    <p className="text-[10px] text-orange-400 font-bold uppercase tracking-wide truncate">
                        {[discount.category, discount.brand].filter(Boolean).join(' · ')}
                    </p>
                )}
                <p className="text-sm font-semibold text-white leading-tight line-clamp-2 flex-1">
                    {discount.title}
                </p>
                {/* Fiyat */}
                <div className="flex items-center gap-1.5 mt-1">
                    {discount.isAd ? (
                        <span className="text-xs text-gray-400 italic">Sponsorlu</span>
                    ) : discount.newPrice > 0 ? (
                        <>
                            {discount.oldPrice > 0 && (
                                <span className="text-xs text-gray-500 line-through">{formatPrice(discount.oldPrice)}₺</span>
                            )}
                            <span className="text-sm font-extrabold text-orange-400">{formatPrice(discount.newPrice)}₺</span>
                            {discount.oldPrice > 0 && discount.newPrice > 0 && (
                                <span className="ml-auto text-[10px] bg-orange-500 text-white font-bold px-1.5 py-0.5 rounded">
                                    %{Math.round(((discount.oldPrice - discount.newPrice) / discount.oldPrice) * 100)}
                                </span>
                            )}
                        </>
                    ) : null}
                </div>
            </div>

            {/* Aksiyon butonları */}
            <div className="flex border-t border-gray-700">
                <button
                    type="button"
                    onClick={onEdit}
                    className="flex-1 py-2 text-xs font-bold text-indigo-400 hover:bg-indigo-900/30 hover:text-indigo-300 transition-colors flex items-center justify-center gap-1"
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
                    className="flex-1 py-2 text-xs font-bold text-red-400 hover:bg-red-900/30 hover:text-red-300 transition-colors flex items-center justify-center gap-1 disabled:opacity-50"
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

// Geri sayım bileşeni
const CountdownTimer: React.FC<{ expiredAt: any }> = ({ expiredAt }) => {
    const [timeLeft, setTimeLeft] = useState<string>('');

    useEffect(() => {
        const calculateTime = () => {
            if (!expiredAt) return '00:00';
            
            const expiredDate = expiredAt.toDate ? expiredAt.toDate() : new Date(expiredAt);
            const deleteDate = new Date(expiredDate.getTime() + 60 * 60 * 1000); // 1 saat sonra silinecek
            
            const diff = deleteDate.getTime() - Date.now();
            if (diff <= 0) return 'Siliniyor...';
            
            const minutes = Math.floor(diff / 1000 / 60);
            const seconds = Math.floor((diff / 1000) % 60);
            return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
        };

        const timer = setInterval(() => {
            setTimeLeft(calculateTime());
        }, 1000);

        setTimeLeft(calculateTime());
        return () => clearInterval(timer);
    }, [expiredAt]);

    return <span className="font-mono text-xs font-bold text-red-400 bg-red-900/30 px-2 py-0.5 rounded border border-red-500/50">{timeLeft}</span>;
};

// 24 Saatlik yayın süresi rozeti
const ExpiryBadge: React.FC<{ createdAt: any }> = ({ createdAt }) => {
    const [status, setStatus] = useState<{ label: string, color: string }>({ label: '', color: '' });

    useEffect(() => {
        const updateStatus = () => {
            if (!createdAt) return;
            const createdDate = createdAt.toDate ? createdAt.toDate() : new Date(createdAt);
            const hoursPassed = (Date.now() - createdDate.getTime()) / (1000 * 60 * 60);
            const hoursLeft = Math.max(0, 24 - hoursPassed);

            if (hoursLeft <= 3) {
                setStatus({ label: `${hoursLeft.toFixed(1)}s kaldı`, color: 'bg-red-600' });
            } else if (hoursLeft <= 12) {
                setStatus({ label: `${hoursLeft.toFixed(0)}s kaldı`, color: 'bg-orange-600' });
            } else {
                setStatus({ label: `${hoursLeft.toFixed(0)}s`, color: 'bg-blue-600/50' });
            }
        };

        updateStatus();
        const interval = setInterval(updateStatus, 60000); // Dakikada bir güncelle
        return () => clearInterval(interval);
    }, [createdAt]);

    if (!status.label) return null;
    return <span className={`px-2 py-0.5 text-[10px] font-bold rounded text-white ${status.color}`} title="24 saatlik otomatik yayın süresi">{status.label}</span>;
};

interface ManageDiscountsProps {
    setActiveView: (view: ViewType) => void;
    isAdmin: boolean;
}

type FilterType = 'all' | 'discount' | 'ad' | 'affiliate_pending' | 'proven' | 'expired';

const ManageDiscounts: React.FC<ManageDiscountsProps> = ({ setActiveView, isAdmin }) => {
    const { showToast } = useToast();
    const [discounts, setDiscounts] = useState<Discount[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [editingDiscount, setEditingDiscount] = useState<Discount | null>(null);
    const [searchQuery, setSearchQuery] = useState('');
    const [activeFilter, setActiveFilter] = useState<FilterType>('all');
    const [isBulkDeleting, setIsBulkDeleting] = useState(false);
    const [showBulkConfirm, setShowBulkConfirm] = useState(false);

    const fetchDiscounts = useCallback(async () => {
        setIsLoading(true);
        try {
            const discountsData = await getDiscounts();
            setDiscounts(discountsData as Discount[]);
        } catch (err) {
            setError('İndirimler yüklenemedi.');
        } finally {
            setIsLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchDiscounts();
    }, [fetchDiscounts]);

    const handleEditSuccess = () => {
        setEditingDiscount(null);
        fetchDiscounts();
        showToast('İlan başarıyla güncellendi.', 'success');
    };

    const handleDeleteItem = async (id: string, deleteUrl: string, screenshotDeleteUrl?: string) => {
        try {
            await deleteDiscount(id, deleteUrl, screenshotDeleteUrl);
            setDiscounts(prev => prev.filter(d => d.id !== id));
            showToast('İlan silindi.', 'success');
        } catch (err) {
            showToast('İlan silinemedi. Lütfen tekrar deneyin.', 'error');
        }
    };

    // Süresi biten ilanları toplu sil
    const handleBulkDeleteExpired = async () => {
        const expiredList = discounts.filter(
            d => d.status === 'İndirim Bitti' || d.status === 'Sonlanıyor'
        );
        if (expiredList.length === 0) return;

        setIsBulkDeleting(true);
        try {
            const count = await deleteExpiredDiscountsBatch(expiredList);
            setDiscounts(prev => prev.filter(
                d => d.status !== 'İndirim Bitti' && d.status !== 'Sonlanıyor'
            ));
            showToast(`${count} süresi biten ilan silindi.`, 'success');
        } catch (err) {
            showToast('Toplu silme başarısız oldu.', 'error');
        } finally {
            setIsBulkDeleting(false);
            setShowBulkConfirm(false);
        }
    };

    // Filtrelenmiş ve aranmış sonuçlar
    const filteredDiscounts = useMemo(() => {
        let result = discounts;

        // Tür filtresi
        switch (activeFilter) {
            case 'discount':
                result = result.filter(d => !d.isAd);
                break;
            case 'ad':
                result = result.filter(d => d.isAd);
                break;
            case 'affiliate_pending':
                result = result.filter(d => d.affiliateLinkUpdated === false);
                break;
            case 'proven':
                result = result.filter(d => !!d.screenshotUrl);
                break;
            case 'expired':
                result = result.filter(d => d.status === 'İndirim Bitti');
                break;
        }

        // Metin arama
        if (searchQuery.trim()) {
            const q = searchQuery.toLowerCase().trim();
            result = result.filter(d =>
                d.title?.toLowerCase().includes(q) ||
                d.brand?.toLowerCase().includes(q) ||
                d.category?.toLowerCase().includes(q) ||
                d.storeName?.toLowerCase().includes(q)
            );
        }

        return result;
    }, [discounts, searchQuery, activeFilter]);

    const filterButtons: { id: FilterType; label: string; count: number }[] = [
        { id: 'all', label: 'Tümü', count: discounts.length },
        { id: 'discount', label: '🏷️ İndirimler', count: discounts.filter(d => !d.isAd).length },
        { id: 'ad', label: '📢 Reklamlar', count: discounts.filter(d => d.isAd).length },
        { id: 'affiliate_pending', label: '💰 Affiliate Bekleyen', count: discounts.filter(d => d.affiliateLinkUpdated === false).length },
        { id: 'proven', label: '✅ Kanıtlı', count: discounts.filter(d => !!d.screenshotUrl).length },
        { id: 'expired', label: '🚩 Bitenler', count: discounts.filter(d => d.status === 'İndirim Bitti' || d.status === 'Sonlanıyor').length },
    ];

    const expiredCount = discounts.filter(d => d.status === 'İndirim Bitti' || d.status === 'Sonlanıyor').length;

    return (
        <div>
            <div className="flex justify-between items-center mb-6">
                <h2 className="text-3xl font-bold text-white">İlanları Yönet</h2>
                <div className="flex items-center gap-3">
                    {activeFilter === 'expired' && expiredCount > 0 && (
                        <button
                            onClick={() => setShowBulkConfirm(true)}
                            disabled={isBulkDeleting}
                            className="bg-red-700 hover:bg-red-600 disabled:opacity-60 text-white font-bold py-2 px-4 rounded-lg transition-colors inline-flex items-center gap-2"
                        >
                            {isBulkDeleting ? (
                                <><div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />Siliniyor...</>
                            ) : (
                                <>
                                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                    </svg>
                                    Tümünü Sil ({expiredCount})
                                </>
                            )}
                        </button>
                    )}
                    <button
                        onClick={() => setActiveView('discounts')}
                        className="bg-gray-700 hover:bg-gray-600 text-white font-bold py-2 px-4 rounded-lg transition-colors inline-flex items-center"
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 17l-5-5m0 0l5-5m-5 5h12" />
                        </svg>
                        Geri Dön
                    </button>
                </div>
            </div>

            {/* Toplu Silme Onay Dialogu */}
            {showBulkConfirm && (
                <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
                    <div className="bg-gray-800 rounded-xl p-6 max-w-sm w-full border border-red-600 shadow-xl">
                        <h3 className="text-xl font-bold text-white mb-2">⚠️ Emin misiniz?</h3>
                        <p className="text-gray-300 mb-5">
                            <strong className="text-red-400">{expiredCount} adet</strong> süresi bitmiş ilan kalıcı olarak silinecek.
                            Bu işlem geri alınamaz.
                        </p>
                        <div className="flex gap-3">
                            <button
                                onClick={() => setShowBulkConfirm(false)}
                                className="flex-1 bg-gray-700 hover:bg-gray-600 text-white font-bold py-2 px-4 rounded-lg transition-colors"
                            >
                                İptal
                            </button>
                            <button
                                onClick={handleBulkDeleteExpired}
                                disabled={isBulkDeleting}
                                className="flex-1 bg-red-600 hover:bg-red-500 disabled:opacity-60 text-white font-bold py-2 px-4 rounded-lg transition-colors"
                            >
                                {isBulkDeleting ? 'Siliniyor...' : 'Evet, Sil'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {error && <p className="text-red-400 bg-red-900/50 p-3 rounded-md mb-4">{error}</p>}

            {/* Arama ve Filtreler */}
            {!isLoading && discounts.length > 0 && (
                <div className="mb-5 space-y-3">
                    <div className="relative">
                        <svg xmlns="http://www.w3.org/2000/svg" className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                        </svg>
                        <input
                            type="text"
                            placeholder="Başlık, marka veya kategori ara..."
                            value={searchQuery}
                            onChange={e => setSearchQuery(e.target.value)}
                            className="w-full bg-gray-800 border border-gray-700 text-white rounded-lg pl-10 pr-10 py-2.5 focus:outline-none focus:border-blue-500 transition-colors placeholder-gray-500"
                        />
                        {searchQuery && (
                            <button onClick={() => setSearchQuery('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-white">✕</button>
                        )}
                    </div>

                    <div className="flex gap-2 flex-wrap">
                        {filterButtons.map(btn => (
                            <button
                                key={btn.id}
                                onClick={() => setActiveFilter(btn.id)}
                                className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors flex items-center gap-1.5 ${activeFilter === btn.id ? 'bg-blue-600 text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'}`}
                            >
                                {btn.label}
                                <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-bold ${activeFilter === btn.id ? 'bg-blue-500' : 'bg-gray-600'}`}>
                                    {btn.count}
                                </span>
                            </button>
                        ))}
                    </div>

                    <p className="text-sm text-gray-400">
                        {filteredDiscounts.length === discounts.length
                            ? `Toplam ${discounts.length} ilan`
                            : `${filteredDiscounts.length} / ${discounts.length} ilan gösteriliyor`}
                        {searchQuery && <span className="text-blue-400"> · "{searchQuery}" için</span>}
                    </p>
                </div>
            )}

            {isLoading ? (
                <div className="flex items-center justify-center py-16">
                    <div className="w-8 h-8 border-2 border-blue-500/30 border-t-blue-500 rounded-full animate-spin" />
                    <span className="ml-3 text-gray-400">İlanlar yükleniyor...</span>
                </div>
            ) : discounts.length === 0 ? (
                <p className="text-center text-gray-400 mt-8">Yönetilecek indirim ilanı bulunmuyor.</p>
            ) : filteredDiscounts.length === 0 ? (
                <div className="text-center py-12">
                    <p className="text-gray-400 text-lg">Sonuç bulunamadı</p>
                    <p className="text-gray-500 text-sm mt-1">Farklı bir arama terimi veya filtre deneyin.</p>
                    <button
                        onClick={() => { setSearchQuery(''); setActiveFilter('all'); }}
                        className="mt-4 text-blue-400 hover:text-blue-300 text-sm underline"
                    >
                        Filtreleri temizle
                    </button>
                </div>
            ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
                    {filteredDiscounts.map(discount => (
                        <DiscountAdminCard
                            key={discount.id}
                            discount={discount}
                            onEdit={() => setEditingDiscount(discount)}
                            onDelete={() => handleDeleteItem(discount.id, discount.deleteUrl, discount.screenshotDeleteUrl)}
                        />
                    ))}
                </div>
            )}

            {editingDiscount && (
                <EditDiscountModal
                    discount={editingDiscount}
                    onClose={() => setEditingDiscount(null)}
                    onSaveSuccess={handleEditSuccess}
                    isAdmin={isAdmin}
                />
            )}
        </div>
    );
};

export default ManageDiscounts;
