import React, { useState, useEffect, useCallback } from 'react';
import type { ViewType } from '../types';
import {
    getDiscounts,
    getPendingDiscounts,
    getDiscountsNeedingAffiliate,
    updateAffiliateLink,
    skipAffiliateUpdate,
    addDiscount,
} from '../services/firebase';
import { analyzeProductLink, isValidProductLink } from '../services/linkAnalyzer';
import { Clipboard } from '@capacitor/clipboard';

async function pasteFromClipboard(): Promise<string> {
    try {
        const { value } = await Clipboard.read();
        if (value) return value;
    } catch {}
    try {
        return await navigator.clipboard.readText();
    } catch {}
    return '';
}
import type { Discount } from '../types';

interface DashboardProps {
    setActiveView: (view: ViewType) => void;
    isAdmin: boolean;
}

// ─── Affiliate Widget ─────────────────────────────────────────────────────────

const AffiliateWidget: React.FC = () => {
    const [pendingDeals, setPendingDeals] = useState<Discount[]>([]);
    const [currentIndex, setCurrentIndex] = useState(0);
    const [affiliateInput, setAffiliateInput] = useState('');
    const [isLoading, setIsLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);
    const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

    const showMsg = (type: 'ok' | 'err', text: string) => {
        setMsg({ type, text });
        setTimeout(() => setMsg(null), 2500);
    };

    const load = useCallback(async () => {
        setIsLoading(true);
        try {
            const deals = await getDiscountsNeedingAffiliate();
            setPendingDeals(deals);
            setCurrentIndex(0);
            setAffiliateInput('');
        } catch { /* sessiz */ }
        finally { setIsLoading(false); }
    }, []);

    useEffect(() => { load(); }, [load]);

    const current = pendingDeals[currentIndex];
    const remaining = pendingDeals.length - currentIndex;

    const advance = () => {
        setAffiliateInput('');
        if (currentIndex < pendingDeals.length - 1) {
            setCurrentIndex(i => i + 1);
        } else {
            load();
        }
    };

    const handleSave = async () => {
        if (!current || !affiliateInput.trim()) return;
        setIsSaving(true);
        try {
            await updateAffiliateLink(current.id, affiliateInput.trim());
            showMsg('ok', 'Kaydedildi');
            advance();
        } catch { showMsg('err', 'Hata'); }
        finally { setIsSaving(false); }
    };

    const handleSkip = async () => {
        if (!current) return;
        setIsSaving(true);
        try { await skipAffiliateUpdate(current.id); advance(); }
        catch { showMsg('err', 'Hata'); }
        finally { setIsSaving(false); }
    };

    const handleSkipAll = async () => {
        if (!window.confirm(`Kalan ${remaining} ürünü atla?`)) return;
        setIsSaving(true);
        try {
            await Promise.all(pendingDeals.slice(currentIndex).map(d => skipAffiliateUpdate(d.id)));
            load();
        } catch { showMsg('err', 'Hata'); }
        finally { setIsSaving(false); }
    };

    const handlePaste = async () => {
        try {
            const { value } = await Clipboard.read();
            if (value) { setAffiliateInput(value); return; }
        } catch {}
        try {
            const text = await navigator.clipboard.readText();
            if (text) setAffiliateInput(text);
        } catch {
            const input = prompt('Linki yapıştırın:');
            if (input) setAffiliateInput(input);
        }
    };

    if (isLoading) {
        return (
            <div className="bg-gray-800 border border-gray-700 rounded-xl p-4">
                <div className="flex items-center gap-2 text-gray-400 text-sm">
                    <div className="w-4 h-4 border-2 border-gray-600 border-t-orange-400 rounded-full animate-spin" />
                    Affiliate listesi yükleniyor...
                </div>
            </div>
        );
    }

    if (pendingDeals.length === 0) {
        return (
            <div className="bg-gray-800 border border-gray-700 rounded-xl p-4 flex items-center justify-between">
                <span className="text-gray-400 text-sm">Bekleyen affiliate yok</span>
                <button onClick={load} className="text-xs text-gray-500 hover:text-white underline">Yenile</button>
            </div>
        );
    }

    return (
        <div className="bg-gray-800 border border-orange-500/40 rounded-xl overflow-hidden">
            {/* Başlık */}
            <div className="flex items-center justify-between px-4 py-2.5 bg-orange-500/10 border-b border-orange-500/20">
                <span className="text-orange-300 text-sm font-semibold">Affiliate — {remaining} bekliyor</span>
                <div className="flex items-center gap-3">
                    <span className="text-gray-500 text-xs">{currentIndex + 1}/{pendingDeals.length}</span>
                    <button onClick={handleSkipAll} disabled={isSaving} className="text-[11px] text-gray-500 hover:text-red-400 transition-colors">Tümünü Atla</button>
                </div>
            </div>

            <div className="p-4 space-y-3">
                {/* Ürün başlığı + Link butonu */}
                <div className="flex items-start gap-3">
                    <p className="flex-1 text-white text-sm font-medium leading-snug line-clamp-2">{current.title}</p>
                    <a
                        href={current.originalStoreLink || current.link}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="shrink-0 px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold rounded-lg transition-colors"
                    >
                        Link
                    </a>
                </div>

                {/* Affiliate input */}
                <div className="flex gap-2">
                    <input
                        type="url"
                        value={affiliateInput}
                        onChange={e => setAffiliateInput(e.target.value)}
                        placeholder="Affiliate linkinizi yapıştırın..."
                        className="flex-1 bg-gray-900 border border-gray-600 rounded-lg px-3 py-2.5 text-sm text-white focus:border-orange-400 outline-none placeholder:text-gray-600"
                    />
                    <button
                        onClick={handlePaste}
                        className="shrink-0 px-3 py-2.5 bg-gray-700 hover:bg-gray-600 text-white text-xs font-semibold rounded-lg transition-colors"
                    >
                        Yapıştır
                    </button>
                </div>

                {/* Mesaj */}
                {msg && (
                    <p className={`text-xs ${msg.type === 'ok' ? 'text-green-400' : 'text-red-400'}`}>{msg.text}</p>
                )}

                {/* Aksiyonlar */}
                <div className="flex gap-2">
                    <button
                        onClick={handleSkip}
                        disabled={isSaving}
                        className="flex-1 py-2.5 bg-gray-700 hover:bg-gray-600 text-white text-sm font-semibold rounded-lg disabled:opacity-50 transition-colors"
                    >
                        Geç
                    </button>
                    <button
                        onClick={handleSave}
                        disabled={isSaving || !affiliateInput.trim()}
                        className="flex-[2] py-2.5 bg-orange-600 hover:bg-orange-500 text-white text-sm font-bold rounded-lg disabled:opacity-50 transition-colors"
                    >
                        {isSaving ? 'Kaydediliyor...' : 'Kaydet & Devam'}
                    </button>
                </div>
            </div>
        </div>
    );
};

