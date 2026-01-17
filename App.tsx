
import React, { useState, useEffect, useCallback } from 'react';
import type { ViewType } from './types';
import type { ScrapedDeal } from './services/dealFinder';
import Sidebar from './components/Sidebar';
import BottomNav from './components/BottomNav';
import DiscountManager from './components/DiscountManager';
import BrochureManager from './components/BrochureManager';
import SubmissionReview from './components/SubmissionReview';
import AdManager from './components/AdManager';
import NotificationSender from './components/NotificationSender';
import DealFinder from './components/DealFinder';
import ManageDiscounts from './components/ManageDiscounts';
import EditDealPage from './components/EditDealPage';
import AffiliateLinkManager from './components/AffiliateLinkManager';
import { ensureAnonymousAuth, onAuthReady } from './services/auth';
import { getPendingAffiliateCount } from './services/firebase';
import Logo from './components/Logo';

const App: React.FC = () => {
    const [activeView, setActiveView] = useState<ViewType>('dealFinder');
    const [authReady, setAuthReady] = useState(false);
    const [authError, setAuthError] = useState<string | null>(null);
    // Authentication is removed. Every user is considered an admin.
    const isAdmin = true;

    // Sayfa geçişi için seçilen veriler
    const [selectedDeal, setSelectedDeal] = useState<ScrapedDeal | null>(null);

    // Bekleyen affiliate link sayısı
    const [pendingAffiliateCount, setPendingAffiliateCount] = useState(0);

    // Sıralı düzenleme kuyruğu
    const [dealQueue, setDealQueue] = useState<ScrapedDeal[]>([]);
    const [currentQueueIndex, setCurrentQueueIndex] = useState(0);

    // Kuyruğu başlat
    const startDealQueue = useCallback((deals: ScrapedDeal[]) => {
        if (deals.length === 0) return;
        setDealQueue(deals);
        setCurrentQueueIndex(0);
        setSelectedDeal(deals[0]);
        setActiveView('editDeal');
    }, []);

    // Sonraki deal'e geç
    const handleNextDeal = useCallback(() => {
        const nextIndex = currentQueueIndex + 1;
        if (nextIndex < dealQueue.length) {
            setCurrentQueueIndex(nextIndex);
            setSelectedDeal(dealQueue[nextIndex]);
        } else {
            // Kuyruk bitti
            setDealQueue([]);
            setCurrentQueueIndex(0);
            setSelectedDeal(null);
            setActiveView('dealFinder');
        }
    }, [currentQueueIndex, dealQueue]);

    // Kuyruğu iptal et
    const handleCancelQueue = useCallback(() => {
        setDealQueue([]);
        setCurrentQueueIndex(0);
        setSelectedDeal(null);
        setActiveView('dealFinder');
    }, []);

    useEffect(() => {
        let authUnsubscribe: (() => void) | undefined;

        const initializeAuth = async () => {
            try {
                await ensureAnonymousAuth();
                authUnsubscribe = onAuthReady(() => {
                    setAuthReady(true);
                });
            } catch (err: any) {
                setAuthError(err.message || 'Bilinmeyen bir kimlik doğrulama hatası oluştu.');
            }
        };

        initializeAuth();

        return () => {
            if (authUnsubscribe) {
                authUnsubscribe();
            }
        };
    }, []);

    // Bekleyen affiliate link sayısını yükle
    useEffect(() => {
        const loadPendingCount = async () => {
            try {
                const count = await getPendingAffiliateCount();
                setPendingAffiliateCount(count);
            } catch (err) {
                console.warn('Affiliate sayısı yüklenemedi:', err);
            }
        };

        if (authReady) {
            loadPendingCount();
            // Her 30 saniyede bir güncelle
            const interval = setInterval(loadPendingCount, 30000);
            return () => clearInterval(interval);
        }
    }, [authReady]);

    if (authError) {
        return (
            <div className="flex items-center justify-center min-h-screen bg-red-900 text-white p-6 pt-[env(safe-area-inset-top)]">
                <div className="text-center max-w-xl bg-red-800 p-8 rounded-lg shadow-lg border border-red-600">
                    <h1 className="text-2xl font-bold mb-4">Kimlik Doğrulama Hatası</h1>
                    <p className="text-left whitespace-pre-wrap opacity-80">{authError}</p>
                    <button onClick={() => window.location.reload()} className="mt-6 px-6 py-2 bg-white text-red-900 font-bold rounded hover:bg-gray-100">
                        Tekrar Dene
                    </button>
                </div>
            </div>
        );
    }

    if (!authReady) {
        return (
            <div className="flex flex-col items-center justify-center min-h-screen bg-gray-900 text-white">
                <Logo className="h-20 md:h-28" showText={false} />
                <h1 className="mt-6 text-3xl md:text-4xl font-bold tracking-wider text-white">
                    İNDİVA
                </h1>
                <p className="mt-1 text-xs font-semibold tracking-[0.2em] text-blue-400 uppercase">
                    Yönetim Paneli
                </p>
                <div className="mt-8 w-8 h-8 border-2 border-blue-500/30 border-t-blue-500 rounded-full animate-spin"></div>
            </div>
        );
    }


    const renderContent = () => {
        switch (activeView) {
            case 'discounts':
                return <DiscountManager setActiveView={setActiveView} isAdmin={isAdmin} />;
            case 'manageDiscounts':
                return <ManageDiscounts setActiveView={setActiveView} isAdmin={isAdmin} />;
            case 'brochures':
                return <BrochureManager setActiveView={setActiveView} isAdmin={isAdmin} />;
            case 'submissions':
                return <SubmissionReview isAdmin={isAdmin} />;
            case 'ads':
                return <AdManager isAdmin={isAdmin} />;
            case 'notifications':
                return <NotificationSender isAdmin={isAdmin} />;
            case 'affiliateLinks':
                return <AffiliateLinkManager isAdmin={isAdmin} setActiveView={setActiveView} />;
            case 'dealFinder':
                return <DealFinder isAdmin={isAdmin} setActiveView={setActiveView} setSelectedDeal={setSelectedDeal} startDealQueue={startDealQueue} />;
            case 'editDeal':
                return selectedDeal ? (
                    <EditDealPage
                        deal={selectedDeal}
                        setActiveView={setActiveView}
                        isAdmin={isAdmin}
                        queueInfo={dealQueue.length > 0 ? { current: currentQueueIndex + 1, total: dealQueue.length } : undefined}
                        onNextDeal={dealQueue.length > 0 ? handleNextDeal : undefined}
                        onCancelQueue={dealQueue.length > 0 ? handleCancelQueue : undefined}
                    />
                ) : <DealFinder isAdmin={isAdmin} setActiveView={setActiveView} setSelectedDeal={setSelectedDeal} startDealQueue={startDealQueue} />;
            default:
                return <DiscountManager setActiveView={setActiveView} isAdmin={isAdmin} />;
        }
    };

    return (
        <div className="flex flex-col min-h-screen bg-gray-900 text-gray-100">
            <div className="flex flex-1">
                <Sidebar activeView={activeView} setActiveView={setActiveView} pendingAffiliateCount={pendingAffiliateCount} />
                {/* Status bar için safe-area-inset-top eklendi */}
                <main className="flex-1 p-6 md:p-10 pb-24 md:pb-10 pt-[calc(1.5rem+env(safe-area-inset-top))] md:pt-10 overflow-x-hidden">
                    {/* Mobile Header - Logo solda, sayfa başlığı sağda */}
                    <div className="md:hidden flex justify-between items-center mb-4 border-b border-gray-800 pb-3">
                        <Logo className="h-7" showText={true} />
                        <span className="text-white font-semibold text-lg">
                            {activeView === 'dealFinder' && '🔍 Fırsat Bul'}
                            {activeView === 'discounts' && '➕ Ekle'}
                            {activeView === 'manageDiscounts' && '📋 Yönet'}
                            {activeView === 'brochures' && '📰 Aktüel'}
                            {activeView === 'submissions' && '✅ Onay'}
                            {activeView === 'ads' && '📢 Reklam'}
                            {activeView === 'notifications' && '🔔 Bildirim'}
                            {activeView === 'editDeal' && '✏️ Düzenle'}
                            {activeView === 'affiliateLinks' && '💰 Affiliate'}
                        </span>
                    </div>
                    {renderContent()}
                </main>
                <BottomNav activeView={activeView} setActiveView={setActiveView} pendingAffiliateCount={pendingAffiliateCount} />
            </div>
        </div>
    );
};

export default App;
