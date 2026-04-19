
import React, { useState, useEffect, useCallback } from 'react';
import { getPendingDiscounts, deletePendingDiscount, getAdRequests, updateAdRequestStatus, deleteAdRequest } from '../services/firebase';
import type { PendingDiscount, AdRequest } from '../types';
import ReviewSubmissionModal from './ReviewSubmissionModal';

interface SubmissionReviewProps {
    isAdmin: boolean;
    onAdRequestCountChange?: (count: number) => void;
    onDiscountCountChange?: (count: number) => void;
}

const SubmissionReview: React.FC<SubmissionReviewProps> = ({ isAdmin, onAdRequestCountChange, onDiscountCountChange }) => {
    const [activeTab, setActiveTab] = useState<'discounts' | 'adRequests'>('adRequests');

    // --- Indirim Gönderileri ---
    const [submissions, setSubmissions] = useState<PendingDiscount[]>([]);
    const [isLoadingSub, setIsLoadingSub] = useState(true);
    const [errorSub, setErrorSub] = useState<string | null>(null);
    const [selectedSubmission, setSelectedSubmission] = useState<PendingDiscount | null>(null);

    // --- İşbirliği Başvuruları ---
    const [adRequests, setAdRequests] = useState<AdRequest[]>([]);
    const [isLoadingAd, setIsLoadingAd] = useState(true);
    const [errorAd, setErrorAd] = useState<string | null>(null);
    const [selectedAdRequest, setSelectedAdRequest] = useState<AdRequest | null>(null);

    const fetchSubmissions = useCallback(async () => {
        setIsLoadingSub(true);
        setErrorSub(null);
        try {
            const data = await getPendingDiscounts();
            setSubmissions(data);
            onDiscountCountChange?.(data.length);
        } catch {
            setErrorSub('Gönderiler yüklenemedi.');
        } finally {
            setIsLoadingSub(false);
        }
    }, [onDiscountCountChange]);

    const fetchAdRequests = useCallback(async () => {
        setIsLoadingAd(true);
        setErrorAd(null);
        try {
            const data = await getAdRequests();
            setAdRequests(data);
            onAdRequestCountChange?.(data.filter(r => r.status === 'pending').length);
        } catch {
            setErrorAd('Başvurular yüklenemedi.');
        } finally {
            setIsLoadingAd(false);
        }
    }, [onAdRequestCountChange]);

    useEffect(() => { fetchSubmissions(); }, [fetchSubmissions]);
    useEffect(() => { fetchAdRequests(); }, [fetchAdRequests]);

    const handleDeleteSubmission = async (id: string) => {
        if (!window.confirm('Bu gönderiyi kalıcı olarak silmek istiyor musunuz?')) return;
        try {
            await deletePendingDiscount(id);
            const updated = submissions.filter(s => s.id !== id);
            setSubmissions(updated);
            onDiscountCountChange?.(updated.length);
        } catch { alert('Silinirken bir hata oluştu.'); }
    };

    const handleAdStatusChange = async (id: string, status: 'reviewed' | 'rejected') => {
        try {
            await updateAdRequestStatus(id, status);
            const updated = adRequests.map(r => r.id === id ? { ...r, status } : r);
            setAdRequests(updated);
            if (selectedAdRequest?.id === id) setSelectedAdRequest(prev => prev ? { ...prev, status } : null);
            onAdRequestCountChange?.(updated.filter(r => r.status === 'pending').length);
        } catch { alert('Durum güncellenemedi.'); }
    };

    const handleDeleteAdRequest = async (id: string) => {
        if (!window.confirm('Bu başvuruyu silmek istiyor musunuz?')) return;
        try {
            await deleteAdRequest(id);
            const updated = adRequests.filter(r => r.id !== id);
            setAdRequests(updated);
            onAdRequestCountChange?.(updated.filter(r => r.status === 'pending').length);
            if (selectedAdRequest?.id === id) setSelectedAdRequest(null);
        } catch { alert('Silinirken bir hata oluştu.'); }
    };

    const formatDate = (ts: any) => {
        if (!ts) return '-';
        return new Date(ts.seconds * 1000).toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
    };

    const statusBadge = (status: AdRequest['status']) => {
        const map: Record<string, string> = {
            pending:  'bg-yellow-500/20 text-yellow-300 animate-pulse',
            reviewed: 'bg-green-500/20 text-green-300',
            rejected: 'bg-red-500/20 text-red-300',
        };
        const label: Record<string, string> = { pending: 'Bekliyor', reviewed: 'İncelendi', rejected: 'Reddedildi' };
        return <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${map[status] || ''}`}>{label[status] || status}</span>;
    };

    const pendingAdCount = adRequests.filter(r => r.status === 'pending').length;

    // --- Detail view for adRequest ---
    if (selectedAdRequest) {
        return (
            <div className="max-w-2xl mx-auto">
                <button onClick={() => setSelectedAdRequest(null)} className="flex items-center gap-2 text-gray-400 hover:text-white mb-6 transition-colors">
                    <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
                    </svg>
                    Geri
                </button>
                <div className="bg-gray-800 rounded-xl border border-gray-700 overflow-hidden">
                    <div className="p-5 border-b border-gray-700 flex items-center justify-between">
                        <div>
                            <h3 className="text-xl font-bold text-white">{selectedAdRequest.companyName}</h3>
                            <p className="text-sm text-gray-400 mt-0.5">{selectedAdRequest.type === 'product' ? 'Ürün İşbirliği' : 'Marka / Mağaza İşbirliği'}</p>
                        </div>
                        {statusBadge(selectedAdRequest.status)}
                    </div>
                    <div className="p-5 space-y-4">
                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">Yetkili Kişi</p>
                                <p className="text-white font-medium">{selectedAdRequest.contactPerson}</p>
                            </div>
                            <div>
                                <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">E-posta</p>
                                <a href={`mailto:${selectedAdRequest.email}`} className="text-blue-400 hover:underline font-medium">{selectedAdRequest.email}</a>
                            </div>
                            <div>
                                <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">Kategori / Sektör</p>
                                <p className="text-white">{selectedAdRequest.category}</p>
                            </div>
                            <div>
                                <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">Başvuru Tarihi</p>
                                <p className="text-gray-300 text-sm">{formatDate(selectedAdRequest.createdAt)}</p>
                            </div>
                        </div>
                        <div>
                            <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">Link</p>
                            <a href={selectedAdRequest.url} target="_blank" rel="noreferrer" className="text-blue-400 hover:underline text-sm break-all">{selectedAdRequest.url}</a>
                        </div>
                        {selectedAdRequest.discountCode && (
                            <div>
                                <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">İndirim Kodu</p>
                                <p className="text-yellow-300 font-mono font-bold">{selectedAdRequest.discountCode}</p>
                            </div>
                        )}
                        {selectedAdRequest.message && (
                            <div>
                                <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">Mesaj</p>
                                <p className="text-gray-300 text-sm bg-gray-900 rounded-lg p-3 leading-relaxed">{selectedAdRequest.message}</p>
                            </div>
                        )}
                    </div>
                    <div className="p-5 border-t border-gray-700 flex gap-3">
                        <a href={`mailto:${selectedAdRequest.email}`}
                            className="flex-1 bg-blue-600 hover:bg-blue-700 text-white font-bold py-2.5 px-4 rounded-lg text-center transition-colors">
                            E-posta Gönder
                        </a>
                        {selectedAdRequest.status === 'pending' && (
                            <button onClick={() => handleAdStatusChange(selectedAdRequest.id, 'reviewed')}
                                className="flex-1 bg-green-600 hover:bg-green-700 text-white font-bold py-2.5 px-4 rounded-lg transition-colors">
                                İncelendi İşaretle
                            </button>
                        )}
                        {selectedAdRequest.status === 'pending' && (
                            <button onClick={() => handleAdStatusChange(selectedAdRequest.id, 'rejected')}
                                className="flex-1 bg-red-600 hover:bg-red-700 text-white font-bold py-2.5 px-4 rounded-lg transition-colors">
                                Reddet
                            </button>
                        )}
                        <button onClick={() => handleDeleteAdRequest(selectedAdRequest.id)}
                            className="bg-gray-700 hover:bg-gray-600 text-gray-300 font-bold py-2.5 px-4 rounded-lg transition-colors">
                            Sil
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div>
            <h2 className="text-3xl font-bold mb-6 text-white">Başvuru & Onay Paneli</h2>

            {/* Tabs */}
            <div className="flex gap-2 mb-6">
                <button
                    onClick={() => setActiveTab('adRequests')}
                    className={`flex items-center gap-2 px-4 py-2 rounded-lg font-semibold text-sm transition-colors ${
                        activeTab === 'adRequests' ? 'bg-blue-600 text-white' : 'bg-gray-800 text-gray-400 hover:text-white'
                    }`}
                >
                    İşbirliği Başvuruları
                    {pendingAdCount > 0 && (
                        <span className="bg-orange-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full">
                            {pendingAdCount}
                        </span>
                    )}
                </button>
                <button
                    onClick={() => setActiveTab('discounts')}
                    className={`flex items-center gap-2 px-4 py-2 rounded-lg font-semibold text-sm transition-colors ${
                        activeTab === 'discounts' ? 'bg-blue-600 text-white' : 'bg-gray-800 text-gray-400 hover:text-white'
                    }`}
                >
                    Affiliate Başvuruları
                    {submissions.length > 0 && (
                        <span className="bg-orange-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full">
                            {submissions.length}
                        </span>
                    )}
                </button>
            </div>

            {/* --- İşbirliği Başvuruları Tab --- */}
            {activeTab === 'adRequests' && (
                <>
                    {isLoadingAd ? (
                        <p className="text-gray-400">Yükleniyor...</p>
                    ) : errorAd ? (
                        <p className="text-red-400 bg-red-900/20 p-4 rounded">{errorAd}</p>
                    ) : adRequests.length === 0 ? (
                        <div className="bg-gray-800 p-12 rounded-lg text-center border border-gray-700">
                            <p className="text-gray-400 text-xl">Henüz işbirliği başvurusu yok.</p>
                        </div>
                    ) : (
                        <div className="space-y-3">
                            {adRequests.map(req => (
                                <div
                                    key={req.id}
                                    onClick={() => setSelectedAdRequest(req)}
                                    className="bg-gray-800 p-4 rounded-xl border border-gray-700 hover:border-gray-500 cursor-pointer transition-colors flex items-center justify-between gap-4"
                                >
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-2 mb-1">
                                            <span className="font-bold text-white truncate">{req.companyName}</span>
                                            <span className="text-xs text-gray-500 shrink-0">{req.type === 'product' ? 'Ürün' : 'Marka'}</span>
                                        </div>
                                        <p className="text-sm text-gray-400 truncate">{req.contactPerson} · {req.email}</p>
                                        <p className="text-xs text-gray-600 mt-1">{formatDate(req.createdAt)}</p>
                                    </div>
                                    <div className="flex items-center gap-3 shrink-0">
                                        {statusBadge(req.status)}
                                        <svg className="h-4 w-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                                        </svg>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </>
            )}

            {/* --- İndirim Gönderileri Tab --- */}
            {activeTab === 'discounts' && (
                <>
                    {isLoadingSub ? (
                        <p className="text-gray-400">Yükleniyor...</p>
                    ) : errorSub ? (
                        <p className="text-red-400 bg-red-900/20 p-4 rounded">{errorSub}</p>
                    ) : submissions.length === 0 ? (
                        <div className="bg-gray-800 p-12 rounded-lg text-center border border-gray-700">
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
                                    </div>
                                    <div className="flex flex-row md:flex-col gap-2 w-full md:w-auto shrink-0">
                                        <button
                                            onClick={() => setSelectedSubmission(submission)}
                                            className="flex-1 bg-green-600 hover:bg-green-700 text-white font-bold py-2 px-6 rounded transition-colors whitespace-nowrap"
                                        >
                                            İncele & Yayınla
                                        </button>
                                        <button
                                            onClick={() => handleDeleteSubmission(submission.id)}
                                            className="flex-1 bg-red-600 hover:bg-red-700 text-white font-bold py-2 px-6 rounded transition-colors whitespace-nowrap"
                                        >
                                            Reddet & Sil
                                        </button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </>
            )}

            {selectedSubmission && (
                <ReviewSubmissionModal
                    submission={selectedSubmission}
                    onClose={() => setSelectedSubmission(null)}
                    onApproveSuccess={() => { setSelectedSubmission(null); fetchSubmissions(); }}
                />
            )}
        </div>
    );
};

export default SubmissionReview;
