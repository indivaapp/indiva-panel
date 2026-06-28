
import React, { useState, useEffect, useCallback } from 'react';
import { App as CapacitorApp } from '@capacitor/app';

import type { ViewType } from './types';
import type { ScrapedDeal } from './services/dealFinder';

declare global {
    interface Window {
        AndroidShareHandler?: {
            getSharedText:   () => string;
            getSharedImage:  () => string;
            getClipboardUrl: () => string;
            finishActivity:  () => void;
        };
        INDIVAShareMode?: { isShareMode: () => boolean };
    }
}

interface SharedStoryData {
    imageBase64: string;   // sıkıştırılmış JPEG base64
    clipboardLink: string; // pano'daki URL (boş olabilir)
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
import TrendyolScraper from './components/TrendyolScraper';
import Dashboard from './components/Dashboard';
import AddDiscountForm from './components/AddDiscountForm';
import StoryManager from './components/StoryManager';
import ShareTarget from './components/ShareTarget';
import ShareUrlTarget from './components/ShareUrlTarget';
import QuickShareOverlay from './components/QuickShareOverlay';
import { watchUser } from './services/auth';
import Login from './components/Login';
import { getPendingAffiliateCount, getPendingAdRequestCount, getPendingDiscountCount } from './services/firebase';

const SYSTEM_KEY = 'indiva_system_active';

// ShareActivity tarafından yüklendiyse: sadece QuickShareOverlay göster
// INDIVAShareMode interface'i ShareActivity.java tarafından inject edilir
const IS_SHARE_MODE = typeof (window as any).INDIVAShareMode !== 'undefined';

const App: React.FC = () => {
    const [activeView, setActiveView] = useState<ViewType>('dashboard');
    const [user, setUser] = useState<import('firebase/auth').User | null>(null);
    const [authChecked, setAuthChecked] = useState(false);
    const authReady = !!user;
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
    const [pendingAdRequestCount, setPendingAdRequestCount] = useState(0);
    const [pendingDiscountCount, setPendingDiscountCount] = useState(0);
    const [dealQueue, setDealQueue] = useState<ScrapedDeal[]>([]);
    const [currentQueueIndex, setCurrentQueueIndex] = useState(0);
    const [sharedLink, setSharedLink]           = useState<string | null>(null);
    const [sharedStoryData, setSharedStoryData] = useState<SharedStoryData | null>(null);

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

    // ShareActivity modunda tüm auth/subscriptions atlanır
    useEffect(() => {
        if (IS_SHARE_MODE) return;
        // Yönetici oturumunu dinle. Oturum kalıcı; bir kez giriş yetince hatırlanır.
        const unsub = watchUser((u) => {
            setUser(u);
            setAuthChecked(true);
        });
        return () => unsub();
    }, []);

    // ── Service Worker kaydı + Share Target mesaj dinleyicisi ─────────────────
    useEffect(() => {
        if (!('serviceWorker' in navigator)) return;

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

        // Fallback: sekme öne geldiğinde cache'de taze share verisi var mı kontrol et
        // (SW mesajının kaybolduğu warm-start senaryosu için)
        const checkShareCache = async () => {
            if (!('caches' in window)) return;
            try {
                const cache = await caches.open('indiva-share-v1');
                const metaResp = await cache.match('/share-meta');
                if (!metaResp) return;
                const meta = JSON.parse(await metaResp.text());
                const age = Date.now() - (meta.timestamp || 0);
                if (age < 60000) { // 60 saniyeden taze
                    setShowShareTarget(true);
                }
            } catch {}
        };

        const handleVisibilityChange = () => {
            if (document.visibilityState === 'visible') {
                checkShareCache();
            }
        };

        document.addEventListener('visibilitychange', handleVisibilityChange);

        return () => {
            navigator.serviceWorker.removeEventListener('message', handleSwMessage);
            document.removeEventListener('visibilitychange', handleVisibilityChange);
        };
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
                if (urlMatch) { setSharedLink(urlMatch[0]); }
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
        // Görsel paylaşımını işle (warm start — detail:'ready' gelince interface'i çağır)
        const handleSharedImage = async (_event: Event) => {
            try {
                const base64 = await window.AndroidShareHandler?.getSharedImage?.();
                if (!base64) return;
                const clipboardLink = (await window.AndroidShareHandler?.getClipboardUrl?.()) || '';
                setSharedStoryData({ imageBase64: base64, clipboardLink });
                setActiveView('stories');
            } catch {}
        };

        const checkAndroidIntent = async () => {
            try {
                // Cold-start: URL kontrolü
                if (window.AndroidShareHandler?.getSharedText) {
                    const sharedText = await window.AndroidShareHandler.getSharedText();
                    if (sharedText) {
                        const urlMatch = sharedText.match(/https?:\/\/[^\s]+/);
                        if (urlMatch) { setSharedLink(urlMatch[0]); return; }
                    }
                }
                // Cold-start: Görsel kontrolü
                if (window.AndroidShareHandler?.getSharedImage) {
                    const base64 = await window.AndroidShareHandler.getSharedImage();
                    if (base64) {
                        const clipboardLink = (await window.AndroidShareHandler?.getClipboardUrl?.()) || '';
                        setSharedStoryData({ imageBase64: base64, clipboardLink });
                        setActiveView('stories');
                    }
                }
            } catch {}
        };
        handleAppUrlOpen();
        checkAndroidIntent();
        const handleSharedUrl = (event: CustomEvent<string>) => {
            if (event.detail) { setSharedLink(event.detail); }
        };
        // Warm-start: Görsel paylaşımı
        window.addEventListener('sharedImage', handleSharedImage as EventListener);
        window.addEventListener('sharedUrl', handleSharedUrl as EventListener);
        return () => {
            urlListener.then(listener => listener.remove());
            window.removeEventListener('sharedImage', handleSharedImage as EventListener);
            window.removeEventListener('sharedUrl', handleSharedUrl as EventListener);
        };
    }, []);

    useEffect(() => {
        if (!authReady) return;
        const loadCounts = async () => {
            try { setPendingAffiliateCount(await getPendingAffiliateCount()); } catch {}
            try { setPendingAdRequestCount(await getPendingAdRequestCount()); } catch {}
            try { setPendingDiscountCount(await getPendingDiscountCount()); } catch {}
        };
        loadCounts();
        const interval = setInterval(loadCounts, 30000);
        return () => clearInterval(interval);
    }, [authReady]);

    // ShareActivity: sadece QuickShareOverlay göster, tüm app'i atla
    if (IS_SHARE_MODE) {
        return <QuickShareOverlay />;
    }

    // Auth durumu henüz belirlenmediyse kısa bir yükleme göster
    if (!authChecked) {
        return (
            <div className="flex items-center justify-center min-h-screen bg-gray-900">
                <div className="w-6 h-6 border-2 border-gray-600 border-t-blue-500 rounded-full animate-spin" />
            </div>
        );
    }

    // Giriş yapılmamışsa yönetici giriş ekranı
    if (!user) {
        return <Login />;
    }

    const renderContent = () => {
        switch (activeView) {
            case 'dashboard':
                return <Dashboard setActiveView={setActiveView} isAdmin={isAdmin} pendingAffiliateCount={pendingAffiliateCount} />;
            case 'discounts':
                return <DiscountManager setActiveView={setActiveView} isAdmin={isAdmin} />;
            case 'manageDiscounts':
                return <ManageDiscounts setActiveView={setActiveView} isAdmin={isAdmin} />;
            case 'brochures':
                return <BrochureManager setActiveView={setActiveView} isAdmin={isAdmin} />;
            case 'submissions':
                return <SubmissionReview isAdmin={isAdmin} onAdRequestCountChange={setPendingAdRequestCount} onDiscountCountChange={setPendingDiscountCount} />;
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
            case 'trendyolScraper':
                return <TrendyolScraper />;
            case 'addDiscount':
                return <AddDiscountForm setActiveView={setActiveView} isAdmin={isAdmin} />;
            case 'stories':
                return (
                    <StoryManager
                        isAdmin={isAdmin}
                        initialImageBase64={sharedStoryData?.imageBase64}
                        initialLink={sharedStoryData?.clipboardLink}
                        onSharedDataConsumed={() => setSharedStoryData(null)}
                    />
                );
            default:
                return <DiscountManager setActiveView={setActiveView} isAdmin={isAdmin} />;
        }
    };

    return (
        <div className="flex flex-col bg-gray-900 text-gray-100 overflow-hidden" style={{ height: '100dvh' }}>

            {/* ── PWA Share Target Overlay ─────────────────────────────────────
                Kullanıcı bir ekran görüntüsünü paylaştığında otomatik açılır,
                işlemi tamamlayınca kapanır. Tüm UI'ın üzerinde görünür.      */}
            {showShareTarget && authReady && (
                <ShareTarget onClose={handleShareTargetClose} />
            )}

            {/* URL Share Target — Trendyol/HB vb.'den link paylaşılınca açılır */}
            {sharedLink && authReady && (
                <ShareUrlTarget
                    url={sharedLink}
                    onClose={() => setSharedLink(null)}
                />
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

                <BottomNav activeView={activeView} setActiveView={setActiveView} pendingAffiliateCount={pendingAffiliateCount} pendingSubmissionsCount={pendingAdRequestCount + pendingDiscountCount} />
            </div>
        </div>
    );
};

export default App;