// ─── AI Link Analyzer ─────────────────────────────────────────────────────────

const AIAnalyzer: React.FC = () => {
    const [link, setLink] = useState('');
    const [isAnalyzing, setIsAnalyzing] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState<string | null>(null);

    const handlePaste = async () => {
        const text = await pasteFromClipboard();
        if (text) setLink(text.trim());
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!isValidProductLink(link)) { setError('Geçerli bir URL girin (http ile başlamalı)'); return; }
        setIsAnalyzing(true);
        setError(null);
        setSuccess(null);
        try {
            const result = await analyzeProductLink(link);
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
            setTimeout(() => setSuccess(null), 5000);
        } catch (err: any) {
            const raw: string = err?.message || '';
            // Ham JSON / teknik mesaj yerine sade Türkçe göster
            if (raw.includes('yoğun') || raw.includes('UNAVAILABLE') || raw.includes('503')) {
                setError('AI şu anda yoğun. Birkaç saniye bekleyip tekrar deneyin.');
            } else if (raw.includes('Sistem kapalı')) {
                setError('Sistem kapalı. Toggle ile açın.');
            } else if (raw.includes('okunamadı') || raw.includes('Jina')) {
                setError('Sayfa okunamadı. Doğrudan ürün sayfasının linkini deneyin.');
            } else {
                setError(raw || 'Analiz başarısız.');
            }
        } finally {
            setIsAnalyzing(false);
        }
    };

    return (
        <div className="bg-gray-800 border border-gray-700 rounded-xl p-4 space-y-3">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">AI Link Analizi</p>
            <form onSubmit={handleSubmit} className="space-y-2">
                <div className="flex gap-2">
                    <input
                        type="url"
                        value={link}
                        onChange={e => { setLink(e.target.value); setError(null); }}
                        placeholder="Ürün linki (Trendyol, Hepsiburada, Amazon...)"
                        className="flex-1 bg-gray-900 border border-gray-600 rounded-lg px-3 py-2.5 text-sm text-white focus:border-blue-400 outline-none placeholder:text-gray-600"
                        disabled={isAnalyzing}
                    />
                    <button
                        type="button"
                        onClick={handlePaste}
                        disabled={isAnalyzing}
                        className="shrink-0 px-3 py-2.5 bg-gray-700 hover:bg-gray-600 disabled:opacity-50 text-white text-xs font-semibold rounded-lg transition-colors"
                    >
                        Yapıştır
                    </button>
                </div>
                <button
                    type="submit"
                    disabled={isAnalyzing || !link.trim()}
                    className="w-full py-2.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm font-semibold rounded-lg transition-colors"
                >
                    {isAnalyzing ? 'Analiz ediliyor...' : 'Analiz Et & Yayınla'}
                </button>
            </form>
            {isAnalyzing && <p className="text-blue-400 text-xs">Analiz ediliyor, lütfen bekleyin...</p>}
            {error && <p className="text-red-400 text-xs">{error}</p>}
            {success && <p className="text-green-400 text-xs">Yayınlandı: {success}</p>}
        </div>
    );
};

