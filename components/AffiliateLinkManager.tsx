import React, { useState, useEffect, useCallback } from 'react';
import {
    getDiscountsNeedingAffiliate,
    updateAffiliateLink,
    skipAffiliateUpdate,
    skipAllAffiliateUpdates
} from '../services/firebase';
import type { Discount, ViewType } from '../types';

interface AffiliateLinkManagerProps {
    isAdmin: boolean;
    setActiveView?: (view: ViewType) => void;
}

const AffiliateLinkManager: React.FC<AffiliateLinkManagerProps> = ({ isAdmin, setActiveView }) => {
    const [discounts, setDiscounts] = useState<Discount[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [affiliateLinks, setAffiliateLinks] = useState<{ [id: string]: string }>({});
    const [savingId, setSavingId] = useState<string | null>(null);
    const [skippingAll, setSkippingAll] = useState(false);
    const [successMessage, setSuccessMessage] = useState<string | null>(null);
    const [fetching, setFetching] = useState(false);

    // İlanları yükle
    const loadDiscounts = useCallback(async () => {
        try {
            setLoading(true);
            setError(null);
            const data = await getDiscountsNeedingAffiliate();
            setDiscounts(data);
            // Mevcut linkleri inputlara doldur
            const links: { [id: string]: string } = {};
            data.forEach(d => {
                links[d.id] = d.adminAffiliateLink || '';
            });
            setAffiliateLinks(links);
        } catch (err: any) {
            setError(err.message || 'Veriler yüklenirken hata oluştu');
        } finally {
            setLoading(false);
        }
    }, []);

    // Telegram'dan yeni indirimleri çek - DOĞRUDAN FRONTEND'DEN
    const fetchNewDeals = async () => {
        try {
            setFetching(true);
            setError(null);


            // 1. dealFinder'dan Telegram verilerini çek
            const { fetchFromTelegram, resolveOnuAlLink, clearDealCache, TELEGRAM_CHANNELS } = await import('../services/dealFinder');
            const { addDiscount, getDiscounts } = await import('../services/firebase');

            // Cache'i temizle - güncel veri için
            clearDealCache();

            console.log('🔄 Telegram\'dan güncel veriler çekiliyor...');
            const deals = await fetchFromTelegram(TELEGRAM_CHANNELS[0], true);
            console.log(`📦 ${deals.length} ilan çekildi`);

            if (deals.length === 0) {
                setSuccessMessage('ℹ️ Telegram\'da yeni ilan bulunamadı');
                setTimeout(() => setSuccessMessage(null), 5000);
                return;
            }

            // 2. Mevcut ilanları al (duplicate check için)
            const existingDiscounts = await getDiscounts();
            const existingTitles = new Set(existingDiscounts.map(d => d.title.toLowerCase().trim()));

            // Son 20 ilanı al ve filtrele
            const newDeals = deals
                .slice(0, 20)
                .filter(deal => !existingTitles.has(deal.title.toLowerCase().trim()))
                .filter(deal => deal.imageUrl && deal.imageUrl.length > 10); // Görseli olmayanları atla

            console.log(`✅ ${newDeals.length} yeni ilan işlenecek`);

            if (newDeals.length === 0) {
                setSuccessMessage('ℹ️ Tüm ilanlar zaten mevcut');
                setTimeout(() => setSuccessMessage(null), 5000);
                return;
            }

            // 3. Her ilanı işle ve Firebase'e kaydet
            let published = 0;
            for (const deal of newDeals.slice(0, 10)) { // Max 10 ilan
                try {
                    // Görsel yükle (URL'den)
                    let finalImageUrl = '';
                    let deleteUrl = '';
                    if (deal.imageUrl) {
                        try {
                            const { uploadFromUrl } = await import('../services/imgbb');
                            const imgResult = await uploadFromUrl(deal.imageUrl);
                            if (imgResult) {
                                finalImageUrl = imgResult.downloadURL;
                                deleteUrl = imgResult.deleteUrl || '';
                            }
                        } catch (imgErr) {
                            console.log('⚠️ Görsel yüklenemedi:', imgErr);
                            // Görsel yüklenemezse orijinal URL'i kullan
                            finalImageUrl = deal.imageUrl;
                        }
                    }

                    // Link çözümle
                    let resolvedLink = deal.onualLink || deal.productLink || '';
                    try {
                        if (resolvedLink.includes('onu.al')) {
                            resolvedLink = await resolveOnuAlLink(resolvedLink);
                        }
                    } catch (linkErr) {
                        console.log('⚠️ Link çözümlenemedi');
                    }

                    // Mağaza adını belirle
                    const storeName = deal.source === 'trendyol' ? 'Trendyol' :
                        deal.source === 'hepsiburada' ? 'Hepsiburada' :
                            deal.source === 'amazon' ? 'Amazon' :
                                deal.source === 'n11' ? 'N11' : 'Mağaza';

                    // Açıklama oluştur
                    const description = `🔥 Bu ürün şu anda sadece ${deal.price} TL! ${storeName}'da sınırlı stokla sunulan bu fırsatı kaçırmayın!`;

                    // Firebase'e kaydet
                    await addDiscount({
                        title: deal.title,
                        description,
                        brand: '',
                        category: 'Diğer',
                        link: resolvedLink,
                        originalStoreLink: resolvedLink,
                        oldPrice: 0,
                        newPrice: deal.price || 0,
                        imageUrl: finalImageUrl,
                        deleteUrl,
                        submittedBy: 'AutoPublish',
                        affiliateLinkUpdated: false,
                        storeName
                    });

                    published++;
                    console.log(`✅ Kaydedildi: ${deal.title.substring(0, 40)}...`);

                    // Rate limiting
                    await new Promise(r => setTimeout(r, 1000));
                } catch (dealErr) {
                    console.error('❌ İlan kaydetme hatası:', dealErr);
                }
            }

            if (published > 0) {
                setSuccessMessage(`✅ ${published} yeni indirim eklendi!`);
                await loadDiscounts(); // Listeyi yenile
            } else {
                setSuccessMessage('ℹ️ Yeni indirim eklenemedi');
            }

            setTimeout(() => setSuccessMessage(null), 5000);
        } catch (err: any) {
            console.error('❌ Fetch hatası:', err);
            setError('İndirimler çekilirken hata: ' + err.message);
        } finally {
            setFetching(false);
        }
    };

    useEffect(() => {
        loadDiscounts();
    }, [loadDiscounts]);

    // Affiliate link güncelle
    const handleSave = async (discountId: string) => {
        const newLink = affiliateLinks[discountId]?.trim();
        if (!newLink) {
            alert('Lütfen bir affiliate link girin veya "Atla" butonunu kullanın.');
            return;
        }

        try {
            setSavingId(discountId);
            await updateAffiliateLink(discountId, newLink);
            setSuccessMessage('Affiliate link güncellendi!');
            // Listeden kaldır
            setDiscounts(prev => prev.filter(d => d.id !== discountId));
            setTimeout(() => setSuccessMessage(null), 3000);
        } catch (err: any) {
            alert('Güncelleme hatası: ' + err.message);
        } finally {
            setSavingId(null);
        }
    };

    // Tek bir ilanı atla
    const handleSkip = async (discountId: string) => {
        try {
            setSavingId(discountId);
            await skipAffiliateUpdate(discountId);
            setDiscounts(prev => prev.filter(d => d.id !== discountId));
        } catch (err: any) {
            alert('Atlama hatası: ' + err.message);
        } finally {
            setSavingId(null);
        }
    };

    // Tümünü atla
    const handleSkipAll = async () => {
        if (!confirm(`${discounts.length} ilan affiliate link olmadan bırakılacak. Emin misiniz?`)) {
            return;
        }

        try {
            setSkippingAll(true);
            const ids = discounts.map(d => d.id);
            await skipAllAffiliateUpdates(ids);
            setDiscounts([]);
            setSuccessMessage(`${ids.length} ilan atlandı`);
            setTimeout(() => setSuccessMessage(null), 3000);
        } catch (err: any) {
            alert('Toplu atlama hatası: ' + err.message);
        } finally {
            setSkippingAll(false);
        }
    };

    // Mağaza tipine göre örnek affiliate link
    const getExampleLink = (discount: Discount): string => {
        const store = discount.storeName?.toLowerCase() || '';
        if (store.includes('trendyol')) return 'ty.gl/XXXXX';
        if (store.includes('hepsiburada')) return 'app.hb.biz/XXXXX';
        if (store.includes('amazon')) return 'amzn.to/XXXXX';
        if (store.includes('n11')) return 'sl.n11.com/XXXXX';
        return 'affiliate-link.com/XXXXX';
    };

    if (!isAdmin) {
        return (
            <div className="text-center py-20">
                <p className="text-gray-400">Bu sayfaya erişim yetkiniz yok.</p>
            </div>
        );
    }

    return (
        <div className="max-w-4xl mx-auto">
            {/* Başlık */}
            <div className="mb-6 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-bold text-white flex items-center gap-3">
                        💰 Affiliate Link Yönetimi
                    </h1>
                    <p className="text-gray-400 mt-1">
                        Otomatik yayınlanan ilanlar için kendi affiliate linkinizi ekleyin
                    </p>
                </div>
                <button
                    onClick={fetchNewDeals}
                    disabled={fetching || loading}
                    className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg flex items-center gap-2 disabled:opacity-50 transition-colors"
                >
                    {fetching ? (
                        <>
                            <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                            Çekiliyor...
                        </>
                    ) : (
                        <>
                            🔄 Yeni İndirimleri Çek
                        </>
                    )}
                </button>
            </div>

            {/* Başarı mesajı */}
            {successMessage && (
                <div className="mb-4 p-4 bg-green-500/20 border border-green-500/30 rounded-lg text-green-400 flex items-center gap-2">
                    ✅ {successMessage}
                </div>
            )}

            {/* Hata mesajı */}
            {error && (
                <div className="mb-4 p-4 bg-red-500/20 border border-red-500/30 rounded-lg text-red-400">
                    ❌ {error}
                </div>
            )}

            {/* Yükleniyor */}
            {loading && (
                <div className="text-center py-20">
                    <div className="inline-block w-8 h-8 border-2 border-blue-500/30 border-t-blue-500 rounded-full animate-spin"></div>
                    <p className="text-gray-400 mt-4">Yükleniyor...</p>
                </div>
            )}

            {/* Boş durum */}
            {!loading && discounts.length === 0 && (
                <div className="text-center py-20 bg-gray-800/50 rounded-2xl border border-gray-700">
                    <div className="text-6xl mb-4">🎉</div>
                    <h2 className="text-xl font-bold text-white mb-2">Tüm linkler güncel!</h2>
                    <p className="text-gray-400">
                        Bekleyen affiliate link güncellemesi yok.
                    </p>
                </div>
            )}

            {/* İlan listesi */}
            {!loading && discounts.length > 0 && (
                <>
                    {/* Özet kartı */}
                    <div className="mb-6 p-4 bg-orange-500/10 border border-orange-500/30 rounded-xl flex items-center justify-between">
                        <div className="flex items-center gap-3">
                            <span className="text-3xl">🔔</span>
                            <div>
                                <p className="text-orange-400 font-semibold">
                                    {discounts.length} ilan affiliate link bekliyor
                                </p>
                                <p className="text-gray-400 text-sm">
                                    Bu ilanlar şu anda orijinal mağaza linkleriyle yayında
                                </p>
                            </div>
                        </div>
                        <button
                            onClick={handleSkipAll}
                            disabled={skippingAll}
                            className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-gray-300 rounded-lg text-sm transition-colors disabled:opacity-50"
                        >
                            {skippingAll ? 'İşleniyor...' : 'Tümünü Atla'}
                        </button>
                    </div>

                    {/* İlan kartları */}
                    <div className="space-y-4">
                        {discounts.map((discount) => (
                            <div
                                key={discount.id}
                                className="bg-gray-800/70 rounded-xl border border-gray-700 overflow-hidden"
                            >
                                <div className="flex flex-col md:flex-row">
                                    {/* Görsel */}
                                    <div className="w-full md:w-32 h-32 md:h-auto flex-shrink-0">
                                        {discount.imageUrl ? (
                                            <img
                                                src={discount.imageUrl}
                                                alt={discount.title}
                                                className="w-full h-full object-cover"
                                            />
                                        ) : (
                                            <div className="w-full h-full bg-gray-700 flex items-center justify-center text-4xl">
                                                📦
                                            </div>
                                        )}
                                    </div>

                                    {/* İçerik */}
                                    <div className="flex-1 p-4">
                                        {/* Başlık ve mağaza */}
                                        <div className="flex items-start justify-between gap-2 mb-2">
                                            <h3 className="font-semibold text-white line-clamp-2">
                                                {discount.title}
                                            </h3>
                                            <span className="flex-shrink-0 px-2 py-1 bg-blue-500/20 text-blue-400 text-xs rounded">
                                                {discount.storeName || 'Mağaza'}
                                            </span>
                                        </div>

                                        {/* Fiyat */}
                                        <p className="text-green-400 font-bold mb-3">
                                            {discount.newPrice?.toLocaleString('tr-TR')} TL
                                        </p>

                                        {/* Orijinal link */}
                                        <div className="mb-3">
                                            <label className="block text-xs text-gray-500 mb-1">
                                                Orijinal Mağaza Linki:
                                            </label>
                                            <a
                                                href={discount.originalStoreLink || discount.link}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="text-blue-400 text-sm hover:underline break-all"
                                            >
                                                {(discount.originalStoreLink || discount.link)?.substring(0, 60)}...
                                            </a>
                                        </div>

                                        {/* Affiliate link input */}
                                        <div>
                                            <label className="block text-xs text-gray-400 mb-1">
                                                Affiliate Linkiniz ({getExampleLink(discount)}):
                                            </label>
                                            <div className="flex gap-2">
                                                <input
                                                    type="url"
                                                    value={affiliateLinks[discount.id] || ''}
                                                    onChange={(e) => setAffiliateLinks(prev => ({
                                                        ...prev,
                                                        [discount.id]: e.target.value
                                                    }))}
                                                    placeholder={`https://${getExampleLink(discount)}`}
                                                    className="flex-1 px-3 py-2 bg-gray-900 border border-gray-600 rounded-lg text-white text-sm focus:outline-none focus:border-blue-500"
                                                />
                                                <button
                                                    onClick={() => handleSave(discount.id)}
                                                    disabled={savingId === discount.id}
                                                    className="px-4 py-2 bg-green-600 hover:bg-green-500 text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
                                                >
                                                    {savingId === discount.id ? '...' : 'Kaydet'}
                                                </button>
                                                <button
                                                    onClick={() => handleSkip(discount.id)}
                                                    disabled={savingId === discount.id}
                                                    className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-gray-300 rounded-lg text-sm transition-colors disabled:opacity-50"
                                                >
                                                    Atla
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                </>
            )}
        </div>
    );
};

export default AffiliateLinkManager;
