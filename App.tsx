
import React, { useState, useEffect, useCallback } from 'react';
import { App as CapacitorApp } from '@capacitor/app';

import type { ViewType } from './types';
import type { ScrapedDeal } from './services/dealFinder';

declare global {
    interface Window {
        AndroidShareHandler?: {
            getSharedText: () => Promise<string> | string;
        };
    }
}

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
import AutoDiscoveryPanel from './components/AutoDiscoveryPanel';
import Dashboard from './components/Dashboard';
import ShareTarget from './components/ShareTarget';
import { ensureAnonymousAuth, onAuthReady } from './services/auth';
import { getPendingAffiliateCount } from './services/firebase';

const SYSTEM_KEY = 'indiva_system_active';

const App: React.FC = () => {
    const [activeView, setActiveView] = useState<ViewType>('dashboard');
    const [authReady, setAuthReady] = useState(false);
    const [authError, setAuthError] = useState<string | null>(null);
    const isAdmin = true;

    // Sistem toggle — tek kaynak, localStorage tabanlı
    const [systemEnabled, setSystemEnabledState] = useState<boolean>(() => {
        try { return localStorage.getItem(SYSTEM_KEY) !== 'false'; }
        catch { return true; }
    });

    const handleToggleSystem = useCallback(() => {
        const newVal = !systemEnabled;
        try { localStorage.setItem(SYSTEM_KEY, newVal ? 'true' : 'false'); } catch {}
        setSystemEnabledState(newVal);
    }, [systemEnabled]);

    const [selectedDeal, setSelectedDeal] = useState<ScrapedDeal | null>(null);
    const [pendingAffiliateCount, setPendingAffiliateCount] = useState(0);
    const [dealQueue, setDealQueue] = useState<ScrapedDeal[]>([]);
    const [currentQueueIndex, setCurrentQueueIndex] = useState(0);
    const [sharedLink, setSharedLink] = useState<string | null>(null);

    // ── PWA Share Target overlay ───────────────────────────────────────────────
    // ?share=1 parametresi Service Worker'dan yönlendirme sonucu gelir
    const [showShareTarget, setShowShareTarget] = useState<boolean>(() => {
        try {
            return new URLSearchParams(window.location.search).get('share') === '1';
        } catch { return false; }
    });

    const startDealQueue = useCallback((deals: ScrapedDeal[]) => {
        if (deals.length === 0) return;
        setDealQueue(deals);
        setCurrentQueueIndex(0);
        setSelectedDeal(deals[0]);
        setActiveView('editDeal');
    }, []);

    const handleNextDeal = useCallback(() => {
        const nextIndex = currentQueueIndex + 1;
        if (nextIndex < dealQueue.length) {
            setCurrentQueueIndex(nextIndex);
            setSelectedDeal(dealQueue[nextIndex]);
        } else {
            setDealQueue([]);
            setCurrentQueueIndex(0);
            setSelectedDeal(null);
            setActiveView('dealFinder');
        }
    }, [currentQueueIndex, dealQueue]);

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
                authUnsubscribe = onAuthReady(() => setAuthReady(true));
            } catch (err: any) {
                setAuthError(err.message || 'Kimlik doğrulama hatası');
            }
        };
        initializeAuth();
        return () => { if (authUnsubscribe) authUnsubscribe(); };
    }, []);

    // ── Service Worker kaydı + Share Target mesaj dinleyicisi ─────────────────
    useEffect(() => {
        // SW Kaydet
        if ('serviceWorker' in navigator) {
            navigator.serviceWorker
                .register('/sw.js', { scope: '/' })
                .then(reg => console.log('[App] SW kayıt:', reg.scope))
                .catch(err => console.warn('[App] SW kayıt hatası:', err));

            // SW'dan gelen "SHARE_RECEIVED" mesajını dinle
            const handleSwMessage = (event: MessageEvent) => {
                if (event.data?.type === 'SHARE_RECEIVED') {
                    setShowShareTarget(true);
                }
            };
            navigator.serviceWorker.addEventListener('message', handleSwMessage);
            return () => {
                navigator.serviceWorker.removeEventListener('message', handleSwMessage);
            };
        }
    }, []);

    // ── Share overlay kapandığında URL'den ?share=1 parametresini temizle ─────
    const handleShareTargetClose = useCallback(() => {
        setShowShareTarget(false);
        // URL'yi temizle (history.replaceState ile sayfa yenilenmeden)
        try {
            const url = new URL(window.location.href);
            url.searchParams.delete('share');
            window.history.replaceState({}, '', url.toString());
        } catch {}
    }, []);

    useEffect(() => {
        const processSharedUrl = (url: string) => {
            if (url.includes('://')) {
                const urlMatch = url.match(/https?:\/\/[^\s]+/);
                if (urlMatch) { setSharedLink(urlMatch[0]); setActiveView('affiliateLinks'); }
            }
        };
        const handleAppUrlOpen = async () => {
            try {
                const launchUrl = await CapacitorApp.getLaunchUrl();
                if (launchUrl?.url) processSharedUrl(launchUrl.url);
            } catch {}
        };
        const urlListener = CapacitorApp.addListener('appUrlOpen', (event) => {
            if (event.url) processSharedUrl(event.url);
        });
        const checkAndroidIntent = async () => {
            try {
                if (window.AndroidShareHandler?.getSharedText) {
                    const sharedText = await window.AndroidShareHandler.getSharedText();
                    if (sharedText) {
                        const urlMatch = sharedText.match(/https?:\/\/[^\s]+/);
                        if (urlMatch) { setSharedLink(urlMatch[0]); setActiveView('affiliateLinks'); }
                    }
                }
            } catch {}
        };
        handleAppUrlOpen();
        checkAndroidIntent();
        const handleSharedUrl = (event: CustomEvent<string>) => {
            if (event.detail) { setSharedLink(event.detail); setActiveView('affiliateLinks'); }
        };
        window.addEventListener('sharedUrl', handleSharedUrl as EventListener);
        return () => {
            urlListener.then(listener => listener.remove());
            window.removeEventListener('sharedUrl', handleSharedUrl as EventListener);
        };
    }, []);

    useEffect(() => {
        if (!authReady) return;
        const loadPendingCount = async () => {
            try { setPendingAffiliateCount(await getPendingAffiliateCount()); } catch {}
        };
        loadPendingCount();
        const interval = setInterval(loadPendingCount, 30000);
        return () => clearInterval(interval);
    }, [authReady]);

    if (authError) {
        return (
            <div className="flex items-center justify-center min-h-screen bg-gray-900 text-white p-6">
                <div className="max-w-md w-full bg-gray-800 p-6 rounded-lg border border-red-700">
                    <p className="text-red-400 font-semibold mb-2">Bağlantı Hatası</p>
                    <p className="text-gray-300 text-sm mb-4">{authError}</p>
                    <button onClick={() => window.location.reload()} className="px-4 py-2 bg-blue-600 text-white text-sm rounded hover:bg-blue-500">
                        Tekrar Dene
                    </button>
                </div>
            </div>
        );
    }

    if (!authReady) {
        return (
            <div className="flex items-center justify-center min-h-screen bg-gray-900">
                <div className="w-6 h-6 border-2 border-gray-600 border-t-blue-500 rounded-full animate-spin" />
            </div>
        );
    }

    const renderContent = () => {
        switch (activeView) {
            case 'dashboard':
                return <Dashboard setActiveView={setActiveView} isAdmin={isAdmin} />;
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
                return <AffiliateLinkManager isAdmin={isAdmin} setActiveView={setActiveView} sharedLink={sharedLink} onSharedLinkProcessed={() => setSharedLink(null)} />;
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
            case 'autoDiscovery':
                return <AutoDiscoveryPanel isAdmin={isAdmin} setActiveView={setActiveView} />;
            default:
                return <DiscountManager setActiveView={setActiveView} isAdmin={isAdmin} />;
        }
    };

    const viewLabels: Record<string, string> = {
        dashboard: 'Ana Sayfa', dealFinder: 'Fırsat Bul', discounts: 'Ekle',
        manageDiscounts: 'Yönet', brochures: 'Aktüel', submissions: 'Onay',
        ads: 'Reklam', notifications: 'Bildirim', editDeal: 'Düzenle',
        affiliateLinks: 'Affiliate', autoDiscovery: 'Keşif',
    };

    return (
        <div className="flex flex-col bg-gray-900 text-gray-100 overflow-hidden" style={{ height: '100dvh' }}>

            {/* ── PWA Share Target Overlay ─────────────────────────────────────
                Kullanıcı bir ekran görüntüsünü paylaştığında otomatik açılır,
                işlemi tamamlayınca kapanır. Tüm UI'ın üzerinde görünür.      */}
            {showShareTarget && authReady && (
                <ShareTarget onClose={handleShareTargetClose} />
            )}

            <div className="flex flex-1 overflow-hidden">
                <Sidebar
                    activeView={activeView}
                    setActiveView={setActiveView}
                    pendingAffiliateCount={pendingAffiliateCount}
                    systemEnabled={systemEnabled}
                    onToggleSystem={handleToggleSystem}
                />

                <div className="flex-1 flex flex-col overflow-hidden">
                    {/* Mobil Header — sabit kalır, scroll olmaz */}
                    <div className="md:hidden flex justify-between items-center px-4 py-3 border-b border-gray-800 shrink-0">
                        <span className="text-white font-semibold">{viewLabels[activeView] ?? activeView}</span>
                        <button
                            onClick={handleToggleSystem}
                            title={systemEnabled ? 'Sistemi Kapat' : 'Sistemi Aç'}
                            className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full focus:outline-none ${systemEnabled ? 'bg-green-500' : 'bg-gray-600'}`}
                        >
                            <span className={`inline-block h-4 w-4 rounded-full bg-white shadow transition-transform duration-150 ${systemEnabled ? 'translate-x-6' : 'translate-x-1'}`} />
                        </button>
                    </div>

                    {/* Sistem Kapalı Uyarısı */}
                    {!systemEnabled && (
                        <div className="mx-4 mt-3 flex items-center justify-between gap-2 rounded-md bg-red-950 border border-red-800 px-3 py-2 text-sm text-red-300 shrink-0">
                            <span>Sistem kapalı — API çağrıları durduruldu</span>
                            <button onClick={handleToggleSystem} className="shrink-0 text-xs font-semibold text-red-200 underline">Aç</button>
                        </div>
                    )}

                    {/* Kaydırılabilir içerik alanı */}
                    <main className="flex-1 overflow-y-auto p-4 md:p-8 pb-24 md:pb-8">
                        {renderContent()}
                    </main>
                </div>

                <BottomNav activeView={activeView} setActiveView={setActiveView} pendingAffiliateCount={pendingAffiliateCount} />
            </div>
        </div>
    );
};

export default App;
