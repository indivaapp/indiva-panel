
import React, { useState } from 'react';
import { addDiscount } from '../services/firebase';
import { uploadToImgbb } from '../services/imgbb';
import { analyzeProductLink } from '../services/linkAnalyzer';
import type { ViewType } from '../types';

interface DiscountManagerProps {
    setActiveView: (view: ViewType) => void;
    isAdmin: boolean;
}

const DiscountManager: React.FC<DiscountManagerProps> = ({ setActiveView, isAdmin }) => {
    // Form fields state
    const [title, setTitle] = useState('');
    const [description, setDescription] = useState('');
    const [brand, setBrand] = useState('');
    const [category, setCategory] = useState('');
    const [link, setLink] = useState('');
    const [oldPrice, setOldPrice] = useState('');
    const [newPrice, setNewPrice] = useState('');

    // Product Image upload state
    const [isUploadingImage, setIsUploadingImage] = useState(false);
    const [imageUploadError, setImageUploadError] = useState<string | null>(null);
    const [uploadedImageUrl, setUploadedImageUrl] = useState<string | null>(null);
    const [uploadedImageDeleteUrl, setUploadedImageDeleteUrl] = useState<string | null>(null);

    // Screenshot (Proof) upload state
    const [isUploadingScreenshot, setIsUploadingScreenshot] = useState(false);
    const [screenshotUploadError, setScreenshotUploadError] = useState<string | null>(null);
    const [uploadedScreenshotUrl, setUploadedScreenshotUrl] = useState<string | null>(null);
    const [uploadedScreenshotDeleteUrl, setUploadedScreenshotDeleteUrl] = useState<string | null>(null);

    // Form submission state
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState<string | null>(null);

    const handleImageChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files[0]) {
            const file = e.target.files[0];

            setUploadedImageUrl(null);
            setUploadedImageDeleteUrl(null);
            setImageUploadError(null);
            setSuccess(null);
            setError(null);
            setIsUploadingImage(true);

            try {
                const { downloadURL, deleteUrl } = await uploadToImgbb(file);
                setUploadedImageUrl(downloadURL);
                setUploadedImageDeleteUrl(deleteUrl);
            } catch (err) {
                console.error(err);
                setImageUploadError('Görsel yüklenemedi. Dosya boyutunu kontrol edin veya tekrar deneyin.');
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
            setSuccess(null);
            setError(null);
            setIsUploadingScreenshot(true);

            try {
                const { downloadURL, deleteUrl } = await uploadToImgbb(file);
                setUploadedScreenshotUrl(downloadURL);
                setUploadedScreenshotDeleteUrl(deleteUrl);
            } catch (err) {
                console.error(err);
                setScreenshotUploadError('Ekran görüntüsü yüklenemedi. Dosya boyutunu kontrol edin veya tekrar deneyin.');
                e.target.value = '';
            } finally {
                setIsUploadingScreenshot(false);
            }
        }
    };

    const resetForm = () => {
        setTitle('');
        setDescription('');
        setBrand('');
        setCategory('');
        setLink('');
        setOldPrice('');
        setNewPrice('');

        // Reset Product Image
        setUploadedImageUrl(null);
        setUploadedImageDeleteUrl(null);
        setImageUploadError(null);
        const imageInput = document.getElementById('imageFile') as HTMLInputElement;
        if (imageInput) imageInput.value = '';

        // Reset Screenshot
        setUploadedScreenshotUrl(null);
        setUploadedScreenshotDeleteUrl(null);
        setScreenshotUploadError(null);
        const screenshotInput = document.getElementById('screenshotFile') as HTMLInputElement;
        if (screenshotInput) screenshotInput.value = '';
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();

        if (!title || !brand || !newPrice || !category) {
            setError('Başlık, marka, kategori ve yeni fiyat alanları zorunludur.');
            return;
        }

        if (!uploadedImageUrl) {
            setError('Lütfen bir ürün görseli yükleyin.');
            return;
        }

        setIsLoading(true);
        setError(null);
        setSuccess(null);

        try {
            await addDiscount({
                title,
                description,
                brand,
                category,
                link,
                oldPrice: parseFloat(oldPrice) || 0,
                newPrice: parseFloat(newPrice),
                imageUrl: uploadedImageUrl,
                deleteUrl: uploadedImageDeleteUrl!,
                screenshotUrl: uploadedScreenshotUrl || undefined,
                screenshotDeleteUrl: uploadedScreenshotDeleteUrl || undefined,
                submittedBy: 'admin',
            });

            setSuccess('İndirim başarıyla eklendi!');
            resetForm();

        } catch (err) {
            const errorMessage = (err as any)?.code === 'permission-denied'
                ? 'İndirim ekleme yetkiniz yok.'
                : 'İndirim veritabanına eklenirken bir hata oluştu.';
            setError(errorMessage);
            console.error(err);
        } finally {
            setIsLoading(false);
        }
    };

    const handleDealFinderClick = () => {
        // Direct redirection to the requested URL
        window.open('https://onual.com/fiyat/', '_blank');
    };

    return (
        <div>
            {/* Dashboard Action Grid */}
            <div className="mb-8">
                {/* İlanları Yönet Button */}
                <button
                    onClick={() => setActiveView('manageDiscounts')}
                    className="w-full group relative overflow-hidden bg-gradient-to-br from-blue-600 to-indigo-700 p-6 rounded-xl shadow-lg hover:shadow-2xl transition-all duration-300 transform hover:-translate-y-1 border border-blue-500/30 text-left"
                >
                    <div className="absolute bottom-0 left-0 -mb-4 -ml-4 w-24 h-24 bg-white opacity-10 rounded-full blur-xl group-hover:scale-150 transition-transform duration-500"></div>
                    <div className="relative z-10 flex items-center justify-between">
                        <div>
                            <h3 className="text-2xl font-bold text-white mb-1">İlanları Yönet</h3>
                            <p className="text-blue-100 text-sm">Mevcut indirimleri düzenle veya sil.</p>
                        </div>
                        <div className="bg-white/20 p-3 rounded-lg group-hover:rotate-12 transition-transform duration-300">
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                            </svg>
                        </div>
                    </div>
                </button>
            </div>

            <div className="bg-gray-800 p-8 rounded-xl shadow-2xl border border-gray-700">
                <div className="mb-6 border-b border-gray-700 pb-4">
                    <h3 className="text-xl font-semibold text-white flex items-center">
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 mr-2 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                        </svg>
                        Yeni İndirim Ekle
                    </h3>
                </div>

                <form onSubmit={handleSubmit} className="space-y-5">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div>
                            <label className="block text-sm text-gray-400 mb-1 font-medium">Ürün Başlığı</label>
                            <input type="text" placeholder="Örn: iPhone 13 128GB" value={title} onChange={e => setTitle(e.target.value)} className="w-full p-3 bg-gray-700 rounded-lg border border-gray-600 focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all" required />
                        </div>
                        <div>
                            <label className="block text-sm text-gray-400 mb-1 font-medium">Marka / Market</label>
                            <input type="text" placeholder="Örn: Teknosa / Apple" value={brand} onChange={e => setBrand(e.target.value)} className="w-full p-3 bg-gray-700 rounded-lg border border-gray-600 focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all" required />
                        </div>
                    </div>

                    <div>
                        <div className="flex justify-between items-end mb-1">
                            <label className="block text-sm text-gray-400 font-medium">Ürün Açıklaması</label>
                            <button 
                                type="button" 
                                onClick={async () => {
                                    if (!title) {
                                        setError('Yapay zekanın açıklama yazabilmesi için önce Ürün Başlığını girmelisiniz.');
                                        return;
                                    }
                                    const btn = document.getElementById('ai-btn');
                                    if(btn) btn.innerText = 'Düşünüyor...';
                                    try {
                                        const prompt = `Şu ürün için Teknik Ürün Analisti kimliğiyle, 45-60 kelimelik, teknik detaylara (malzeme, performans, donanım) odaklanan, ikna edici ve profesyonel bir pazarlama metni yaz. Ürünün neden fırsat olduğunu teknik bir dille açıkla. Ayrıca şu kategorilerden birini seç: Teknoloji, Giyim & Ayakkabı, Ev, Yaşam & Mutfak, Kozmetik & Kişisel Bakım, Süpermarket, Anne & Bebek, Mobilya, Kitap & Kırtasiye, Spor & Outdoor, Takı & Aksesuar, Otomotiv & Motosiklet, Pet Shop, Bahçe & Yapı Market, Oyuncak & Hobi, Sağlık & Medikal, Çanta & Valiz, Saat & Gözlük, Elektronik Aksesuar, Ofis & İş Dünyası.
                                        Format: "AÇIKLAMA: [metin] | KATEGORİ: [kategori]". 
                                        Ürün: ${title}`;
                                        
                                        const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
                                            method: 'POST',
                                            headers: {
                                                'Content-Type': 'application/json',
                                                'Authorization': `Bearer ${(import.meta as any).env.VITE_OPENROUTER_API_KEY}`
                                            },
                                            body: JSON.stringify({
                                                model: 'google/gemini-2.5-flash',
                                                messages: [{ role: 'user', content: prompt }]
                                            })
                                        });

                                        if (!response.ok) throw new Error('API Hatası');
                                        const result = await response.json();
                                        const text = result.choices[0].message.content;
                                        
                                        if (text.includes('| KATEGORİ:')) {
                                            const parts = text.split('| KATEGORİ:');
                                            let aiDesc = parts[0].replace('AÇIKLAMA:', '').trim();
                                            let aiCat = parts[1].trim();
                                            aiDesc = aiDesc.replace(/\*\*/g, '');
                                            setDescription(aiDesc);
                                            setCategory(aiCat);
                                        } else {
                                            setDescription(text.replace(/\*\*/g, ''));
                                        }
                                    } catch (err) {
                                        console.error(err);
                                        setError('Yapay zeka asistanı şu an yanıt veremiyor.');
                                    } finally {
                                        if(btn) btn.innerText = '✨ AI ile Yaz';
                                    }
                                }}
                                id="ai-btn"
                                className="text-xs bg-purple-600 hover:bg-purple-500 text-white py-1 px-3 rounded-md transition-colors font-bold flex items-center gap-1"
                            >
                                ✨ AI ile Yaz
                            </button>
                        </div>
                        <textarea placeholder="Ürün hakkında kısa bilgi..." value={description} onChange={e => setDescription(e.target.value)} className="w-full p-3 bg-gray-700 rounded-lg border border-gray-600 focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all border-l-4 border-l-purple-500" rows={3}></textarea>
                    </div>

                    <div>
                        <label className="block text-sm text-gray-400 mb-1 font-medium">Kategori</label>
                        <select value={category} onChange={(e) => setCategory(e.target.value)} className="w-full p-3 bg-gray-700 rounded-lg border border-gray-600 focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all border-l-4 border-l-purple-500" required>
                            <option value="">Kategori Seçin</option>
                            <option value="Teknoloji">Teknoloji</option>
                            <option value="Giyim & Ayakkabı">Giyim & Ayakkabı</option>
                            <option value="Ev, Yaşam & Mutfak">Ev, Yaşam & Mutfak</option>
                            <option value="Kozmetik & Kişisel Bakım">Kozmetik & Kişisel Bakım</option>
                            <option value="Süpermarket">Süpermarket</option>
                            <option value="Anne & Bebek">Anne & Bebek</option>
                            <option value="Mobilya">Mobilya</option>
                            <option value="Kitap & Kırtasiye">Kitap & Kırtasiye</option>
                            <option value="Spor & Outdoor">Spor & Outdoor</option>
                            <option value="Takı & Aksesuar">Takı & Aksesuar</option>
                            <option value="Otomotiv & Motosiklet">Otomotiv & Motosiklet</option>
                            <option value="Pet Shop">Pet Shop</option>
                            <option value="Bahçe & Yapı Market">Bahçe & Yapı Market</option>
                            <option value="Oyuncak & Hobi">Oyuncak & Hobi</option>
                            <option value="Sağlık & Medikal">Sağlık & Medikal</option>
                            <option value="Çanta & Valiz">Çanta & Valiz</option>
                            <option value="Saat & Gözlük">Saat & Gözlük</option>
                            <option value="Elektronik Aksesuar">Elektronik Aksesuar</option>
                            <option value="Ofis & İş Dünyası">Ofis & İş Dünyası</option>
                            <option value="Hediyelik Eşya">Hediyelik Eşya</option>
                        </select>
                    </div>

                    <div>
                        <div className="flex justify-between items-end mb-1">
                            <label className="block text-sm text-gray-400 font-medium">Ürün Linki</label>
                            <button 
                                type="button" 
                                onClick={async () => {
                                    if (!link) {
                                        setError('Analiz için önce geçerli bir Ürün Linki girmelisiniz.');
                                        return;
                                    }
                                    const btn = document.getElementById('analyze-btn');
                                    if(btn) btn.innerText = 'Analiz Ediliyor...';
                                    setIsLoading(true);
                                    try {
                                        const analyzed = await analyzeProductLink(link);
                                        if (analyzed.error) throw new Error(analyzed.error);
                                        
                                        setTitle(analyzed.title);
                                        setBrand(analyzed.brand);
                                        setCategory(analyzed.category);
                                        setDescription(analyzed.description);
                                        if (analyzed.oldPrice) setOldPrice(analyzed.oldPrice.toString());
                                        if (analyzed.newPrice) setNewPrice(analyzed.newPrice.toString());
                                        if (analyzed.imageUrl) setUploadedImageUrl(analyzed.imageUrl);
                                        
                                        setSuccess('Ürün başarıyla analiz edildi ve form dolduruldu!');
                                    } catch (err) {
                                        console.error(err);
                                        setError('Link analiz edilemedi. Lütfen manuel girin veya başka bir link deneyin.');
                                    } finally {
                                        if(btn) btn.innerText = '🤖 Link ile Analiz Et';
                                        setIsLoading(false);
                                    }
                                }}
                                id="analyze-btn"
                                className="text-xs bg-blue-600 hover:bg-blue-500 text-white py-1 px-3 rounded-md transition-colors font-bold"
                            >
                                🤖 Link ile Analiz Et
                            </button>
                        </div>
                        <input type="url" placeholder="https://..." value={link} onChange={e => setLink(e.target.value)} className="w-full p-3 bg-gray-700 rounded-lg border border-gray-600 focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all border-l-4 border-l-blue-500" />
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div>
                            <label className="block text-sm text-gray-400 mb-1 font-medium">Eski Fiyat</label>
                            <div className="relative">
                                <span className="absolute inset-y-0 left-0 pl-3 flex items-center text-gray-400">₺</span>
                                <input type="number" step="0.01" placeholder="0.00" value={oldPrice} onChange={e => setOldPrice(e.target.value)} className="w-full p-3 pl-8 bg-gray-700 rounded-lg border border-gray-600 focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all" />
                            </div>
                        </div>
                        <div>
                            <label className="block text-sm text-green-400 mb-1 font-bold">Yeni Fiyat</label>
                            <div className="relative">
                                <span className="absolute inset-y-0 left-0 pl-3 flex items-center text-green-500">₺</span>
                                <input type="number" step="0.01" placeholder="0.00" value={newPrice} onChange={e => setNewPrice(e.target.value)} className="w-full p-3 pl-8 bg-gray-700 rounded-lg border border-green-500/50 focus:ring-2 focus:ring-green-500 focus:border-transparent transition-all font-bold text-white" required />
                            </div>
                        </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6 border-t border-gray-700 pt-6 mt-4">
                        {/* Main Image Upload */}
                        <div className="bg-gray-750 p-4 rounded-lg border border-gray-600 border-dashed hover:border-blue-500 transition-colors">
                            <label className="block text-sm text-gray-300 mb-2 font-bold flex items-center">
                                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
                                1. Ürün Görseli (Zorunlu)
                            </label>
                            <input
                                id="imageFile"
                                type="file"
                                onChange={handleImageChange}
                                className="w-full text-sm text-gray-400 file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-xs file:font-semibold file:bg-blue-600 file:text-white hover:file:bg-blue-700 disabled:opacity-50 cursor-pointer"
                                required
                                disabled={isUploadingImage || isUploadingScreenshot}
                                accept="image/*"
                            />
                            {isUploadingImage && <p className="text-blue-400 text-xs mt-2 animate-pulse">Görsel yükleniyor...</p>}
                            {imageUploadError && <p className="text-red-400 text-xs mt-2">{imageUploadError}</p>}
                            {uploadedImageUrl && (
                                <div className="mt-3">
                                    <img src={uploadedImageUrl} alt="Yüklenen" className="w-full h-32 object-contain rounded-md border border-gray-600 bg-gray-900" />
                                </div>
                            )}
                        </div>

                        {/* Screenshot Upload */}
                        <div className="bg-gray-750 p-4 rounded-lg border border-gray-600 border-dashed hover:border-yellow-500 transition-colors">
                            <label className="block text-sm text-yellow-500 mb-2 font-bold flex items-center">
                                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                                2. İndirim Kanıtı (Opsiyonel)
                            </label>
                            <input
                                id="screenshotFile"
                                type="file"
                                onChange={handleScreenshotChange}
                                className="w-full text-sm text-gray-400 file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-xs file:font-semibold file:bg-yellow-600 file:text-black hover:file:bg-yellow-500 disabled:opacity-50 cursor-pointer"
                                disabled={isUploadingImage || isUploadingScreenshot}
                                accept="image/*"
                            />
                            <p className="text-[10px] text-gray-500 mt-1">Fiyatın doğruluğunu kanıtlamak için ekran görüntüsü.</p>
                            {isUploadingScreenshot && <p className="text-blue-400 text-xs mt-2 animate-pulse">Yükleniyor...</p>}
                            {screenshotUploadError && <p className="text-red-400 text-xs mt-2">{screenshotUploadError}</p>}
                            {uploadedScreenshotUrl && (
                                <div className="mt-3">
                                    <img src={uploadedScreenshotUrl} alt="Kanıt" className="w-full h-32 object-contain rounded-md border border-gray-600 bg-gray-900" />
                                </div>
                            )}
                        </div>
                    </div>

                    {error && <div className="p-3 bg-red-900/30 border border-red-800 text-red-200 rounded text-sm">{error}</div>}
                    {success && <div className="p-3 bg-green-900/30 border border-green-800 text-green-200 rounded text-sm">{success}</div>}

                    <button type="submit" disabled={isLoading || isUploadingImage || isUploadingScreenshot} className="w-full py-4 bg-gradient-to-r from-green-600 to-emerald-600 rounded-lg font-bold text-white text-lg hover:from-green-700 hover:to-emerald-700 disabled:from-gray-600 disabled:to-gray-700 disabled:cursor-not-allowed transition-all shadow-lg transform active:scale-[0.99] mt-4">
                        {isLoading ? 'İşleniyor...' : 'İndirimi Yayınla'}
                    </button>
                </form>
            </div>
        </div>
    );
};

export default DiscountManager;
