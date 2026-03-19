
import React, { useState, useEffect } from 'react';
import type { Discount } from '../types';
import { updateDiscount } from '../services/firebase';
import { uploadToImgbb, deleteFromImgbb } from '../services/imgbb';


interface EditDiscountModalProps {
    discount: Discount;
    onClose: () => void;
    onSaveSuccess: () => void;
    isAdmin: boolean;
}

const EditDiscountModal: React.FC<EditDiscountModalProps> = ({ discount, onClose, onSaveSuccess, isAdmin }) => {
    const [formData, setFormData] = useState<Partial<Discount>>({});

    // Main Image states
    const [newImageFile, setNewImageFile] = useState<File | null>(null);
    const [imagePreview, setImagePreview] = useState<string>(discount.imageUrl);

    // Screenshot states
    const [newScreenshotFile, setNewScreenshotFile] = useState<File | null>(null);
    const [screenshotPreview, setScreenshotPreview] = useState<string | undefined>(discount.screenshotUrl);

    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        setFormData({
            title: discount.title,
            description: discount.description,
            brand: discount.brand,
            category: discount.category,
            link: discount.link,
            oldPrice: discount.oldPrice,
            newPrice: discount.newPrice,
        });
        setImagePreview(discount.imageUrl);
        setScreenshotPreview(discount.screenshotUrl);
        setNewImageFile(null);
        setNewScreenshotFile(null);
    }, [discount]);

    const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
        const { name, value } = e.target;
        setFormData(prev => ({ ...prev, [name]: value }));
    };

    const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files[0]) {
            const file = e.target.files[0];
            setNewImageFile(file);

            const reader = new FileReader();
            reader.onloadend = () => {
                setImagePreview(reader.result as string);
            };
            reader.readAsDataURL(file);
        }
    };

    const handleScreenshotChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files[0]) {
            const file = e.target.files[0];
            setNewScreenshotFile(file);

            const reader = new FileReader();
            reader.onloadend = () => {
                setScreenshotPreview(reader.result as string);
            };
            reader.readAsDataURL(file);
        }
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setIsLoading(true);
        setError(null);

        try {
            const dataToUpdate: Partial<Omit<Discount, 'id'>> = {
                ...formData,
                oldPrice: parseFloat(String(formData.oldPrice)) || 0,
                newPrice: parseFloat(String(formData.newPrice)) || 0,
            };

            // 1. Handle Main Image Update
            const oldDeleteUrl = discount.deleteUrl;
            if (newImageFile) {
                const { downloadURL, deleteUrl } = await uploadToImgbb(newImageFile);
                dataToUpdate.imageUrl = downloadURL;
                dataToUpdate.deleteUrl = deleteUrl;
            }

            // 2. Handle Screenshot Update
            const oldScreenshotDeleteUrl = discount.screenshotDeleteUrl;
            if (newScreenshotFile) {
                const { downloadURL, deleteUrl } = await uploadToImgbb(newScreenshotFile);
                dataToUpdate.screenshotUrl = downloadURL;
                dataToUpdate.screenshotDeleteUrl = deleteUrl;
            }

            // 3. Update Firestore
            await updateDiscount(discount.id, dataToUpdate);

            // 4. Cleanup old images from ImgBB (Best effort)
            if (newImageFile && oldDeleteUrl) {
                deleteFromImgbb(oldDeleteUrl);
            }
            if (newScreenshotFile && oldScreenshotDeleteUrl) {
                deleteFromImgbb(oldScreenshotDeleteUrl);
            }

            onSaveSuccess();
        } catch (err) {
            const errorMessage = (err as any)?.code === 'permission-denied'
                ? 'Güncelleme yetkiniz yok.'
                : 'İndirim güncellenirken bir hata oluştu.';
            setError(errorMessage);
            console.error(err);
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className="fixed inset-0 bg-black bg-opacity-70 flex items-center justify-center z-[9999] p-4">
            <div className="bg-gray-800 rounded-lg shadow-xl w-full max-w-2xl max-h-[90vh] flex flex-col">
                {/* Fixed Header */}
                <div className="p-6 border-b border-gray-700 flex justify-between items-center flex-shrink-0">
                    <h3 className="text-xl font-semibold text-white">İlanı Düzenle</h3>
                    <button onClick={onClose} className="text-gray-400 hover:text-white text-3xl leading-none">&times;</button>
                </div>

                {/* Scrollable Content */}
                <div className="p-6 overflow-y-auto flex-1 overscroll-contain" style={{ WebkitOverflowScrolling: 'touch' }}>
                    <form id="edit-form" onSubmit={handleSubmit} className="space-y-4">

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div>
                                <label className="block text-sm text-gray-400 mb-1">Ürün Başlığı</label>
                                <input name="title" type="text" value={formData.title || ''} onChange={handleChange} className="w-full p-3 bg-gray-700 rounded-md border border-gray-600 text-white" required />
                            </div>
                            <div>
                                <label className="block text-sm text-gray-400 mb-1">Marka / Market</label>
                                <input name="brand" type="text" value={formData.brand || ''} onChange={handleChange} className="w-full p-3 bg-gray-700 rounded-md border border-gray-600 text-white" required />
                            </div>
                        </div>

                        <div>
                            <div className="flex justify-between items-end mb-1">
                                <label className="block text-sm text-gray-400 font-medium">Açıklama</label>
                                <button 
                                    type="button" 
                                    onClick={async () => {
                                        if (!formData.title) {
                                            setError('Açıklama yazılabilmesi için ürün başlığı gereklidir.');
                                            return;
                                        }
                                        const btn = document.getElementById('edit-ai-btn');
                                        if(btn) btn.innerText = 'Yazılıyor...';
                                        try {
                                            const prompt = `Teknik Ürün Analisti kimliğiyle, şu ürün için 45-60 kelimelik, donanım/teknik özellik odaklı, profesyonel bir inceleme metni yaz. Ürünün değerini teknik verilerle açıkla.
                                            Format: "AÇIKLAMA: [metin] | KATEGORİ: [kategori]". 
                                            Ürün: ${formData.title}`;
                                            
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
                                                let aiDesc = parts[0].replace('AÇIKLAMA:', '').trim().replace(/\*\*/g, '');
                                                let aiCat = parts[1].trim();
                                                setFormData(prev => ({ ...prev, description: aiDesc, category: aiCat }));
                                            } else {
                                                setFormData(prev => ({ ...prev, description: text.replace(/\*\*/g, '') }));
                                            }
                                        } catch (err) {
                                            console.error(err);
                                            setError('AI şu an yanıt veremiyor.');
                                        } finally {
                                            if(btn) btn.innerText = '✨ AI ile Yaz';
                                        }
                                    }}
                                    id="edit-ai-btn"
                                    className="text-[10px] bg-purple-600 hover:bg-purple-500 text-white py-0.5 px-2 rounded transition-colors font-bold"
                                >
                                    ✨ AI ile Yaz
                                </button>
                            </div>
                            <textarea name="description" value={formData.description || ''} onChange={handleChange} className="w-full p-3 bg-gray-700 rounded-md border border-gray-600 text-white border-l-4 border-l-purple-500" rows={3}></textarea>
                        </div>

                        <div>
                            <label className="block text-sm text-gray-400 mb-1">Kategori</label>
                            <select name="category" value={formData.category || ''} onChange={handleChange} className="w-full p-3 bg-gray-700 rounded-md border border-gray-600 text-white" required>
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
                            <label className="block text-sm text-gray-400 mb-1">Ürün Linki</label>
                            <div className="flex gap-2">
                                <input name="link" type="url" value={formData.link || ''} onChange={handleChange} className="flex-1 p-3 bg-gray-700 rounded-md border border-gray-600 text-white" />
                                <button
                                    type="button"
                                    onClick={() => formData.link && window.open(formData.link, '_blank')}
                                    disabled={!formData.link}
                                    className="px-4 py-3 bg-blue-600 text-white font-medium rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
                                    title="Linki yeni sekmede aç"
                                >
                                    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                                    </svg>
                                    Git
                                </button>
                            </div>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div>
                                <label className="block text-sm text-gray-400 mb-1">Eski Fiyat</label>
                                <input name="oldPrice" type="number" step="0.01" value={formData.oldPrice || ''} onChange={handleChange} className="w-full p-3 bg-gray-700 rounded-md border border-gray-600 text-white" />
                            </div>
                            <div>
                                <label className="block text-sm text-gray-400 mb-1">Yeni Fiyat</label>
                                <input name="newPrice" type="number" step="0.01" value={formData.newPrice || ''} onChange={handleChange} className="w-full p-3 bg-gray-700 rounded-md border border-gray-600 text-white" required />
                            </div>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 border-t border-gray-700 pt-4">
                            <div>
                                <label className="block text-sm text-gray-400 mb-1">Ürün Görseli</label>
                                {imagePreview && <img src={imagePreview} alt="Ürün Görseli" className="w-32 h-32 object-cover rounded-md mb-2 border border-gray-600" />}
                                <input
                                    type="file"
                                    onChange={handleImageChange}
                                    className="w-full text-sm text-gray-400 file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-semibold file:bg-blue-600 file:text-white hover:file:bg-blue-700"
                                />
                            </div>

                            <div>
                                <label className="block text-sm text-yellow-500 mb-1 font-semibold">Kanıt (Ekran Görüntüsü)</label>
                                {screenshotPreview ? (
                                    <img src={screenshotPreview} alt="Kanıt Görseli" className="w-32 h-32 object-cover rounded-md mb-2 border border-gray-600" />
                                ) : (
                                    <p className="text-xs text-gray-500 mb-2">Kanıt görseli yok.</p>
                                )}
                                <input
                                    type="file"
                                    onChange={handleScreenshotChange}
                                    className="w-full text-sm text-gray-400 file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-semibold file:bg-yellow-600 file:text-white hover:file:bg-yellow-700"
                                />
                            </div>
                        </div>

                        {error && <p className="text-red-400 text-sm mt-2">{error}</p>}
                    </form>
                </div>

                {/* Fixed Footer with Buttons */}
                <div className="p-4 border-t border-gray-700 bg-gray-800 flex justify-end space-x-2 flex-shrink-0 rounded-b-lg">
                    <button type="button" onClick={onClose} className="px-6 py-3 bg-gray-600 text-white rounded-md hover:bg-gray-500 transition-colors">İptal</button>
                    <button type="submit" form="edit-form" disabled={isLoading} className="px-6 py-3 bg-blue-600 text-white font-bold rounded-md hover:bg-blue-700 disabled:bg-gray-500 disabled:cursor-not-allowed transition-colors">
                        {isLoading ? 'Kaydediliyor...' : 'Kaydet'}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default EditDiscountModal;