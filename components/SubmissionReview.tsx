
import React, { useState, useEffect, useCallback } from 'react';
import { getPendingDiscounts, deletePendingDiscount } from '../services/firebase';
import type { PendingDiscount } from '../types';
import ReviewSubmissionModal from './ReviewSubmissionModal';

interface SubmissionReviewProps {
    isAdmin: boolean;
}

const SubmissionReview: React.FC<SubmissionReviewProps> = ({ isAdmin }) => {
    const [submissions, setSubmissions] = useState<PendingDiscount[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    
    // State for the modal
    const [selectedSubmission, setSelectedSubmission] = useState<PendingDiscount | null>(null);

    const fetchSubmissions = useCallback(async () => {
        setIsLoading(true);
        setError(null);
        try {
            const subs = await getPendingDiscounts();
            setSubmissions(subs);
        } catch (err) {
            setError('Gönderiler yüklenemedi. Veritabanı bağlantısını kontrol edin.');
            console.error(err);
        } finally {
            setIsLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchSubmissions();
    }, [fetchSubmissions]);
    
    const handleDelete = async (id: string) => {
        if(!window.confirm("Bu gönderiyi kalıcı olarak silmek istediğinize emin misiniz?")) return;
        
        try {
            await deletePendingDiscount(id);
            setSubmissions(prev => prev.filter(s => s.id !== id));
        } catch (err) {
            console.error("Silme hatası:", err);
            alert("Silinirken bir hata oluştu.");
        }
    };

    const handleApproveSuccess = () => {
        setSelectedSubmission(null); // Close modal
        fetchSubmissions(); // Refresh list
    };

    return (
        <div>
            <h2 className="text-3xl font-bold mb-6 text-white">İndirim Paylaş & Kazan - Onay Paneli</h2>

            {isLoading ? (
                <p className="text-gray-400">Yükleniyor...</p>
            ) : error ? (
                <p className="text-red-400 bg-red-900/20 p-4 rounded">{error}</p>
            ) : submissions.length === 0 ? (
                 <div className="bg-gray-800 p-12 rounded-lg text-center border border-gray-700">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-16 w-16 mx-auto text-gray-600 mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
                    </svg>
                    <p className="text-gray-400 text-xl">Bekleyen kullanıcı gönderisi yok.</p>
                 </div>
            ) : (
                <div className="space-y-4">
                    {submissions.map(submission => (
                        <div key={submission.id} className="bg-gray-800 p-4 rounded-lg shadow-lg flex flex-col md:flex-row items-start md:items-center justify-between gap-6 border border-gray-700 hover:border-gray-500 transition-colors">
                            <div className="relative w-32 h-32 flex-shrink-0 bg-gray-900 rounded-md overflow-hidden border border-gray-600">
                                {submission.imageBase64 ? (
                                    <img 
                                        src={submission.imageBase64.startsWith('data:image') ? submission.imageBase64 : `data:image/jpeg;base64,${submission.imageBase64}`} 
                                        alt={submission.title} 
                                        className="w-full h-full object-cover" 
                                    />
                                ) : (
                                    <div className="flex items-center justify-center h-full text-gray-500 text-xs">Görsel Yok</div>
                                )}
                            </div>
                            
                            <div className="flex-1 w-full">
                                <div className="flex justify-between items-start">
                                    <h3 className="font-bold text-xl text-white">{submission.title}</h3>
                                    <span className="px-2 py-1 bg-blue-900 text-blue-200 text-xs rounded-full">{submission.category}</span>
                                </div>
                                <p className="text-gray-400 font-semibold">{submission.brand}</p>
                                <div className="mt-2 flex items-center space-x-2">
                                    <span className="text-green-400 font-bold text-lg">{submission.newPrice} TL</span>
                                    {submission.oldPrice && <span className="text-gray-500 line-through text-sm">{submission.oldPrice} TL</span>}
                                </div>
                                <p className="text-xs text-gray-500 mt-2">
                                    Gönderen: {submission.userId || 'Anonim'} | 
                                    Tarih: {submission.createdAt ? new Date((submission.createdAt as any).seconds * 1000).toLocaleDateString() : 'Tarih yok'}
                                </p>
                                {submission.description && (
                                    <p className="text-sm text-gray-400 mt-2 line-clamp-2 bg-gray-700/50 p-2 rounded">{submission.description}</p>
                                )}
                            </div>

                            <div className="flex flex-row md:flex-col gap-2 w-full md:w-auto shrink-0">
                                <button 
                                    onClick={() => setSelectedSubmission(submission)} 
                                    className="flex-1 bg-green-600 hover:bg-green-700 text-white font-bold py-2 px-6 rounded transition-colors whitespace-nowrap"
                                >
                                    İncele & Yayınla
                                </button>
                                <button 
                                    onClick={() => handleDelete(submission.id)} 
                                    className="flex-1 bg-red-600 hover:bg-red-700 text-white font-bold py-2 px-6 rounded transition-colors whitespace-nowrap"
                                >
                                    Reddet & Sil
                                </button>
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {selectedSubmission && (
                <ReviewSubmissionModal 
                    submission={selectedSubmission}
                    onClose={() => setSelectedSubmission(null)}
                    onApproveSuccess={handleApproveSuccess}
                />
            )}
        </div>
    );
};

export default SubmissionReview;
