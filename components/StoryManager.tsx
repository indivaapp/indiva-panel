
import React, { useState, useEffect, useCallback } from 'react';
import {
    getInfluencerStories,
    addInfluencerStory,
    updateInfluencerStory,
    deleteInfluencerStory,
    addDiscount,
} from '../services/firebase';
import { uploadToImgbb } from '../services/imgbb';
import type { InfluencerStory } from '../types';

interface StoryManagerProps {
    isAdmin: boolean;
}

const GEMINI_KEY = (import.meta as any).env?.VITE_GEMINI_API_KEY || '';

const StoryManager: React.FC<StoryManagerProps> = () => {
    const [stories, setStories]           = useState<InfluencerStory[]>([]);
    const [isLoading, setIsLoading]       = useState(true);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [isUploading, setIsUploading]   = useState(false);
    const [error, setError]               = useState<string | null>(null);
    const [success, setSuccess]           = useState<string | null>(null);

    const [productImage, setProductImage]   = useState('');
    const [affiliateLink, setAffiliateLink] = useState('');
    const [discountCode, setDiscountCode]   = useState('');
    const [uploadError, setUploadError]     = useState<string | null>(null);
    const [alsoPublishDiscount, setAlsoPublishDiscount] = useState(false);

    const fetchStories = useCallback(async () => {
        setIsLoading(true);
        try {
            setStories(await getInfluencerStories());
        } catch {
            setError('Story\'ler yüklenemedi.');
        } finally {
            setIsLoading(false);
        }
    }, []);

    useEffect(() => { fetchStories(); }, [fetchStories]);

    const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        setUploadError(null);
        setIsUploading(true);
        try {
            const { downloadURL } = await uploadToImgbb(file);
            setProductImage(downloadURL);
        } catch {
            setUploadError('Görsel yüklenemedi. Tekrar deneyin.');
        } finally {
            setIsUploading(false);
        }
    };

    const resetForm = () => {
        setProductImage('');
        setAffiliateLink('');
        setDiscountCode('');
        setAlsoPublishDiscount(false);
        setUploadError(null);
        setError(null);
        setSuccess(null);
        const input = document.getElementById('storyImageFile') as HTMLInputElement;
        if (input) input.value = '';
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!productImage) { setError('Lütfen bir ürün görseli yükleyin.'); return; }
        if (!affiliateLink.trim()) { setError('Lütfen bir affiliate link girin.'); return; }

        setIsSubmitting(true);
        setError(null);
        setSuccess(null);

        try {
            // ── 1. Story yayınla ──────────────────────────────────────────────
            const expiresAt = new Date();
            expiresAt.setHours(expiresAt.getHours() + 24);
            await addInfluencerStory({
                imageUrl: productImage,
                affiliateLink: affiliateLink.trim(),
                discountCode: discountCode.trim() || '',
                isActive: true,
                expiresAt,
            });

            // ── 2. Onay kutucuğu işaretliyse → AI ile indirim ilanı da ekle ──
            if (alsoPublishDiscount) {
                try {
                    const res = await fetch('https://indiva-proxy.vercel.app/api/ai-scrape', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ url: affiliateLink.trim(), geminiKey: GEMINI_KEY }),
                        signal: AbortSignal.timeout(60000),
                    });
                    const data = await res.json();
                    if (data.success && data.product) {
                        const p = data.product;
                        const storeName = affiliateLink.includes('trendyol') ? 'Trendyol'
                            : affiliateLink.includes('hepsiburada') ? 'Hepsiburada'
                            : affiliateLink.includes('amazon') ? 'Amazon'
                            : affiliateLink.includes('n11') ? 'N11'
                            : 'Online Mağaza';

                        const newPrice = p.newPrice || 0;
                        const oldPrice = p.oldPrice > 0 ? p.oldPrice : newPrice > 0 ? Math.round(newPrice * 1.3) : 0;
                        const discountPercent = oldPrice > newPrice && newPrice > 0
                            ? Math.round(((oldPrice - newPrice) / oldPrice) * 100) : 0;

                        await addDiscount({
                            title:               p.title || 'Ürün',
                            brand:               storeName,
                            category:            p.category || 'Diğer',
                            link:                affiliateLink.trim(),
                            oldPrice,
                            newPrice,
                            imageUrl:            p.imageUrl || productImage,
                            deleteUrl:           '',
                            submittedBy:         'AI-Story',
                            affiliateLinkUpdated: true,
                            storeName,
                        });
                    }
                } catch {
                    // Discount ekleme başarısız olsa bile story yayınlandı
                }
            }

            setSuccess(
                alsoPublishDiscount
                    ? 'Story yayınlandı ve indirim ilanı eklendi! Story 24 saat sonra otomatik silinecek.'
                    : 'Story yayınlandı! 24 saat sonra otomatik silinecek.'
            );
            resetForm();
            await fetchStories();
        } catch (err: any) {
            setError(`Hata: ${err?.message || 'Bilinmeyen hata'}`);
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleToggleActive = async (story: InfluencerStory) => {
        try {
            await updateInfluencerStory(story.id, { isActive: !story.isActive });
            setStories(prev => prev.map(s =>
                s.id === story.id ? { ...s, isActive: !s.isActive } : s
            ));
        } catch {
            setError('Durum güncellenemedi.');
        }
    };

    const handleDelete = async (id: string) => {
        if (!window.confirm('Bu story silinecek. Emin misiniz?')) return;
        try {
            await deleteInfluencerStory(id);
            setStories(prev => prev.filter(s => s.id !== id));
        } catch {
            setError('Story silinemedi.');
        }
    };

    const formatExpiry = (ts: any) => {
        if (!ts) return '—';
        const date = ts.toDate ? ts.toDate() : new Date(ts.seconds * 1000);
        return date.toLocaleString('tr-TR', {
            day: '2-digit', month: '2-digit', year: 'numeric',
            hour: '2-digit', minute: '2-digit',
        });
    };

    const isExpired = (ts: any) => {
        if (!ts) return false;
        const date = ts.toDate ? ts.toDate() : new Date(ts.seconds * 1000);
        return date < new Date();
    };

    return (
        <div>
            <div className="mb-6">
                <h2 className="text-3xl font-bold text-white">Story Yönetimi</h2>
                <p className="text-gray-400 text-sm mt-1">
                    Her story 24 saat sonra otomatik olarak yayından kalkar.
                </p>
            </div>

            {/* FORM */}
            <div className="bg-gray-800 p-6 rounded-xl border border-gray-700 mb-8">
                <h3 className="text-lg font-semibold text-white mb-4">Yeni Story Ekle</h3>
                <form onSubmit={handleSubmit} className="space-y-4">

                    {/* Görsel yükleme */}
                    <div>
                        <label className="block text-sm text-gray-400 mb-2 font-medium">
                            Ürün Görseli <span className="text-red-400">*</span>
                        </label>
                        <input
                            id="storyImageFile"
                            type="file"
                            accept="image/*"
                            onChange={handleImageUpload}
                            disabled={isUploading || isSubmitting}
                            className="w-full text-sm text-gray-400 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-purple-600 file:text-white hover:file:bg-purple-700 disabled:opacity-50"
                        />
                        {isUploading && (
                            <p className="text-blue-400 text-xs mt-2 flex items-center gap-1">
                                <span className="inline-block w-3 h-3 border border-blue-400 border-t-transparent rounded-full animate-spin" />
                                Görsel yükleniyor...
                            </p>
                        )}
                        {uploadError && <p className="text-red-400 text-xs mt-1">{uploadError}</p>}
                        {productImage && !isUploading && (
                            <img
                                src={productImage}
                                alt="Önizleme"
                                className="mt-3 w-24 h-24 object-cover rounded-xl border border-gray-600"
                            />
                        )}
                    </div>

                    {/* Affiliate link */}
                    <div>
                        <label className="block text-sm text-gray-400 mb-2 font-medium">
                            İndirim / Affiliate Linki <span className="text-red-400">*</span>
                        </label>
                        <input
                            type="url"
                            placeholder="https://..."
                            value={affiliateLink}
                            onChange={e => setAffiliateLink(e.target.value)}
                            disabled={isSubmitting}
                            className="w-full p-3 bg-gray-700 rounded-lg border border-gray-600 text-white placeholder-gray-500 focus:border-purple-500 focus:outline-none"
                        />
                    </div>

                    {/* İndirim kodu */}
                    <div>
                        <label className="block text-sm text-gray-400 mb-2 font-medium">
                            İndirim Kodu <span className="text-gray-500 font-normal">(opsiyonel)</span>
                        </label>
                        <input
                            type="text"
                            placeholder="Örn: INDIVA20"
                            value={discountCode}
                            onChange={e => setDiscountCode(e.target.value.toUpperCase())}
                            disabled={isSubmitting}
                            className="w-full p-3 bg-gray-700 rounded-lg border border-gray-600 text-white placeholder-gray-500 focus:border-purple-500 focus:outline-none font-mono tracking-widest"
                        />
                        <p className="text-xs text-gray-500 mt-1">
                            Girilirse uygulamada "İndirime Git" butonunun üstünde gösterilir. Tıklanınca otomatik kopyalanır.
                        </p>
                    </div>

                    {/* Onay kutucuğu — AI indirim ilanı */}
                    <label className="flex items-start gap-3 cursor-pointer group select-none">
                        <input
                            type="checkbox"
                            checked={alsoPublishDiscount}
                            onChange={e => setAlsoPublishDiscount(e.target.checked)}
                            disabled={isSubmitting}
                            className="mt-0.5 w-4 h-4 rounded accent-purple-500 cursor-pointer"
                        />
                        <span className="text-sm text-gray-300 group-hover:text-white transition-colors">
                            Aynı zamanda AI ile indirim ilanı olarak da yayınla
                            <span className="block text-xs text-gray-500 font-normal mt-0.5">
                                Affiliate link, yapay zeka tarafından analiz edilip ana sayfaya indirim ilanı olarak da eklenir.
                            </span>
                        </span>
                    </label>

                    <p className="text-xs text-gray-500">Story 24 saat sonra otomatik olarak yayından kalkacak.</p>

                    {error && <p className="text-red-400 text-sm">{error}</p>}
                    {success && <p className="text-green-400 text-sm">{success}</p>}

                    <button
                        type="submit"
                        disabled={isSubmitting || isUploading || !productImage || !affiliateLink.trim()}
                        className="w-full py-3 bg-purple-600 hover:bg-purple-500 disabled:bg-gray-600 disabled:cursor-not-allowed text-white font-bold rounded-xl transition-colors"
                    >
                        {isSubmitting
                            ? (alsoPublishDiscount ? 'Yayınlanıyor...' : 'Yayınlanıyor...')
                            : '🎬 Story Yayınla'}
                    </button>
                </form>
            </div>

            {/* LİSTE */}
            <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold text-white">
                    Yayındaki Story'ler
                    <span className="ml-2 text-sm font-normal text-gray-400">({stories.length})</span>
                </h3>
                {stories.length > 0 && (
                    <button onClick={fetchStories} className="text-xs text-gray-500 hover:text-gray-300 transition-colors">
                        Yenile
                    </button>
                )}
            </div>

            {isLoading ? (
                <div className="flex justify-center py-10">
                    <div className="w-6 h-6 border-2 border-gray-600 border-t-purple-500 rounded-full animate-spin" />
                </div>
            ) : stories.length === 0 ? (
                <div className="text-center py-12 bg-gray-800 rounded-xl border border-dashed border-gray-700">
                    <p className="text-gray-500 text-sm">Henüz yayında story yok.</p>
                </div>
            ) : (
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                    {stories.map(story => {
                        const expired = isExpired(story.expiresAt);
                        return (
                            <div
                                key={story.id}
                                className={`bg-gray-800 rounded-xl overflow-hidden border transition-all ${
                                    expired ? 'border-red-800/50 opacity-60' :
                                    story.isActive ? 'border-purple-600/40' : 'border-gray-700 opacity-70'
                                }`}
                            >
                                <div className="relative">
                                    <img
                                        src={story.imageUrl}
                                        alt="Story görseli"
                                        className="w-full aspect-square object-cover"
                                    />
                                    <span className={`absolute top-2 right-2 text-[10px] font-bold px-2 py-0.5 rounded-full ${
                                        expired ? 'bg-red-600 text-white' :
                                        story.isActive ? 'bg-green-500 text-white' : 'bg-gray-600 text-gray-300'
                                    }`}>
                                        {expired ? 'Süresi Doldu' : story.isActive ? 'Aktif' : 'Pasif'}
                                    </span>
                                </div>

                                <div className="p-3 space-y-1.5">
                                    <a
                                        href={story.affiliateLink}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="text-blue-400 text-xs hover:underline truncate block"
                                    >
                                        {story.affiliateLink}
                                    </a>
                                    {story.discountCode && (
                                        <p className="text-[11px] font-mono font-bold tracking-widest text-yellow-400 bg-yellow-400/10 px-2 py-0.5 rounded-md inline-block">
                                            🎟️ {story.discountCode}
                                        </p>
                                    )}
                                    <p className="text-[10px] text-gray-500">
                                        Bitiş: {formatExpiry(story.expiresAt)}
                                    </p>
                                </div>

                                <div className="flex border-t border-gray-700">
                                    {!expired && (
                                        <button
                                            onClick={() => handleToggleActive(story)}
                                            className="flex-1 py-2 text-xs font-semibold text-gray-300 hover:bg-gray-700 transition-colors"
                                        >
                                            {story.isActive ? 'Pasife Al' : 'Aktif Et'}
                                        </button>
                                    )}
                                    <button
                                        onClick={() => handleDelete(story.id)}
                                        className="flex-1 py-2 text-xs font-semibold text-red-400 hover:bg-gray-700 transition-colors border-l border-gray-700"
                                    >
                                        Sil
                                    </button>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
};

export default StoryManager;
