
import React, { useState, useEffect } from 'react';
import type { AdRequest } from '../types';
import { getAdRequests, updateAdRequestStatus, deleteAdRequest } from '../services/firebase';
import DeleteImgButton from './DeleteImgButton';

interface AdRequestListModalProps {
    onClose: () => void;
}

const AdRequestListModal: React.FC<AdRequestListModalProps> = ({ onClose }) => {
    const [requests, setRequests] = useState<AdRequest[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [selectedRequest, setSelectedRequest] = useState<AdRequest | null>(null);

    const fetchRequests = async () => {
        setIsLoading(true);
        try {
            const data = await getAdRequests();
            setRequests(data);
        } catch (error) {
            console.error("Error fetching ad requests:", error);
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        fetchRequests();
    }, []);

    const handleStatusChange = async (id: string, status: 'reviewed' | 'rejected') => {
        try {
            await updateAdRequestStatus(id, status);
            setRequests(prev => prev.map(req => req.id === id ? { ...req, status } : req));
            if (selectedRequest && selectedRequest.id === id) {
                setSelectedRequest({ ...selectedRequest, status });
            }
        } catch (error) {
            console.error("Update failed", error);
            alert("Durum güncellenemedi.");
        }
    };

    // Bu fonksiyon DeleteImgButton tarafından tetiklenir
    const executeDelete = async (id: string) => {
        await deleteAdRequest(id);
        // Listeden kaldır
        setRequests(prev => prev.filter(req => req.id !== id));
        // Eğer detay penceresi açıksa kapat
        if (selectedRequest && selectedRequest.id === id) {
            setSelectedRequest(null);
        }
    };

    const handleMailClick = (e: React.MouseEvent, email: string) => {
        e.stopPropagation();
        window.location.href = `mailto:${email}`;
    };

    const formatDate = (timestamp: any) => {
        if (!timestamp) return '-';
        return new Date(timestamp.seconds * 1000).toLocaleDateString('tr-TR', {
            day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit'
        });
    };

    // --- RENDER: DETAILED VIEW ---
    if (selectedRequest) {
        return (
            <div className="fixed inset-0 bg-black bg-opacity-80 flex items-center justify-center z-[9999] p-4">
                <div className="bg-gray-800 rounded-lg shadow-2xl w-full max-w-3xl max-h-[90vh] flex flex-col border border-gray-700">
                    {/* Fixed Header */}
                    <div className="p-6 border-b border-gray-700 flex justify-between items-center bg-gray-900 flex-shrink-0">
                        <button
                            type="button"
                            onClick={() => setSelectedRequest(null)}
                            className="flex items-center text-gray-400 hover:text-white transition-colors"
                        >
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
                            </svg>
                            Listeye Dön
                        </button>
                        <div className="flex items-center gap-2">
                            {selectedRequest.status === 'pending' && <span className="px-3 py-1 text-sm font-bold rounded bg-yellow-600 text-black">Bekliyor</span>}
                            {selectedRequest.status === 'reviewed' && <span className="px-3 py-1 text-sm font-bold rounded bg-green-600 text-white">İncelendi</span>}
                            {selectedRequest.status === 'rejected' && <span className="px-3 py-1 text-sm font-bold rounded bg-red-600 text-white">Reddedildi</span>}
                        </div>
                    </div>

                    {/* Scrollable Content */}
                    <div className="p-8 space-y-6 overflow-y-auto flex-1">
                        <div className="flex items-start justify-between">
                            <div>
                                <h2 className="text-3xl font-bold text-white mb-1">{selectedRequest.companyName}</h2>
                                <p className="text-gray-400 text-lg">{selectedRequest.type === 'product' ? 'Ürün Reklamı' : 'Mağaza Reklamı'}</p>
                            </div>
                            <div className="text-right text-sm text-gray-500">
                                <p>Başvuru Tarihi</p>
                                <p>{formatDate(selectedRequest.createdAt)}</p>
                            </div>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 bg-gray-700/30 p-6 rounded-lg border border-gray-700">
                            <div>
                                <label className="block text-xs uppercase text-gray-500 font-bold mb-1">Yetkili Kişi</label>
                                <p className="text-white font-medium text-lg">{selectedRequest.contactPerson}</p>
                            </div>
                            <div>
                                <label className="block text-xs uppercase text-gray-500 font-bold mb-1">E-posta</label>
                                <button
                                    type="button"
                                    onClick={(e) => handleMailClick(e, selectedRequest.email)}
                                    className="text-blue-400 hover:underline font-medium text-lg flex items-center"
                                >
                                    {selectedRequest.email}
                                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 ml-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                                    </svg>
                                </button>
                            </div>
                            <div>
                                <label className="block text-xs uppercase text-gray-500 font-bold mb-1">Kategori</label>
                                <p className="text-white font-medium">{selectedRequest.category}</p>
                            </div>
                            <div>
                                <label className="block text-xs uppercase text-gray-500 font-bold mb-1">İndirim Kodu</label>
                                <p className="text-green-400 font-mono font-bold text-lg">{selectedRequest.discountCode || '-'}</p>
                            </div>
                        </div>

                        <div>
                            <label className="block text-xs uppercase text-gray-500 font-bold mb-2">İlgili Link</label>
                            <a
                                href={selectedRequest.url}
                                target="_blank"
                                rel="noreferrer"
                                className="block w-full p-4 bg-gray-900 rounded border border-gray-600 text-blue-400 hover:text-blue-300 hover:border-blue-500 transition-all truncate"
                            >
                                {selectedRequest.url}
                            </a>
                        </div>

                        <div>
                            <label className="block text-xs uppercase text-gray-500 font-bold mb-2">Mesaj / Not</label>
                            <div className="p-4 bg-gray-700/50 rounded border border-gray-600 text-gray-300 min-h-[100px] whitespace-pre-wrap">
                                {selectedRequest.message || "Mesaj eklenmemiş."}
                            </div>
                        </div>
                    </div>

                    {/* Fixed Footer Actions */}
                    <div className="p-4 border-t border-gray-700 bg-gray-900 flex flex-col sm:flex-row justify-end gap-3 flex-shrink-0 rounded-b-lg">
                        {/* Güvenli Silme Butonu */}
                        <div className="sm:mr-auto border border-red-900/50 bg-red-900/20 rounded px-4 py-2 flex items-center">
                            <DeleteImgButton
                                onDelete={() => executeDelete(selectedRequest.id)}
                                isTextButton={true}
                            />
                        </div>

                        {selectedRequest.status === 'pending' && (
                            <>
                                <button
                                    type="button"
                                    onClick={() => handleStatusChange(selectedRequest.id, 'rejected')}
                                    className="px-6 py-3 bg-gray-700 hover:bg-gray-600 text-white rounded font-bold transition-colors"
                                >
                                    Reddet
                                </button>
                                <button
                                    type="button"
                                    onClick={() => handleStatusChange(selectedRequest.id, 'reviewed')}
                                    className="px-6 py-3 bg-green-600 hover:bg-green-500 text-white rounded font-bold transition-colors shadow-lg shadow-green-900/50"
                                >
                                    ✓ Reklamı Paylaş
                                </button>
                            </>
                        )}
                    </div>
                </div>
            </div>
        );
    }

    // --- RENDER: LIST VIEW ---
    return (
        <div className="fixed inset-0 bg-black bg-opacity-70 flex items-center justify-center z-[9999] p-4">
            <div className="bg-gray-800 rounded-lg shadow-xl w-full max-w-4xl max-h-[90vh] overflow-y-auto flex flex-col">
                <div className="p-6 border-b border-gray-700 flex justify-between items-center sticky top-0 bg-gray-800 z-10">
                    <h3 className="text-2xl font-bold text-white flex items-center">
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8 mr-3 text-yellow-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
                        </svg>
                        Gelen Reklam Başvuruları
                    </h3>
                    <button type="button" onClick={onClose} className="text-gray-400 hover:text-white text-4xl leading-none">&times;</button>
                </div>

                <div className="p-6 flex-1 overflow-y-auto">
                    {isLoading ? (
                        <div className="text-center py-10 text-gray-400">Yükleniyor...</div>
                    ) : requests.length === 0 ? (
                        <div className="text-center py-10 text-gray-400">Henüz bir reklam başvurusu yok.</div>
                    ) : (
                        <div className="space-y-4">
                            {requests.map(req => (
                                <div
                                    key={req.id}
                                    onClick={() => setSelectedRequest(req)}
                                    className={`p-4 rounded-lg border cursor-pointer transition-all transform hover:-translate-y-1 hover:shadow-lg ${req.status === 'pending' ? 'border-yellow-500/50 bg-yellow-900/10' : 'border-gray-700 bg-gray-750 hover:bg-gray-700'
                                        }`}
                                >
                                    <div className="flex flex-col md:flex-row justify-between md:items-center gap-4">
                                        <div className="flex-1">
                                            <div className="flex items-center gap-2 mb-2">
                                                <span className={`px-2 py-1 text-xs font-bold rounded uppercase ${req.type === 'product' ? 'bg-blue-900 text-blue-200' : 'bg-purple-900 text-purple-200'}`}>
                                                    {req.type === 'product' ? 'Ürün' : 'Mağaza'}
                                                </span>
                                                {req.status === 'pending' && <span className="px-2 py-1 text-xs font-bold rounded bg-yellow-600 text-black animate-pulse">Bekliyor</span>}
                                                {req.status === 'reviewed' && <span className="px-2 py-1 text-xs font-bold rounded bg-green-600 text-white">İncelendi</span>}
                                                {req.status === 'rejected' && <span className="px-2 py-1 text-xs font-bold rounded bg-red-600 text-white">Reddedildi</span>}
                                                <span className="text-xs text-gray-500 ml-auto md:ml-2 hidden md:inline">{formatDate(req.createdAt)}</span>
                                            </div>

                                            <h4 className="text-xl font-bold text-white">{req.companyName}</h4>
                                            <p className="text-gray-400 text-sm">{req.contactPerson}</p>
                                        </div>

                                        <div className="flex flex-row md:flex-col gap-2 shrink-0">
                                            {/* Mail Button in List */}
                                            <button
                                                type="button"
                                                onClick={(e) => handleMailClick(e, req.email)}
                                                className="p-2 bg-gray-700 hover:bg-blue-600 text-white rounded transition-colors"
                                                title="Mail Gönder"
                                            >
                                                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                                                </svg>
                                            </button>

                                            {/* Delete Button in List using the Secure Component */}
                                            <div className="flex items-center justify-center bg-gray-700 rounded hover:bg-gray-600 p-2" onClick={(e) => e.stopPropagation()}>
                                                <DeleteImgButton
                                                    onDelete={() => executeDelete(req.id)}
                                                    isTextButton={true}
                                                />
                                            </div>
                                        </div>
                                    </div>
                                    <div className="mt-2 text-xs text-gray-500 md:hidden text-right">
                                        {formatDate(req.createdAt)}
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default AdRequestListModal;
