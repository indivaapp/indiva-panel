
import React, { useState, useEffect } from 'react';
import { collection, query, where, getDocs, doc, deleteDoc } from 'firebase/firestore';
import { db } from '../firebaseConfig';
import type { ViewType } from '../types';

// ScrapedDeal tipi
interface ScrapedDeal {
    id: string;
    title: string;
    price: number;
    source: string;
    onualLink: string;
    productLink?: string;
    imageUrl?: string;
    postedAt?: Date;
    fetchedAt?: Date;
    status?: string;
}

// Reddedilen indirimleri localStorage'da sakla
const REJECTED_KEY = 'rejected_deal_ids';

function getRejectedIds(): Set<string> {
    try {
        const stored = localStorage.getItem(REJECTED_KEY);
        return new Set(stored ? JSON.parse(stored) : []);
    } catch {
        return new Set();
    }
}

function addRejectedId(id: string): void {
    try {
        const rejected = getRejectedIds();
        rejected.add(id);
        localStorage.setItem(REJECTED_KEY, JSON.stringify([...rejected]));
    } catch {
        // localStorage hatası
    }
}

interface DealFinderProps {
    isAdmin: boolean;
    setActiveView?: (view: ViewType) => void;
    setSelectedDeal?: (deal: ScrapedDeal | null) => void;
}

