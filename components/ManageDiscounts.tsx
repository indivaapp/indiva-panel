
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { getDiscounts, deleteDiscount, deleteExpiredDiscountsBatch } from '../services/firebase';
import type { Discount, ViewType } from '../types';
import EditDiscountModal from './EditDiscountModal';
import DeleteImgButton from './DeleteImgButton';
import { useToast } from './ToastProvider';

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
            console.error(err);
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
                    {/* Toplu Silme Butonu - Sadece Bitenler filtresinde göster */}
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
                    {/* Arama Çubuğu */}
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
                            <button
                                onClick={() => setSearchQuery('')}
                                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-white"
                            >
                                ✕
                            </button>
                        )}
                    </div>

                    {/* Filtre Butonları */}
                    <div className="flex gap-2 flex-wrap">
                        {filterButtons.map(btn => (
                            <button
                                key={btn.id}
                                onClick={() => setActiveFilter(btn.id)}
                                className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors flex items-center gap-1.5 ${activeFilter === btn.id
                                    ? 'bg-blue-600 text-white'
                                    : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                                    }`}
                            >
                                {btn.label}
                                <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-bold ${activeFilter === btn.id ? 'bg-blue-500' : 'bg-gray-600'
                                    }`}>
                                    {btn.count}
                                </span>
                            </button>
                        ))}
                    </div>

                    {/* Sonuç sayısı */}
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
                <div className="bg-gray-800 rounded-lg shadow-lg">
                    {/* Desktop: Table view */}
                    <div className="hidden md:block overflow-x-auto">
                        <table className="min-w-full">
                            <thead className="bg-gray-700">
                                <tr>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">Görsel</th>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">Başlık / Marka</th>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">Fiyat</th>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">İşlemler</th>
                                </tr>
                            </thead>
                            <tbody className="bg-gray-800 divide-y divide-gray-700">
                                {filteredDiscounts.map(discount => (
                                    <tr key={discount.id} className={discount.isAd ? "bg-yellow-900/10" : ""}>
                                        <td className="px-6 py-4 whitespace-nowrap">
                                            <div className="relative w-16 h-16">
                                                <img src={discount.imageUrl} alt={discount.title} className="w-16 h-16 object-cover rounded-md" />
                                                <DeleteImgButton
                                                    onDelete={() => handleDeleteItem(discount.id, discount.deleteUrl, discount.screenshotDeleteUrl)}
                                                />
                                            </div>
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap">
                                            <div className="flex items-center flex-wrap gap-1">
                                                <div className="text-sm font-medium text-white">{discount.title}</div>
                                                {discount.isAd && <span className="px-2 py-0.5 text-xs bg-yellow-600 text-black font-bold rounded">REKLAM</span>}
                                                {discount.affiliateLinkUpdated === false && <span className="px-2 py-0.5 text-xs bg-orange-600 text-white font-bold rounded">AFF. BEKL.</span>}
                                                {discount.status === 'İndirim Bitti' && <span className="px-2 py-0.5 text-xs bg-red-600 text-white font-bold rounded">İNDİRİM BİTTİ</span>}
                                            </div>
                                            <div className="text-sm text-gray-400">{discount.brand}</div>
                                            {discount.screenshotUrl && <div className="text-xs text-green-500 mt-1">Kanıtlı İlan</div>}
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap">
                                            {discount.isAd ? (
                                                <span className="text-xs text-gray-400 italic">Sponsorlu</span>
                                            ) : (
                                                <>
                                                    <div className="text-sm text-green-400 font-semibold">{discount.newPrice} TL</div>
                                                    {discount.oldPrice > 0 && <div className="text-xs text-gray-500 line-through">{discount.oldPrice} TL</div>}
                                                </>
                                            )}
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                                            <div className="flex items-center space-x-4">
                                                <button type="button" onClick={() => setEditingDiscount(discount)} className="text-indigo-400 hover:text-indigo-300">Düzenle</button>
                                                <DeleteImgButton
                                                    onDelete={() => handleDeleteItem(discount.id, discount.deleteUrl, discount.screenshotDeleteUrl)}
                                                    isTextButton={true}
                                                />
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                    {/* Mobile: Card list view */}
                    <div className="md:hidden divide-y divide-gray-700">
                        {filteredDiscounts.map(discount => (
                            <div key={discount.id} className={`p-4 flex space-x-4 ${discount.isAd ? 'bg-yellow-900/10' : ''}`}>
                                <div className="relative w-24 h-24 flex-shrink-0">
                                    <img src={discount.imageUrl} alt={discount.title} className="w-full h-full object-cover rounded-md" />
                                    <DeleteImgButton
                                        onDelete={() => handleDeleteItem(discount.id, discount.deleteUrl, discount.screenshotDeleteUrl)}
                                    />
                                </div>
                                <div className="flex-1 flex flex-col justify-between">
                                    <div>
                                        <div className="flex items-start justify-between flex-wrap gap-1">
                                            <p className="font-bold text-white leading-tight">{discount.title}</p>
                                            <div className="flex gap-1 flex-wrap">
                                                {discount.isAd && <span className="px-2 py-0.5 text-xs bg-yellow-600 text-black font-bold rounded">REKLAM</span>}
                                                {discount.affiliateLinkUpdated === false && <span className="px-2 py-0.5 text-xs bg-orange-600 text-white font-bold rounded">AFF.</span>}
                                                {discount.status === 'İndirim Bitti' && <span className="px-2 py-0.5 text-xs bg-red-600 text-white font-bold rounded">BİTTİ</span>}
                                            </div>
                                        </div>
                                        <p className="text-sm text-gray-400">{discount.brand}</p>
                                        {discount.screenshotUrl && <p className="text-xs text-green-500 mt-1">✔ Kanıtlı İlan</p>}
                                        <div className="mt-2">
                                            {discount.isAd ? (
                                                <p className="text-sm text-gray-400 italic">Sponsorlu İçerik</p>
                                            ) : (
                                                <>
                                                    <p className="text-lg font-semibold text-green-400">{discount.newPrice} TL</p>
                                                    {discount.oldPrice > 0 && <p className="text-xs text-gray-500 line-through">{discount.oldPrice} TL</p>}
                                                </>
                                            )}
                                        </div>
                                    </div>
                                    <div className="flex items-center space-x-4 pt-2">
                                        <button type="button" onClick={() => setEditingDiscount(discount)} className="text-indigo-400 hover:text-indigo-300 text-sm font-medium">Düzenle</button>
                                        <DeleteImgButton
                                            onDelete={() => handleDeleteItem(discount.id, discount.deleteUrl, discount.screenshotDeleteUrl)}
                                            isTextButton={true}
                                        />
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
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
