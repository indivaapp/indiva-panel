import React, { useState, useEffect } from 'react';
import type { ViewType } from '../types';
import { addDiscount, getAiUsageStats, type AiUsageStats } from '../services/firebase';
import { analyzeProductLink, isValidProductLink } from '../services/linkAnalyzer';

async function pasteFromClipboard(): Promise<string> {
    try { return await navigator.clipboard.readText(); } catch {}
    return '';
}

interface DashboardProps {
    setActiveView: (view: ViewType) => void;
    isAdmin: boolean;
    pendingAffiliateCount?: number;
    pendingSocialContentCount?: number;
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

// ─── AI Kullanım/Maliyet Kutusu ────────────────────────────────────────────────
// Tüm AI pipeline'ları (price-checker, auto-onual, auto-akakce, kalite kapısı,
// sosyal medya içerik, vercel-proxy AI uç noktaları) her çağrıdan sonra
// 'aiUsage' koleksiyonuna token/maliyet increment'i yazıyor. Burada sadece
// 2 doküman (bugün + bu ay) okunuyor — ekstra Firestore read yükü yok.
// USD/TL kuru: canlı çekilemezse aşağıdaki FALLBACK_USD_TRY kullanılır (elle güncelleyin).
const FALLBACK_USD_TRY = 34;

const AiCostSection: React.FC = () => {
    const [today, setToday] = useState<AiUsageStats | null>(null);
    const [month, setMonth] = useState<AiUsageStats | null>(null);
    const [rate, setRate] = useState<number>(FALLBACK_USD_TRY);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const load = async () => {
        setLoading(true);
        try {
            const stats = await getAiUsageStats();
            setToday(stats.today);
            setMonth(stats.month);
            setError(null);
        } catch (e: any) {
            // permission-denied: Firestore kuralları 'aiUsage' koleksiyonuna henüz
            // izin vermiyor olabilir — sessizce yutmak yerine görünür yap.
            setError(e?.code === 'permission-denied'
                ? 'Erişim reddedildi — firestore.rules\'a aiUsage kuralı eklenip deploy edilmeli.'
                : (e?.message || 'Veriler yüklenemedi.'));
        } finally { setLoading(false); }
    };

    useEffect(() => {
        // Kuru bir kez çek (Firestore değil, harici ücretsiz bir API) — başarısız olursa fallback kalır
        fetch('https://open.er-api.com/v6/latest/USD')
            .then(r => r.json())
            .then(j => { const r2 = j?.rates?.TRY; if (typeof r2 === 'number' && r2 > 0) setRate(r2); })
            .catch(() => {});

        load();
        const t = setInterval(() => { if (document.visibilityState === 'visible') load(); }, 5 * 60 * 1000);
        const onVisible = () => { if (document.visibilityState === 'visible') load(); };
        document.addEventListener('visibilitychange', onVisible);
        return () => { clearInterval(t); document.removeEventListener('visibilitychange', onVisible); };
    }, []);

    const fmtUsd = (n?: number) => `$${(n ?? 0).toFixed(3)}`;
    const fmtTry = (n?: number) => `₺${((n ?? 0) * rate).toFixed(2)}`;

    return (
        <div className="rounded-2xl overflow-hidden border border-purple-500/20 bg-gray-800/80"
             style={{ boxShadow: '0 0 0 1px rgba(168,85,247,0.08), 0 4px 24px rgba(0,0,0,0.3)' }}>

            <div className="px-4 py-3 flex items-center gap-2 bg-gradient-to-r from-purple-500/10 to-transparent border-b border-purple-500/15">
                <div className="w-6 h-6 rounded-lg bg-purple-600/80 flex items-center justify-center text-xs shadow">🤖</div>
                <span className="text-xs font-bold text-purple-300 uppercase tracking-widest flex-1">AI Maliyeti (tahmini)</span>
                <button onClick={load} disabled={loading} title="Yenile"
                    className="text-gray-400 hover:text-white text-sm disabled:opacity-40 transition-colors">🔄</button>
            </div>

            <div className="p-4 space-y-3">
                <div className="grid grid-cols-2 gap-3">
                    <div className="bg-gray-900/60 border border-gray-700 rounded-xl px-4 py-3">
                        <p className="text-purple-300 text-lg font-bold leading-none">{fmtUsd(today?.costUsd)}</p>
                        <p className="text-purple-200/80 text-sm font-semibold mt-0.5">{fmtTry(today?.costUsd)}</p>
                        <p className="text-gray-400 text-xs mt-1">bugün · {today?.calls ?? 0} çağrı</p>
                    </div>
                    <div className="bg-gray-900/60 border border-gray-700 rounded-xl px-4 py-3">
                        <p className="text-purple-300 text-lg font-bold leading-none">{fmtUsd(month?.costUsd)}</p>
                        <p className="text-purple-200/80 text-sm font-semibold mt-0.5">{fmtTry(month?.costUsd)}</p>
                        <p className="text-gray-400 text-xs mt-1">bu ay · {month?.calls ?? 0} çağrı</p>
                    </div>
                </div>
                {error ? (
                    <p className="text-red-400 text-[11px] leading-relaxed">⚠️ {error}</p>
                ) : (
                    <p className="text-gray-500 text-[11px] leading-relaxed">
                        price-checker, auto-onual/akakçe, kalite kapısı ve sosyal medya AI'ının toplamıdır.
                        OpenRouter çağrıları gerçek maliyeti, doğrudan Gemini çağrıları token bazlı tahmini
                        maliyeti kullanır. Kur: 1$ ≈ ₺{rate.toFixed(2)}.
                    </p>
                )}
            </div>
        </div>
    );
};

// ─── Ana Dashboard ────────────────────────────────────────────────────────────

const Dashboard: React.FC<DashboardProps> = ({ setActiveView, pendingAffiliateCount = 0, pendingSocialContentCount = 0 }) => {
    const now = new Date();
    const hour = now.getHours();
    const greeting = hour < 12 ? 'Günaydın' : hour < 18 ? 'İyi günler' : 'İyi akşamlar';

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

            {/* Trendyol Veri Çekici */}
            <button
                onClick={() => setActiveView('trendyolScraper')}
                className="w-full relative overflow-hidden rounded-2xl border border-orange-500/20 text-left transition-all active:scale-[0.99]"
                style={{
                    background: 'linear-gradient(135deg, rgba(249,115,22,0.14) 0%, rgba(220,38,38,0.07) 100%)',
                    boxShadow: '0 0 0 1px rgba(249,115,22,0.1), 0 4px 24px rgba(0,0,0,0.25)',
                }}
            >
                <div className="absolute -right-4 -top-4 w-20 h-20 rounded-full bg-orange-500/10 blur-xl pointer-events-none" />
                <div className="absolute -right-2 top-1/2 -translate-y-1/2 text-5xl opacity-10 pointer-events-none select-none">🛒</div>

                <div className="relative px-4 py-4 flex items-center gap-4">
                    <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-orange-500 to-red-500 flex items-center justify-center text-xl shadow-lg shadow-orange-900/30 shrink-0">
                        🛒
                    </div>
                    <div className="flex-1">
                        <p className="text-white font-bold text-sm">Veri Çekici</p>
                        <p className="text-orange-300/70 text-xs mt-0.5">Trendyol & Cimri'den indirim çek, seç, yayınla</p>
                    </div>
                    <svg className="w-5 h-5 text-gray-600 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                </div>
            </button>

            {/* Sosyal Medya İçeriği */}
            <button
                onClick={() => setActiveView('socialContent')}
                className="w-full relative overflow-hidden rounded-2xl border border-orange-500/20 text-left transition-all active:scale-[0.99]"
                style={{
                    background: 'linear-gradient(135deg, rgba(249,115,22,0.12) 0%, rgba(219,39,119,0.06) 100%)',
                    boxShadow: '0 0 0 1px rgba(249,115,22,0.1), 0 4px 24px rgba(0,0,0,0.25)',
                }}
            >
                <div className="absolute -right-4 -top-4 w-20 h-20 rounded-full bg-orange-500/10 blur-xl pointer-events-none" />
                <div className="absolute -right-2 top-1/2 -translate-y-1/2 text-5xl opacity-10 pointer-events-none select-none">📱</div>

                <div className="relative px-4 py-4 flex items-center gap-4">
                    <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-orange-500 to-pink-600 flex items-center justify-center text-xl shadow-lg shadow-orange-900/30 shrink-0">
                        📱
                    </div>
                    <div className="flex-1">
                        <p className="text-white font-bold text-sm">Sosyal Medya İçeriği</p>
                        <p className="text-orange-300/70 text-xs mt-0.5">
                            {pendingSocialContentCount > 0
                                ? `${pendingSocialContentCount} paylaşıma hazır içerik`
                                : 'En iyi fırsatlardan otomatik içerik'}
                        </p>
                    </div>
                    {pendingSocialContentCount > 0 && (
                        <span className="bg-orange-500 text-white text-xs font-bold px-2.5 py-1 rounded-full shadow shadow-orange-900/40">
                            {pendingSocialContentCount}
                        </span>
                    )}
                    <svg className="w-5 h-5 text-gray-600 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                </div>
            </button>

            {/* AI Kullanım/Maliyet Takibi */}
            <AiCostSection />
        </div>
    );
};

export default Dashboard;