const DealFinder: React.FC<DealFinderProps> = ({ isAdmin, setActiveView, setSelectedDeal }) => {
    // State
    const [deals, setDeals] = useState<ScrapedDeal[]>([]);
    const [currentIndex, setCurrentIndex] = useState(0);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [pendingCount, setPendingCount] = useState(0);

    // Mevcut görüntülenen indirim
    const currentDeal = deals[currentIndex];

    // Sayfa yüklendiğinde bekleyen ilan sayısını al
    useEffect(() => {
        loadPendingCount();
    }, []);

    // Bekleyen ilan sayısını yükle
    const loadPendingCount = async () => {
        try {
            const q = query(
                collection(db, 'pendingDeals'),
                where('status', '==', 'pending')
            );
            const snapshot = await getDocs(q);
            setPendingCount(snapshot.size);
        } catch (err) {
            console.error('Bekleyen ilan sayısı alınamadı:', err);
        }
    };

    // Firebase'den bekleyen ilanları çek
    const handleFetchDeals = async () => {
        setIsLoading(true);
        setError(null);

        try {
            // Firebase'den bekleyen ilanları al (index olmadan basit sorgu)
            const q = query(
                collection(db, 'pendingDeals'),
                where('status', '==', 'pending')
            );

            const snapshot = await getDocs(q);

            let fetchedDeals: ScrapedDeal[] = snapshot.docs.map(docSnap => ({
                id: docSnap.id,
                ...docSnap.data()
            } as ScrapedDeal));

            // Client-side sıralama (eski tarihten yeniye)
            fetchedDeals.sort((a, b) => {
                // Firebase Timestamp veya Date string olabilir
                const getTime = (posted: any): number => {
                    if (!posted) return 0;
                    if (posted.seconds) return posted.seconds * 1000; // Firebase Timestamp
                    if (posted.toDate) return posted.toDate().getTime(); // Firestore Timestamp
                    const d = new Date(posted);
                    return isNaN(d.getTime()) ? 0 : d.getTime();
                };
                return getTime(a.postedAt) - getTime(b.postedAt);
            });

            // Reddedilenleri filtrele
            const rejected = getRejectedIds();
            const filteredDeals = fetchedDeals.filter(d => !rejected.has(d.id));

            setDeals(filteredDeals);
            setCurrentIndex(0);
            setPendingCount(filteredDeals.length);

            if (filteredDeals.length === 0) {
                setError('Bekleyen indirim yok. Yeni ilanlar 10 dakikada bir otomatik çekiliyor.');
            }
        } catch (err: any) {
            console.error('Firebase hatası:', err);
            setError(err.message || 'Veriler çekilirken bir hata oluştu.');
        } finally {
            setIsLoading(false);
        }
    };

    // Reddet - bu indirimi atla ve Firebase'den sil
    const handleReject = async () => {
        if (!currentDeal) return;

        try {
            // Firebase'den sil
            await deleteDoc(doc(db, 'pendingDeals', currentDeal.id));

            // Reddedilenlere ekle (onu.al linki ile)
            addRejectedId(currentDeal.onualLink);

            // Listeden kaldır
            const newDeals = deals.filter(d => d.id !== currentDeal.id);
            setDeals(newDeals);

            // Index'i ayarla
            if (currentIndex >= newDeals.length && newDeals.length > 0) {
                setCurrentIndex(newDeals.length - 1);
            }

            setPendingCount(prev => Math.max(0, prev - 1));
        } catch (err) {
            console.error('Silme hatası:', err);
        }
    };

    // Onayla - düzenleme sayfasına git
    const handleApprove = async () => {
        if (!currentDeal || !setActiveView || !setSelectedDeal) return;

        // Seçili indirimi ayarla ve düzenleme sayfasına git
        setSelectedDeal(currentDeal as any);
        setActiveView('editDeal');

        // Firebase'den sil (artık işlendi)
        try {
            await deleteDoc(doc(db, 'pendingDeals', currentDeal.id));
            setPendingCount(prev => Math.max(0, prev - 1));
        } catch (err) {
            console.error('Silme hatası:', err);
        }
    };

    // Admin değilse erişim yok
    if (!isAdmin) {
        return (
            <div className="flex items-center justify-center h-96">
                <p className="text-red-400">Bu sayfaya erişim yetkiniz yok.</p>
            </div>
        );
    }

    return (
        <div className="max-w-md mx-auto px-4 py-6">
            {/* Başlık */}
            <div className="text-center mb-6">
                <h1 className="text-2xl font-bold text-white mb-1 flex items-center justify-center gap-2">
                    🛍️ Fırsat Bulucu
                    {pendingCount > 0 && (
                        <span className="bg-orange-500 text-white text-sm px-2 py-0.5 rounded-full animate-pulse">
                            {pendingCount} yeni
                        </span>
                    )}
                </h1>
                <p className="text-gray-400 text-sm">
                    İlanlar otomatik çekiliyor (10 dk)
                </p>
            </div>

            {/* Verileri Yükle Butonu veya Kart */}
            {deals.length === 0 ? (
                <div className="text-center">
                    <button
                        onClick={handleFetchDeals}
                        disabled={isLoading}
                        className="w-full py-4 px-6 bg-gradient-to-r from-orange-500 to-orange-600 hover:from-orange-600 hover:to-orange-700 text-white font-bold rounded-xl shadow-lg transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-3"
                    >
                        {isLoading ? (
                            <>
                                <svg className="animate-spin h-5 w-5" fill="none" viewBox="0 0 24 24">
                                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                </svg>
                                Yükleniyor...
                            </>
                        ) : (
                            <>
                                📥 Bekleyen İlanları Yükle
                                {pendingCount > 0 && <span className="bg-white/20 px-2 py-0.5 rounded-full text-sm">{pendingCount}</span>}
                            </>
                        )}
                    </button>

                    {error && (
                        <p className="mt-4 text-gray-400 text-sm">{error}</p>
                    )}

                    {/* Manuel Çekme Butonu */}
                    <button
                        onClick={async () => {
                            setIsLoading(true);
                            try {
                                await fetch('https://indiva-proxy.vercel.app/api/fetch-deals');
                                await loadPendingCount();
                                await handleFetchDeals();
                            } catch (err) {
                                console.error(err);
                            } finally {
                                setIsLoading(false);
                            }
                        }}
                        disabled={isLoading}
                        className="mt-4 text-gray-500 hover:text-gray-300 text-sm transition-colors"
                    >
                        🔄 Telegram'dan Şimdi Çek
                    </button>
                </div>
            ) : currentDeal ? (
                <>
                    {/* İndirim Kartı */}
                    <div className="bg-gray-800 rounded-2xl overflow-hidden shadow-xl mb-4">
                        {/* Görsel */}
                        <div className="aspect-square bg-gray-700 relative">
                            {/* Tarih Etiketi */}
                            {currentDeal.postedAt && (() => {
                                // Firebase Timestamp veya Date string olabilir
                                let dateObj: Date;
                                const posted = currentDeal.postedAt as any;
                                if (posted?.seconds) {
                                    // Firebase Timestamp
                                    dateObj = new Date(posted.seconds * 1000);
                                } else if (posted?.toDate) {
                                    // Firestore Timestamp objesi
                                    dateObj = posted.toDate();
                                } else {
                                    dateObj = new Date(posted);
                                }

                                // Geçerli tarih mi kontrol et
                                if (isNaN(dateObj.getTime())) return null;

                                return (
                                    <div className="absolute top-2 right-2 bg-black/70 text-white text-xs px-2 py-1 rounded-lg backdrop-blur-sm">
                                        {dateObj.toLocaleDateString('tr-TR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                                    </div>
                                );
                            })()}
                            {currentDeal.imageUrl ? (
                                <img
                                    src={currentDeal.imageUrl}
                                    alt={currentDeal.title}
                                    className="w-full h-full object-cover"
                                    onError={(e) => {
                                        (e.target as HTMLImageElement).src = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect fill="%23374151" width="100" height="100"/><text x="50" y="55" text-anchor="middle" fill="%239CA3AF" font-size="40">📷</text></svg>';
                                    }}
                                />
                            ) : (
                                <div className="w-full h-full flex items-center justify-center">
                                    <span className="text-6xl">📷</span>
                                </div>
                            )}
                        </div>

                        {/* Bilgiler */}
                        <div className="p-4">
                            <h2 className="text-white font-semibold text-lg line-clamp-2 mb-2">
                                {currentDeal.title}
                            </h2>

                            <div className="flex items-center gap-2">
                                <span className="text-2xl font-bold text-orange-400">
                                    {currentDeal.price > 0 ? `${currentDeal.price.toLocaleString('tr-TR')}₺` : 'Fiyat yok'}
                                </span>
                            </div>
                        </div>
                    </div>

                    {/* Reddet / Onayla Butonları */}
                    <div className="flex gap-4 mb-3">
                        <button
                            onClick={handleReject}
                            className="flex-1 py-4 bg-red-500/20 hover:bg-red-500/30 text-red-400 font-bold rounded-xl border-2 border-red-500/50 transition-all duration-200 flex items-center justify-center gap-2"
                        >
                            <span className="text-2xl">❌</span>
                            <span>Reddet</span>
                        </button>

                        <button
                            onClick={handleApprove}
                            className="flex-1 py-4 bg-green-500/20 hover:bg-green-500/30 text-green-400 font-bold rounded-xl border-2 border-green-500/50 transition-all duration-200 flex items-center justify-center gap-2"
                        >
                            <span className="text-2xl">✓</span>
                            <span>Onayla</span>
                        </button>
                    </div>

                    {/* İndirime Git Butonu */}
                    <button
                        onClick={() => window.open(currentDeal.onualLink || currentDeal.productLink, '_blank')}
                        className="w-full py-3 mb-4 bg-blue-500/20 hover:bg-blue-500/30 text-blue-400 font-medium rounded-xl border border-blue-500/50 transition-all duration-200 flex items-center justify-center gap-2"
                    >
                        <span>🔗</span>
                        <span>İndirime Git</span>
                    </button>

                    {/* İlerleme ve Navigasyon */}
                    <div className="flex items-center justify-center gap-4 mb-2">
                        {/* Önceki butonu */}
                        <button
                            onClick={() => setCurrentIndex(prev => Math.max(0, prev - 1))}
                            disabled={currentIndex === 0}
                            className="p-2 bg-gray-700 hover:bg-gray-600 disabled:bg-gray-800 disabled:text-gray-600 text-white rounded-full transition-all"
                            title="Önceki"
                        >
                            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                            </svg>
                        </button>

                        {/* İlerleme */}
                        <span className="text-gray-400 text-sm min-w-[80px] text-center">
                            {currentIndex + 1} / {deals.length}
                        </span>

                        {/* Sonraki butonu */}
                        <button
                            onClick={() => setCurrentIndex(prev => Math.min(deals.length - 1, prev + 1))}
                            disabled={currentIndex === deals.length - 1}
                            className="p-2 bg-gray-700 hover:bg-gray-600 disabled:bg-gray-800 disabled:text-gray-600 text-white rounded-full transition-all"
                            title="Sonraki"
                        >
                            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                            </svg>
                        </button>
                    </div>

                    {/* Yeniden Yükle */}
                    <button
                        onClick={handleFetchDeals}
                        disabled={isLoading}
                        className="w-full mt-4 py-2 text-gray-400 hover:text-white text-sm transition-colors"
                    >
                        🔄 Yeniden Yükle
                    </button>
                </>
            ) : null}
        </div>
    );
};

export default DealFinder;
