import React, { useState, useRef, useEffect } from 'react';
import { analyzeProductLink, type AnalyzedProduct } from '../services/linkAnalyzer';
import {
    addDiscount,
    getDiscountsNeedingAffiliate,
    updateAffiliateLink,
    skipAffiliateUpdate
} from '../services/firebase';
import { uploadToImgbb } from '../services/imgbb';
import { Clipboard } from '@capacitor/clipboard';
import type { ViewType, Discount } from '../types';

interface AffiliateLinkManagerProps {
    isAdmin: boolean;
    setActiveView?: (view: ViewType) => void;
    sharedLink?: string | null;
    onSharedLinkProcessed?: () => void;
}

const AffiliateLinkManager: React.FC<AffiliateLinkManagerProps> = ({ isAdmin, sharedLink, onSharedLinkProcessed }) => {
    // Mode State
    const [mode, setMode] = useState<'analyzer' | 'sequential'>('sequential');

    // Analyzer State
    const [link, setLink] = useState('');
    const [isAnalyzing, setIsAnalyzing] = useState(false);
    const [isPublishing, setIsPublishing] = useState(false);
    const [product, setProduct] = useState<AnalyzedProduct | null>(null);
    const [status, setStatus] = useState<string>('');
    const [isUploadingImage, setIsUploadingImage] = useState(false);
    const [isUploadingProof, setIsUploadingProof] = useState(false);
    const [proofImageUrl, setProofImageUrl] = useState('');
    const fileInputRef = useRef<HTMLInputElement>(null);
    const proofInputRef = useRef<HTMLInputElement>(null);

    // Sequential Mode State
    const [pendingDeals, setPendingDeals] = useState<Discount[]>([]);
    const [currentIndex, setCurrentIndex] = useState(0);
    const [isLoadingPending, setIsLoadingPending] = useState(false);
    const [affiliateInput, setAffiliateInput] = useState('');
    const [isUpdating, setIsUpdating] = useState(false);

    // Common State
    const [error, setError] = useState<string | null>(null);
    const [successMessage, setSuccessMessage] = useState<string | null>(null);

    // Help: Format time ago
    const formatTimeAgo = (date: any) => {
        if (!date) return '';
        const now = new Date();
        const created = date.toDate ? date.toDate() : new Date(date);
        const diffInMs = now.getTime() - created.getTime();
        const diffInMin = Math.floor(diffInMs / (1000 * 60));

        if (diffInMin < 1) return 'Az önce';
        if (diffInMin < 60) return `${diffInMin} dk önce`;

        const diffInHours = Math.floor(diffInMin / 60);
        if (diffInHours < 24) return `${diffInHours} sa önce`;

        return created.toLocaleDateString('tr-TR');
    };

    // Load Pending Deals
    const loadPending = async () => {
        setIsLoadingPending(true);
        try {
            const deals = await getDiscountsNeedingAffiliate();
            setPendingDeals(deals);
            setCurrentIndex(0);
        } catch (err: any) {
            setError('Bekleyen ürünler yüklenemedi: ' + err.message);
        } finally {
            setIsLoadingPending(false);
        }
    };

    useEffect(() => {
        if (mode === 'sequential') {
            loadPending();
        }
    }, [mode]);


    // Paylaşılan link geldiğinde otomatik doldur
    useEffect(() => {
        if (sharedLink) {
            if (mode === 'sequential') {
                setAffiliateInput(sharedLink);
                setSuccessMessage('📥 Link otomatik yapıştırıldı! "Save & Next" diyerek kaydedebilirsiniz.');
            } else {
                setMode('analyzer');
                setLink(sharedLink);
                setSuccessMessage('📥 Link diğer uygulamadan alındı! Analiz edebilirsiniz.');
            }
            setTimeout(() => setSuccessMessage(null), 4000);
            if (onSharedLinkProcessed) {
                onSharedLinkProcessed();
            }
        }
    }, [sharedLink, onSharedLinkProcessed, mode]);

    // --- Sequential Handlers ---
    const currentDeal = pendingDeals[currentIndex];

    const handleOpenProduct = () => {
        if (!currentDeal) return;
        const linkToOpen = currentDeal.originalStoreLink || currentDeal.link;
        window.open(linkToOpen, '_blank');
        setSuccessMessage('🌐 Ürün açıldı! Hızlanmak için mağaza uygulamasından "Paylaş -> INDIVA Panel" yapabilirsiniz.');
        setTimeout(() => setSuccessMessage(null), 4000);
    };

    const handleClipboardPaste = async () => {
        try {
            // First try Native Capacitor Clipboard
            const { value } = await Clipboard.read();
            if (value) {
                setAffiliateInput(value);
                setSuccessMessage('📋 Pano\'dan yapıştırıldı (Native).');
                setTimeout(() => setSuccessMessage(null), 2000);
                return;
            }

            // Fallback to Web API
            const webText = await navigator.clipboard.readText();
            if (webText) {
                setAffiliateInput(webText);
                setSuccessMessage('📋 Pano\'dan yapıştırıldı (Web).');
                setTimeout(() => setSuccessMessage(null), 2000);
                return;
            }

            throw new Error('Clipboard empty');
        } catch (err) {
            // Ultimate fallback for security/unsupported envs
            const input = prompt('Linkinizi buraya yapıştırın:');
            if (input) {
                setAffiliateInput(input);
                setSuccessMessage('📋 Manuel yapıştırıldı.');
                setTimeout(() => setSuccessMessage(null), 2000);
            }
        }
    };


    const handleSaveAffiliate = async () => {
        if (!currentDeal || !affiliateInput.trim()) return;

        setIsUpdating(true);
        try {
            await updateAffiliateLink(currentDeal.id, affiliateInput.trim());
            setSuccessMessage('✅ Link güncellendi!');
            setAffiliateInput('');

            // Sıradakine geç veya listeyi yenile
            if (currentIndex < pendingDeals.length - 1) {
                setCurrentIndex(prev => prev + 1);
            } else {
                loadPending();
            }
            setTimeout(() => setSuccessMessage(null), 2000);
        } catch (err: any) {
            setError('Güncelleme hatası: ' + err.message);
        } finally {
            setIsUpdating(false);
        }
    };

    const handleSkip = async () => {
        if (!currentDeal) return;

        setIsUpdating(true);
        try {
            await skipAffiliateUpdate(currentDeal.id);
            setAffiliateInput('');

            if (currentIndex < pendingDeals.length - 1) {
                setCurrentIndex(prev => prev + 1);
            } else {
                loadPending();
            }
        } catch (err: any) {
            setError('Atlama hatası: ' + err.message);
        } finally {
            setIsUpdating(false);
        }
    };

    const handleSkipAll = async () => {
        if (pendingDeals.length === 0) return;
        if (!window.confirm('Kalan tüm ürünleri atlamak ve listeyi temizlemek istediğinize emin misiniz?')) return;

        setIsUpdating(true);
        try {
            // Sadece geriye kalanları atla
            const remainingDeals = pendingDeals.slice(currentIndex);
            await Promise.all(remainingDeals.map(deal => skipAffiliateUpdate(deal.id)));

            setSuccessMessage('🧹 Tüm liste temizlendi.');
            setPendingDeals([]);
            setCurrentIndex(0);
            setTimeout(() => setSuccessMessage(null), 3000);
        } catch (err: any) {
            setError('Toplu atlama hatası: ' + err.message);
        } finally {
            setIsUpdating(false);
        }
    };


    // --- Analyzer Handlers ---
    const handleAnalyze = async () => {
        if (!link.trim()) {
            setError('Lütfen bir link yapıştırın');
            return;
        }

        setIsAnalyzing(true);
        setError(null);
        setProduct(null);
        setStatus('📖 Sayfa okunuyor...');

        try {
            setStatus('🤖 AI analiz ediyor...');
            const result = await analyzeProductLink(link);
            setProduct(result);
            setStatus('');
            setSuccessMessage('✨ Analiz tamamlandı! Eksik bilgileri düzenleyebilirsiniz.');
            setTimeout(() => setSuccessMessage(null), 4000);
        } catch (err: any) {
            setError(err.message || 'Analiz hatası');
            setStatus('');
        } finally {
            setIsAnalyzing(false);
        }
    };

    const updateProduct = (field: keyof AnalyzedProduct, value: string | number) => {
        if (!product) return;
        setProduct({ ...product, [field]: value });
    };

    const handlePublish = async () => {
        if (!product) return;
        setIsPublishing(true);
        setError(null);

        try {
            await addDiscount({
                title: product.title,
                description: product.description,
                brand: product.brand,
                category: product.category,
                link: product.link,
                oldPrice: product.oldPrice,
                newPrice: product.newPrice,
                imageUrl: product.imageUrl || '',
                screenshotUrl: proofImageUrl || '',
                deleteUrl: '',
                submittedBy: 'AI Link Analyzer',
                affiliateLinkUpdated: true,
            });

            setSuccessMessage('✅ Başarıyla yayınlandı!');
            setProduct(null);
            setLink('');
            setTimeout(() => setSuccessMessage(null), 5000);
        } catch (err: any) {
            setError(err.message);
        } finally {
            setIsPublishing(false);
        }
    };

    const handleQuickPublish = async () => {
        if (!link.trim()) {
            setError('Lütfen bir link yapıştırın');
            return;
        }

        setIsAnalyzing(true);
        setError(null);
        setProduct(null);
        setStatus('🚀 Hızlı yayınlanıyor...');

        try {
            setStatus('📖 Sayfa okunuyor...');
            const result = await analyzeProductLink(link);
            setStatus('💾 Firebase\'e kaydediliyor...');

            await addDiscount({
                title: result.title,
                description: result.description,
                brand: result.brand,
                category: result.category,
                link: result.link,
                oldPrice: result.oldPrice,
                newPrice: result.newPrice,
                imageUrl: result.imageUrl || '',
                deleteUrl: '',
                submittedBy: 'AI Quick Publish',
                affiliateLinkUpdated: true,
            });

            setSuccessMessage('⚡ Hızlı yayınlama başarılı!');
            setLink('');
            setStatus('');
            setTimeout(() => setSuccessMessage(null), 5000);
        } catch (err: any) {
            setError(err.message || 'Hızlı yayınlama hatası');
            setStatus('');
        } finally {
            setIsAnalyzing(false);
        }
    };

    const handlePaste = async () => {
        try {
            // Try Native
            const { value } = await Clipboard.read();
            if (value) {
                setLink(value);
                setSuccessMessage('📋 Link yapıştırıldı (Native).');
                setTimeout(() => setSuccessMessage(null), 2000);
                return;
            }

            // Try Web
            const webText = await navigator.clipboard.readText();
            if (webText) {
                setLink(webText);
                setSuccessMessage('📋 Link yapıştırıldı (Web).');
                setTimeout(() => setSuccessMessage(null), 2000);
                return;
            }
        } catch {
            const input = prompt('Linki buraya yapıştırın:');
            if (input) setLink(input);
        }
    };

    const handleImageUpload = async (file: File) => {
        setIsUploadingImage(true);
        setError(null);
        try {
            const url = await uploadToImgbb(file);
            if (product) {
                setProduct({ ...product, imageUrl: url });
            }
            setSuccessMessage('🖼️ Görsel yüklendi!');
            setTimeout(() => setSuccessMessage(null), 3000);
        } catch (err: any) {
            setError('Görsel yüklenemedi: ' + err.message);
        } finally {
            setIsUploadingImage(false);
        }
    };


    if (!isAdmin) {
        return <div className="text-center text-red-400 p-10">Erişim yok</div>;
    }

    return (
        <div className="max-w-2xl mx-auto px-4 py-6 pb-20">
            {/* Tab Navigation */}
            <div className="flex bg-gray-800 p-1 rounded-xl mb-6 border border-gray-700">
                <button
                    onClick={() => setMode('sequential')}
                    className={`flex-1 py-2 px-4 rounded-lg text-sm font-bold transition-all ${mode === 'sequential' ? 'bg-orange-600 text-white shadow-lg' : 'text-gray-400 hover:text-white'}`}
                >
                    💰 Affiliate Master ({pendingDeals.length})
                </button>
                <button
                    onClick={() => setMode('analyzer')}
                    className={`flex-1 py-2 px-4 rounded-lg text-sm font-bold transition-all ${mode === 'analyzer' ? 'bg-purple-600 text-white shadow-lg' : 'text-gray-400 hover:text-white'}`}
                >
                    🤖 Link Analiz & Manuel
                </button>
            </div>

            {/* Mesajlar */}
            {error && (
                <div className="mb-4 p-3 bg-red-500/20 border border-red-500/30 rounded-lg text-red-400 text-sm">
                    ❌ {error}
                </div>
            )}
            {successMessage && (
                <div className="mb-4 p-3 bg-green-500/20 border border-green-500/30 rounded-lg text-green-400 text-sm">
                    {successMessage}
                </div>
            )}

            {/* --- SEQUENTIAL MODE --- */}
            {mode === 'sequential' && (
                <div className="space-y-6">
                    {isLoadingPending ? (
                        <div className="text-center py-20">
                            <div className="w-12 h-12 border-4 border-orange-500/30 border-t-orange-500 rounded-full animate-spin mx-auto mb-4"></div>
                            <p className="text-gray-400">Ürünler yükleniyor...</p>
                        </div>
                    ) : pendingDeals.length === 0 ? (
                        <div className="bg-gray-800 rounded-2xl p-10 border border-gray-700 text-center">
                            <div className="text-6xl mb-4">🎉</div>
                            <h2 className="text-xl font-bold text-white mb-2">Harikasın!</h2>
                            <p className="text-gray-400">Tüm ürünlerin affiliate linkleri güncel.</p>
                            <button onClick={loadPending} className="mt-6 px-6 py-2 bg-gray-700 text-white rounded-lg hover:bg-gray-600">Yenile</button>
                        </div>
                    ) : (
                        <div className="bg-gray-800 rounded-2xl border border-gray-700 overflow-hidden shadow-2xl">
                            {/* Product Header */}
                            <div className="aspect-video relative overflow-hidden bg-white">
                                <img
                                    src={currentDeal.imageUrl}
                                    className="w-full h-full object-contain"
                                    alt={currentDeal.title}
                                />
                                <div className="absolute top-2 left-2 bg-black/60 backdrop-blur-md text-white px-3 py-1 rounded-full text-xs font-bold border border-white/20">
                                    {currentIndex + 1} / {pendingDeals.length}
                                </div>
                                <div className="absolute top-2 right-2 bg-blue-600 text-white px-3 py-1 rounded-full text-xs font-bold">
                                    {currentDeal.storeName || currentDeal.brand}
                                </div>
                            </div>

                            <div className="p-5 space-y-5">
                                <h2 className="text-lg font-bold text-white leading-tight">{currentDeal.title}</h2>

                                <div className="flex items-center gap-3 bg-gray-900/50 p-3 rounded-xl border border-gray-700/50">
                                    <div className="flex-1">
                                        <p className="text-[10px] text-gray-500 uppercase font-bold tracking-wider mb-1">Orijinal Fiyat</p>
                                        <p className="text-xl font-bold text-green-400">{currentDeal.newPrice} ₺</p>
                                    </div>
                                    <button
                                        onClick={handleOpenProduct}
                                        className="px-4 py-3 bg-blue-600 hover:bg-blue-500 text-white rounded-xl font-bold flex items-center gap-2 shadow-lg shadow-blue-900/30 transition-all active:scale-95"
                                    >
                                        <span>🚀 Ürüne Git</span>
                                    </button>
                                </div>

                                <div className="space-y-3">
                                    <div className="flex justify-between items-center ml-1">
                                        <label className="block text-gray-400 text-xs font-bold uppercase tracking-wider">Kendi Affiliate Linkiniz</label>
                                        <span className="text-gray-500 text-[10px] font-bold">⏱️ {formatTimeAgo(currentDeal.createdAt)}</span>
                                    </div>
                                    <div className="flex gap-2">
                                        <input
                                            type="url"
                                            value={affiliateInput}
                                            onChange={(e) => setAffiliateInput(e.target.value)}
                                            placeholder="https://ty.gl/..."
                                            className="flex-1 px-4 py-3 bg-gray-900 border border-gray-600 rounded-xl text-white text-sm focus:border-orange-500 outline-none"
                                        />
                                        <button
                                            onClick={handleClipboardPaste}
                                            className="px-4 bg-gray-700 rounded-xl hover:bg-gray-600 font-bold text-xs text-white transition-colors"
                                            title="Clipboard'dan yapıştır"
                                        >
                                            📋 Yapıştır
                                        </button>
                                    </div>
                                </div>
                            </div>

                            <div className="flex gap-3 p-5 pt-0">
                                <button
                                    onClick={handleSkip}
                                    disabled={isUpdating}
                                    className="flex-1 py-4 bg-gray-700 hover:bg-gray-600 text-white font-bold rounded-xl disabled:opacity-50"
                                >
                                    Geç
                                </button>
                                <button
                                    onClick={handleSaveAffiliate}
                                    disabled={isUpdating || !affiliateInput.trim()}
                                    className="flex-[2] py-4 bg-gradient-to-r from-orange-600 to-red-600 text-white font-bold rounded-xl disabled:opacity-50 shadow-lg shadow-orange-900/30 active:scale-95 transition-all"
                                >
                                    {isUpdating ? 'Güncelleniyor...' : 'Kaydet & Devam Et'}
                                </button>
                            </div>

                            {/* Batch Skip Option */}
                            <div className="px-5 pb-5">
                                <button
                                    onClick={handleSkipAll}
                                    disabled={isUpdating}
                                    className="w-full py-2 text-gray-500 hover:text-red-400 text-[10px] font-bold uppercase tracking-widest transition-colors border-t border-gray-700/50 pt-4"
                                >
                                    ⚠️ Tümünü Atla ve Listeyi Temizle ⚠️
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            )}

            {/* --- ANALYZER MODE --- */}
            {mode === 'analyzer' && (
                <div className="space-y-6">
                    {/* Link Input */}
                    <div className="bg-gray-800 rounded-xl p-5 border border-gray-700 mb-6 shadow-xl">
                        <label className="block text-gray-300 text-sm font-bold mb-3 uppercase tracking-wider">🔗 Ürün Linki</label>
                        <div className="flex gap-2 mb-3">
                            <input
                                type="url"
                                value={link}
                                onChange={(e) => setLink(e.target.value)}
                                placeholder="https://..."
                                className="flex-1 px-3 py-3 bg-gray-900 border border-gray-600 rounded-lg text-white text-sm focus:border-purple-500 outline-none"
                            />
                            <button
                                onClick={async () => {
                                    const text = await navigator.clipboard.readText();
                                    if (text) setLink(text);
                                }}
                                className="px-4 bg-gray-700 rounded-lg hover:bg-gray-600 text-white"
                                title="Yapıştır"
                            >
                                📋
                            </button>
                        </div>

                        <div className="flex gap-2">
                            <button
                                onClick={handleAnalyze}
                                disabled={isAnalyzing || !link.trim()}
                                className="flex-1 py-3 bg-gradient-to-r from-purple-600 to-pink-600 text-white font-bold rounded-xl disabled:opacity-50 shadow-lg shadow-purple-900/30"
                            >
                                {isAnalyzing ? '📖 Analiz Ediliyor...' : '🔍 Şimdi Analiz Et'}
                            </button>

                            <button
                                onClick={handleQuickPublish}
                                disabled={isAnalyzing || !link.trim()}
                                className="px-6 py-3 bg-gray-700 hover:bg-gray-600 text-white font-bold rounded-xl disabled:opacity-50"
                            >
                                Tezgaha At
                            </button>
                        </div>
                    </div>

                    {/* Analyzed Product Card */}
                    {product && (
                        <div className="bg-gray-800 rounded-xl border border-gray-700 overflow-hidden shadow-2xl animate-in fade-in slide-in-from-bottom-4">
                            <div className="p-5 border-b border-gray-700 bg-gray-900/50">
                                <h3 className="font-bold text-white uppercase tracking-[0.1em] text-xs">Analiz Sonucu</h3>
                            </div>

                            <div className="p-5 space-y-4">
                                <div className="flex gap-4">
                                    <div className="w-24 h-24 bg-white rounded-lg p-2 flex-shrink-0 relative group">
                                        <img src={product.imageUrl} className="w-full h-full object-contain" alt="" />
                                        <button
                                            onClick={() => fileInputRef.current?.click()}
                                            className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity rounded-lg"
                                        >
                                            <span className="text-[10px] text-white font-bold">Değiştir</span>
                                        </button>
                                        <input type="file" ref={fileInputRef} className="hidden" accept="image/*" onChange={(e) => e.target.files?.[0] && handleImageUpload(e.target.files[0])} />
                                        {isUploadingImage && <div className="absolute inset-0 bg-black/60 flex items-center justify-center rounded-lg"><div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></div></div>}
                                    </div>
                                    <div className="flex-1 space-y-2">
                                        <textarea
                                            value={product.title}
                                            onChange={(e) => updateProduct('title', e.target.value)}
                                            className="w-full bg-gray-900 border border-gray-700 rounded-lg p-2 text-white text-sm font-bold min-h-[60px]"
                                            placeholder="Ürün Başlığı"
                                        />
                                        <div className="flex gap-2">
                                            <div className="flex-1">
                                                <input
                                                    type="text"
                                                    value={product.newPrice}
                                                    onChange={(e) => updateProduct('newPrice', e.target.value)}
                                                    className="w-full bg-gray-900 border border-gray-700 rounded-lg p-2 text-white text-sm"
                                                    placeholder="Yeni Fiyat"
                                                />
                                            </div>
                                            <div className="flex-1">
                                                <input
                                                    type="text"
                                                    value={product.oldPrice || ''}
                                                    onChange={(e) => updateProduct('oldPrice', e.target.value)}
                                                    className="w-full bg-gray-900 border border-gray-700 rounded-lg p-2 text-white text-sm"
                                                    placeholder="Eski Fiyat (Ops)"
                                                />
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                <div className="grid grid-cols-2 gap-3">
                                    <div>
                                        <label className="block text-[10px] text-gray-500 font-bold mb-1 ml-1 uppercase">Mağaza</label>
                                        <input
                                            type="text"
                                            value={product.brand}
                                            onChange={(e) => updateProduct('brand', e.target.value)}
                                            className="w-full bg-gray-900 border border-gray-700 rounded-lg p-2 text-white text-sm"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-[10px] text-gray-500 font-bold mb-1 ml-1 uppercase">Kategori</label>
                                        <select
                                            value={product.category}
                                            onChange={(e) => updateProduct('category', e.target.value)}
                                            className="w-full bg-gray-900 border border-gray-700 rounded-lg p-2 text-white text-sm"
                                        >
                                            <option value="Diğer">Kategori Seç</option>
                                            <option value="Gıda & Market">Gıda & Market</option>
                                            <option value="Giyim & Ayakkabı">Giyim & Ayakkabı</option>
                                            <option value="Elektronik">Elektronik</option>
                                            <option value="Ev & Yaşam">Ev & Yaşam</option>
                                            <option value="Kişisel Bakım">Kişisel Bakım</option>
                                            <option value="Anne & Bebek">Anne & Bebek</option>
                                        </select>
                                    </div>
                                </div>

                                <div>
                                    <label className="block text-[10px] text-gray-500 font-bold mb-1 ml-1 uppercase">Açıklama</label>
                                    <textarea
                                        value={product.description}
                                        onChange={(e) => updateProduct('description', e.target.value)}
                                        className="w-full bg-gray-900 border border-gray-700 rounded-lg p-2 text-white text-sm min-h-[100px]"
                                        placeholder="Ürün Açıklaması"
                                    />
                                </div>

                                <div className="flex gap-3 pt-2">
                                    <button
                                        onClick={() => { setProduct(null); setLink(''); }}
                                        className="px-6 py-3 bg-gray-700 hover:bg-gray-600 text-white font-bold rounded-xl transition-colors"
                                    >
                                        İptal
                                    </button>
                                    <button
                                        onClick={handlePublish}
                                        disabled={isPublishing || !product.title}
                                        className="flex-1 py-3 bg-gradient-to-r from-green-600 to-emerald-600 text-white font-bold rounded-xl disabled:opacity-50 shadow-lg shadow-green-900/30"
                                    >
                                        {isPublishing ? '🚀 Yayınlanıyor...' : '🚀 İndirimi Yayınla'}
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Akakce Hızlı Erişim */}
                    <div className="bg-gray-800 rounded-xl border border-gray-700 overflow-hidden shadow-xl">
                        <div className="bg-gradient-to-r from-orange-600/20 to-red-600/20 px-5 py-4 border-b border-gray-700">
                            <h2 className="text-lg font-bold text-white flex items-center gap-2">
                                <span className="text-xl">🔥</span> Akakce Fırsat Kaynakları
                            </h2>
                        </div>
                        <div className="p-4 space-y-3">
                            <a href="https://www.akakce.com/fark-atan-fiyatlar/" target="_blank" rel="noopener noreferrer" className="flex items-center justify-between p-4 bg-gray-900/50 rounded-xl border border-gray-700 hover:border-orange-500 hover:bg-gray-900 transition-all group">
                                <span className="text-white font-medium">🏷️ Fark Atan Fiyatlar</span>
                                <span className="text-orange-400 group-hover:translate-x-1 transition-transform">→</span>
                            </a>
                            <a href="https://www.akakce.com/son-alti-ayin-en-ucuz-fiyatli-urunleri/" target="_blank" rel="noopener noreferrer" className="flex items-center justify-between p-4 bg-gray-900/50 rounded-xl border border-gray-700 hover:border-green-500 hover:bg-gray-900 transition-all group">
                                <span className="text-white font-medium">📉 Son 6 Ayın En Ucuzları</span>
                                <span className="text-green-400 group-hover:translate-x-1 transition-transform">→</span>
                            </a>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default AffiliateLinkManager;
