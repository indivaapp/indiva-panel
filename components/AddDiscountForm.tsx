
import React, { useState } from 'react';
import { addDiscount } from '../services/firebase';
import { uploadToImgbb } from '../services/imgbb';
import { CATEGORIES } from '../constants/categories';
import type { ViewType } from '../types';

interface Props {
    setActiveView: (v: ViewType) => void;
    isAdmin: boolean;
}

const AddDiscountForm: React.FC<Props> = ({ setActiveView }) => {
    const [form, setForm] = useState({
        title: '',
        brand: '',
        category: '',
        link: '',
        oldPrice: '',
        newPrice: '',
    });
    const [imageFile, setImageFile] = useState<File | null>(null);
    const [imagePreview, setImagePreview] = useState('');
    const [screenshotFile, setScreenshotFile] = useState<File | null>(null);
    const [screenshotPreview, setScreenshotPreview] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [error, setError] = useState('');

    const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
        setForm(prev => ({ ...prev, [k]: e.target.value }));

    const handleImage = (e: React.ChangeEvent<HTMLInputElement>, type: 'image' | 'screenshot') => {
        const file = e.target.files?.[0];
        if (!file) return;
        const url = URL.createObjectURL(file);
        if (type === 'image') { setImageFile(file); setImagePreview(url); }
        else { setScreenshotFile(file); setScreenshotPreview(url); }
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!form.title || !form.brand || !form.category || !form.link || !form.oldPrice || !form.newPrice) {
            setError('Lütfen tüm zorunlu alanları doldurun.');
            return;
        }
        if (!imageFile) {
            setError('Ürün görseli zorunludur.');
            return;
        }
        setError('');
        setIsSubmitting(true);
        try {
            // Görseli yükle
            const imgResult = await uploadToImgbb(imageFile);

            // Opsiyonel ekran görüntüsü
            let screenshotUrl = '';
            let screenshotDeleteUrl = '';
            if (screenshotFile) {
                const ssResult = await uploadToImgbb(screenshotFile);
                screenshotUrl = ssResult.downloadURL;
                screenshotDeleteUrl = ssResult.deleteUrl;
            }

            await addDiscount({
                title: form.title,
                brand: form.brand,
                category: form.category,
                link: form.link,
                oldPrice: parseFloat(form.oldPrice),
                newPrice: parseFloat(form.newPrice),
                imageUrl: imgResult.downloadURL,
                deleteUrl: imgResult.deleteUrl,
                ...(screenshotUrl && { screenshotUrl, screenshotDeleteUrl }),
                submittedBy: 'admin',
                affiliateLinkUpdated: true,
            });

            setActiveView('discounts');
        } catch (err: any) {
            setError(err.message || 'Bir hata oluştu.');
        } finally {
            setIsSubmitting(false);
        }
    };

    const inputCls = 'w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm';
    const labelCls = 'block text-xs font-semibold text-gray-400 mb-1';

    return (
        <div className="max-w-xl mx-auto">
            <div className="flex items-center gap-3 mb-6">
                <button onClick={() => setActiveView('dashboard')} className="text-gray-400 hover:text-white transition-colors">
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
                    </svg>
                </button>
                <h2 className="text-lg font-bold text-white">Yeni İndirim Ekle</h2>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
                {/* Ürün Görseli */}
                <div>
                    <label className={labelCls}>Ürün Görseli *</label>
                    <label className={`flex flex-col items-center justify-center w-full h-36 border-2 border-dashed rounded-xl cursor-pointer transition-colors ${imagePreview ? 'border-blue-500' : 'border-gray-600 hover:border-gray-400'} overflow-hidden`}>
                        {imagePreview
                            ? <img src={imagePreview} alt="" className="h-full w-full object-contain" />
                            : <div className="text-center text-gray-400 text-sm">
                                <div className="text-2xl mb-1">📷</div>
                                <span>Görsel seç</span>
                            </div>
                        }
                        <input type="file" accept="image/*" className="hidden" onChange={e => handleImage(e, 'image')} />
                    </label>
                </div>

                {/* Başlık */}
                <div>
                    <label className={labelCls}>Başlık *</label>
                    <input className={inputCls} placeholder="Ürün adı ve indirim detayı" value={form.title} onChange={set('title')} />
                </div>

                {/* Marka & Kategori */}
                <div className="grid grid-cols-2 gap-3">
                    <div>
                        <label className={labelCls}>Marka *</label>
                        <input className={inputCls} placeholder="Nike, Apple..." value={form.brand} onChange={set('brand')} />
                    </div>
                    <div>
                        <label className={labelCls}>Kategori *</label>
                        <select className={inputCls} value={form.category} onChange={set('category')}>
                            <option value="">Seçin</option>
                            {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                        </select>
                    </div>
                </div>

                {/* Link */}
                <div>
                    <label className={labelCls}>Ürün Linki *</label>
                    <input className={inputCls} placeholder="https://..." value={form.link} onChange={set('link')} />
                </div>

                {/* Fiyatlar */}
                <div className="grid grid-cols-2 gap-3">
                    <div>
                        <label className={labelCls}>Eski Fiyat (₺) *</label>
                        <input className={inputCls} type="number" placeholder="0" value={form.oldPrice} onChange={set('oldPrice')} />
                    </div>
                    <div>
                        <label className={labelCls}>Yeni Fiyat (₺) *</label>
                        <input className={inputCls} type="number" placeholder="0" value={form.newPrice} onChange={set('newPrice')} />
                    </div>
                </div>

                {/* Kanıt Görseli (opsiyonel) */}
                <div>
                    <label className={labelCls}>Kanıt Görseli (isteğe bağlı)</label>
                    <label className={`flex items-center gap-3 w-full border border-dashed rounded-xl cursor-pointer px-4 py-3 transition-colors ${screenshotPreview ? 'border-green-500' : 'border-gray-600 hover:border-gray-400'}`}>
                        {screenshotPreview
                            ? <img src={screenshotPreview} alt="" className="h-12 w-12 object-contain rounded" />
                            : <span className="text-gray-400 text-sm">📎 Ekran görüntüsü ekle</span>
                        }
                        <input type="file" accept="image/*" className="hidden" onChange={e => handleImage(e, 'screenshot')} />
                    </label>
                </div>

                {error && <p className="text-red-400 text-sm">{error}</p>}

                <div className="flex gap-3 pt-2">
                    <button
                        type="button"
                        onClick={() => setActiveView('dashboard')}
                        className="flex-1 py-2.5 rounded-lg border border-gray-600 text-gray-300 hover:bg-gray-700 transition-colors text-sm font-semibold"
                    >
                        İptal
                    </button>
                    <button
                        type="submit"
                        disabled={isSubmitting}
                        className="flex-1 py-2.5 rounded-lg bg-green-600 hover:bg-green-500 disabled:opacity-50 text-white text-sm font-bold transition-colors"
                    >
                        {isSubmitting ? 'Yükleniyor...' : '✅ Yayınla'}
                    </button>
                </div>
            </form>
        </div>
    );
};

export default AddDiscountForm;
