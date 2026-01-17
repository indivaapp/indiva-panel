
import React, { useState, useEffect, useCallback } from 'react';
import { getDiscounts, deleteDiscount } from '../services/firebase';
import type { Discount, ViewType } from '../types';
import EditDiscountModal from './EditDiscountModal';
import DeleteImgButton from './DeleteImgButton';

interface ManageDiscountsProps {
    setActiveView: (view: ViewType) => void;
    isAdmin: boolean;
}

const ManageDiscounts: React.FC<ManageDiscountsProps> = ({ setActiveView, isAdmin }) => {
    const [discounts, setDiscounts] = useState<Discount[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [editingDiscount, setEditingDiscount] = useState<Discount | null>(null);
    
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
    }
    
    const handleDeleteItem = async (id: string, deleteUrl: string, screenshotDeleteUrl?: string) => {
        await deleteDiscount(id, deleteUrl, screenshotDeleteUrl);
        // UI Update
        setDiscounts(prev => prev.filter(d => d.id !== id));
    };

    return (
        <div>
            <div className="flex justify-between items-center mb-6">
                <h2 className="text-3xl font-bold text-white">İlanları Yönet</h2>
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
            
            {error && <p className="text-red-400 bg-red-900/50 p-3 rounded-md mb-4">{error}</p>}
            
            {isLoading ? (
                <p>İndirimler yükleniyor...</p>
            ) : discounts.length === 0 ? (
                <p className="text-center text-gray-400 mt-8">Yönetilecek indirim ilanı bulunmuyor.</p>
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
                                {discounts.map(discount => (
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
                                            <div className="flex items-center">
                                                <div className="text-sm font-medium text-white">{discount.title}</div>
                                                {discount.isAd && <span className="ml-2 px-2 py-0.5 text-xs bg-yellow-600 text-black font-bold rounded">REKLAM</span>}
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
                                                <button type="button" onClick={() => setEditingDiscount(discount)} className="text-indigo-400 hover:text-indigo-300 disabled:text-gray-500 disabled:cursor-not-allowed">Düzenle</button>
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
                        {discounts.map(discount => (
                            <div key={discount.id} className={`p-4 flex space-x-4 ${discount.isAd ? 'bg-yellow-900/10' : ''}`}>
                                <div className="relative w-24 h-24 flex-shrink-0">
                                    <img src={discount.imageUrl} alt={discount.title} className="w-full h-full object-cover rounded-md" />
                                    <DeleteImgButton
                                        onDelete={() => handleDeleteItem(discount.id, discount.deleteUrl, discount.screenshotDeleteUrl)}
                                    />
                                </div>
                                <div className="flex-1 flex flex-col justify-between">
                                    <div>
                                        <div className="flex items-start justify-between">
                                            <p className="font-bold text-white leading-tight">{discount.title}</p>
                                            {discount.isAd && <span className="ml-2 px-2 py-0.5 text-xs bg-yellow-600 text-black font-bold rounded flex-shrink-0">REKLAM</span>}
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
                                        <button type="button" onClick={() => setEditingDiscount(discount)} className="text-indigo-400 hover:text-indigo-300 text-sm font-medium disabled:text-gray-500 disabled:cursor-not-allowed">Düzenle</button>
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