// ─── Ana Dashboard ────────────────────────────────────────────────────────────

const Dashboard: React.FC<DashboardProps> = ({ setActiveView }) => {
    const [stats, setStats] = useState({ total: 0, today: 0, pending: 0, expired: 0 });
    const [loading, setLoading] = useState(true);

    const loadStats = async () => {
        setLoading(true);
        try {
            const [discounts, pendingDiscounts] = await Promise.all([
                getDiscounts(),
                getPendingDiscounts(),
            ]);
            const today = new Date(); today.setHours(0, 0, 0, 0);
            const todayCount = discounts.filter(d => {
                if (!d.createdAt) return false;
                const created = d.createdAt.toDate ? d.createdAt.toDate() : new Date(d.createdAt);
                return created >= today;
            }).length;
            setStats({
                total: discounts.filter(d => !d.isAd && d.status !== 'İndirim Bitti').length,
                today: todayCount,
                pending: pendingDiscounts.length,
                expired: discounts.filter(d => d.status === 'İndirim Bitti').length,
            });
        } catch {}
        finally { setLoading(false); }
    };

    useEffect(() => { loadStats(); }, []);

    return (
        <div className="space-y-4 max-w-2xl">
            {/* Yeni İndirim Ekle */}
            <button
                onClick={() => setActiveView('addDiscount')}
                className="w-full group relative overflow-hidden bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-500 hover:to-emerald-500 p-5 rounded-xl shadow-lg border border-green-500/30 text-left transition-all active:scale-[0.99]"
            >
                <div className="absolute -top-4 -right-4 w-20 h-20 bg-white/10 rounded-full blur-xl" />
                <div className="relative flex items-center justify-between">
                    <div>
                        <h3 className="text-xl font-bold text-white">➕ Yeni İndirim Ekle</h3>
                        <p className="text-green-100 text-sm mt-0.5">Yeni bir indirim ilanı oluştur ve yayınla</p>
                    </div>
                    <svg className="h-8 w-8 text-white/60 group-hover:translate-x-1 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                </div>
            </button>

            {/* Affiliate Widget */}
            <AffiliateWidget />

            {/* AI Analyzer */}
            <AIAnalyzer />

            {/* Stats */}
            <div className="grid grid-cols-2 gap-3">
                {loading ? (
                    [...Array(4)].map((_, i) => <div key={i} className="bg-gray-800 rounded-xl h-20 animate-pulse border border-gray-700" />)
                ) : (
                    <>
                        <button onClick={() => setActiveView('discounts')} className="bg-gray-800 border border-gray-700 rounded-xl p-4 text-left hover:border-gray-500 transition-colors">
                            <p className="text-2xl font-bold text-white">{stats.total}</p>
                            <p className="text-xs text-gray-400 mt-0.5">Aktif İndirim</p>
                        </button>
                        <button onClick={() => setActiveView('discounts')} className="bg-gray-800 border border-gray-700 rounded-xl p-4 text-left hover:border-gray-500 transition-colors">
                            <p className="text-2xl font-bold text-white">{stats.today}</p>
                            <p className="text-xs text-gray-400 mt-0.5">Bugün Eklenen</p>
                        </button>
                        <button onClick={() => setActiveView('submissions')} className="bg-gray-800 border border-gray-700 rounded-xl p-4 text-left hover:border-gray-500 transition-colors">
                            <p className="text-2xl font-bold text-white">{stats.pending}</p>
                            <p className="text-xs text-gray-400 mt-0.5">Bekleyen Onay</p>
                        </button>
                        <button onClick={() => setActiveView('discounts')} className="bg-gray-800 border border-gray-700 rounded-xl p-4 text-left hover:border-gray-500 transition-colors">
                            <p className="text-2xl font-bold text-white">{stats.expired}</p>
                            <p className="text-xs text-gray-400 mt-0.5">Biten İndirim</p>
                        </button>
                    </>
                )}
            </div>

            {!loading && (
                <button onClick={loadStats} className="text-xs text-gray-600 hover:text-gray-400 transition-colors">
                    Yenile
                </button>
            )}
        </div>
    );
};

export default Dashboard;
