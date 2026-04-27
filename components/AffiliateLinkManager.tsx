
import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
    getDiscountsNeedingAffiliate,
    updateAffiliateLink,
    skipAffiliateUpdate
} from '../services/firebase';
import { Clipboard } from '@capacitor/clipboard';
import { App as CapApp } from '@capacitor/app';
import {
    generateAffiliateLink,
    isTrendyolUrl,
    saveTrendyolCookies,
    hasTrendyolCookies,
} from '../services/trendyolAffiliate';
import type { ViewType, Discount } from '../types';

interface AffiliateLinkManagerProps {
    isAdmin: boolean;
    setActiveView?: (view: ViewType) => void;
    sharedLink?: string | null;
    onSharedLinkProcessed?: () => void;
}

// Affiliate link olarak kabul edilecek URL pattern'leri
const isAffiliateLink = (url: string): boolean => {
    if (!url || !url.startsWith('http')) return false;
    return (
        url.includes('ty.gl/') ||
        url.includes('trendyol.com/') ||
        url.includes('hepsiburada.com/') ||
        url.includes('amzn.to/') ||
        url.includes('amazon.com.tr/')
    );
};

const readClipboard = async (): Promise<string> => {
    try {
        const { value } = await Clipboard.read();
        if (value) return value;
    } catch {}
    try {
        return await navigator.clipboard.readText();
    } catch {}
    return '';
};

