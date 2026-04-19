import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Clipboard } from '@capacitor/clipboard';
import { App as CapApp } from '@capacitor/app';
import BotPlugin from '../plugins/botPlugin';
import { getDiscountsNeedingAffiliate, updateAffiliateLink } from '../../services/firebase';
import type { Discount } from '../../types';

// Mağaza tanımları
const STORES = [
    { id: 'hepsiburada', label: 'Hepsiburada', color: 'from-orange-500 to-orange-600', match: 'hepsiburada.com', pkg: 'com.pozitron.hepsiburada' },
    { id: 'trendyol',    label: 'Trendyol',    color: 'from-orange-600 to-red-600',    match: 'trendyol.com',   pkg: 'trendyol.com' },
];

const getStore = (url: string) => STORES.find(s => url.includes(s.match));

const isAffiliateLink = (url: string) =>
    url.startsWith('http') && (
        url.includes('ty.gl/') ||
        url.includes('hb.biz/') ||
        url.includes('hepsiburada.com/') ||
        url.includes('trendyol.com/') ||
        url.includes('amzn.to/') ||
        url.includes('amazon.com.tr/')
    );

type SetupStep = 'idle' | 'waiting_share' | 'done';

interface Coords { shareX: number; shareY: number; copyX: number; copyY: number; fallbackX: number; fallbackY: number }

