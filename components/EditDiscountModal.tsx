import React, { useState, useEffect } from 'react';
import { GoogleGenAI } from '@google/genai';
import type { Discount } from '../types';
import { updateDiscount, sendNotification } from '../services/firebase';
import { sendDirectPushNotification } from '../services/fcmService';
import { uploadToImgbb, deleteFromImgbb } from '../services/imgbb';
import { CATEGORIES } from '../constants/categories';

const BADGE_PRESETS = ['Sponsorlu', 'İşbirliği', 'Genç Girişimci', 'Kadın Girişimci', 'Yerli Üretim'];

const pad = (n: number) => String(n).padStart(2, '0');

/** Firestore Timestamp veya Date → "YYYY-MM-DD" */
function toDatePart(val?: any): string {
    if (!val) return '';
    try {
        const d: Date = typeof val.toDate === 'function' ? val.toDate() : new Date(val);
        return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    } catch { return ''; }
}

/** Firestore Timestamp veya Date → "HH:MM" (yerel saat) */
function toTimePart(val?: any): string {
    if (!val) return '23:59';
    try {
        const d: Date = typeof val.toDate === 'function' ? val.toDate() : new Date(val);
        return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
    } catch { return '23:59'; }
}

interface EditDiscountModalProps {
    discount: Discount;
    onClose: () => void;
    onSaveSuccess: () => void;
    onDelete?: (d: Discount) => void;
    isAdmin: boolean;
}

