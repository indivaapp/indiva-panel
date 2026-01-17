
import React, { useState, useEffect } from 'react';
import type { PendingDiscount } from '../types';
import { addDiscount, deletePendingDiscount } from '../services/firebase';
import { uploadToImgbb, base64ToFile } from '../services/imgbb';

interface ReviewSubmissionModalProps {
    submission: PendingDiscount;
    onClose: () => void;
    onApproveSuccess: () => void;
}

const ReviewSubmissionModal: React.FC<ReviewSubmissionModalProps> = ({ submission, onClose, onApproveSuccess }) => {
    // Form state initialized with submission data
    const [formData, setFormData] = useState({
        title: submission.title || '',
        brand: submission.brand || '',
        description: submission.description || '',
        category: submission.category || '',
        link: submission.link || '',
        oldPrice: submission.oldPrice || '',
        newPrice: submission.newPrice || '',
    });

    // Image handling
    const [previewImage, setPreviewImage] = useState<string>('');
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [statusMessage, setStatusMessage] = useState<string>('');

    useEffect(() => {
        // Handle base64 image prefix
        const base64Str = submission.imageBase64;
        if (base64Str && !base64Str.startsWith('data:image')) {
            setPreviewImage(`data:image/jpeg;base64,${base64Str}`);
        } else {
            setPreviewImage(base64Str);
        }
    }, [submission]);

    const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
        const { name, value } = e.target;
        setFormData(prev => ({ ...prev, [name]: value }));
    };

    const handleApprove = async (e: React.FormEvent) => {
        e.preventDefault();
        setIsLoading(true);
        setError(null);
        setStatusMessage('Görsel işleniyor ve ImgBB\'ye yükleniyor...');

        try {
            // 1. Convert Base64 to File and Upload to ImgBB
            const imageFile = base64ToFile(previewImage, `submission-${submission.id}.jpg`);
            const { downloadURL, deleteUrl } = await uploadToImgbb(imageFile);

            setStatusMessage('İndirim veritabanına kaydediliyor...');

            // 2. Add to Discounts collection
            await addDiscount({
                title: formData.title,
                description: formData.description,
                brand: formData.brand,
                category: formData.category,
                link: formData.link,
                oldPrice: parseFloat(String(formData.oldPrice)) || 0,
                newPrice: parseFloat(String(formData.newPrice)),
                imageUrl: downloadURL,
                deleteUrl: deleteUrl,
                submittedBy: submission.userId || 'anonymous-user',
            });

            setStatusMessage('Bekleyen listeden siliniyor...');

            // 3. Delete from PendingDiscounts
            await deletePendingDiscount(submission.id);

            onApproveSuccess();
        } catch (err: any) {
            console.error(err);
            const msg = err.message || 'Onaylama işlemi sırasında bir hata oluştu.';
            setError(msg);
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className="fixed inset-0 bg-black bg-opacity-70 flex items-center justify-center z-[9999] p-4">
            <div className="bg-gray-800 rounded-lg shadow-xl w-full max-w-2xl max-h-[90vh] flex flex-col">
                {/* Fixed Header */}
                <div className="p-6 border-b border-gray-700 flex justify-between items-center flex-shrink-0">
                    <h3 className="text-xl font-semibold text-white">Kullanıcı Gönderisini İncele & Onayla</h3>
                    <button onClick={onClose} className="text-gray-400 hover:text-white text-3xl leading-none">&times;</button>
                </div>

                {/* Scrollable Content */}
                <div className="p-6 overflow-y-auto flex-1">
                    <div className="bg-blue-900/30 border border-blue-800 p-4 rounded-md mb-6 text-sm text-blue-200">
                        <p>Bu indirim kullanıcı tarafından gönderildi. Lütfen bilgileri kontrol edin, yazım hatalarını düzeltin ve uygunsa onaylayın. Onayladığınızda görsel otomatik olarak sunucuya yüklenip ilan yayınlanacaktır.</p>
                    </div>

                    <form id="review-form" onSubmit={handleApprove} className="space-y-4">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div>
                                <label className="block text-sm text-gray-400 mb-1">Ürün Başlığı</label>
                                <input name="title" type="text" value={formData.title} onChange={handleChange} className="w-full p-3 bg-gray-700 rounded-md border border-gray-600 text-white" required />
                            </div>
                            <div>
                                <label className="block text-sm text-gray-400 mb-1">Marka / Market</label>
                                <input name="brand" type="text" value={formData.brand} onChange={handleChange} className="w-full p-3 bg-gray-700 rounded-md border border-gray-600 text-white" required />
                            </div>
                        </div>

                        <div>
                            <label className="block text-sm text-gray-400 mb-1">Açıklama</label>
                            <textarea name="description" value={formData.description} onChange={handleChange} className="w-full p-3 bg-gray-700 rounded-md border border-gray-600 text-white" rows={3}></textarea>
                        </div>

                        <div>
                            <label className="block text-sm text-gray-400 mb-1">Kategori</label>
                            <select name="category" value={formData.category} onChange={handleChange} className="w-full p-3 bg-gray-700 rounded-md border border-gray-600 text-white" required>
                                <option value="">Kategori Seçin</option>
                                <option value="Elektronik">Elektronik</option>
                                <option value="Giyim">Giyim</option>
                                <option value="Market">Market</option>
                                <option value="Ev & Yaşam">Ev & Yaşam</option>
                                <option value="Kozmetik">Kozmetik</option>
                                <option value="Yeme & İçme">Yeme & İçme</option>
                                <option value="Diğer">Diğer</option>
                            </select>
                        </div>

                        <div>
                            <label className="block text-sm text-gray-400 mb-1">Ürün/Affiliate Linki</label>
                            <input name="link" type="url" value={formData.link} onChange={handleChange} className="w-full p-3 bg-gray-700 rounded-md border border-gray-600 text-white" />
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div>
                                <label className="block text-sm text-gray-400 mb-1">Eski Fiyat</label>
                                <input name="oldPrice" type="number" step="0.01" value={formData.oldPrice} onChange={handleChange} className="w-full p-3 bg-gray-700 rounded-md border border-gray-600 text-white" />
                            </div>
                            <div>
                                <label className="block text-sm text-gray-400 mb-1">Yeni Fiyat</label>
                                <input name="newPrice" type="number" step="0.01" value={formData.newPrice} onChange={handleChange} className="w-full p-3 bg-gray-700 rounded-md border border-gray-600 text-white" required />
                            </div>
                        </div>

                        <div className="border-t border-gray-700 pt-4">
                            <label className="block text-sm text-gray-400 mb-2">Kullanıcı Görseli</label>
                            {previewImage ? (
                                <img src={previewImage} alt="Kullanıcı Gönderisi" className="w-full md:w-1/2 h-48 object-contain bg-gray-900 rounded-md border border-gray-600" />
                            ) : (
                                <p className="text-gray-500">Görsel yok</p>
                            )}
                        </div>

                        {error && <p className="text-red-400 text-sm font-bold bg-red-900/20 p-2 rounded">{error}</p>}
                        {isLoading && <p className="text-blue-400 text-sm animate-pulse">{statusMessage}</p>}
                    </form>
                </div>

                {/* Fixed Footer with Buttons */}
                <div className="p-4 border-t border-gray-700 bg-gray-800 flex justify-end space-x-2 flex-shrink-0 rounded-b-lg">
                    <button type="button" onClick={onClose} disabled={isLoading} className="px-6 py-3 bg-gray-600 text-white rounded-md hover:bg-gray-500 transition-colors disabled:opacity-50">İptal</button>
                    <button type="submit" form="review-form" disabled={isLoading} className="px-6 py-3 bg-green-600 text-white font-bold rounded-md hover:bg-green-700 disabled:bg-gray-500 disabled:cursor-not-allowed transition-colors">
                        {isLoading ? 'İşleniyor...' : '✓ Onayla ve Yayınla'}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default ReviewSubmissionModal;
