
import React, { useState, useEffect } from 'react';
import {
    getScheduledNotifications,
    addScheduledNotification,
    toggleScheduledNotification,
    deleteScheduledNotification
} from '../services/firebase';
import { sendDirectPushNotification } from '../services/fcmService';
import { uploadToImgbb } from '../services/imgbb';
import type { ScheduledNotification } from '../types';

interface NotificationSenderProps {
    isAdmin: boolean;
}

const NotificationSender: React.FC<NotificationSenderProps> = ({ isAdmin }) => {
    const [activeTab, setActiveTab] = useState<'instant' | 'scheduled'>('instant');

    // --- Instant Notification State ---
    const [title, setTitle] = useState('');
    const [message, setMessage] = useState('');
    const [link, setLink] = useState('');
    const [imageFile, setImageFile] = useState<File | null>(null);
    const [imageUrl, setImageUrl] = useState<string | null>(null); // For preview
    const [isUploading, setIsUploading] = useState(false);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState<string | null>(null);

    // --- Scheduled Notification State ---
    const [schedules, setSchedules] = useState<ScheduledNotification[]>([]);
    const [isScheduleLoading, setIsScheduleLoading] = useState(false);
    const [showScheduleModal, setShowScheduleModal] = useState(false);

    // New Schedule Form
    const [schLabel, setSchLabel] = useState('');
    const [schTime, setSchTime] = useState('09:00');
    const [schTitle, setSchTitle] = useState('');
    const [schMessage, setSchMessage] = useState('');
    const [schLink, setSchLink] = useState('');
    const [schImageFile, setSchImageFile] = useState<File | null>(null);
    const [schImageUrl, setSchImageUrl] = useState<string | null>(null); // For preview in modal

    // Fetch schedules on load
    useEffect(() => {
        if (activeTab === 'scheduled') {
            fetchSchedules();
        }
    }, [activeTab]);

    const fetchSchedules = async () => {
        setIsScheduleLoading(true);
        try {
            const data = await getScheduledNotifications();
            setSchedules(data);
        } catch (e) {
        } finally {
            setIsScheduleLoading(false);
        }
    };

    // --- Instant Notification Handlers ---

    const handleImageChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files[0]) {
            const file = e.target.files[0];
            setImageFile(file);
            // Local preview
            const reader = new FileReader();
            reader.onloadend = () => setImageUrl(reader.result as string);
            reader.readAsDataURL(file);
        }
    };

    const handleInstantSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setIsLoading(true);
        setError(null);
        setSuccess(null);

        try {
            let finalImageUrl = '';

            if (imageFile) {
                setIsUploading(true);
                const { downloadURL } = await uploadToImgbb(imageFile);
                finalImageUrl = downloadURL;
                setIsUploading(false);
            }

            // Send directly via FCM HTTP API (no Cloud Functions needed)
            const result = await sendDirectPushNotification(
                title,
                message,
                finalImageUrl || undefined,
                link || undefined
            );

            if (result.success) {
                setSuccess('Bildirim başarıyla tüm kullanıcılara gönderildi! ✅');
                setTitle('');
                setMessage('');
                setLink('');
                setImageFile(null);
                setImageUrl(null);
            } else {
                throw new Error(result.error);
            }
        } catch (err: any) {
            setIsUploading(false);
            setError(err.message || 'Bildirim gönderilemedi.');
        } finally {
            setIsLoading(false);
        }
    };

    // --- Scheduled Notification Handlers ---

    const handleSchImageChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files[0]) {
            const file = e.target.files[0];
            setSchImageFile(file);
            const reader = new FileReader();
            reader.onloadend = () => setSchImageUrl(reader.result as string);
            reader.readAsDataURL(file);
        }
    };

    const handleAddSchedule = async (e: React.FormEvent) => {
        e.preventDefault();
        setIsLoading(true);
        try {
            let finalImageUrl = '';
            if (schImageFile) {
                // Upload image for scheduled notification
                const { downloadURL } = await uploadToImgbb(schImageFile);
                finalImageUrl = downloadURL;
            }

            // Add to Firestore with keys matching FCM payload guide
            await addScheduledNotification({
                label: schLabel,
                time: schTime,
                title: schTitle,
                message: schMessage,
                url: schLink || undefined,   // Changed key to url
                image: finalImageUrl || undefined, // Changed key to image
                isActive: true
            });
            setShowScheduleModal(false);
            // Reset form
            setSchLabel('');
            setSchTime('09:00');
            setSchTitle('');
            setSchMessage('');
            setSchLink('');
            setSchImageFile(null);
            setSchImageUrl(null);
            fetchSchedules();
        } catch (e) {
            alert("Program eklenirken hata oluştu.");
        } finally {
            setIsLoading(false);
        }
    };

    const handleToggleSchedule = async (id: string, currentStatus: boolean) => {
        try {
            // Optimistic update
            setSchedules(prev => prev.map(s => s.id === id ? { ...s, isActive: !currentStatus } : s));
            await toggleScheduledNotification(id, !currentStatus);
        } catch (e) {
            fetchSchedules(); // Revert on error
        }
    };

    const handleDeleteSchedule = async (id: string) => {
        if (!window.confirm("Bu zamanlanmış bildirimi silmek istediğinize emin misiniz?")) return;
        try {
            await deleteScheduledNotification(id);
            setSchedules(prev => prev.filter(s => s.id !== id));
        } catch (e) {
        }
    };

    return (
        <div>
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-6">
                <h2 className="text-3xl font-bold text-white mb-4 md:mb-0">Bildirim & Otomasyon Merkezi</h2>

                {/* Tab Navigation */}
                <div className="bg-gray-800 p-1 rounded-lg inline-flex border border-gray-700">
                    <button
                        onClick={() => setActiveTab('instant')}
                        className={`px-6 py-2 rounded-md text-sm font-bold transition-colors ${activeTab === 'instant' ? 'bg-blue-600 text-white shadow-md' : 'text-gray-400 hover:text-white hover:bg-gray-700'}`}
                    >
                        Anlık Gönder
                    </button>
                    <button
                        onClick={() => setActiveTab('scheduled')}
                        className={`px-6 py-2 rounded-md text-sm font-bold transition-colors ${activeTab === 'scheduled' ? 'bg-blue-600 text-white shadow-md' : 'text-gray-400 hover:text-white hover:bg-gray-700'}`}
                    >
                        Zamanlayıcı (Günlük)
                    </button>
                </div>
            </div>

            {activeTab === 'instant' ? (
                <div className="bg-gray-800 p-8 rounded-xl shadow-2xl max-w-3xl mx-auto border border-gray-700">
                    <div className="flex flex-col items-center justify-center mb-8">
                        <div className="bg-blue-900/30 p-4 rounded-full mb-4 border border-blue-500/30">
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-10 w-10 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
                            </svg>
                        </div>
                        <h3 className="text-2xl font-bold text-white">Anlık Bildirim Gönder</h3>
                        <p className="text-gray-400 text-center mt-2">
                            Tüm kullanıcıların cihazlarına (iOS & Android) anında bildirim düşer.
                        </p>
                    </div>

                    <form onSubmit={handleInstantSubmit} className="space-y-5">
                        <div>
                            <label className="block text-sm font-bold text-gray-300 mb-1">Bildirim Başlığı</label>
                            <input
                                type="text"
                                placeholder="Örn: ⚡ ŞOK Market'te Büyük İndirim!"
                                value={title}
                                onChange={e => setTitle(e.target.value)}
                                className="w-full p-3 bg-gray-700 rounded-lg border border-gray-600 focus:ring-2 focus:ring-blue-500 focus:border-transparent text-white transition-all"
                                required
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-bold text-gray-300 mb-1">Bildirim İçeriği (Mesaj)</label>
                            <textarea
                                placeholder="Örn: Elektronik kategorisinde %50'ye varan büyük indirimi kaçırma. Hemen tıkla!"
                                value={message}
                                onChange={e => setMessage(e.target.value)}
                                className="w-full p-3 bg-gray-700 rounded-lg border border-gray-600 focus:ring-2 focus:ring-blue-500 focus:border-transparent text-white transition-all"
                                rows={3}
                                required
                            ></textarea>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                            <div>
                                <label className="block text-sm font-bold text-gray-300 mb-1">Hedef URL (Deep Link)</label>
                                <div className="relative">
                                    <span className="absolute inset-y-0 left-0 pl-3 flex items-center text-gray-400">
                                        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" /></svg>
                                    </span>
                                    <input
                                        type="text"
                                        placeholder="Örn: /product/123 veya https://..."
                                        value={link}
                                        onChange={e => setLink(e.target.value)}
                                        className="w-full p-3 pl-10 bg-gray-700 rounded-lg border border-gray-600 focus:ring-2 focus:ring-blue-500 focus:border-transparent text-white"
                                    />
                                </div>
                            </div>
                            <div>
                                <label className="block text-sm font-bold text-gray-300 mb-1">Büyük Resim URL (Opsiyonel)</label>
                                <input
                                    type="file"
                                    onChange={handleImageChange}
                                    accept="image/*"
                                    className="w-full text-sm text-gray-400 file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-semibold file:bg-blue-600 file:text-white hover:file:bg-blue-700"
                                />
                            </div>
                        </div>

                        {imageUrl && (
                            <div className="mt-2 p-2 bg-gray-900 rounded border border-gray-700 inline-block">
                                <p className="text-xs text-gray-500 mb-1">Görsel Önizleme:</p>
                                <img src={imageUrl} alt="Önizleme" className="h-32 object-contain rounded" />
                            </div>
                        )}

                        {error && <div className="p-3 bg-red-900/40 border border-red-800 rounded text-red-200 text-sm text-center">{error}</div>}
                        {success && <div className="p-3 bg-green-900/40 border border-green-800 rounded text-green-200 text-sm text-center">{success}</div>}

                        <button type="submit" disabled={isLoading || isUploading} className="w-full px-6 py-4 bg-gradient-to-r from-blue-600 to-indigo-700 rounded-lg font-bold text-white text-lg hover:from-blue-700 hover:to-indigo-800 disabled:from-gray-600 disabled:to-gray-700 disabled:cursor-not-allowed transition-all shadow-lg transform active:scale-[0.99] flex items-center justify-center">
                            {isUploading ? 'Görsel Yükleniyor...' : isLoading ? 'Gönderim Kuyruğuna Ekleniyor...' : (
                                <>
                                    <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                                    </svg>
                                    Bildirimi Yayınla
                                </>
                            )}
                        </button>
                    </form>
                </div>
            ) : (
                <div className="space-y-6">
                    <div className="flex flex-col md:flex-row justify-between items-center bg-gray-800 p-6 rounded-xl border border-gray-700 shadow-lg">
                        <div>
                            <h3 className="text-xl font-bold text-white">Otomatik Rutinler</h3>
                            <p className="text-gray-400 text-sm mt-1">Her gün belirlenen saatte kullanıcılara otomatik olarak hatırlatma gönderir.</p>
                        </div>
                        <button
                            onClick={() => setShowScheduleModal(true)}
                            className="mt-4 md:mt-0 bg-green-600 hover:bg-green-700 text-white px-5 py-3 rounded-lg font-bold flex items-center transition-all shadow-lg"
                        >
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                            </svg>
                            Yeni Rutin Ekle
                        </button>
                    </div>

                    {isScheduleLoading ? (
                        <div className="flex justify-center py-10">
                            <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-white"></div>
                        </div>
                    ) : schedules.length === 0 ? (
                        <div className="text-center py-16 bg-gray-800 rounded-xl border border-gray-700 border-dashed">
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-16 w-16 mx-auto text-gray-600 mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                            </svg>
                            <h4 className="text-xl font-bold text-white">Henüz rutin oluşturulmadı</h4>
                            <p className="text-gray-400 mt-2">Günlük gönderimler için sağ üstten yeni bir rutin ekleyin.</p>
                        </div>
                    ) : (
                        <div className="grid grid-cols-1 gap-4">
                            {schedules.map(item => (
                                <div key={item.id} className={`bg-gray-800 p-6 rounded-xl border flex flex-col lg:flex-row items-start lg:items-center justify-between gap-6 transition-all hover:shadow-lg ${item.isActive ? 'border-green-500/30' : 'border-gray-700 opacity-60 grayscale'}`}>
                                    <div className="flex items-start gap-5 flex-1">
                                        <div className="bg-gray-700 px-4 py-3 rounded-lg text-2xl font-mono font-bold text-white tracking-wider shadow-inner border border-gray-600">
                                            {item.time}
                                        </div>
                                        <div className="flex-1">
                                            <div className="flex items-center gap-3 mb-1">
                                                <h4 className="font-bold text-white text-lg">{item.label}</h4>
                                                {item.image && (
                                                    <span className="px-2 py-0.5 text-[10px] bg-blue-900/50 text-blue-300 border border-blue-800 rounded uppercase font-bold flex items-center">
                                                        <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
                                                        Görselli
                                                    </span>
                                                )}
                                                {item.url && (
                                                    <span className="px-2 py-0.5 text-[10px] bg-purple-900/50 text-purple-300 border border-purple-800 rounded uppercase font-bold flex items-center">
                                                        <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" /></svg>
                                                        Linkli
                                                    </span>
                                                )}
                                            </div>
                                            <p className="text-sm text-gray-300 font-medium mb-1"><span className="text-gray-500">Başlık:</span> {item.title}</p>
                                            <p className="text-xs text-gray-400"><span className="text-gray-500">Mesaj:</span> {item.message}</p>
                                        </div>
                                        {item.image && (
                                            <img src={item.image} alt="Preview" className="w-16 h-16 object-cover rounded-lg border border-gray-600 hidden sm:block" />
                                        )}
                                    </div>

                                    <div className="flex items-center justify-between w-full lg:w-auto gap-6 border-t lg:border-t-0 border-gray-700 pt-4 lg:pt-0 pl-0 lg:pl-6 border-l-0 lg:border-l">
                                        <div className="flex flex-col items-end">
                                            <span className={`text-xs font-bold mb-1 ${item.isActive ? 'text-green-400' : 'text-gray-500'}`}>
                                                {item.isActive ? 'AKTİF' : 'PASİF'}
                                            </span>
                                            <button
                                                onClick={() => handleToggleSchedule(item.id, item.isActive)}
                                                className={`w-12 h-6 rounded-full relative transition-colors ${item.isActive ? 'bg-green-600' : 'bg-gray-600'}`}
                                            >
                                                <div className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-transform shadow-sm ${item.isActive ? 'left-7' : 'left-1'}`}></div>
                                            </button>
                                        </div>
                                        <button
                                            onClick={() => handleDeleteSchedule(item.id)}
                                            className="p-3 text-red-500 hover:bg-red-900/20 rounded-lg transition-colors border border-transparent hover:border-red-900/50"
                                            title="Rutini Sil"
                                        >
                                            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                            </svg>
                                        </button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}

            {/* Add Schedule Modal */}
            {showScheduleModal && (
                <div className="fixed inset-0 bg-black bg-opacity-80 flex items-center justify-center z-[9999] p-4 backdrop-blur-sm">
                    <div className="bg-gray-800 rounded-xl shadow-2xl w-full max-w-lg p-0 border border-gray-700 overflow-hidden flex flex-col max-h-[90vh]">
                        <div className="p-5 border-b border-gray-700 bg-gray-900">
                            <h3 className="text-xl font-bold text-white flex items-center">
                                <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 mr-2 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                                </svg>
                                Yeni Günlük Rutin Ekle
                            </h3>
                        </div>

                        <div className="p-6 overflow-y-auto custom-scrollbar">
                            <form onSubmit={handleAddSchedule} className="space-y-4">
                                <div className="grid grid-cols-3 gap-4">
                                    <div className="col-span-2">
                                        <label className="block text-xs uppercase font-bold text-gray-500 mb-1">Rutin Etiketi</label>
                                        <input
                                            type="text"
                                            value={schLabel}
                                            onChange={e => setSchLabel(e.target.value)}
                                            placeholder="Örn: Sabah Bülteni"
                                            className="w-full p-2.5 bg-gray-700 rounded border border-gray-600 text-white focus:border-green-500 focus:ring-1 focus:ring-green-500"
                                            required
                                        />
                                        <p className="text-[10px] text-gray-500 mt-1">Sadece yönetim panelinde görünür.</p>
                                    </div>
                                    <div>
                                        <label className="block text-xs uppercase font-bold text-gray-500 mb-1">Saat</label>
                                        <input
                                            type="time"
                                            value={schTime}
                                            onChange={e => setSchTime(e.target.value)}
                                            className="w-full p-2.5 bg-gray-700 rounded border border-gray-600 text-white text-center font-mono font-bold"
                                            required
                                        />
                                    </div>
                                </div>

                                <div className="border-t border-gray-700 pt-4 mt-2">
                                    <label className="block text-xs uppercase font-bold text-gray-500 mb-1">Bildirim Başlığı</label>
                                    <input type="text" value={schTitle} onChange={e => setSchTitle(e.target.value)} placeholder="Kullanıcıya görünecek başlık" className="w-full p-2.5 bg-gray-700 rounded border border-gray-600 text-white" required />
                                </div>

                                <div>
                                    <label className="block text-xs uppercase font-bold text-gray-500 mb-1">Bildirim İçeriği</label>
                                    <textarea value={schMessage} onChange={e => setSchMessage(e.target.value)} placeholder="Kullanıcıya gidecek mesaj içeriği..." className="w-full p-2.5 bg-gray-700 rounded border border-gray-600 text-white" rows={3} required></textarea>
                                </div>

                                <div>
                                    <label className="block text-xs uppercase font-bold text-gray-500 mb-1">Hedef URL (Opsiyonel)</label>
                                    <input type="text" value={schLink} onChange={e => setSchLink(e.target.value)} placeholder="Örn: /product/123" className="w-full p-2.5 bg-gray-700 rounded border border-gray-600 text-white" />
                                </div>

                                <div>
                                    <label className="block text-xs uppercase font-bold text-gray-500 mb-1">Görsel (Opsiyonel)</label>
                                    <input
                                        type="file"
                                        onChange={handleSchImageChange}
                                        accept="image/*"
                                        className="w-full text-xs text-gray-400 file:mr-3 file:py-2 file:px-3 file:rounded-md file:border-0 file:text-xs file:font-bold file:bg-gray-600 file:text-white hover:file:bg-gray-500"
                                    />
                                    {schImageUrl && (
                                        <img src={schImageUrl} alt="Preview" className="mt-2 h-20 object-contain rounded border border-gray-600" />
                                    )}
                                </div>

                                <div className="flex justify-end gap-3 mt-6 pt-4 border-t border-gray-700">
                                    <button type="button" onClick={() => setShowScheduleModal(false)} className="px-4 py-2.5 text-gray-300 hover:text-white hover:bg-gray-700 rounded-lg transition-colors font-medium">İptal</button>
                                    <button type="submit" disabled={isLoading} className="px-6 py-2.5 bg-green-600 rounded-lg text-white font-bold hover:bg-green-700 shadow-lg disabled:opacity-70 flex items-center">
                                        {isLoading ? 'Kaydediliyor...' : 'Rutini Oluştur'}
                                    </button>
                                </div>
                            </form>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default NotificationSender;
