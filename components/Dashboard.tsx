import React, { useState, useEffect } from 'react';
import { collection, query, where, getDocs, getCountFromServer } from 'firebase/firestore';
import { db } from '../firebaseConfig';
import type { ViewType } from '../types';
import { addDiscount } from '../services/firebase';
import { analyzeProductLink, isValidProductLink } from '../services/linkAnalyzer';

async function pasteFromClipboard(): Promise<string> {
    try { return await navigator.clipboard.readText(); } catch {}
    return '';
}

interface DashboardProps {
    setActiveView: (view: ViewType) => void;
    isAdmin: boolean;
    pendingAffiliateCount?: number;
    pendingSubmissionsCount?: number;
}

// ─── AI Link Analyzer ─────────────────────────────────────────────────────────

const AIAnalyzer: React.FC = () => {
    const [link, setLink] = useState('');
    const [isAnalyzing, setIsAnalyzing] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState<string | null>(null);
    const [step, setStep] = useState<'idle' | 'reading' | 'analyzing' | 'publishing'>('idle');

    const handlePaste = async () => {
        const text = await pasteFromClipboard();
        if (text) { setLink(text.trim()); setError(null); }
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!isValidProductLink(link)) { setError('Geçerli bir URL girin (http ile başlamalı)'); return; }
        setIsAnalyzing(true);
        setError(null);
        setSuccess(null);
        try {
            setStep('reading');
            const result = await analyzeProductLink(link);
            setStep('publishing');
            await addDiscount({
                title: result.title,
                brand: result.brand,
                category: result.category,
                link: result.link,
                oldPrice: result.oldPrice,
                newPrice: result.newPrice,
                imageUrl: result.imageUrl || '',
                deleteUrl: '',
                submittedBy: 'AI',
                affiliateLinkUpdated: true,
            });
            setSuccess(result.title);
            setLink('');
            setStep('idle');
            setTimeout(() => setSuccess(null), 6000);
        } catch (err: any) {
            const raw: string = err?.message || '';
            if (raw.includes('yoğun') || raw.includes('UNAVAILABLE') || raw.includes('503')) {
                setError('AI şu anda yoğun. Birkaç saniye bekleyip tekrar deneyin.');
            } else if (raw.includes('Sistem kapalı')) {
                setError('Sistem kapalı. Toggle ile açın.');
            } else if (raw.includes('okunamadı') || raw.includes('Jina')) {
                setError('Sayfa okunamadı. Doğrudan ürün sayfasının linkini deneyin.');
            } else {
                setError(raw || 'Analiz başarısız.');
            }
            setStep('idle');
        } finally {
            setIsAnalyzing(false);
        }
    };

    const stepLabels: Record<string, string> = {
        reading: 'Ürün sayfası okunuyor...',
        analyzing: 'AI analiz ediyor...',
        publishing: 'Yayınlanıyor...',
    };

    return (
        <div className="rounded-2xl overflow-hidden border border-blue-500/20 bg-gray-800/80"
             style={{ boxShadow: '0 0 0 1px rgba(59,130,246,0.08), 0 4px 24px rgba(0,0,0,0.3)' }}>

            {/* Başlık */}
            <div className="px-4 py-3 flex items-center gap-2 bg-gradient-to-r from-blue-500/10 to-transparent border-b border-blue-500/15">
                <div className="w-6 h-6 rounded-lg bg-blue-600/80 flex items-center justify-center text-xs shadow">🤖</div>
                <span className="text-xs font-bold text-blue-300 uppercase tracking-widest">AI Link Analizi</span>
            </div>

            <div className="p-4 space-y-3">
                <form onSubmit={handleSubmit} className="space-y-2.5">
                    <div className="flex gap-2">
                        <input
                            type="url"
                            value={link}
                            onChange={e => { setLink(e.target.value); setError(null); }}
                            placeholder="Trendyol, Hepsiburada, Amazon linki..."
                            className="flex-1 bg-gray-900 border border-gray-700 focus:border-blue-500 rounded-xl px-3 py-2.5 text-sm text-white outline-none placeholder:text-gray-600 transition-colors"
                            disabled={isAnalyzing}
                        />
                        <button type="button" onClick={handlePaste} disabled={isAnalyzing}
                            className="shrink-0 px-3 py-2.5 bg-gray-700 hover:bg-gray-600 disabled:opacity-50 text-white text-xs font-semibold rounded-xl transition-colors">
                            📋
                        </button>
                    </div>

                    <button type="submit" disabled={isAnalyzing || !link.trim()}
                        className="w-full py-3 rounded-xl text-sm font-bold transition-all disabled:opacity-40 relative overflow-hidden"
                        style={{
                            background: isAnalyzing
                                ? 'linear-gradient(135deg, #1d4ed8, #7c3aed)'
                                : 'linear-gradient(135deg, #2563eb, #3b82f6)',
                            boxShadow: isAnalyzing ? 'none' : '0 4px 16px rgba(37,99,235,0.35)',
                        }}>
                        <span className="relative z-10 flex items-center justify-center gap-2 text-white">
                            {isAnalyzing ? (
                                <>
                                    <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                                    {stepLabels[step] || 'İşleniyor...'}
                                </>
                            ) : (
                                '⚡ Analiz Et & Yayınla'
                            )}
                        </span>
                    </button>
                </form>

                {/* Durum mesajları */}
                {error && (
                    <div className="flex items-start gap-2 bg-red-950/50 border border-red-500/20 rounded-xl px-3 py-2.5">
                        <span className="text-red-400 text-sm shrink-0">⚠️</span>
                        <p className="text-red-300 text-xs leading-relaxed">{error}</p>
                    </div>
                )}
                {success && (
                    <div className="flex items-start gap-2 bg-green-950/50 border border-green-500/20 rounded-xl px-3 py-2.5">
                        <span className="text-green-400 text-sm shrink-0">✅</span>
                        <p className="text-green-300 text-xs leading-relaxed line-clamp-2">Yayınlandı: <span className="font-medium">{success}</span></p>
                    </div>
                )}
            </div>
        </div>
    );
};

