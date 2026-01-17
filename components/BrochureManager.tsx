
import React, { useState, useEffect, useCallback } from 'react';
import { addBrochure, getBrochures, deleteAllByMarket, deleteBrochure } from '../services/firebase';
import { uploadToImgbb } from '../services/imgbb';
import { fetchBrochuresFromAkakce, getMarketName, type MarketId } from '../services/brochureScraper';
import type { Brochure } from '../types';
import DeleteImgButton from './DeleteImgButton';

const MARKETS = ['BİM', 'A101', 'ŞOK'];
const MARKET_KEY_MAP: { [key: string]: string } = { 'BİM': 'bim', 'A101': 'a101', 'ŞOK': 'sok' };


interface BrochureManagerProps {
    setActiveView: (view: any) => void;
    isAdmin: boolean;
}

const BrochureManager: React.FC<BrochureManagerProps> = ({ isAdmin }) => {
    // Upload form state
    const [selectedMarketForUpload, setSelectedMarketForUpload] = useState('');
    const [filesToUpload, setFilesToUpload] = useState<FileList | null>(null);
    const [isUploading, setIsUploading] = useState(false);
    const [uploadError, setUploadError] = useState<string | null>(null);
    const [uploadSuccess, setUploadSuccess] = useState<string | null>(null);
    const [uploadProgress, setUploadProgress] = useState('');

    // Management section state
    const [activeTab, setActiveTab] = useState(MARKETS[0]);
    const [brochures, setBrochures] = useState<Brochure[]>([]);
    const [isLoadingBrochures, setIsLoadingBrochures] = useState(false);
    const [isDeleting, setIsDeleting] = useState(false);
    const [fetchError, setFetchError] = useState<string | null>(null);

    // Otomatik çekme state
    const [isAutoFetching, setIsAutoFetching] = useState(false);
    const [autoFetchProgress, setAutoFetchProgress] = useState('');


    const fetchBrochures = useCallback(async (market: string) => {
        setIsLoadingBrochures(true);
        setFetchError(null);
        try {
            const data = await getBrochures(market);
            setBrochures(data);
        } catch (err) {
            setFetchError('Aktüeller yüklenirken bir hata oluştu.');
            console.error(err);
        } finally {
            setIsLoadingBrochures(false);
        }
    }, []);

    useEffect(() => {
        fetchBrochures(activeTab);
    }, [activeTab, fetchBrochures]);

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
                });
            } catch (err) {
                const errorMessage = (err as any)?.code === 'permission-denied'
                    ? 'Afiş ekleme yetkiniz yok.'
                    : `${file.name} yüklenemedi. Lütfen tekrar deneyin.`;
                setUploadError(errorMessage);
                console.error(err);
                setIsUploading(false);
                return; // Stop on first error
            }
        }

        setIsUploading(false);
        setUploadSuccess(`${totalFiles} adet aktüel başarıyla ${selectedMarketForUpload} için eklendi!`);
        setUploadProgress('');
        setSelectedMarketForUpload('');
        setFilesToUpload(null);
        const fileInput = document.getElementById('brochureImageFile') as HTMLInputElement;
        if (fileInput) fileInput.value = '';

        if (selectedMarketForUpload === activeTab) {
            fetchBrochures(activeTab);
        }
    };

    // Otomatik aktüel çekme fonksiyonu
    const handleAutoFetch = async () => {
        const marketKey = MARKET_KEY_MAP[activeTab] as MarketId;
        if (!marketKey) return;

        const confirmMessage = `${activeTab} için mevcut aktüeller silinip, Akakce'den güncel aktüeller çekilecek. Devam etmek istiyor musunuz?`;
        if (!window.confirm(confirmMessage)) return;

        setIsAutoFetching(true);
        setAutoFetchProgress('');
        setUploadError(null);
        setUploadSuccess(null);

        try {
            // 1. Akakce'den görselleri çek (CORS proxy ile)
            const imageUrls = await fetchBrochuresFromAkakce(marketKey, (step) => {
                setAutoFetchProgress(step);
            });

            if (imageUrls.length === 0) {
                setUploadError(`${activeTab} için Akakce'de aktüel bulunamadı.`);
                setIsAutoFetching(false);
                return;
            }

            // 2. Mevcut aktüelleri sil
            setAutoFetchProgress(`Mevcut aktüeller siliniyor...`);
            await deleteAllByMarket(activeTab);

            // 3. Her görseli CORS proxy üzerinden çek ve ImgBB'ye yükle
            let uploadedCount = 0;
            for (let i = 0; i < imageUrls.length; i++) {
                const imageUrl = imageUrls[i];
                setAutoFetchProgress(`(${i + 1}/${imageUrls.length}) Görsel yükleniyor...`);

                try {
                    // Görseli CORS proxy üzerinden fetch et (CDN direkt CORS hatası veriyor)
                    const proxyUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(imageUrl)}`;
                    const imgResponse = await fetch(proxyUrl);

                    if (!imgResponse.ok) {
                        console.warn(`Görsel indirilemedi (HTTP ${imgResponse.status}): ${imageUrl}`);
                        continue;
                    }

                    const blob = await imgResponse.blob();
                    const file = new File([blob], `${marketKey}_${i + 1}.jpg`, { type: blob.type || 'image/jpeg' });

                    // ImgBB'ye yükle
                    const { downloadURL, deleteUrl } = await uploadToImgbb(file);

                    // Firebase'e kaydet
                    await addBrochure({
                        marketName: activeTab,
                        imageUrl: downloadURL,
                        deleteUrl,
                    });

                    uploadedCount++;
                } catch (err) {
                    console.error(`Görsel yüklenemedi: ${imageUrl}`, err);
                    // Tek görsel hatası işlemi durdurmasın
                }
            }

            // 4. Listeyi yenile
            await fetchBrochures(activeTab);

            setUploadSuccess(`✅ ${uploadedCount} aktüel Akakce'den başarıyla çekildi ve kaydedildi!`);
        } catch (error: any) {
            setUploadError(`Otomatik çekme hatası: ${error.message}`);
            console.error(error);
        } finally {
            setIsAutoFetching(false);
            setAutoFetchProgress('');
        }
    };

    const handleBulkDelete = async () => {
        if (brochures.length === 0 || isLoadingBrochures || isDeleting) {
            return;
        }

        if (window.confirm(`${activeTab} marketine ait TÜM afişleri silmek istediğinizden emin misiniz? Bu işlem hem görselleri hem de kayıtları kalıcı olarak siler ve geri alınamaz.`)) {
            setIsDeleting(true);
            try {
                await deleteAllByMarket(activeTab);
                await fetchBrochures(activeTab); // Refresh the list
            } catch (err: any) {
                const errorMessage = `Toplu silme sırasında bir hata oluştu: ${err.message || 'Bilinmeyen hata.'}`;
                alert(errorMessage);
                console.error(err);
            } finally {
                setIsDeleting(false);
            }
        }
    };

    const handleDeleteBrochure = async (id: string, marketName: string, deleteUrl: string) => {
        await deleteBrochure(id, marketName, deleteUrl);
        setBrochures(prev => prev.filter(b => b.id !== id));
    };


    return (
        <div>
            <h2 className="text-3xl font-bold text-white mb-6">Aktüel Yönetimi</h2>

            {/* Otomatik Çekme Kartı */}
            <div className="bg-gradient-to-r from-purple-900/50 to-blue-900/50 p-6 rounded-lg shadow-lg mb-8 border border-purple-500/30">
                <div className="flex items-center justify-between">
                    <div>
                        <h3 className="text-xl font-semibold text-white flex items-center gap-2">
                            <svg className="h-6 w-6 text-purple-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                            </svg>
                            Otomatik Aktüel Çek
                        </h3>
                        <p className="text-gray-400 text-sm mt-1">
                            Akakce.com'dan {activeTab} aktüellerini otomatik çek ve güncelle
                        </p>
                    </div>
                    <button
                        onClick={handleAutoFetch}
                        disabled={isAutoFetching || isDeleting || isUploading}
                        className="px-6 py-3 bg-gradient-to-r from-purple-600 to-blue-600 text-white font-semibold rounded-lg hover:from-purple-700 hover:to-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-lg flex items-center gap-2"
                    >
                        {isAutoFetching ? (
                            <>
                                <svg className="animate-spin h-5 w-5" fill="none" viewBox="0 0 24 24">
                                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                </svg>
                                Çekiliyor...
                            </>
                        ) : (
                            <>
                                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M9 19l3 3m0 0l3-3m-3 3V10" />
                                </svg>
                                {activeTab} Aktüellerini Çek
                            </>
                        )}
                    </button>
                </div>
                {autoFetchProgress && (
                    <div className="mt-4 p-3 bg-purple-900/40 rounded-lg">
                        <p className="text-purple-300 text-sm flex items-center gap-2">
                            <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                            </svg>
                            {autoFetchProgress}
                        </p>
                    </div>
                )}
            </div>

            <div className="bg-gray-800 p-6 rounded-lg shadow-lg mb-8">
                <h3 className="text-xl font-semibold mb-4 text-white">Yeni Aktüel Ekle (Manuel)</h3>
                <form onSubmit={handleUploadSubmit} className="space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <select value={selectedMarketForUpload} onChange={e => setSelectedMarketForUpload(e.target.value)} className="w-full p-3 bg-gray-700 rounded-md border border-gray-600 text-white" required>
                            <option value="">Market Seçin...</option>
                            {MARKETS.map(m => <option key={m} value={m}>{m}</option>)}
                        </select>
                        <input id="brochureImageFile" type="file" onChange={handleFileChange} multiple className="w-full text-sm text-gray-400 file:mr-4 file:py-3 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-semibold file:bg-blue-600 file:text-white hover:file:bg-blue-700" required accept="image/*" />
                    </div>
                    {uploadError && <p className="text-red-400 text-sm">{uploadError}</p>}
                    {uploadSuccess && <p className="text-green-400 text-sm">{uploadSuccess}</p>}
                    {uploadProgress && <p className="text-blue-400 text-sm">{uploadProgress}</p>}
                    <button type="submit" disabled={isUploading} className="w-full md:w-auto px-6 py-2 bg-green-600 rounded-md font-semibold hover:bg-green-700 disabled:bg-gray-500 disabled:cursor-not-allowed transition-colors">
                        {isUploading ? 'Yükleniyor...' : 'Manuel Yükle'}
                    </button>
                </form>
            </div>

            <div className="bg-gray-800 p-6 rounded-lg shadow-lg">
                <div className="flex justify-between items-center mb-4 border-b border-gray-700 pb-4">
                    <div className="flex space-x-1">
                        {MARKETS.map(market => (
                            <button key={market} onClick={() => setActiveTab(market)} className={`px-4 py-2 text-sm font-semibold rounded-md ${activeTab === market ? 'bg-blue-600 text-white' : 'text-gray-300 hover:bg-gray-700'}`}>
                                {market}
                            </button>
                        ))}
                    </div>
                    <button type="button" onClick={handleBulkDelete} disabled={brochures.length === 0 || isLoadingBrochures || isDeleting} className="bg-red-600 text-white font-bold py-2 px-4 rounded-lg text-sm hover:bg-red-700 disabled:bg-red-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors">
                        {isDeleting ? 'Siliniyor...' : `${activeTab} Tümünü Sil`}
                    </button>
                </div>

                <div className={`relative ${isDeleting ? 'opacity-50' : ''}`}>
                    {fetchError && <p className="text-red-400">{fetchError}</p>}
                    {isLoadingBrochures ? <p className="text-center py-8">Aktüeller yükleniyor...</p> :
                        brochures.length === 0 ? <p className="text-center text-gray-400 py-8">Bu market için yüklü aktüel bulunmuyor.</p> :
                            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
                                {brochures.map(brochure => {
                                    return (
                                        <div key={brochure.id} className="relative group rounded-lg overflow-hidden">
                                            <img src={brochure.imageUrl} alt={`${brochure.marketName} Aktüel`} className="w-full h-64 object-cover" />
                                            <DeleteImgButton
                                                onDelete={() => handleDeleteBrochure(brochure.id, brochure.marketName, brochure.deleteUrl)}
                                            />
                                        </div>
                                    );
                                })}
                            </div>
                    }
                </div>
            </div>
        </div>
    );
};

export default BrochureManager;