const AffiliateBot: React.FC<{ isAdmin: boolean }> = ({ isAdmin }) => {
    const [accessEnabled, setAccessEnabled] = useState(false);
    const [activeTab, setActiveTab] = useState<'bot' | 'setup'>('bot');

    // Setup
    const [setupStore, setSetupStore] = useState(STORES[0]);
    const [setupStep, setSetupStep] = useState<SetupStep>('idle');
    const [coords, setCoords] = useState<Record<string, Coords>>({});

    // Bot
    const [deals, setDeals] = useState<Discount[]>([]);
    const [grouped, setGrouped] = useState<Record<string, Discount[]>>({});
    const [botRunning, setBotRunning] = useState(false);
    const [currentIdx, setCurrentIdx] = useState(0);
    const [processed, setProcessed] = useState(0);
    const [total, setTotal] = useState(0);
    const [status, setStatus] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [failed, setFailed] = useState<Discount[]>([]);

    const queueRef = useRef<Discount[]>([]);
    const idxRef = useRef(0);
    const runningRef = useRef(false);
    const lastSavedRef = useRef('');
    const failedRef = useRef<Discount[]>([]);

    // Erişilebilirlik kontrolü
    const checkAccess = useCallback(async () => {
        try {
            const { enabled } = await BotPlugin.isAccessibilityEnabled();
            setAccessEnabled(enabled);
        } catch { setAccessEnabled(false); }
    }, []);

    useEffect(() => { checkAccess(); }, [checkAccess]);

    // Kayıtlı koordinatları yükle
    useEffect(() => {
        const load = async () => {
            const loaded: Record<string, Coords> = {};
            for (const s of STORES) {
                try {
                    const c = await BotPlugin.getCoordinates({ store: s.id });
                    if (c.shareX > 0) loaded[s.id] = c;
                } catch {}
            }
            setCoords(loaded);
        };
        load();
    }, []);

    // İlan listesini yükle
    const loadDeals = async () => {
        setIsLoading(true);
        try {
            const list = await getDiscountsNeedingAffiliate();
            setDeals(list);
            const g: Record<string, Discount[]> = {};
            for (const d of list) {
                const store = getStore(d.link || d.originalStoreLink || '');
                if (!store) continue;
                if (!g[store.id]) g[store.id] = [];
                g[store.id].push(d);
            }
            setGrouped(g);
        } catch { }
        setIsLoading(false);
    };

    useEffect(() => { loadDeals(); }, []);

    // ── KOORDİNAT ÖĞRETME ────────────────────────────────────────────────────

    const startSetup = async (type: 'share' | 'fallback') => {
        setSetupStep('waiting_share');
        setStatus(type === 'share'
            ? `${setupStore.label}'da bir ürün açın ve PAYLAŞ butonuna dokunun`
            : `${setupStore.label}'da paylaş bulunamazsa tıklanacak yere dokunun (örn: arama sonucundaki ilk ürün)`);
        try {
            const { x, y } = await BotPlugin.startCapture({ type, storeName: setupStore.label });
            const prev = coords[setupStore.id] ?? { shareX: 0, shareY: 0, copyX: 0, copyY: 0, fallbackX: 0, fallbackY: 0 };
            const updated: Coords = type === 'share'
                ? { ...prev, shareX: x, shareY: y }
                : { ...prev, fallbackX: x, fallbackY: y };
            setCoords(c => ({ ...c, [setupStore.id]: updated }));
            await BotPlugin.saveCoordinates({ store: setupStore.id, ...updated });
            setStatus(`✅ ${type === 'share' ? 'Paylaş' : 'Geri dönüş'} koordinatı kaydedildi!`);
            setSetupStep('done');
        } catch (e: any) {
            setStatus('❌ Hata: ' + e.message);
            setSetupStep('idle');
        }
    };

    // ── BOT DÖNGÜSÜ ──────────────────────────────────────────────────────────

    const runNextCycle = useCallback(async () => {
        if (!runningRef.current) return;
        const queue = queueRef.current;
        const idx = idxRef.current;
        if (idx >= queue.length) {
            setBotRunning(false);
            runningRef.current = false;
            setStatus('🎉 Tüm linkler güncellendi!');
            loadDeals();
            return;
        }

        const deal = queue[idx];
        const url = deal.originalStoreLink || deal.link;
        const store = getStore(url);
        if (!store) {
            setStatus(`⏭ Atlandı: ${deal.brand} — bilinmeyen mağaza (${url?.substring(0, 60)})`);
            idxRef.current += 1;
            setTimeout(() => runNextCycle(), 300);
            return;
        }
        setCurrentIdx(idx);
        setStatus(`🤖 İşleniyor: ${deal.brand} (${idx + 1}/${queue.length})`);

        const isHepsi = store.id === 'hepsiburada';
        BotPlugin.runCycle({
            url,
            store: store.id,
            shareDelay: isHepsi ? 4000 : 3000,
            copyDelay:  isHepsi ? 3000 : 1500,
            backDelay:  500,
        }).catch(() => {});
    }, []);

    // Panel öne gelince clipboard oku — runCycle'dan bağımsız, anında tetiklenir
    useEffect(() => {
        if (!botRunning) return;
        let listener: any = null;
        CapApp.addListener('appStateChange', async ({ isActive }) => {
            if (!isActive || !runningRef.current) return;
            await new Promise(r => setTimeout(r, 300));

            let text = '';
            try { const r = await Clipboard.read(); text = r.value || ''; } catch {}
            if (!text) text = await navigator.clipboard.readText().catch(() => '');

            const deal = queueRef.current[idxRef.current];
            if (!deal) return;

            if (text && isAffiliateLink(text) && text !== lastSavedRef.current) {
                lastSavedRef.current = text;
                await updateAffiliateLink(deal.id, text);
                setProcessed(p => p + 1);
                setStatus(`✅ Kaydedildi: ${deal.brand}`);
            } else {
                failedRef.current = [...failedRef.current, deal];
                setFailed([...failedRef.current]);
                setStatus(`⏭ Atlandı: ${deal.brand} (link kopyalanamadı)`);
            }

            idxRef.current += 1;
            if (runningRef.current) setTimeout(() => runNextCycle(), 400);
        }).then(l => { listener = l; });
        return () => { listener?.remove(); };
    }, [botRunning, runNextCycle]);

    const startBot = async () => {
        await loadDeals();
        const queue = deals.filter(d => {
            const url = d.originalStoreLink || d.link || '';
            const store = getStore(url);
            return store && !!coords[store.id]?.shareX;
        });
        if (queue.length === 0) { setStatus('Koordinatı ayarlanmış ilan yok'); return; }
        queueRef.current = queue;
        idxRef.current = 0;
        lastSavedRef.current = '';
        failedRef.current = [];
        runningRef.current = true;
        setBotRunning(true);
        setProcessed(0);
        setTotal(queue.length);
        setFailed([]);
        runNextCycle();
    };

    const stopBot = () => {
        runningRef.current = false;
        setBotRunning(false);
        BotPlugin.cancelCapture().catch(() => {});
        setStatus('Bot durduruldu');
    };

    if (!isAdmin) return <div className="text-red-400 p-8 text-center">Erişim yok</div>;

    return (
        <div className="max-w-lg mx-auto px-4 py-6 pb-24 space-y-4">
            <h2 className="text-xl font-bold text-white">🤖 Affiliate Link Botu</h2>

            {/* Erişilebilirlik İzni */}
            {!accessEnabled && (
                <div className="bg-yellow-500/20 border border-yellow-500/40 rounded-xl p-4">
                    <p className="text-yellow-300 font-semibold mb-1">⚠️ İzin Gerekiyor</p>
                    <p className="text-yellow-200/80 text-sm mb-3">
                        Botun çalışması için Erişilebilirlik iznini bir kez açmanız gerekiyor.
                    </p>
                    <button
                        onClick={async () => { await BotPlugin.openAccessibilitySettings(); setTimeout(checkAccess, 3000); }}
                        className="w-full py-2.5 bg-yellow-500 text-black font-bold rounded-lg text-sm"
                    >
                        Ayarlara Git → İNDİVA Panel'i Etkinleştir
                    </button>
                </div>
            )}

            {/* Sekmeler */}
            <div className="flex gap-2 bg-gray-800 p-1 rounded-xl">
                {(['bot', 'setup'] as const).map(t => (
                    <button key={t} onClick={() => setActiveTab(t)}
                        className={`flex-1 py-2 rounded-lg text-sm font-bold transition-colors ${activeTab === t ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-white'}`}>
                        {t === 'bot' ? '▶ Botu Çalıştır' : '⚙️ Koordinat Ayarla'}
                    </button>
                ))}
            </div>

            {/* ─── BOT SEKMESİ ─── */}
            {activeTab === 'bot' && (
                <div className="space-y-4">
                    {/* Durum mesajı */}
                    {status && (
                        <div className={`p-3 rounded-xl text-sm font-medium ${
                            status.startsWith('✅') || status.startsWith('🎉') ? 'bg-green-500/20 text-green-300 border border-green-500/30' :
                            status.startsWith('❌') ? 'bg-red-500/20 text-red-300 border border-red-500/30' :
                            'bg-blue-500/20 text-blue-300 border border-blue-500/30'
                        }`}>{status}</div>
                    )}

                    {/* Bot aktifken progress */}
                    {botRunning && (
                        <div className="bg-gray-800 border border-blue-500/40 rounded-xl p-4">
                            <div className="flex items-center justify-between mb-3">
                                <div className="flex items-center gap-2">
                                    <span className="relative flex h-2.5 w-2.5">
                                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75" />
                                        <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-blue-500" />
                                    </span>
                                    <span className="text-blue-300 font-bold text-sm">Bot Çalışıyor</span>
                                </div>
                                <span className="text-gray-400 text-sm">{processed}/{total}</span>
                            </div>
                            <div className="w-full bg-gray-700 rounded-full h-2 mb-3">
                                <div className="bg-blue-500 h-2 rounded-full transition-all"
                                    style={{ width: total > 0 ? `${(processed / total) * 100}%` : '0%' }} />
                            </div>
                            <button onClick={stopBot}
                                className="w-full py-2 bg-red-600 hover:bg-red-500 text-white font-bold rounded-lg text-sm">
                                ■ Durdur
                            </button>
                        </div>
                    )}

                    {/* Mağaza bazlı özet */}
                    {!botRunning && (
                        <div className="space-y-2">
                            {isLoading ? (
                                <div className="text-center py-8 text-gray-400">Yükleniyor...</div>
                            ) : (
                                <>
                                    {STORES.map(store => {
                                        const count = grouped[store.id]?.length ?? 0;
                                        const hasCoords = !!coords[store.id]?.shareX;
                                        return (
                                            <div key={store.id} className="bg-gray-800 border border-gray-700 rounded-xl p-4 flex items-center justify-between">
                                                <div>
                                                    <p className="text-white font-semibold">{store.label}</p>
                                                    <p className="text-gray-400 text-sm">{count} ilan bekliyor</p>
                                                </div>
                                                <div className="text-right">
                                                    {hasCoords
                                                        ? <span className="text-green-400 text-xs font-bold">✅ Hazır</span>
                                                        : <span className="text-yellow-400 text-xs font-bold">⚙️ Ayarla</span>
                                                    }
                                                </div>
                                            </div>
                                        );
                                    })}

                                    <button
                                        onClick={startBot}
                                        disabled={!accessEnabled || deals.length === 0}
                                        className="w-full py-4 bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-500 hover:to-blue-500 disabled:opacity-40 text-white font-bold rounded-xl text-base shadow-lg transition-all active:scale-95"
                                    >
                                        🤖 Botu Başlat — {deals.length} İlan
                                    </button>
                                </>
                            )}
                        </div>
                    )}
                </div>
            )}

            {/* ─── BAŞARISIZ ÜRÜNLER ─── */}
            {failed.length > 0 && (
                <div className="space-y-2">
                    <p className="text-red-400 font-semibold text-sm">⚠️ Kopyalanamayan Ürünler ({failed.length})</p>
                    <p className="text-gray-500 text-xs">Bu ürünlerin affiliate linkini manuel güncellemeniz gerekiyor.</p>
                    {failed.map(d => (
                        <div key={d.id} className="bg-red-500/10 border border-red-500/30 rounded-xl p-3 flex items-center justify-between gap-2">
                            <div className="min-w-0">
                                <p className="text-white text-sm font-medium truncate">{d.title}</p>
                                <p className="text-gray-400 text-xs truncate">{d.originalStoreLink || d.link}</p>
                            </div>
                            <a
                                href={d.originalStoreLink || d.link}
                                target="_blank"
                                rel="noreferrer"
                                className="shrink-0 px-3 py-1.5 bg-red-600 hover:bg-red-500 text-white text-xs font-bold rounded-lg"
                            >
                                Aç
                            </a>
                        </div>
                    ))}
                </div>
            )}

            {/* ─── KURULUM SEKMESİ ─── */}
            {activeTab === 'setup' && (
                <div className="space-y-4">
                    <p className="text-gray-400 text-sm">
                        Her mağaza için sadece <strong className="text-white">Paylaş</strong> butonunun konumunu öğretin.
                        Kopyala butonu uygulama içinde otomatik bulunur.
                    </p>

                    {/* Mağaza seç */}
                    <div className="flex gap-2">
                        {STORES.map(s => (
                            <button key={s.id} onClick={() => { setSetupStore(s); setSetupStep('idle'); setStatus(''); }}
                                className={`flex-1 py-2 rounded-lg text-xs font-bold transition-colors ${setupStore.id === s.id ? `bg-gradient-to-r ${s.color} text-white` : 'bg-gray-700 text-gray-400'}`}>
                                {s.label}
                            </button>
                        ))}
                    </div>

                    {/* Mevcut koordinat */}
                    {coords[setupStore.id]?.shareX ? (
                        <div className="bg-green-500/10 border border-green-500/30 rounded-xl p-3 text-sm text-green-300">
                            ✅ {setupStore.label} hazır
                            <div className="text-xs text-green-400/70 mt-1">
                                Paylaş: ({Math.round(coords[setupStore.id].shareX)}, {Math.round(coords[setupStore.id].shareY)})
                            </div>
                        </div>
                    ) : null}

                    {status && (
                        <div className={`p-3 rounded-xl text-sm ${status.startsWith('✅') ? 'bg-green-500/20 border border-green-500/30 text-green-300' : status.startsWith('❌') ? 'bg-red-500/20 border border-red-500/30 text-red-300' : 'bg-blue-500/20 border border-blue-500/30 text-blue-300'}`}>
                            {status}
                        </div>
                    )}

                    <div className="bg-gray-800 border border-gray-700 rounded-xl p-4">
                        <p className="text-white font-semibold mb-1">Paylaş Butonu</p>
                        <p className="text-gray-400 text-sm mb-3">
                            {setupStore.label}'da bir ürün açın, sonra paylaş butonuna dokunun.
                        </p>
                        <button
                            onClick={() => startSetup('share')}
                            disabled={setupStep === 'waiting_share'}
                            className="w-full py-3 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-bold rounded-lg text-sm"
                        >
                            {setupStep === 'waiting_share' ? '⏳ Paylaş butonuna dokunun...' : '📍 Paylaş Koordinatını Öğret'}
                        </button>
                    </div>

                    <div className="bg-gray-800 border border-gray-700 rounded-xl p-4">
                        <p className="text-white font-semibold mb-1">Geri Dönüş Koordinatı <span className="text-gray-500 font-normal text-xs">(opsiyonel)</span></p>
                        <p className="text-gray-400 text-sm mb-3">
                            Paylaş bulunamazsa (örn: arama sayfası açıldıysa) bu noktaya bir kez basılır, sonra tekrar paylaş denenir.
                        </p>
                        {coords[setupStore.id]?.fallbackX ? (
                            <p className="text-green-400 text-xs mb-2">✅ Kayıtlı: ({Math.round(coords[setupStore.id].fallbackX)}, {Math.round(coords[setupStore.id].fallbackY)})</p>
                        ) : null}
                        <button
                            onClick={() => startSetup('fallback')}
                            disabled={setupStep === 'waiting_share'}
                            className="w-full py-3 bg-gray-600 hover:bg-gray-500 disabled:opacity-50 text-white font-bold rounded-lg text-sm"
                        >
                            {setupStep === 'waiting_share' ? '⏳ Koordinata dokunun...' : '📍 Geri Dönüş Koordinatını Öğret'}
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
};

export default AffiliateBot;