const EditDiscountModal: React.FC<EditDiscountModalProps> = ({ discount, onClose, onSaveSuccess, onDelete, isAdmin }) => {
    const [formData, setFormData] = useState<Partial<Discount>>({});

    // Main Image states
    const [newImageFile, setNewImageFile] = useState<File | null>(null);
    const [imagePreview, setImagePreview] = useState<string>(discount.imageUrl);

    // Screenshot states
    const [newScreenshotFile, setNewScreenshotFile] = useState<File | null>(null);
    const [screenshotPreview, setScreenshotPreview] = useState<string | undefined>(discount.screenshotUrl);

    // Sponsorlu ilan alanları
    const [isAd, setIsAd] = useState<boolean>(discount.isAd ?? false);
    const [adBadge, setAdBadge] = useState<string>(discount.adBadge ?? '');
    const [description, setDescription] = useState<string>(discount.description ?? '');
    const [expiresDate, setExpiresDate] = useState<string>(toDatePart(discount.expiresAt));
    const [expiresTime, setExpiresTime] = useState<string>(toTimePart(discount.expiresAt));

    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Notification states — serbest başlık + açıklama
    const [notifTitle, setNotifTitle] = useState('');
    const [notifBody, setNotifBody]   = useState('');
    const [isSendingNotif, setIsSendingNotif] = useState(false);
    const [notifResult, setNotifResult] = useState<{ ok: boolean; msg: string } | null>(null);

    useEffect(() => {
        setFormData({
            title: discount.title,
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
        setIsAd(discount.isAd ?? false);
        setAdBadge(discount.adBadge ?? '');
        setDescription(discount.description ?? '');
        setExpiresDate(toDatePart(discount.expiresAt));
        setExpiresTime(toTimePart(discount.expiresAt));
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

        if (isAd && !adBadge.trim()) {
            setError('Sponsorlu ilan için rozet metni zorunludur.');
            setIsLoading(false);
            return;
        }

        try {
            const dataToUpdate: Partial<Omit<Discount, 'id'>> = {
                ...formData,
                oldPrice: parseFloat(String(formData.oldPrice)) || 0,
                newPrice: parseFloat(String(formData.newPrice)) || 0,
                // Sponsorlu ilan alanları
                isAd,
                adBadge: isAd ? adBadge.trim() : '',
                ...(isAd && description.trim() && { description: description.trim() }),
                ...(!isAd && { description: '' }),
                ...(isAd && expiresDate && { expiresAt: new Date(`${expiresDate}T${expiresTime || '23:59'}`) }),
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
                            <label className="block text-sm text-gray-400 mb-1">Kategori</label>
                            <select name="category" value={formData.category || ''} onChange={handleChange} className="w-full p-3 bg-gray-700 rounded-md border border-gray-600 text-white" required>
                                <option value="">Kategori Seçin</option>
                                {CATEGORIES.map(cat => (
                                    <option key={cat} value={cat}>{cat}</option>
                                ))}
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

                        {/* ── İlan Türü ─────────────────────────────────────── */}
                        <div className="border border-gray-600 rounded-xl p-4 space-y-3">
                            <p className="text-xs font-bold text-gray-400 uppercase tracking-wider">İlan Türü</p>

                            <div className="grid grid-cols-2 gap-2">
                                <button
                                    type="button"
                                    onClick={() => { setIsAd(false); setAdBadge(''); setDescription(''); setExpiresDate(''); setExpiresTime('23:59'); }}
                                    className={`py-2.5 rounded-lg text-sm font-semibold transition-all ${!isAd ? 'bg-blue-600 text-white shadow-lg' : 'bg-gray-700 text-gray-400 hover:bg-gray-600'}`}
                                >
                                    📋 Standart İlan
                                </button>
                                <button
                                    type="button"
                                    onClick={() => { setIsAd(true); if (!adBadge) setAdBadge('Sponsorlu'); }}
                                    className={`py-2.5 rounded-lg text-sm font-semibold transition-all ${isAd ? 'bg-yellow-400 text-yellow-900 shadow-lg' : 'bg-gray-700 text-gray-400 hover:bg-gray-600'}`}
                                >
                                    ⭐ Sponsorlu / Reklam
                                </button>
                            </div>

                            {isAd && (
                                <div className="space-y-3 pt-1">
                                    <div>
                                        <p className="text-xs text-gray-400 mb-1.5">Hızlı Seç:</p>
                                        <div className="flex flex-wrap gap-1.5">
                                            {BADGE_PRESETS.map(p => (
                                                <button
                                                    key={p}
                                                    type="button"
                                                    onClick={() => setAdBadge(p)}
                                                    className={`px-2.5 py-1 rounded-full text-xs font-bold transition-all ${
                                                        adBadge === p
                                                            ? 'bg-yellow-400 text-yellow-900'
                                                            : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                                                    }`}
                                                >
                                                    {p}
                                                </button>
                                            ))}
                                        </div>
                                    </div>

                                    <div>
                                        <label className="block text-xs font-semibold text-gray-400 mb-1">
                                            Rozet Metni *{' '}
                                            <span className="font-normal text-gray-500">({adBadge.length}/16)</span>
                                        </label>
                                        <input
                                            type="text"
                                            className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-yellow-500 text-sm"
                                            placeholder="Sponsorlu"
                                            value={adBadge}
                                            maxLength={16}
                                            onChange={e => setAdBadge(e.target.value)}
                                        />
                                        {adBadge.trim() && (
                                            <div className="mt-1.5 flex items-center gap-2">
                                                <span className="text-xs text-gray-400">Önizleme →</span>
                                                <span className="inline-block bg-yellow-400 text-yellow-900 text-[9px] font-black px-2 py-0.5 rounded uppercase tracking-wide">
                                                    {adBadge}
                                                </span>
                                                <span className="text-xs text-gray-500">sol üst köşede görünür</span>
                                            </div>
                                        )}
                                    </div>

                                    <div>
                                        <label className="block text-xs font-semibold text-gray-400 mb-1">
                                            Ürün Açıklaması{' '}
                                            <span className="font-normal text-gray-500">(opsiyonel — detay sayfasında gösterilir)</span>
                                        </label>
                                        <textarea
                                            className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-yellow-500 text-sm resize-none"
                                            rows={3}
                                            placeholder="Ürün hakkında kısa açıklama..."
                                            value={description}
                                            maxLength={300}
                                            onChange={e => setDescription(e.target.value)}
                                        />
                                        {description && (
                                            <p className="text-xs text-gray-500 mt-0.5 text-right">{description.length}/300</p>
                                        )}
                                    </div>

                                    <div>
                                        <label className="block text-xs font-semibold text-gray-400 mb-1">
                                            Bitiş Tarihi ve Saati{' '}
                                            <span className="font-normal text-gray-500">(opsiyonel — süre dolunca otomatik kaldırılır)</span>
                                        </label>
                                        <div className="flex gap-2">
                                            <input
                                                type="date"
                                                className="flex-1 bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-yellow-500 text-sm"
                                                value={expiresDate}
                                                min={new Date().toISOString().split('T')[0]}
                                                onChange={e => setExpiresDate(e.target.value)}
                                            />
                                            <input
                                                type="time"
                                                className="w-28 bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-yellow-500 text-sm"
                                                value={expiresTime}
                                                onChange={e => setExpiresTime(e.target.value)}
                                            />
                                        </div>
                                        {expiresDate && (
                                            <p className="text-xs text-gray-500 mt-1">
                                                📅 {new Date(`${expiresDate}T${expiresTime}`).toLocaleString('tr-TR')} tarihinde yayından kaldırılır
                                            </p>
                                        )}
                                    </div>
                                </div>
                            )}
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

                        {/* ── Push Bildirim ─────────────────────────────── */}
                        <div className="border-t border-gray-700 pt-4 mt-2 space-y-3">
                            <p className="text-sm font-bold text-white flex items-center gap-2">
                                🔔 Push Bildirim Gönder
                            </p>

                            {/* Başlık */}
                            <div>
                                <label className="block text-xs text-gray-400 mb-1">Bildirim Başlığı</label>
                                <input
                                    type="text"
                                    value={notifTitle}
                                    onChange={e => setNotifTitle(e.target.value)}
                                    placeholder="Bildirim başlığını yaz..."
                                    maxLength={80}
                                    className="w-full bg-gray-900 rounded-xl p-3 text-sm text-white font-medium outline-none placeholder:text-gray-500 border border-gray-700 focus:border-orange-500 transition-colors"
                                />
                            </div>

                            {/* Açıklama */}
                            <div>
                                <label className="block text-xs text-gray-400 mb-1">Bildirim Açıklaması</label>
                                <textarea
                                    value={notifBody}
                                    onChange={e => setNotifBody(e.target.value)}
                                    placeholder="Bildirim açıklamasını yaz..."
                                    maxLength={180}
                                    rows={2}
                                    className="w-full bg-gray-900 rounded-xl p-3 text-sm text-white outline-none placeholder:text-gray-500 border border-gray-700 focus:border-orange-500 transition-colors resize-none"
                                />
                            </div>

                            {/* Önizleme */}
                            <div className="bg-gray-900 rounded-xl p-3 flex items-center gap-3 text-xs text-gray-400">
                                {imagePreview && <img src={imagePreview} className="w-10 h-10 rounded-lg object-cover shrink-0" />}
                                <div className="flex-1 min-w-0">
                                    <p className="text-white font-semibold truncate">
                                        {notifTitle || <span className="text-gray-500 italic">Başlık girilmedi</span>}
                                    </p>
                                    <p className="truncate mt-0.5">
                                        {notifBody || <span className="text-gray-500 italic">Açıklama girilmedi</span>}
                                    </p>
                                </div>
                            </div>

                            {notifResult && (
                                <p className={`text-xs font-semibold ${notifResult.ok ? 'text-green-400' : 'text-red-400'}`}>
                                    {notifResult.msg}
                                </p>
                            )}

                            <button
                                type="button"
                                disabled={isSendingNotif || !notifTitle.trim() || !notifBody.trim()}
                                onClick={async () => {
                                    setIsSendingNotif(true);
                                    setNotifResult(null);
                                    try {
                                        // Push görseli için herkese açık URL gerekir — kaydedilmemiş
                                        // base64 önizleme değil, ilanın mevcut görsel URL'si kullanılır.
                                        const pushImage = discount.imageUrl || undefined;
                                        // 1) FCM v1 ile direkt gönder (all_users topic)
                                        const fcmResult = await sendDirectPushNotification(
                                            notifTitle.trim(),
                                            notifBody.trim(),
                                            pushImage,
                                            discount.link || undefined,
                                            discount.id,
                                        );
                                        if (!fcmResult.success) {
                                            throw new Error(fcmResult.error || 'FCM bildirimi gönderilemedi.');
                                        }
                                        // 2) Firestore'a geçmiş kaydı bırak
                                        await sendNotification(
                                            notifTitle.trim(),
                                            notifBody.trim(),
                                            pushImage,
                                            discount.link || undefined,
                                            discount.id,
                                        );
                                        setNotifResult({ ok: true, msg: '✅ Bildirim başarıyla gönderildi!' });
                                        setNotifTitle('');
                                        setNotifBody('');
                                    } catch {
                                        setNotifResult({ ok: false, msg: '❌ Bildirim gönderilemedi.' });
                                    } finally {
                                        setIsSendingNotif(false);
                                    }
                                }}
                                className="w-full py-3 bg-gradient-to-r from-orange-500 to-orange-600 hover:from-orange-600 hover:to-orange-700 text-white font-bold rounded-xl transition-all disabled:opacity-50 disabled:cursor-not-allowed active:scale-[0.99]"
                            >
                                {isSendingNotif ? '📤 Gönderiliyor...' : '🚀 Tüm Kullanıcılara Bildirim Gönder'}
                            </button>
                        </div>
                    </form>
                </div>

                {/* Fixed Footer */}
                <div className="p-4 border-t border-gray-700 bg-gray-800 flex gap-2 flex-shrink-0 rounded-b-lg">
                    {onDelete && (
                        <button
                            type="button"
                            onClick={() => onDelete(discount)}
                            className="px-4 py-3 bg-red-700 hover:bg-red-600 text-white font-bold rounded-md transition-colors"
                        >Sil</button>
                    )}
                    <div className="flex-1 flex justify-end gap-2">
                        <button type="button" onClick={onClose} className="px-6 py-3 bg-gray-600 text-white rounded-md hover:bg-gray-500 transition-colors">İptal</button>
                        <button type="submit" form="edit-form" disabled={isLoading} className="px-6 py-3 bg-blue-600 text-white font-bold rounded-md hover:bg-blue-700 disabled:bg-gray-500 disabled:cursor-not-allowed transition-colors">
                            {isLoading ? 'Kaydediliyor...' : 'Kaydet'}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default EditDiscountModal;