// ─── Fırsat Bekçisi (Watchdog İzleme) ─────────────────────────────────────────
// price-checker.js (GitHub Actions, 08:00–02:00) süresi biten / fiyatı artan
// ilanları "İndirim Bitti" + deleteAt (şimdi+1sa) yapar; uygulamada kart 1 saat
// gri + geri sayım gösterir, sonra otomatik kalkar. Burası sadece İZLER ve
// gerektiğinde manuel kontrol tetikler — mevcut otomatik sisteme dokunmaz.

interface RemovingDeal { id: string; title: string; imageUrl?: string; reason?: string; deleteAtMs: number; }

const toMs = (dt: any): number => {
    if (!dt) return 0;
    if (typeof dt.toMillis === 'function') return dt.toMillis();
    if (typeof dt.seconds === 'number') return dt.seconds * 1000;
    if (dt instanceof Date) return dt.getTime();
    const n = new Date(dt).getTime();
    return isNaN(n) ? 0 : n;
};

const WatchdogSection: React.FC = () => {
    const [activeCount, setActiveCount] = useState<number | null>(null);
    const [removing, setRemoving] = useState<RemovingDeal[]>([]);
    const [loading, setLoading] = useState(false);
    const [triggering, setTriggering] = useState(false);
    const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
    const [nowTs, setNowTs] = useState(Date.now());

    const load = async () => {
        setLoading(true);
        try {
            const col = collection(db, 'discounts');
            try {
                const cnt = await getCountFromServer(query(col, where('status', '==', 'aktif')));
                setActiveCount(cnt.data().count);
            } catch { setActiveCount(null); }

            const snap = await getDocs(query(col, where('status', '==', 'İndirim Bitti')));
            const list: RemovingDeal[] = snap.docs.map(d => {
                const x = d.data() as any;
                return { id: d.id, title: x.title || 'İlan', imageUrl: x.imageUrl, reason: x.errorReason, deleteAtMs: toMs(x.deleteAt) };
            })
            .filter(r => r.deleteAtMs === 0 || r.deleteAtMs > Date.now())
            .sort((a, b) => (a.deleteAtMs || Infinity) - (b.deleteAtMs || Infinity));
            setRemoving(list);
        } catch { /* sessiz */ } finally { setLoading(false); }
    };

    useEffect(() => { load(); const t = setInterval(load, 60000); return () => clearInterval(t); }, []);
    useEffect(() => { const t = setInterval(() => setNowTs(Date.now()), 1000); return () => clearInterval(t); }, []);

    const fmt = (ms: number): string => {
        if (!ms) return '—';
        const rem = ms - nowTs;
        if (rem <= 0) return '00:00';
        const m = Math.floor(rem / 60000);
        const s = Math.floor((rem % 60000) / 1000);
        return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    };

    const triggerCheck = async () => {
        setTriggering(true); setMsg(null);
        try {
            const token = (import.meta as any).env?.VITE_GITHUB_TOKEN || '';
            if (!token || token.includes('YOUR_')) throw new Error('VITE_GITHUB_TOKEN tanımlı değil.');
            const res = await fetch('https://api.github.com/repos/indivaapp/indiva-panel/actions/workflows/price-checker.yml/dispatches', {
                method: 'POST',
                headers: { Accept: 'application/vnd.github.v3+json', Authorization: `token ${token}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ ref: 'main' }),
            });
            if (res.status === 204) {
                setMsg({ ok: true, text: '✅ Kontrol başlatıldı. ~1-2 dk sonra sonuçlar yansır.' });
                setTimeout(load, 90000);
            } else throw new Error(`HTTP ${res.status}`);
        } catch (e: any) {
            setMsg({ ok: false, text: 'Tetiklenemedi: ' + (e?.message || 'hata') });
        } finally { setTriggering(false); }
    };

    return (
        <div className="rounded-2xl overflow-hidden border border-emerald-500/20 bg-gray-800/80"
             style={{ boxShadow: '0 0 0 1px rgba(16,185,129,0.08), 0 4px 24px rgba(0,0,0,0.3)' }}>

            <div className="px-4 py-3 flex items-center gap-2 bg-gradient-to-r from-emerald-500/10 to-transparent border-b border-emerald-500/15">
                <div className="w-6 h-6 rounded-lg bg-emerald-600/80 flex items-center justify-center text-xs shadow">🛡️</div>
                <span className="text-xs font-bold text-emerald-300 uppercase tracking-widest flex-1">Fırsat Bekçisi</span>
                <button onClick={load} disabled={loading} title="Yenile"
                    className="text-gray-400 hover:text-white text-sm disabled:opacity-40 transition-colors">🔄</button>
            </div>

            <div className="p-4 space-y-3">
                {/* İstatistikler */}
                <div className="grid grid-cols-2 gap-3">
                    <div className="bg-gray-900/60 border border-gray-700 rounded-xl px-4 py-3">
                        <p className="text-emerald-300 text-2xl font-bold leading-none">{activeCount ?? '—'}</p>
                        <p className="text-gray-400 text-xs mt-1">aktif ilan</p>
                    </div>
                    <div className="bg-gray-900/60 border border-gray-700 rounded-xl px-4 py-3">
                        <p className="text-orange-300 text-2xl font-bold leading-none">{removing.length}</p>
                        <p className="text-gray-400 text-xs mt-1">kaldırılıyor (1 sa)</p>
                    </div>
                </div>

                <p className="text-gray-500 text-[11px] leading-relaxed">
                    🤖 Otomatik kontrol her gün <span className="text-gray-300 font-semibold">08:00–02:00</span> arası,
                    10 dakikada bir. Süresi biten/fiyatı artan ilanlar uygulamada 1 saat <span className="text-gray-300">gri + geri sayım</span> gösterip otomatik kalkar.
                </p>

                {/* Kaldırılma sürecindeki ilanlar */}
                {removing.length > 0 && (
                    <div className="space-y-2 max-h-72 overflow-y-auto">
                        {removing.map(r => (
                            <div key={r.id} className="flex items-center gap-3 bg-gray-900/50 border border-gray-700/70 rounded-xl p-2.5">
                                <div className="w-11 h-11 shrink-0 rounded-lg overflow-hidden bg-gray-700"
                                     style={{ filter: 'grayscale(1)', opacity: 0.85 }}>
                                    {r.imageUrl
                                        ? <img src={r.imageUrl} alt="" className="w-full h-full object-cover" />
                                        : <div className="w-full h-full flex items-center justify-center text-base">🏷️</div>}
                                </div>
                                <div className="flex-1 min-w-0">
                                    <p className="text-gray-200 text-xs font-medium line-clamp-1">{r.title}</p>
                                    <p className="text-gray-500 text-[11px] line-clamp-1">{r.reason || 'İndirim bitti'}</p>
                                </div>
                                <div className="shrink-0 text-right">
                                    <p className="text-orange-400 font-bold text-sm tabular-nums">{fmt(r.deleteAtMs)}</p>
                                    <p className="text-gray-600 text-[10px]">sonra silinir</p>
                                </div>
                            </div>
                        ))}
                    </div>
                )}

                {removing.length === 0 && !loading && (
                    <div className="text-center py-4 text-gray-500 text-xs">✓ Şu an kaldırılma sürecinde ilan yok.</div>
                )}

                {/* Manuel kontrol */}
                <button onClick={triggerCheck} disabled={triggering}
                    className="w-full py-2.5 rounded-xl text-sm font-bold text-white transition-all disabled:opacity-50 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 flex items-center justify-center gap-2">
                    {triggering
                        ? <><span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Başlatılıyor...</>
                        : '🔍 Şimdi Kontrol Et'}
                </button>

                {msg && (
                    <p className={`text-xs font-semibold ${msg.ok ? 'text-green-400' : 'text-red-400'}`}>{msg.text}</p>
                )}
            </div>
        </div>
    );
};

// ─── Ana Dashboard ────────────────────────────────────────────────────────────

const Dashboard: React.FC<DashboardProps> = ({
    setActiveView,
    pendingAffiliateCount  = 0,
    pendingSubmissionsCount = 0,
}) => {
    const now = new Date();
    const hour = now.getHours();
    const greeting = hour < 12 ? 'Günaydın' : hour < 18 ? 'İyi günler' : 'İyi akşamlar';
    const totalPending = pendingAffiliateCount + pendingSubmissionsCount;

    return (
        <div className="space-y-4 max-w-2xl">

            {/* Header */}
            <div className="flex items-center justify-between pb-1">
                <div>
                    <p className="text-gray-500 text-xs font-medium">{greeting} 👋</p>
                    <h1 className="text-white text-xl font-bold tracking-tight">İNDİVA Panel</h1>
                </div>
                <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-orange-500 to-pink-600 flex items-center justify-center shadow-lg shadow-orange-900/30 text-lg">
                    🛍️
                </div>
            </div>

            {/* Bekleyen İşler */}
            {totalPending > 0 && (
                <div className="grid grid-cols-2 gap-3">
                    {pendingAffiliateCount > 0 && (
                        <button
                            onClick={() => setActiveView('affiliateLinks')}
                            className="bg-orange-950/50 border border-orange-700/30 rounded-xl px-4 py-3 text-left transition-all active:scale-[0.98]"
                        >
                            <p className="text-orange-300 text-2xl font-bold leading-none">{pendingAffiliateCount}</p>
                            <p className="text-orange-400/70 text-xs mt-1">affiliate bekliyor</p>
                        </button>
                    )}
                    {pendingSubmissionsCount > 0 && (
                        <button
                            onClick={() => setActiveView('submissions')}
                            className="bg-blue-950/50 border border-blue-700/30 rounded-xl px-4 py-3 text-left transition-all active:scale-[0.98]"
                        >
                            <p className="text-blue-300 text-2xl font-bold leading-none">{pendingSubmissionsCount}</p>
                            <p className="text-blue-400/70 text-xs mt-1">onay bekliyor</p>
                        </button>
                    )}
                </div>
            )}

            {/* Story Yönetimi */}
            <button
                onClick={() => setActiveView('stories')}
                className="w-full relative overflow-hidden rounded-2xl border border-pink-500/20 text-left transition-all active:scale-[0.99]"
                style={{
                    background: 'linear-gradient(135deg, rgba(168,85,247,0.15) 0%, rgba(236,72,153,0.1) 100%)',
                    boxShadow: '0 0 0 1px rgba(236,72,153,0.1), 0 4px 24px rgba(0,0,0,0.25)',
                }}
            >
                {/* Arka plan dekorasyon */}
                <div className="absolute -right-6 -top-6 w-24 h-24 rounded-full bg-pink-500/10 blur-xl pointer-events-none" />
                <div className="absolute -right-2 top-1/2 -translate-y-1/2 text-5xl opacity-10 pointer-events-none select-none">🎬</div>

                <div className="relative px-4 py-4 flex items-center gap-4">
                    <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center text-xl shadow-lg shadow-purple-900/30 shrink-0">
                        🎬
                    </div>
                    <div className="flex-1">
                        <p className="text-white font-bold text-sm">Story Yönetimi</p>
                        <p className="text-purple-300/70 text-xs mt-0.5">Influencer story ekle ve yönet</p>
                    </div>
                    <svg className="w-5 h-5 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                </div>
            </button>

            {/* Affiliate Linki */}
            <button
                onClick={() => setActiveView('affiliateLinks')}
                className="w-full relative overflow-hidden rounded-2xl border border-orange-500/20 text-left transition-all active:scale-[0.99]"
                style={{
                    background: 'linear-gradient(135deg, rgba(249,115,22,0.12) 0%, rgba(251,191,36,0.06) 100%)',
                    boxShadow: '0 0 0 1px rgba(249,115,22,0.1), 0 4px 24px rgba(0,0,0,0.25)',
                }}
            >
                <div className="absolute -right-4 -top-4 w-20 h-20 rounded-full bg-orange-500/10 blur-xl pointer-events-none" />
                <div className="absolute -right-2 top-1/2 -translate-y-1/2 text-5xl opacity-10 pointer-events-none select-none">🔗</div>

                <div className="relative px-4 py-4 flex items-center gap-4">
                    <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-orange-500 to-amber-500 flex items-center justify-center text-xl shadow-lg shadow-orange-900/30 shrink-0">
                        🔗
                    </div>
                    <div className="flex-1">
                        <p className="text-white font-bold text-sm">Affiliate Linkleri</p>
                        <p className="text-orange-300/70 text-xs mt-0.5">
                            {pendingAffiliateCount > 0
                                ? `${pendingAffiliateCount} ürün güncelleme bekliyor`
                                : 'Affiliate linklerini yönet'}
                        </p>
                    </div>
                    {pendingAffiliateCount > 0 && (
                        <span className="bg-orange-500 text-white text-xs font-bold px-2.5 py-1 rounded-full shadow shadow-orange-900/40">
                            {pendingAffiliateCount}
                        </span>
                    )}
                    <svg className="w-5 h-5 text-gray-600 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                </div>
            </button>

            {/* AI Analyzer */}
            <AIAnalyzer />

            {/* Fırsat Bekçisi (otomatik fiyat/geçerlilik takibi) */}
            <WatchdogSection />
        </div>
    );
};

export default Dashboard;
