
import React, { useState, useEffect, useCallback } from 'react';
import { addBrochure, getBrochures, deleteAllByMarket, deleteBrochure } from '../services/firebase';
import { uploadToImgbb } from '../services/imgbb';
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


    const fetchBrochures = useCallback(async (market: string) => {
        setIsLoadingBrochures(true);
        setFetchError(null);
        try {
            const data = await getBrochures(market);
            setBrochures(data);
        } catch (err) {
            setFetchError('Aktüeller yüklenirken bir hata oluştu.');
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
                    title: `${selectedMarketForUpload} Aktüel`,
                    storeName: selectedMarketForUpload,
                    validityDate: '',
                });
            } catch (err) {
                const errorMessage = (err as any)?.code === 'permission-denied'
                    ? 'Afiş ekleme yetkiniz yok.'
                    : `${file.name} yüklenemedi. Lütfen tekrar deneyin.`;
                setUploadError(errorMessage);
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
