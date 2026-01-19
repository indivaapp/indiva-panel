/**
 * AI Link Analyzer - Düzenlenebilir Sonuçlar
 * AI analiz eder, eksik bilgileri kullanıcı düzenleyebilir
 */

import React, { useState, useRef } from 'react';
import { analyzeProductLink, isValidProductLink, type AnalyzedProduct } from '../services/linkAnalyzer';
import { addDiscount } from '../services/firebase';
import { uploadToImgbb } from '../services/imgbb';
import type { ViewType } from '../types';

interface AffiliateLinkManagerProps {
    isAdmin: boolean;
    setActiveView?: (view: ViewType) => void;
}

const AffiliateLinkManager: React.FC<AffiliateLinkManagerProps> = ({ isAdmin }) => {
    const [link, setLink] = useState('');
    const [isAnalyzing, setIsAnalyzing] = useState(false);
    const [isPublishing, setIsPublishing] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [successMessage, setSuccessMessage] = useState<string | null>(null);
    const [status, setStatus] = useState<string>('');
    const [isUploadingImage, setIsUploadingImage] = useState(false);
    const [isUploadingProof, setIsUploadingProof] = useState(false);
    const [proofImageUrl, setProofImageUrl] = useState('');
    const fileInputRef = useRef<HTMLInputElement>(null);
    const proofInputRef = useRef<HTMLInputElement>(null);

    // Düzenlenebilir ürün bilgileri
    const [product, setProduct] = useState<AnalyzedProduct | null>(null);

    // Linki analiz et
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

    // Ürün bilgisini güncelle
    const updateProduct = (field: keyof AnalyzedProduct, value: string | number) => {
        if (!product) return;
        setProduct({ ...product, [field]: value });
    };

    // Firebase'e yayınla
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

    // Panodan yapıştır
    const handlePaste = async () => {
        try {
            const text = await navigator.clipboard.readText();
            if (text) setLink(text);
        } catch {
            const input = prompt('Linki yapıştırın:');
            if (input) setLink(input);
        }
    };

    if (!isAdmin) {
        return <div className="text-center text-red-400 p-10">Erişim yok</div>;
    }

    return (
        <div className="max-w-2xl mx-auto px-4 py-6">
            {/* Header */}
            <div className="text-center mb-6">
                <div className="text-4xl mb-2">🤖</div>
                <h1 className="text-xl font-bold text-white">AI Link Analyzer</h1>
                <p className="text-gray-400 text-sm">Link yapıştır → AI analiz etsin → Düzenle → Yayınla</p>
            </div>

            {/* Link Input */}
            <div className="bg-gray-800 rounded-xl p-5 border border-gray-700 mb-6">
                <label className="block text-gray-300 text-sm mb-2">🔗 Ürün Linki</label>
                <div className="flex gap-2 mb-3">
                    <input
                        type="url"
                        value={link}
                        onChange={(e) => setLink(e.target.value)}
                        placeholder="https://..."
                        className="flex-1 px-3 py-3 bg-gray-900 border border-gray-600 rounded-lg text-white text-sm"
                    />
                    <button onClick={handlePaste} className="px-4 bg-gray-700 rounded-lg">📋</button>
                </div>

                <button
                    onClick={handleAnalyze}
                    disabled={isAnalyzing || !link.trim()}
                    className="w-full py-3 bg-gradient-to-r from-purple-600 to-pink-600 text-white font-bold rounded-xl disabled:opacity-50"
                >
                    {isAnalyzing ? status || 'Analiz ediliyor...' : '✨ AI ile Analiz Et'}
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

            {/* Düzenlenebilir Sonuç */}
            {product && (
                <div className="bg-gray-800 rounded-xl border border-gray-700 overflow-hidden">
                    <div className="bg-gradient-to-r from-blue-600/20 to-purple-600/20 px-5 py-3 border-b border-gray-700">
                        <h2 className="text-lg font-bold text-white">📝 Düzenle & Yayınla</h2>
                    </div>

                    <div className="p-5 space-y-4">
                        {/* Başlık */}
                        <div>
                            <label className="block text-gray-400 text-xs mb-1">Ürün Başlığı</label>
                            <input
                                type="text"
                                value={product.title}
                                onChange={(e) => updateProduct('title', e.target.value)}
                                className="w-full px-3 py-2 bg-gray-900 border border-gray-600 rounded-lg text-white text-sm"
                            />
                        </div>

                        {/* Marka & Mağaza & Kategori */}
                        <div className="grid grid-cols-3 gap-3">
                            <div>
                                <label className="block text-gray-400 text-xs mb-1">Marka</label>
                                <input
                                    type="text"
                                    value={product.brand}
                                    onChange={(e) => updateProduct('brand', e.target.value)}
                                    className="w-full px-3 py-2 bg-gray-900 border border-gray-600 rounded-lg text-white text-sm"
                                />
                            </div>
                            <div>
                                <label className="block text-gray-400 text-xs mb-1">Mağaza</label>
                                <input
                                    type="text"
                                    value={product.store}
                                    onChange={(e) => updateProduct('store', e.target.value)}
                                    className="w-full px-3 py-2 bg-gray-900 border border-gray-600 rounded-lg text-white text-sm"
                                />
                            </div>
                            <div>
                                <label className="block text-gray-400 text-xs mb-1">Kategori</label>
                                <select
                                    value={product.category}
                                    onChange={(e) => updateProduct('category', e.target.value)}
                                    className="w-full px-3 py-2 bg-gray-900 border border-gray-600 rounded-lg text-white text-sm"
                                >
                                    <option>Elektronik</option>
                                    <option>Giyim</option>
                                    <option>Ev & Yaşam</option>
                                    <option>Kozmetik</option>
                                    <option>Gıda</option>
                                    <option>Spor</option>
                                    <option>Mutfak</option>
                                    <option>Diğer</option>
                                </select>
                            </div>
                        </div>

                        {/* Fiyatlar */}
                        <div className="grid grid-cols-3 gap-3">
                            <div>
                                <label className="block text-gray-400 text-xs mb-1">💰 Eski Fiyat (₺)</label>
                                <input
                                    type="number"
                                    value={product.oldPrice || ''}
                                    onChange={(e) => updateProduct('oldPrice', parseFloat(e.target.value) || 0)}
                                    placeholder="0"
                                    className="w-full px-3 py-2 bg-gray-900 border border-gray-600 rounded-lg text-white text-sm"
                                />
                            </div>
                            <div>
                                <label className="block text-gray-400 text-xs mb-1">🔥 Yeni Fiyat (₺)</label>
                                <input
                                    type="number"
                                    value={product.newPrice || ''}
                                    onChange={(e) => updateProduct('newPrice', parseFloat(e.target.value) || 0)}
                                    placeholder="0"
                                    className="w-full px-3 py-2 bg-gray-900 border border-gray-600 rounded-lg text-white text-sm"
                                />
                            </div>
                            <div>
                                <label className="block text-gray-400 text-xs mb-1">📊 İndirim %</label>
                                <input
                                    type="number"
                                    value={product.discountPercent || ''}
                                    onChange={(e) => updateProduct('discountPercent', parseInt(e.target.value) || 0)}
                                    placeholder="0"
                                    className="w-full px-3 py-2 bg-gray-900 border border-gray-600 rounded-lg text-white text-sm"
                                />
                            </div>
                        </div>

                        {/* Görsel Yükleme */}
                        <div>
                            <label className="block text-gray-400 text-xs mb-1">🖼️ Ürün Görseli</label>
                            <div className="flex gap-2">
                                <input
                                    type="url"
                                    value={product.imageUrl}
                                    onChange={(e) => updateProduct('imageUrl', e.target.value)}
                                    placeholder="https://... veya galeriden seç"
                                    className="flex-1 px-3 py-2 bg-gray-900 border border-gray-600 rounded-lg text-white text-sm"
                                />
                                <input
                                    type="file"
                                    ref={fileInputRef}
                                    accept="image/*"
                                    className="hidden"
                                    onChange={async (e) => {
                                        const file = e.target.files?.[0];
                                        if (!file) return;

                                        setIsUploadingImage(true);
                                        setError(null);

                                        try {
                                            const result = await uploadToImgbb(file);
                                            updateProduct('imageUrl', result.downloadURL);
                                            setSuccessMessage('✅ Görsel yüklendi!');
                                            setTimeout(() => setSuccessMessage(null), 2000);
                                        } catch (err: any) {
                                            setError('Görsel yüklenemedi: ' + err.message);
                                        } finally {
                                            setIsUploadingImage(false);
                                        }
                                    }}
                                />
                                <button
                                    type="button"
                                    onClick={() => fileInputRef.current?.click()}
                                    disabled={isUploadingImage}
                                    className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-sm font-medium disabled:opacity-50 whitespace-nowrap"
                                >
                                    {isUploadingImage ? '⏳' : '📷 Seç'}
                                </button>
                            </div>
                            {product.imageUrl && (
                                <img
                                    src={product.imageUrl}
                                    alt="Önizleme"
                                    className="mt-2 w-20 h-20 object-cover rounded-lg border border-gray-600"
                                    onError={(e) => (e.target as HTMLImageElement).style.display = 'none'}
                                />
                            )}
                        </div>

                        {/* Kanıt Görseli */}
                        <div>
                            <label className="block text-gray-400 text-xs mb-1">📸 Kanıt Görseli (Screenshot)</label>
                            <div className="flex gap-2">
                                <input
                                    type="url"
                                    value={proofImageUrl}
                                    onChange={(e) => setProofImageUrl(e.target.value)}
                                    placeholder="https://... veya galeriden seç"
                                    className="flex-1 px-3 py-2 bg-gray-900 border border-gray-600 rounded-lg text-white text-sm"
                                />
                                <input
                                    type="file"
                                    ref={proofInputRef}
                                    accept="image/*"
                                    className="hidden"
                                    onChange={async (e) => {
                                        const file = e.target.files?.[0];
                                        if (!file) return;

                                        setIsUploadingProof(true);
                                        setError(null);

                                        try {
                                            const result = await uploadToImgbb(file);
                                            setProofImageUrl(result.downloadURL);
                                            setSuccessMessage('✅ Kanıt görseli yüklendi!');
                                            setTimeout(() => setSuccessMessage(null), 2000);
                                        } catch (err: any) {
                                            setError('Görsel yüklenemedi: ' + err.message);
                                        } finally {
                                            setIsUploadingProof(false);
                                        }
                                    }}
                                />
                                <button
                                    type="button"
                                    onClick={() => proofInputRef.current?.click()}
                                    disabled={isUploadingProof}
                                    className="px-4 py-2 bg-orange-600 hover:bg-orange-500 text-white rounded-lg text-sm font-medium disabled:opacity-50 whitespace-nowrap"
                                >
                                    {isUploadingProof ? '⏳' : '📸 Seç'}
                                </button>
                            </div>
                            {proofImageUrl && (
                                <img
                                    src={proofImageUrl}
                                    alt="Kanıt"
                                    className="mt-2 w-20 h-20 object-cover rounded-lg border border-orange-500"
                                    onError={(e) => (e.target as HTMLImageElement).style.display = 'none'}
                                />
                            )}
                        </div>

                        {/* Açıklama */}
                        <div>
                            <label className="block text-gray-400 text-xs mb-1">✍️ Açıklama</label>
                            <textarea
                                value={product.description}
                                onChange={(e) => updateProduct('description', e.target.value)}
                                rows={3}
                                className="w-full px-3 py-2 bg-gray-900 border border-gray-600 rounded-lg text-white text-sm"
                            />
                        </div>

                        {/* Butonlar */}
                        <div className="flex gap-3 pt-2">
                            <button
                                onClick={() => { setProduct(null); setLink(''); }}
                                className="flex-1 py-3 bg-gray-700 hover:bg-gray-600 text-white rounded-xl"
                            >
                                İptal
                            </button>
                            <button
                                onClick={handlePublish}
                                disabled={isPublishing || !product.title}
                                className="flex-1 py-3 bg-gradient-to-r from-green-600 to-emerald-600 text-white font-bold rounded-xl disabled:opacity-50"
                            >
                                {isPublishing ? 'Yayınlanıyor...' : '🚀 Yayınla'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default AffiliateLinkManager;
