
import React, { useState, useEffect, useCallback } from 'react';
import { addBrochure, getBrochures, deleteAllByMarket, deleteBrochure, updateBrochureOrder } from '../services/firebase';
import { uploadToImgbb } from '../services/imgbb';
import type { Brochure } from '../types';
import DeleteImgButton from './DeleteImgButton';
import { db } from '../firebaseConfig';
import { doc, writeBatch, Timestamp, deleteField } from 'firebase/firestore';

const MARKETS = ['BİM', 'A101', 'ŞOK'];

interface BrochureManagerProps {
    setActiveView: (view: any) => void;
    isAdmin: boolean;
}

const BrochureManager: React.FC<BrochureManagerProps> = ({ isAdmin }) => {
    // Upload form state
    const [selectedMarketForUpload, setSelectedMarketForUpload] = useState('');
    const [filesToUpload, setFilesToUpload]     = useState<FileList | null>(null);
    const [isUploading, setIsUploading]         = useState(false);
    const [uploadError, setUploadError]         = useState<string | null>(null);
    const [uploadSuccess, setUploadSuccess]     = useState<string | null>(null);
    const [uploadProgress, setUploadProgress]   = useState('');

    // Management section state
    const [activeTab, setActiveTab]             = useState(MARKETS[0]);
    const [brochures, setBrochures]             = useState<Brochure[]>([]);
    const [isLoadingBrochures, setIsLoadingBrochures] = useState(false);
    const [isDeleting, setIsDeleting]           = useState(false);
    const [fetchError, setFetchError]           = useState<string | null>(null);

    // Sıralama modu
    const [isReorderMode, setIsReorderMode]     = useState(false);
    const [isSavingOrder, setIsSavingOrder]     = useState(false);
    const [orderSaved, setOrderSaved]           = useState(false);

    // AI sıralama
    const [isAISorting, setIsAISorting]         = useState(false);
    const [aiSortStatus, setAiSortStatus]       = useState('');

    const fetchBrochures = useCallback(async (market: string) => {
        setIsLoadingBrochures(true);
        setFetchError(null);
        setIsReorderMode(false);
        try {
            const data = await getBrochures(market);
            setBrochures(data);
        } catch {
            setFetchError('Aktüeller yüklenirken bir hata oluştu.');
        } finally {
            setIsLoadingBrochures(false);
        }
    }, []);

    useEffect(() => {
        fetchBrochures(activeTab);
    }, [activeTab, fetchBrochures]);

    // ── AI Tarihe Göre Sıralama ─────────────────────────────────────────────────

    const extractDateFromImage = async (imageUrl: string): Promise<Date | null> => {
        try {
            const res = await fetch(imageUrl);
            if (!res.ok) {
                console.warn('[AI Sort] Görsel yüklenemedi:', imageUrl.substring(0, 60), res.status);
                return null;
            }
            const blob = await res.blob();
            const base64 = await new Promise<string>(resolve => {
                const reader = new FileReader();
                reader.onloadend = () => resolve((reader.result as string).split(',')[1]);
                reader.readAsDataURL(blob);
            });

            const apiKey = import.meta.env.VITE_GEMINI_API_KEY;
            const geminiRes = await fetch(
                `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        contents: [{
                            parts: [
                                {
                                    text: 'This is a Turkish supermarket weekly circular cover. Find the validity date range shown on the cover (e.g. "4-10 Ocak 2025" or "4-10 May 2025"). Return ONLY the start date as an 8-digit number in YYYYMMDD format. Example: 20250104 for January 4 2025. Return only the number, nothing else. If no date found, return 0.'
                                },
                                { inlineData: { mimeType: blob.type || 'image/jpeg', data: base64 } }
                            ]
                        }],
                        generationConfig: { temperature: 0, maxOutputTokens: 20 }
                    })
                }
            );

            const json = await geminiRes.json();
            const rawText = (json?.candidates?.[0]?.content?.parts?.[0]?.text || '').trim();
            console.log('[AI Sort] Gemini yanıtı:', rawText, '| URL:', imageUrl.substring(0, 50));
            const raw = rawText.replace(/\D/g, '');

            if (!raw || raw === '0' || raw.length < 8) return null;

            const year  = parseInt(raw.substring(0, 4));
            const month = parseInt(raw.substring(4, 6)) - 1;
            const day   = parseInt(raw.substring(6, 8));

            if (year < 2020 || year > 2035 || month < 0 || month > 11 || day < 1 || day > 31) return null;
            return new Date(year, month, day);
        } catch (e) {
            console.error('[AI Sort] Hata:', e);
            return null;
        }
    };

    const handleAISort = async () => {
        if (brochures.length < 2 || isAISorting) return;
        setIsAISorting(true);
        setAiSortStatus(`0 / ${brochures.length} görsel analiz ediliyor...`);

        let completed = 0;
        try {
            const results = await Promise.all(
                brochures.map(async b => {
                    const date = await extractDateFromImage(b.imageUrl).catch(() => null);
                    completed++;
                    setAiSortStatus(`${completed} / ${brochures.length} görsel analiz edildi...`);
                    return { brochure: b, date };
                })
            );

            const foundDates = results.filter(r => r.date !== null).length;
            console.log(`[AI Sort] Toplam: ${results.length}, tarih bulunan: ${foundDates}`);
            results.forEach(r => {
                console.log(`  - ${r.brochure.imageUrl.substring(0, 50)} → ${r.date ? r.date.toLocaleDateString('tr-TR') : 'null'}`);
            });

            if (foundDates === 0) {
                setAiSortStatus('⚠ Hiçbir görselden tarih okunamadı. Konsolu kontrol edin.');
                setTimeout(() => setAiSortStatus(''), 5000);
                return;
            }

            const sorted = [...results].sort((a, b) => {
                if (!a.date && !b.date) return 0;
                if (!a.date) return 1;
                if (!b.date) return -1;
                return b.date.getTime() - a.date.getTime();
            });

            setBrochures(sorted.map(r => r.brochure));

            // publishDate alanını gerçek tarihle güncelle + order'ı temizle → getBrochures sıralaması kalıcı olur
            const marketKey = activeTab === 'BİM' ? 'bim' : activeTab === 'A101' ? 'a101' : 'sok';
            const batch = writeBatch(db);
            const base = Date.now();
            sorted.forEach((r, idx) => {
                const ref = doc(db, 'circulars', marketKey, 'brochures', r.brochure.id);
                const ts = r.date
                    ? Timestamp.fromDate(r.date)
                    : Timestamp.fromMillis(base - idx * 1000);
                batch.update(ref, { publishDate: ts, order: deleteField() });
            });
            await batch.commit();
            setAiSortStatus(`✓ ${foundDates}/${results.length} görselden tarih okundu, sıralandı!`);
            setTimeout(() => setAiSortStatus(''), 4000);
        } catch (e) {
            console.error('[AI Sort] Genel hata:', e);
            setAiSortStatus('Hata oluştu, tekrar deneyin.');
            setTimeout(() => setAiSortStatus(''), 3000);
        } finally {
            setIsAISorting(false);
        }
    };

    // ── Manuel Sıralama ─────────────────────────────────────────────────────────

    const moveItem = (index: number, direction: 'up' | 'down') => {
        const newList = [...brochures];
        const targetIndex = direction === 'up' ? index - 1 : index + 1;
        if (targetIndex < 0 || targetIndex >= newList.length) return;
        [newList[index], newList[targetIndex]] = [newList[targetIndex], newList[index]];
        setBrochures(newList);
    };

    const handleSaveOrder = async () => {
        setIsSavingOrder(true);
        try {
            await updateBrochureOrder(activeTab, brochures.map(b => b.id));
            setOrderSaved(true);
            setIsReorderMode(false);
            setTimeout(() => setOrderSaved(false), 2500);
        } catch {
            alert('Sıralama kaydedilemedi.');
        } finally {
            setIsSavingOrder(false);
        }
    };

    // ── Upload ──────────────────────────────────────────────────────────────────

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        setFilesToUpload(e.target.files);
    };

    const handleUploadSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!selectedMarketForUpload || !filesToUpload || filesToUpload.length === 0) {
            setUploadError('Lütfen bir market seçin ve en az bir dosya ekleyin.');
            return;
        }
        setIsUploading(true);
        setUploadError(null);
        setUploadSuccess(null);
        setUploadProgress('');

        const totalFiles = filesToUpload.length;
        for (let i = 0; i < totalFiles; i++) {
            const file = filesToUpload[i] as File;
            setUploadProgress(`(${i + 1}/${totalFiles}) ${file.name} yükleniyor...`);
            try {
                const { downloadURL, deleteUrl } = await uploadToImgbb(file);
                await addBrochure({
                    marketName: selectedMarketForUpload,
                    imageUrl: downloadURL,
                    deleteUrl,
                    title: `${selectedMarketForUpload} Aktüel`,
                    storeName: selectedMarketForUpload,
                    validityDate: '',
                });
            } catch (err) {
                const errorMessage = (err as any)?.code === 'permission-denied'
                    ? 'Afiş ekleme yetkiniz yok.'
                    : `${file.name} yüklenemedi.`;
                setUploadError(errorMessage);
                setIsUploading(false);
                return;
            }
        }

        setIsUploading(false);
        setUploadSuccess(`${totalFiles} adet aktüel başarıyla ${selectedMarketForUpload} için eklendi!`);
        setUploadProgress('');
        setSelectedMarketForUpload('');
        setFilesToUpload(null);
        const fileInput = document.getElementById('brochureImageFile') as HTMLInputElement;
        if (fileInput) fileInput.value = '';
        if (selectedMarketForUpload === activeTab) fetchBrochures(activeTab);
    };

    // ── Silme ───────────────────────────────────────────────────────────────────

    const handleBulkDelete = async () => {
        if (brochures.length === 0 || isLoadingBrochures || isDeleting) return;
        if (window.confirm(`${activeTab} marketine ait TÜM afişleri silmek istediğinizden emin misiniz?`)) {
            setIsDeleting(true);
            try {
                await deleteAllByMarket(activeTab);
                await fetchBrochures(activeTab);
            } catch (err: any) {
                alert(`Toplu silme hatası: ${err.message || 'Bilinmeyen hata.'}`);
            } finally {
                setIsDeleting(false);
            }
        }
    };

    const handleDeleteBrochure = async (id: string, marketName: string, deleteUrl: string) => {
        await deleteBrochure(id, marketName, deleteUrl);
        setBrochures(prev => prev.filter(b => b.id !== id));
    };

    // ── Render ──────────────────────────────────────────────────────────────────

    return (
        <div>
            <h2 className="text-3xl font-bold text-white mb-6">Aktüel Yönetimi</h2>

            {/* Yükleme formu */}
            <div className="bg-gray-800 p-6 rounded-lg shadow-lg mb-8">
                <h3 className="text-xl font-semibold mb-4 text-white">Yeni Aktüel Ekle</h3>
                <form onSubmit={handleUploadSubmit} className="space-y-4">
                    {/* Market butonları */}
                    <div className="flex gap-2">
                        {MARKETS.map(m => (
                            <button
                                key={m}
                                type="button"
                                onClick={() => setSelectedMarketForUpload(m)}
                                className={`flex-1 py-2.5 rounded-xl text-sm font-bold transition-all ${
                                    selectedMarketForUpload === m
                                        ? 'bg-blue-600 text-white shadow-lg shadow-blue-900/30'
                                        : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                                }`}
                            >
                                {m}
                            </button>
                        ))}
                    </div>

                    <input
                        id="brochureImageFile"
                        type="file"
                        onChange={handleFileChange}
                        multiple
                        accept="image/*"
                        required
                        className="w-full text-sm text-gray-400 file:mr-4 file:py-3 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-semibold file:bg-blue-600 file:text-white hover:file:bg-blue-700"
                    />
                    {uploadError   && <p className="text-red-400 text-sm">{uploadError}</p>}
                    {uploadSuccess && <p className="text-green-400 text-sm">{uploadSuccess}</p>}
                    {uploadProgress && <p className="text-blue-400 text-sm">{uploadProgress}</p>}
                    <button
                        type="submit"
                        disabled={isUploading}
                        className="w-full md:w-auto px-6 py-2 bg-green-600 rounded-md font-semibold hover:bg-green-700 disabled:bg-gray-500 disabled:cursor-not-allowed transition-colors"
                    >
                        {isUploading ? 'Yükleniyor...' : 'Yükle'}
                    </button>
                </form>
            </div>

            {/* Listeleme + sıralama */}
            <div className="bg-gray-800 p-6 rounded-lg shadow-lg">

                {/* Tab + araçlar */}
                <div className="flex flex-wrap justify-between items-center gap-3 mb-4 border-b border-gray-700 pb-4">
                    <div className="flex space-x-1">
                        {MARKETS.map(market => (
                            <button
                                key={market}
                                onClick={() => setActiveTab(market)}
                                className={`px-4 py-2 text-sm font-semibold rounded-md transition-colors ${
                                    activeTab === market ? 'bg-blue-600 text-white' : 'text-gray-300 hover:bg-gray-700'
                                }`}
                            >
                                {market}
                            </button>
                        ))}
                    </div>

                    <div className="flex items-center gap-2 flex-wrap">
                        {orderSaved && (
                            <span className="text-green-400 text-sm font-medium">✓ Sıralama kaydedildi</span>
                        )}
                        {aiSortStatus && (
                            <span className={`text-sm font-medium ${aiSortStatus.startsWith('✓') ? 'text-green-400' : aiSortStatus.startsWith('Hata') ? 'text-red-400' : 'text-blue-400'}`}>
                                {aiSortStatus}
                            </span>
                        )}

                        {/* AI Tarihe Göre Sırala */}
                        {!isReorderMode && (
                            <button
                                onClick={handleAISort}
                                disabled={brochures.length < 2 || isLoadingBrochures || isAISorting}
                                className="px-3 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:bg-gray-600 disabled:cursor-not-allowed text-white text-sm font-semibold rounded-lg transition-colors flex items-center gap-1.5"
                                title="Görsellerdeki tarihleri AI ile okuyup en yeniden eskiye sıralar"
                            >
                                {isAISorting ? (
                                    <><div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Analiz ediliyor...</>
                                ) : (
                                    <>✨ AI Tarihe Göre Sırala</>
                                )}
                            </button>
                        )}

                        {/* Manuel sıralama modu toggle */}
                        {!isReorderMode ? (
                            <button
                                onClick={() => setIsReorderMode(true)}
                                disabled={brochures.length < 2 || isLoadingBrochures}
                                className="px-3 py-2 bg-purple-600 hover:bg-purple-500 disabled:bg-gray-600 disabled:cursor-not-allowed text-white text-sm font-semibold rounded-lg transition-colors flex items-center gap-1.5"
                            >
                                ↕ Sırala
                            </button>
                        ) : (
                            <>
                                <button
                                    onClick={handleSaveOrder}
                                    disabled={isSavingOrder}
                                    className="px-3 py-2 bg-green-600 hover:bg-green-500 disabled:bg-gray-600 text-white text-sm font-bold rounded-lg transition-colors"
                                >
                                    {isSavingOrder ? 'Kaydediliyor...' : '✓ Kaydet'}
                                </button>
                                <button
                                    onClick={() => { fetchBrochures(activeTab); }}
                                    className="px-3 py-2 bg-gray-600 hover:bg-gray-500 text-gray-200 text-sm rounded-lg transition-colors"
                                >
                                    İptal
                                </button>
                            </>
                        )}

                        <button
                            type="button"
                            onClick={handleBulkDelete}
                            disabled={brochures.length === 0 || isLoadingBrochures || isDeleting || isReorderMode}
                            className="px-3 py-2 bg-red-600 hover:bg-red-700 disabled:bg-red-800 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-bold rounded-lg transition-colors"
                        >
                            {isDeleting ? 'Siliniyor...' : 'Tümünü Sil'}
                        </button>
                    </div>
                </div>

                {isReorderMode && (
                    <div className="mb-4 flex items-center gap-2 bg-purple-900/30 border border-purple-700/40 rounded-lg px-3 py-2">
                        <span className="text-purple-300 text-sm">↕ Sıralama modu — ok tuşlarıyla sırayı değiştir, sonra Kaydet'e bas.</span>
                    </div>
                )}

                {/* Grid */}
                <div className={`relative ${isDeleting ? 'opacity-50' : ''}`}>
                    {fetchError && <p className="text-red-400">{fetchError}</p>}
                    {isLoadingBrochures ? (
                        <p className="text-center py-8">Aktüeller yükleniyor...</p>
                    ) : brochures.length === 0 ? (
                        <p className="text-center text-gray-400 py-8">Bu market için yüklü aktüel bulunmuyor.</p>
                    ) : (
                        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
                            {brochures.map((brochure, index) => (
                                <div
                                    key={brochure.id}
                                    className={`relative group rounded-lg overflow-hidden transition-all ${
                                        isReorderMode ? 'ring-2 ring-purple-500/50' : ''
                                    }`}
                                >
                                    <img
                                        src={brochure.imageUrl}
                                        alt={`${brochure.marketName} Aktüel`}
                                        className="w-full h-64 object-cover"
                                    />

                                    {/* Sıra numarası — sıralama modunda */}
                                    {isReorderMode && (
                                        <div className="absolute top-2 left-2 w-6 h-6 bg-purple-600 text-white text-xs font-bold rounded-full flex items-center justify-center shadow">
                                            {index + 1}
                                        </div>
                                    )}

                                    {/* Sıralama kontrolleri */}
                                    {isReorderMode ? (
                                        <div className="absolute inset-x-0 bottom-0 flex bg-black/70">
                                            <button
                                                onClick={() => moveItem(index, 'up')}
                                                disabled={index === 0}
                                                className="flex-1 py-2.5 text-white text-lg font-bold hover:bg-white/10 disabled:opacity-20 transition-colors"
                                            >
                                                ↑
                                            </button>
                                            <div className="w-px bg-white/10" />
                                            <button
                                                onClick={() => moveItem(index, 'down')}
                                                disabled={index === brochures.length - 1}
                                                className="flex-1 py-2.5 text-white text-lg font-bold hover:bg-white/10 disabled:opacity-20 transition-colors"
                                            >
                                                ↓
                                            </button>
                                        </div>
                                    ) : (
                                        <DeleteImgButton
                                            onDelete={() => handleDeleteBrochure(brochure.id, brochure.marketName, brochure.deleteUrl)}
                                        />
                                    )}
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default BrochureManager;
