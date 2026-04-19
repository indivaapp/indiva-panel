
import React, { useState, useEffect, useCallback } from 'react';
import { addAdvertisement, getAdvertisements, deleteAdvertisement, getAdRequests } from '../services/firebase';
import { uploadToImgbb } from '../services/imgbb';
import type { Discount } from '../types';
import DeleteImgButton from './DeleteImgButton';
import AdRequestListModal from './AdRequestListModal';
import { CATEGORIES } from '../constants/categories';

interface AdManagerProps {
    isAdmin: boolean;
}

// Reklam Etiketi Seçenekleri
const AD_BADGES = [
    "Kadın Girişimci",
    "Yeni Girişimci",
    "Genç Girişimci",
    "Sosyal Sorumluluk Projesi",
    "İNDİVA Özel İndirim Kodu",
    "Sponsorlu Reklam"
];

const AdManager: React.FC<AdManagerProps> = ({ isAdmin }) => {
    const [ads, setAds] = useState<Discount[]>([]);

    // Form Fields matching DiscountManager
    const [title, setTitle] = useState(''); // productName/Title
    const [brand, setBrand] = useState(''); // sellerName/Brand
    const [category, setCategory] = useState('');
    const [link, setLink] = useState('');
    const [oldPrice, setOldPrice] = useState('');
    const [newPrice, setNewPrice] = useState('');

    // Ad Specific Field
    const [expiresAt, setExpiresAt] = useState('');
    const [adBadge, setAdBadge] = useState(''); // Reklam etiketi (örn: Kadın Girişimci)

    // Image State
    const [isUploadingImage, setIsUploadingImage] = useState(false);
    const [imageUploadError, setImageUploadError] = useState<string | null>(null);
    const [uploadedImageUrl, setUploadedImageUrl] = useState<string | null>(null);
    const [uploadedImageDeleteUrl, setUploadedImageDeleteUrl] = useState<string | null>(null);

    // Screenshot State
    const [isUploadingScreenshot, setIsUploadingScreenshot] = useState(false);
    const [screenshotUploadError, setScreenshotUploadError] = useState<string | null>(null);
    const [uploadedScreenshotUrl, setUploadedScreenshotUrl] = useState<string | null>(null);
    const [uploadedScreenshotDeleteUrl, setUploadedScreenshotDeleteUrl] = useState<string | null>(null);

    const [isSubmitting, setIsSubmitting] = useState(false);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState<string | null>(null);

    // --- Notifications (Ad Requests) ---
    const [pendingRequestCount, setPendingRequestCount] = useState(0);
    const [showRequestModal, setShowRequestModal] = useState(false);

    const fetchAds = useCallback(async () => {
        setIsLoading(true);
        try {
            const adsData = await getAdvertisements();
            setAds(adsData);
        } catch (err) {
            setError('Reklamlar yüklenemedi.');
        } finally {
            setIsLoading(false);
        }
    }, []);

    // Check for pending requests
    useEffect(() => {
        const checkRequests = async () => {
            try {
                const reqs = await getAdRequests();
                const pending = reqs.filter(r => r.status === 'pending');
                setPendingRequestCount(pending.length);
            } catch {
                // pending request count yüklenemedi
            }
        };
        checkRequests();

        // Optional: Interval to check every minute
        const interval = setInterval(checkRequests, 60000);
        return () => clearInterval(interval);
    }, []);

    useEffect(() => {
        fetchAds();
    }, [fetchAds]);

    const handleImageChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files[0]) {
            const file = e.target.files[0];

            setUploadedImageUrl(null);
            setUploadedImageDeleteUrl(null);
            setImageUploadError(null);
            setIsUploadingImage(true);

            try {
                const { downloadURL, deleteUrl } = await uploadToImgbb(file);
                setUploadedImageUrl(downloadURL);
                setUploadedImageDeleteUrl(deleteUrl);
            } catch (err) {
                    setImageUploadError('Görsel yüklenemedi.');
                e.target.value = '';
            } finally {
                setIsUploadingImage(false);
            }
        }
    };

    const handleScreenshotChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files[0]) {
            const file = e.target.files[0];

            setUploadedScreenshotUrl(null);
            setUploadedScreenshotDeleteUrl(null);
            setScreenshotUploadError(null);
            setIsUploadingScreenshot(true);

            try {
                const { downloadURL, deleteUrl } = await uploadToImgbb(file);
                setUploadedScreenshotUrl(downloadURL);
                setUploadedScreenshotDeleteUrl(deleteUrl);
            } catch (err) {
                    setScreenshotUploadError('Ekran görüntüsü yüklenemedi.');
                e.target.value = '';
            } finally {
                setIsUploadingScreenshot(false);
            }
        }
    };

    const resetForm = () => {
        setTitle('');
        setBrand('');
        setCategory('');
        setLink('');
        setOldPrice('');
        setNewPrice('');
        setExpiresAt('');
        setAdBadge(''); // Reset badge

        setUploadedImageUrl(null);
        setUploadedImageDeleteUrl(null);
        const imageInput = document.getElementById('adImageFile') as HTMLInputElement;
        if (imageInput) imageInput.value = '';

        setUploadedScreenshotUrl(null);
        setUploadedScreenshotDeleteUrl(null);
        const screenshotInput = document.getElementById('adScreenshotFile') as HTMLInputElement;
        if (screenshotInput) screenshotInput.value = '';
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();

        if (!title || !brand || !newPrice || !category || !expiresAt || !uploadedImageUrl || !link || !adBadge) {
            setError('Lütfen tüm zorunlu alanları (Reklam Etiketi dahil) doldurun.');
            return;
        }

        setIsSubmitting(true);
        setError(null);
        setSuccess(null);

        try {
            await addAdvertisement({
                title,
                brand,
                category,
                link,
                oldPrice: parseFloat(oldPrice) || 0,
                newPrice: parseFloat(newPrice),
                imageUrl: uploadedImageUrl,
                deleteUrl: uploadedImageDeleteUrl!,
                screenshotUrl: uploadedScreenshotUrl || undefined,
                screenshotDeleteUrl: uploadedScreenshotDeleteUrl || undefined,
                expiresAt: new Date(expiresAt),
                adBadge: adBadge, // Save selected badge
            });

            setSuccess('Reklam anlaşması başarıyla kaydedildi.');
            resetForm();
            await fetchAds();
        } catch (err) {
            const errorMessage = (err as any)?.code === 'permission-denied'
                ? 'Reklam ekleme yetkiniz yok.'
                : 'Reklam eklenirken bir hata oluştu.';
            setError(errorMessage);
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleDelete = async (id: string, deleteUrl: string, screenshotDeleteUrl?: string) => {
        await deleteAdvertisement(id, deleteUrl, screenshotDeleteUrl);
        setAds(prev => prev.filter(a => a.id !== id));
    };

    return (
        <div>
            <div className="flex justify-between items-center mb-6">
                <h2 className="text-3xl font-bold text-white">Reklam & Sponsorluk Yönetimi</h2>

                {/* Notification Button */}
                <button
                    onClick={() => setShowRequestModal(true)}
                    className="relative p-2 bg-gray-800 rounded-full hover:bg-gray-700 transition-colors border border-gray-600 group"
                    title="Reklam Başvuruları"
                >
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-white group-hover:text-yellow-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
                    </svg>
                    {pendingRequestCount > 0 && (
                        <span className="absolute -top-1 -right-1 bg-red-600 text-white text-xs font-bold w-5 h-5 flex items-center justify-center rounded-full animate-bounce">
                            {pendingRequestCount}
                        </span>
                    )}
                </button>
            </div>

            <div className="bg-gray-800 p-6 rounded-lg shadow-lg mb-8">
                <h3 className="text-xl font-semibold mb-4">Yeni Reklam Anlaşması Ekle</h3>
                <p className="text-sm text-gray-400 mb-4">
                    Eklenen reklamlar, belirtilen <span className="text-yellow-500 font-bold">tarih ve saatte</span> uygulamadan otomatik olarak kaldırılacaktır.
                </p>

                <form onSubmit={handleSubmit} className="space-y-4">
                    {/* Row 1: Title & Brand */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <input type="text" placeholder="Ürün Başlığı" value={title} onChange={e => setTitle(e.target.value)} className="w-full p-3 bg-gray-700 rounded-md border border-gray-600" required />
                        <input type="text" placeholder="Marka / Satıcı" value={brand} onChange={e => setBrand(e.target.value)} className="w-full p-3 bg-gray-700 rounded-md border border-gray-600" required />
                    </div>


                    {/* Row 3: Category & Ad Badge */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <select value={category} onChange={(e) => setCategory(e.target.value)} className="w-full p-3 bg-gray-700 rounded-md border border-gray-600" required>
                            <option value="">Ürün Kategorisi Seçin</option>
                            {CATEGORIES.map(cat => (
                                <option key={cat} value={cat}>{cat}</option>
                            ))}
                        </select>

                        {/* NEW: Ad Badge Selection */}
                        <select value={adBadge} onChange={(e) => setAdBadge(e.target.value)} className="w-full p-3 bg-yellow-900/30 text-yellow-100 rounded-md border border-yellow-600 focus:border-yellow-400" required>
                            <option value="" className="text-gray-400">Reklam Etiketi Seçin (Sol Üst Köşe)</option>
                            {AD_BADGES.map(badge => (
                                <option key={badge} value={badge} className="text-black">{badge}</option>
                            ))}
                        </select>
                    </div>

                    {/* Row 4: Date & Link */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                            <label className="block text-xs text-gray-400 mb-1 ml-1">Anlaşma Bitiş Tarihi ve Saati</label>
                            <input
                                type="datetime-local"
                                value={expiresAt}
                                onChange={e => setExpiresAt(e.target.value)}
                                className="w-full p-3 bg-gray-700 rounded-md border border-gray-600 text-white"
                                required
                            />
                        </div>
                        <div className="flex flex-col justify-end">
                            <input type="url" placeholder="Yönlendirilecek Link (https://...)" value={link} onChange={e => setLink(e.target.value)} className="w-full p-3 bg-gray-700 rounded-md border border-gray-600" required />
                        </div>
                    </div>

                    {/* Row 5: Prices */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <input type="number" step="0.01" placeholder="Eski Fiyat (Opsiyonel)" value={oldPrice} onChange={e => setOldPrice(e.target.value)} className="w-full p-3 bg-gray-700 rounded-md border border-gray-600" />
                        <input type="number" step="0.01" placeholder="Kampanya Fiyatı" value={newPrice} onChange={e => setNewPrice(e.target.value)} className="w-full p-3 bg-gray-700 rounded-md border border-gray-600" required />
                    </div>

                    {/* Row 6: Images */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6 border-t border-gray-700 pt-4">
                        {/* Main Image */}
                        <div>
                            <label className="block text-sm text-gray-400 mb-2 font-bold">1. Reklam Görseli (Zorunlu)</label>
                            <input
                                id="adImageFile"
                                type="file"
                                onChange={handleImageChange}
                                className="w-full text-sm text-gray-400 file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-semibold file:bg-blue-600 file:text-white hover:file:bg-blue-700 disabled:opacity-50"
                                required
                                disabled={isUploadingImage || isUploadingScreenshot}
                                accept="image/*"
                            />
                            {isUploadingImage && <p className="text-blue-400 text-xs mt-1">Görsel yükleniyor...</p>}
                            {imageUploadError && <p className="text-red-400 text-xs mt-1">{imageUploadError}</p>}
                            {uploadedImageUrl && (
                                <div className="mt-2">
                                    <img src={uploadedImageUrl} alt="Yüklenen" className="w-24 h-24 object-cover rounded-md border border-gray-600" />
                                </div>
                            )}
                        </div>

                        {/* Screenshot Proof */}
                        <div>
                            <label className="block text-sm text-gray-400 mb-2 font-bold text-yellow-500">2. İndirim Kanıtı (Opsiyonel)</label>
                            <input
                                id="adScreenshotFile"
                                type="file"
                                onChange={handleScreenshotChange}
                                className="w-full text-sm text-gray-400 file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-semibold file:bg-yellow-600 file:text-white hover:file:bg-yellow-700 disabled:opacity-50"
                                disabled={isUploadingImage || isUploadingScreenshot}
                                accept="image/*"
                            />
                            {isUploadingScreenshot && <p className="text-blue-400 text-xs mt-1">Yükleniyor...</p>}
                            {screenshotUploadError && <p className="text-red-400 text-xs mt-1">{screenshotUploadError}</p>}
                            {uploadedScreenshotUrl && (
                                <div className="mt-2">
                                    <img src={uploadedScreenshotUrl} alt="Kanıt" className="w-24 h-24 object-cover rounded-md border border-gray-600" />
                                </div>
                            )}
                        </div>
                    </div>

                    {error && <p className="text-red-400 text-sm">{error}</p>}
                    {success && <p className="text-green-400 text-sm">{success}</p>}

                    <button type="submit" disabled={isSubmitting || isUploadingImage || isUploadingScreenshot} className="w-full md:w-auto px-6 py-3 bg-yellow-600 text-black rounded-md font-bold hover:bg-yellow-500 disabled:bg-gray-500 disabled:cursor-not-allowed transition-colors">
                        {isSubmitting ? 'Ekleniyor...' : 'Reklamı Yayınla'}
                    </button>
                </form>
            </div>

            <h3 className="text-xl font-semibold mb-4">Yayındaki Reklamlar</h3>
            {isLoading && ads.length === 0 ? <p>Yükleniyor...</p> :
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {ads.map(ad => (
                        <div key={ad.id} className="bg-gray-800 rounded-lg shadow-lg overflow-hidden relative group border-2 border-yellow-600/50">
                            <img src={ad.imageUrl} alt={ad.title} className="w-full h-48 object-cover" />

                            {/* AD BADGE DISPLAY */}
                            <div className="absolute top-0 right-0 bg-yellow-600 text-black text-xs font-bold px-2 py-1 z-10">
                                {ad.adBadge || 'REKLAM'}
                            </div>

                            <div className="p-4">
                                <h4 className="font-bold text-lg">{ad.title}</h4>
                                <p className="text-sm text-gray-400">{ad.brand}</p>
                                <p className="text-sm text-green-400 font-bold mt-1">{ad.newPrice} TL</p>
                                <a href={ad.link} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-400 hover:underline block mt-1 truncate">{ad.link}</a>

                                {ad.screenshotUrl && <p className="text-xs text-green-500 mt-2">✔ Kanıt Yüklü</p>}

                                <p className="text-xs mt-2 text-red-400 font-mono">
                                    Bitiş: {ad.expiresAt ? new Date((ad.expiresAt as any).seconds * 1000).toLocaleString('tr-TR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'Belirtilmemiş'}
                                </p>
                            </div>
                            <DeleteImgButton
                                onDelete={() => handleDelete(ad.id, ad.deleteUrl, ad.screenshotDeleteUrl)}
                            />
                        </div>
                    ))}
                </div>
            }

            {/* REQUEST LIST MODAL */}
            {showRequestModal && (
                <AdRequestListModal onClose={() => setShowRequestModal(false)} />
            )}
        </div>
    );
};

export default AdManager;