const AffiliateLinkManager: React.FC<AffiliateLinkManagerProps> = ({ isAdmin, sharedLink, onSharedLinkProcessed }) => {
    const [pendingDeals, setPendingDeals] = useState<Discount[]>([]);
    const [currentIndex, setCurrentIndex] = useState(0);
    const [isLoadingPending, setIsLoadingPending] = useState(false);
    const [affiliateInput, setAffiliateInput] = useState('');
    const [isUpdating, setIsUpdating] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [successMessage, setSuccessMessage] = useState<string | null>(null);

    // Bot state
    // Cookie ayarları
    const [showCookieSettings, setShowCookieSettings] = useState(false);
    const [cookieEntrance, setCookieEntrance]         = useState('');
    const [cookieAnonym, setCookieAnonym]             = useState('');
    const [cookiesConfigured, setCookiesConfigured]   = useState(hasTrendyolCookies);

    // Otomatik üretme
    const [autoGenerating, setAutoGenerating] = useState(false);
    const [autoProgress, setAutoProgress]     = useState({ done: 0, total: 0 });

    const [botActive, setBotActive] = useState(false);
    const [botStatus, setBotStatus] = useState<'waiting' | 'detected' | 'saving'>('waiting');
    const lastSavedRef = useRef('');
    const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const currentDealRef = useRef<Discount | null>(null);
    const currentIndexRef = useRef(0);

    const currentDeal = pendingDeals[currentIndex];

    // ref'leri güncel tut
    useEffect(() => { currentDealRef.current = currentDeal ?? null; }, [currentDeal]);
    useEffect(() => { currentIndexRef.current = currentIndex; }, [currentIndex]);

    const formatTimeAgo = (date: any) => {
        if (!date) return '';
        const now = new Date();
        const created = date.toDate ? date.toDate() : new Date(date);
        const diff = Math.floor((now.getTime() - created.getTime()) / 60000);
        if (diff < 1) return 'Az önce';
        if (diff < 60) return `${diff} dk önce`;
        const h = Math.floor(diff / 60);
        if (h < 24) return `${h} sa önce`;
        return created.toLocaleDateString('tr-TR');
    };

    const handleSaveCookies = () => {
        if (!cookieEntrance.trim() || !cookieAnonym.trim()) return;
        saveTrendyolCookies(cookieEntrance.trim(), cookieAnonym.trim());
        setCookiesConfigured(true);
        setShowCookieSettings(false);
        setCookieEntrance('');
        setCookieAnonym('');
        setSuccessMessage('✅ Cookie\'ler kaydedildi!');
        setTimeout(() => setSuccessMessage(null), 3000);
    };

    const handleAutoGenerateAll = async () => {
        const trendyolDeals = pendingDeals.filter(d => isTrendyolUrl(d.originalStoreLink || d.link));
        if (trendyolDeals.length === 0) {
            setError('Bekleyen Trendyol ürünü yok.');
            return;
        }
        setAutoGenerating(true);
        setAutoProgress({ done: 0, total: trendyolDeals.length });
        let done = 0;
        for (const deal of trendyolDeals) {
            try {
                const link = await generateAffiliateLink(deal.originalStoreLink || deal.link);
                if (link.includes('ty.gl')) {
                    await updateAffiliateLink(deal.id, link);
                }
            } catch { /* devam et */ }
            done++;
            setAutoProgress({ done, total: trendyolDeals.length });
        }
        setAutoGenerating(false);
        setSuccessMessage(`🎉 ${done} Trendyol ürünü otomatik güncellendi!`);
        setTimeout(() => setSuccessMessage(null), 4000);
        await loadPending();
    };

    const loadPending = async () => {
        setIsLoadingPending(true);
        try {
            const deals = await getDiscountsNeedingAffiliate();
            setPendingDeals(deals);
            setCurrentIndex(0);
        } catch (err: any) {
            setError('Bekleyen ürünler yüklenemedi: ' + err.message);
        } finally {
            setIsLoadingPending(false);
        }
    };

    useEffect(() => { loadPending(); }, []);

    useEffect(() => {
        if (sharedLink) {
            setAffiliateInput(sharedLink);
            setSuccessMessage('📥 Link otomatik yapıştırıldı!');
            setTimeout(() => setSuccessMessage(null), 4000);
            onSharedLinkProcessed?.();
        }
    }, [sharedLink, onSharedLinkProcessed]);

    // ── BOT KLİP KONTROL FONKSİYONU ──────────────────────────────────────────
    const checkClipboardForBot = useCallback(async () => {
        const deal = currentDealRef.current;
        if (!deal || isUpdating) return;

        const text = (await readClipboard()).trim();
        if (!text || !isAffiliateLink(text) || text === lastSavedRef.current) return;

        // Aynı linki iki kez kaydetme
        lastSavedRef.current = text;
        setBotStatus('saving');
        setAffiliateInput(text);

        try {
            await updateAffiliateLink(deal.id, text);

            const nextIndex = currentIndexRef.current + 1;
            if (nextIndex < pendingDeals.length) {
                setCurrentIndex(nextIndex);
                setBotStatus('waiting');
                setSuccessMessage(`✅ ${deal.brand} kaydedildi — sıradaki açılıyor...`);
                setTimeout(() => setSuccessMessage(null), 2500);
                setAffiliateInput('');
                // Sıradaki ürünü otomatik aç
                setTimeout(() => {
                    const nextDeal = pendingDeals[nextIndex];
                    if (nextDeal) window.open(nextDeal.originalStoreLink || nextDeal.link, '_blank');
                }, 600);
            } else {
                setBotActive(false);
                setBotStatus('waiting');
                setSuccessMessage('🎉 Tüm linkler güncellendi!');
                loadPending();
            }
        } catch {
            setBotStatus('waiting');
            lastSavedRef.current = ''; // tekrar deneyebilsin
        }
    }, [pendingDeals, isUpdating]);

    // ── BOT AKTİF/PASİF EFEKT ────────────────────────────────────────────────
    useEffect(() => {
        if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
        if (!botActive) return;

        let appListener: any = null;

        // Capacitor: uygulama ön plana gelince hemen kontrol et
        // (kullanıcı Hepsiburada/Trendyol'dan panele döndüğünde tetiklenir)
        CapApp.addListener('appStateChange', ({ isActive }) => {
            if (isActive) checkClipboardForBot();
        }).then(l => { appListener = l; });

        // Web fallback: sekme/pencere odağı
        const onFocus = () => checkClipboardForBot();
        window.addEventListener('focus', onFocus);

        // Yedek poll — 2sn
        pollIntervalRef.current = setInterval(checkClipboardForBot, 2000);

        return () => {
            if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
            window.removeEventListener('focus', onFocus);
            appListener?.remove();
        };
    }, [botActive, checkClipboardForBot]);

    // ── BOT BAŞLAT ────────────────────────────────────────────────────────────
    const startBot = () => {
        if (!currentDeal) return;
        lastSavedRef.current = '';
        setBotActive(true);
        setBotStatus('waiting');
        setAffiliateInput('');
        window.open(currentDeal.originalStoreLink || currentDeal.link, '_system');
        setSuccessMessage('🤖 Bot başlatıldı! Ürünü paylaşıp affiliate linkini kopyalayın, panel otomatik kaydeder.');
        setTimeout(() => setSuccessMessage(null), 5000);
    };

    const stopBot = () => {
        setBotActive(false);
        setBotStatus('waiting');
        if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
    };

    // ── MANUEL HANDLER'LAR ───────────────────────────────────────────────────
    const handleOpenProduct = () => {
        if (!currentDeal) return;
        window.open(currentDeal.originalStoreLink || currentDeal.link, '_system');
    };

    const handleClipboardPaste = async () => {
        const text = await readClipboard();
        if (text) {
            setAffiliateInput(text);
        } else {
            const input = prompt('Linkinizi buraya yapıştırın:');
            if (input) setAffiliateInput(input);
        }
    };

    const handleSaveAffiliate = async () => {
        if (!currentDeal || !affiliateInput.trim()) return;
        setIsUpdating(true);
        try {
            await updateAffiliateLink(currentDeal.id, affiliateInput.trim());
            setSuccessMessage('✅ Link güncellendi!');
            setAffiliateInput('');
            if (currentIndex < pendingDeals.length - 1) {
                setCurrentIndex(prev => prev + 1);
            } else {
                loadPending();
            }
            setTimeout(() => setSuccessMessage(null), 2000);
        } catch (err: any) {
            setError('Güncelleme hatası: ' + err.message);
        } finally {
            setIsUpdating(false);
        }
    };

    const handleSkip = async () => {
        if (!currentDeal) return;
        setIsUpdating(true);
        try {
            await skipAffiliateUpdate(currentDeal.id);
            setAffiliateInput('');
            if (currentIndex < pendingDeals.length - 1) {
                setCurrentIndex(prev => prev + 1);
            } else {
                loadPending();
            }
        } catch (err: any) {
            setError('Atlama hatası: ' + err.message);
        } finally {
            setIsUpdating(false);
        }
    };

    const handleSkipAll = async () => {
        if (!window.confirm('Kalan tüm ürünleri atlamak istiyor musunuz?')) return;
        setIsUpdating(true);
        try {
            await Promise.all(pendingDeals.slice(currentIndex).map(d => skipAffiliateUpdate(d.id)));
            setSuccessMessage('🧹 Liste temizlendi.');
            setPendingDeals([]);
            setCurrentIndex(0);
            setTimeout(() => setSuccessMessage(null), 3000);
        } catch (err: any) {
            setError('Toplu atlama hatası: ' + err.message);
        } finally {
            setIsUpdating(false);
        }
    };

    if (!isAdmin) return <div className="text-center text-red-400 p-10">Erişim yok</div>;

    return (
        <div className="max-w-2xl mx-auto px-4 py-6 pb-20">

            {/* Cookie Ayarları */}
            <div className="mb-4 bg-gray-800 rounded-xl border border-gray-700 overflow-hidden">
                <button
                    onClick={() => setShowCookieSettings(v => !v)}
                    className="w-full flex items-center justify-between px-4 py-3 text-sm"
                >
                    <span className="flex items-center gap-2">
                        <span>{cookiesConfigured ? '🟢' : '🔴'}</span>
                        <span className="text-gray-300 font-medium">Trendyol Cookie Ayarları</span>
                        {cookiesConfigured && <span className="text-green-400 text-xs">Ayarlı</span>}
                    </span>
                    <span className="text-gray-500">{showCookieSettings ? '▲' : '▼'}</span>
                </button>
                {showCookieSettings && (
                    <div className="px-4 pb-4 space-y-3 border-t border-gray-700">
                        <p className="text-xs text-gray-500 pt-3">
                            Trendyol.com → F12 → Uygulama → Çerezler'den alın
                        </p>
                        <div>
                            <label className="text-xs text-gray-400 block mb-1">COOKIE_TY.Entrance değeri</label>
                            <textarea
                                value={cookieEntrance}
                                onChange={e => setCookieEntrance(e.target.value)}
                                placeholder="x=17000813&pp=..."
                                rows={2}
                                className="w-full text-xs p-2 bg-gray-900 border border-gray-600 rounded-lg text-white font-mono"
                            />
                        </div>
                        <div>
                            <label className="text-xs text-gray-400 block mb-1">COOKIE_TY.Anonym değeri</label>
                            <textarea
                                value={cookieAnonym}
                                onChange={e => setCookieAnonym(e.target.value)}
                                placeholder="tx=eyJhbGci..."
                                rows={2}
                                className="w-full text-xs p-2 bg-gray-900 border border-gray-600 rounded-lg text-white font-mono"
                            />
                        </div>
                        <button
                            onClick={handleSaveCookies}
                            disabled={!cookieEntrance.trim() || !cookieAnonym.trim()}
                            className="w-full py-2 bg-green-600 hover:bg-green-500 disabled:bg-gray-600 text-white text-sm font-bold rounded-lg"
                        >
                            Kaydet
                        </button>
                    </div>
                )}
            </div>

            {/* Otomatik Üretme Butonu */}
            {cookiesConfigured && pendingDeals.length > 0 && (
                <button
                    onClick={handleAutoGenerateAll}
                    disabled={autoGenerating}
                    className="w-full mb-4 py-3 bg-gradient-to-r from-green-700 to-teal-700 hover:from-green-600 hover:to-teal-600 disabled:from-gray-700 disabled:to-gray-700 text-white font-bold rounded-xl flex items-center justify-center gap-2 transition-all"
                >
                    {autoGenerating ? (
                        <>
                            <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                            <span>Oluşturuluyor... {autoProgress.done}/{autoProgress.total}</span>
                        </>
                    ) : (
                        <>
                            <span>⚡</span>
                            <span>Trendyol Linklerini Otomatik Oluştur</span>
                        </>
                    )}
                </button>
            )}

            {/* Mesajlar */}
            {error && (
                <div className="mb-4 p-3 bg-red-500/20 border border-red-500/30 rounded-lg text-red-400 text-sm flex justify-between">
                    <span>❌ {error}</span>
                    <button onClick={() => setError(null)} className="text-red-300 hover:text-white ml-2">✕</button>
                </div>
            )}
            {successMessage && (
                <div className="mb-4 p-3 bg-green-500/20 border border-green-500/30 rounded-lg text-green-400 text-sm">
                    {successMessage}
                </div>
            )}

            {/* Bot Durum Bandı */}
            {botActive && (
                <div className={`mb-4 p-3 rounded-xl border flex items-center gap-3 ${
                    botStatus === 'saving'
                        ? 'bg-orange-500/20 border-orange-500/40 text-orange-300'
                        : 'bg-blue-500/20 border-blue-500/40 text-blue-300'
                }`}>
                    <span className="relative flex h-3 w-3">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-current opacity-75" />
                        <span className="relative inline-flex h-3 w-3 rounded-full bg-current" />
                    </span>
                    <span className="text-sm font-semibold flex-1">
                        {botStatus === 'saving' ? '💾 Kaydediliyor...' : '🤖 Bot çalışıyor — panoyu izliyor'}
                    </span>
                    <button onClick={stopBot} className="text-xs px-2 py-1 rounded bg-white/10 hover:bg-white/20 font-bold">
                        Durdur
                    </button>
                </div>
            )}

            {isLoadingPending ? (
                <div className="text-center py-20">
                    <div className="w-12 h-12 border-4 border-orange-500/30 border-t-orange-500 rounded-full animate-spin mx-auto mb-4" />
                    <p className="text-gray-400">Ürünler yükleniyor...</p>
                </div>
            ) : pendingDeals.length === 0 ? (
                <div className="bg-gray-800 rounded-2xl p-10 border border-gray-700 text-center">
                    <div className="text-6xl mb-4">🎉</div>
                    <h2 className="text-xl font-bold text-white mb-2">Harikasın!</h2>
                    <p className="text-gray-400">Tüm ürünlerin affiliate linkleri güncel.</p>
                    <button onClick={loadPending} className="mt-6 px-6 py-2 bg-gray-700 text-white rounded-lg hover:bg-gray-600">Yenile</button>
                </div>
            ) : (
                <div className="bg-gray-800 rounded-2xl border border-gray-700 overflow-hidden shadow-2xl">
                    {/* Ürün Görseli */}
                    <div className="aspect-video relative overflow-hidden bg-white">
                        <img src={currentDeal.imageUrl} className="w-full h-full object-contain" alt={currentDeal.title} />
                        <div className="absolute top-2 left-2 bg-black/60 backdrop-blur-md text-white px-3 py-1 rounded-full text-xs font-bold border border-white/20">
                            {currentIndex + 1} / {pendingDeals.length}
                        </div>
                        <div className="absolute top-2 right-2 bg-blue-600 text-white px-3 py-1 rounded-full text-xs font-bold">
                            {currentDeal.storeName || currentDeal.brand}
                        </div>
                    </div>

                    <div className="p-5 space-y-5">
                        <h2 className="text-lg font-bold text-white leading-tight">{currentDeal.title}</h2>

                        {/* Fiyat + Aç */}
                        <div className="flex items-center gap-3 bg-gray-900/50 p-3 rounded-xl border border-gray-700/50">
                            <div className="flex-1">
                                <p className="text-[10px] text-gray-500 uppercase font-bold tracking-wider mb-1">Fiyat</p>
                                <p className="text-xl font-bold text-green-400">{currentDeal.newPrice} ₺</p>
                            </div>
                            <button onClick={handleOpenProduct}
                                className="px-4 py-3 bg-blue-600 hover:bg-blue-500 text-white rounded-xl font-bold flex items-center gap-2 shadow-lg shadow-blue-900/30 transition-all active:scale-95">
                                🚀 Ürüne Git
                            </button>
                        </div>

                        {/* BOT BAŞLAT butonu — bot pasifken göster */}
                        {!botActive && (
                            <button onClick={startBot}
                                className="w-full py-3 bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-500 hover:to-blue-500 text-white font-bold rounded-xl flex items-center justify-center gap-2 shadow-lg shadow-purple-900/30 transition-all active:scale-95">
                                <span className="text-lg">🤖</span>
                                <span>Botu Başlat</span>
                                <span className="text-xs font-normal opacity-75">(ürünü açar, linki otomatik kaydeder)</span>
                            </button>
                        )}

                        {/* Manuel giriş — bot pasifken göster */}
                        {!botActive && (
                            <div className="space-y-2">
                                <div className="flex justify-between items-center">
                                    <label className="text-gray-400 text-xs font-bold uppercase tracking-wider">Manuel Giriş</label>
                                    <span className="text-gray-500 text-[10px]">⏱️ {formatTimeAgo(currentDeal.createdAt)}</span>
                                </div>
                                <div className="flex gap-2">
                                    <input
                                        type="url"
                                        value={affiliateInput}
                                        onChange={e => setAffiliateInput(e.target.value)}
                                        placeholder="https://ty.gl/..."
                                        className="flex-1 px-4 py-3 bg-gray-900 border border-gray-600 rounded-xl text-white text-sm focus:border-orange-500 outline-none"
                                    />
                                    <button onClick={handleClipboardPaste}
                                        className="px-4 bg-gray-700 rounded-xl hover:bg-gray-600 font-bold text-xs text-white transition-colors">
                                        📋
                                    </button>
                                </div>
                            </div>
                        )}

                        {/* Bot aktifken kopyalama talimatı */}
                        {botActive && (
                            <div className="bg-gray-900/60 border border-blue-500/30 rounded-xl p-4 text-center">
                                <p className="text-blue-300 text-sm font-semibold mb-1">Açılan ürün sayfasına gidin</p>
                                <p className="text-gray-400 text-xs">Affiliate linkini kopyalayın → panele dönün → otomatik kaydedilir</p>
                                <div className="mt-3 flex justify-center gap-1">
                                    {[0,1,2].map(i => (
                                        <span key={i} className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-bounce" style={{ animationDelay: `${i * 0.15}s` }} />
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Alt Butonlar */}
                    {!botActive && (
                        <div className="flex gap-3 p-5 pt-0">
                            <button onClick={handleSkip} disabled={isUpdating}
                                className="flex-1 py-4 bg-gray-700 hover:bg-gray-600 text-white font-bold rounded-xl disabled:opacity-50">
                                Geç
                            </button>
                            <button onClick={handleSaveAffiliate} disabled={isUpdating || !affiliateInput.trim()}
                                className="flex-[2] py-4 bg-gradient-to-r from-orange-600 to-red-600 text-white font-bold rounded-xl disabled:opacity-50 shadow-lg shadow-orange-900/30 active:scale-95 transition-all">
                                {isUpdating ? 'Güncelleniyor...' : 'Kaydet & Devam Et'}
                            </button>
                        </div>
                    )}

                    <div className="px-5 pb-5">
                        <button onClick={handleSkipAll} disabled={isUpdating}
                            className="w-full py-2 text-gray-500 hover:text-red-400 text-[10px] font-bold uppercase tracking-widest transition-colors border-t border-gray-700/50 pt-4">
                            ⚠️ Tümünü Atla ve Listeyi Temizle ⚠️
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
};

export default AffiliateLinkManager;
