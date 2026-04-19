import React, { useState, useEffect, useCallback } from 'react';
import { getDiscounts, deleteDiscount } from '../services/firebase';
import type { Discount, ViewType } from '../types';
import EditDiscountModal from './EditDiscountModal';

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
    const [search, setSearch] = useState('');
    const [selectedDiscount, setSelectedDiscount] = useState<Discount | null>(null);

    const load = useCallback(async () => {
        setIsLoading(true);
        try {
            const data = await getDiscounts();
            setDiscounts(data);
            setFiltered(data);
        } catch {/* sessiz */}
        finally { setIsLoading(false); }
    }, []);

    useEffect(() => { load(); }, [load]);

    useEffect(() => {
        const q = search.trim().toLowerCase();
        setFiltered(q ? discounts.filter(d =>
            d.title.toLowerCase().includes(q) ||
            d.brand?.toLowerCase().includes(q)
        ) : discounts);
    }, [search, discounts]);

    const handleSaveSuccess = () => {
        setSelectedDiscount(null);
        load();
    };

    const handleDelete = async (d: Discount) => {
        if (!window.confirm(`"${d.title}" silinsin mi?`)) return;
        await deleteDiscount(d.id, d.deleteUrl, d.screenshotDeleteUrl);
        setSelectedDiscount(null);
        load();
    };

    return (
        <div>
            {/* Header */}
            <div className="flex items-center justify-between mb-4 gap-3">
                <h2 className="text-2xl font-bold text-white shrink-0">İlanları Düzenle</h2>
                <button
                    onClick={() => setActiveView('addDiscount')}
                    className="flex items-center gap-2 bg-green-600 hover:bg-green-500 text-white font-bold px-4 py-2 rounded-xl transition-colors shrink-0"
                >
                    <span className="text-lg">➕</span>
                    <span className="text-sm">Yeni İlan</span>
                </button>
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
                            <div className="bg-gray-700 h-36" />
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
                        return (
                            <div
                                key={d.id}
                                onClick={() => setSelectedDiscount(d)}
                                className="bg-gray-800 rounded-2xl overflow-hidden cursor-pointer border border-gray-700 hover:border-orange-500 transition-all active:scale-95"
                            >
                                {/* Image */}
                                <div className="relative bg-gray-900 h-36">
                                    <img
                                        src={d.imageUrl}
                                        alt={d.title}
                                        className="w-full h-full object-contain"
                                        onError={e => { (e.target as HTMLImageElement).src = 'https://placehold.co/200x200/1f2937/6b7280?text=Görsel'; }}
                                    />
                                    {pct > 0 && (
                                        <span className="absolute top-2 left-2 bg-orange-500 text-white text-[10px] font-black px-1.5 py-0.5 rounded-lg">
                                            %{pct} İND
                                        </span>
                                    )}
                                    <span className="absolute bottom-1.5 right-2 text-[10px] text-gray-400 bg-black/60 px-1.5 py-0.5 rounded">
                                        {timeAgo(d.createdAt)}
                                    </span>
                                </div>

                                {/* Info */}
                                <div className="p-2.5">
                                    <p className="text-xs text-orange-400 font-semibold truncate">{d.brand}</p>
                                    <p className="text-white text-xs font-bold leading-tight line-clamp-2 mt-0.5 mb-1.5">{d.title}</p>
                                    <div className="flex items-center gap-1.5">
                                        {d.oldPrice > 0 && (
                                            <span className="text-gray-500 line-through text-[11px]">{d.oldPrice}₺</span>
                                        )}
                                        <span className="text-green-400 font-black text-sm">{d.newPrice}₺</span>
                                    </div>
                                </div>
                            </div>
                        );
                    })}
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
