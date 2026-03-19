import React, { useState, useEffect } from 'react';
import type { ViewType } from '../types';
import {
    getDiscounts,
    getPendingDiscounts,
    getAdvertisements,
    getAdRequests,
    getPendingAffiliateCount,
} from '../services/firebase';
import { analyzeProductLink, isValidProductLink } from '../services/linkAnalyzer';
import type { ScrapedDeal } from '../services/dealFinder';

interface DashboardProps {
    setActiveView: (view: ViewType) => void;
    setSelectedDeal: (deal: ScrapedDeal) => void;
    isAdmin: boolean;
}

interface Stats {
    totalDiscounts: number;
    pendingAffiliate: number;
    pendingSubmissions: number;
    activeAds: number;
    pendingAdRequests: number;
    todayDiscounts: number;
    expiredDiscounts: number;
}

const StatCard: React.FC<{
    icon: string;
    label: string;
    value: number | string;
    color: string;
    onClick?: () => void;
    badge?: number;
}> = ({ icon, label, value, color, onClick, badge }) => (
    <button
        onClick={onClick}
        className={`relative bg-gray-800 rounded-xl p-5 flex flex-col gap-2 border border-gray-700 transition-all duration-200 text-left w-full
            ${onClick ? 'hover:border-gray-500 hover:bg-gray-750 cursor-pointer hover:scale-[1.02]' : 'cursor-default'}`}
    >
        {badge !== undefined && badge > 0 && (
            <span className="absolute top-3 right-3 bg-orange-500 text-white text-xs font-bold px-2 py-0.5 rounded-full">
                {badge}
            </span>
        )}
        <div className={`text-3xl w-12 h-12 flex items-center justify-center rounded-lg ${color}`}>
            {icon}
        </div>
        <div>
            <p className="text-2xl font-bold text-white">{value}</p>
            <p className="text-sm text-gray-400 mt-0.5">{label}</p>
        </div>
    </button>
);

const QuickAction: React.FC<{
    icon: string;
    label: string;
    description: string;
    onClick: () => void;
    highlight?: boolean;
}> = ({ icon, label, description, onClick, highlight }) => (
    <button
        onClick={onClick}
        className={`flex items-center gap-4 p-4 rounded-xl border transition-all duration-200 text-left w-full
            ${highlight
                ? 'bg-blue-600/20 border-blue-500/50 hover:bg-blue-600/30'
                : 'bg-gray-800 border-gray-700 hover:border-gray-500 hover:bg-gray-750'
            }`}
    >
        <span className="text-2xl">{icon}</span>
        <div>
            <p className="font-semibold text-white text-sm">{label}</p>
            <p className="text-xs text-gray-400 mt-0.5">{description}</p>
        </div>
        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-gray-500 ml-auto flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
    </button>
);

const Dashboard: React.FC<DashboardProps> = ({ setActiveView, setSelectedDeal }) => {
    const [stats, setStats] = useState<Stats>({
        totalDiscounts: 0,
        pendingAffiliate: 0,
        pendingSubmissions: 0,
        activeAds: 0,
        pendingAdRequests: 0,
        todayDiscounts: 0,
        expiredDiscounts: 0,
    });
    const [loading, setLoading] = useState(true);
    const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
    const [pipelineStatus, setPipelineStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
    const [pipelineMessage, setPipelineMessage] = useState('');

    // Link Analizi State
    const [analysisLink, setAnalysisLink] = useState('');
    const [isAnalyzing, setIsAnalyzing] = useState(false);

    // Link Analizi İşlemi
    const handleAnalyzeLink = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!isValidProductLink(analysisLink)) {
            setPipelineStatus('error');
            setPipelineMessage('Lütfen geçerli bir ürün linki girin.');
            setTimeout(() => { setPipelineStatus('idle'); setPipelineMessage(''); }, 3000);
            return;
        }

        setIsAnalyzing(true);
        setPipelineStatus('loading');
        setPipelineMessage('Link analiz ediliyor, lütfen bekleyin...');

        try {
            const product = await analyzeProductLink(analysisLink);
            
            // ScrapedDeal formatına çevir
            const deal: ScrapedDeal = {
                id: `manual_${Date.now()}`,
                title: product.title,
                price: product.newPrice,
                source: 'other',
                onualLink: product.link,
                productLink: product.link,
                imageUrl: product.imageUrl,
                scrapedAt: new Date(),
                // AnalyzedProduct'tan gelen ek verileri description'a ekle (çünkü EditDealPage oradan okuyor)
                couponCode: '', 
            };

            // Store tespiti
            const storeLower = product.store.toLowerCase();
            if (storeLower.includes('trendyol')) deal.source = 'trendyol';
            else if (storeLower.includes('hepsiburada')) deal.source = 'hepsiburada';
            else if (storeLower.includes('amazon')) deal.source = 'amazon';
            else if (storeLower.includes('n11')) deal.source = 'n11';
            else deal.source = 'other';

            // EditDealPage'e description hazırlama (AI'nın ürettiği metni oraya aktar)
            // EditDealPage deal.couponCode varsa onu description'a koyuyor, ama biz direkt description'ı da etkileyebiliriz
            // Aslında EditDealPage'i biraz modifiye etmemiz gerekebilir ki bu description'ı direkt alsın.
            // Ama şimdilik deal nesnesini setSelectedDeal ile gönderiyoruz.
            
            // @ts-ignore
            deal.aiDescription = product.description;
            // @ts-ignore
            deal.brandName = product.brand;
            // @ts-ignore
            deal.categoryName = product.category;
            // @ts-ignore
            deal.oldPriceValue = product.oldPrice;

            setSelectedDeal(deal);
            setActiveView('editDeal');
            
            setPipelineStatus('idle');
            setPipelineMessage('');
            setAnalysisLink('');
        } catch (err: any) {
            setPipelineStatus('error');
            setPipelineMessage('Analiz hatası: ' + (err.message || 'Bilinmeyen bir hata oluştu'));
            setTimeout(() => { setPipelineStatus('idle'); setPipelineMessage(''); }, 5000);
        } finally {
            setIsAnalyzing(false);
        }
    };

    // OnuAl Pipeline'ı tetikle (GitHub Actions workflow_dispatch)
    const triggerOnualPipeline = async () => {
        setPipelineStatus('loading');
        setPipelineMessage('');

        try {
            // @ts-ignore
            const GITHUB_TOKEN = (import.meta as any).env?.VITE_GITHUB_TOKEN || '';
            if (!GITHUB_TOKEN) {
                throw new Error('GitHub token tanımlı değil');
            }

            const response = await fetch(
                'https://api.github.com/repos/indivaapp/indiva-panel/actions/workflows/auto-onual.yml/dispatches',
                {
                    method: 'POST',
                    headers: {
                        'Accept': 'application/vnd.github.v3+json',
                        'Authorization': `token ${GITHUB_TOKEN}`,
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({ ref: 'main' }),
                }
            );

            if (response.status === 204) {
                setPipelineStatus('success');
                setPipelineMessage('OnuAl Pipeline başlatıldı! Yaklaşık 2-3 dakika içinde yeni ürünler eklenecek.');
                // 60 saniye sonra istatistikleri yenile
                setTimeout(() => {
                    loadStats();
                    setPipelineStatus('idle');
                    setPipelineMessage('');
                }, 60000);
            } else if (response.status === 401 || response.status === 403) {
                throw new Error('GitHub token geçersiz veya yetkisiz');
            } else {
                const errData = await response.json().catch(() => ({}));
                throw new Error(errData.message || `HTTP ${response.status}`);
            }
        } catch (err: any) {
            setPipelineStatus('error');
            setPipelineMessage(err.message || 'Pipeline tetiklenemedi');
            setTimeout(() => { setPipelineStatus('idle'); setPipelineMessage(''); }, 5000);
        }
    };

    // Price Checker Pipeline'ı tetikle (GitHub Actions workflow_dispatch)
    const triggerPriceChecker = async () => {
        setPipelineStatus('loading');
        setPipelineMessage('');

        try {
            // @ts-ignore
            const GITHUB_TOKEN = (import.meta as any).env?.VITE_GITHUB_TOKEN || '';
            if (!GITHUB_TOKEN) {
                throw new Error('GitHub token tanımlı değil');
            }

            const response = await fetch(
                'https://api.github.com/repos/indivaapp/indiva-panel/actions/workflows/price-checker.yml/dispatches',
                {
                    method: 'POST',
                    headers: {
                        'Accept': 'application/vnd.github.v3+json',
                        'Authorization': `token ${GITHUB_TOKEN}`,
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({ ref: 'main' }),
                }
            );

            if (response.status === 204) {
                setPipelineStatus('success');
                setPipelineMessage('Fiyat Kontrolü başlatıldı! Ürünler taranıyor ve bittiğinde işaretlenecek.');
                setTimeout(() => {
                    loadStats();
                    setPipelineStatus('idle');
                    setPipelineMessage('');
                }, 10000);
            } else {
                throw new Error(`HTTP ${response.status}`);
            }
        } catch (err: any) {
            setPipelineStatus('error');
            setPipelineMessage(err.message || 'Fiyat kontrolü tetiklenemedi');
            setTimeout(() => { setPipelineStatus('idle'); setPipelineMessage(''); }, 5000);
        }
    };

    const loadStats = async () => {
        setLoading(true);
        try {
            const [discounts, pendingDiscounts, ads, adRequests, pendingAffiliateCount] = await Promise.all([
                getDiscounts(),
                getPendingDiscounts(),
                getAdvertisements(),
                getAdRequests(),
                getPendingAffiliateCount(),
            ]);

            // Bugün eklenen indirimleri say
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            const todayCount = discounts.filter(d => {
                if (!d.createdAt) return false;
                const created = d.createdAt.toDate ? d.createdAt.toDate() : new Date(d.createdAt as any);
                return created >= today;
            }).length;

            // Bekleyen reklam başvuruları
            const pendingAdRequestCount = adRequests.filter(r => r.status === 'pending').length;

            setStats({
                totalDiscounts: discounts.filter(d => !d.isAd && d.status !== 'İndirim Bitti').length,
                pendingAffiliate: pendingAffiliateCount,
                pendingSubmissions: pendingDiscounts.length,
                activeAds: ads.length,
                pendingAdRequests: pendingAdRequestCount,
                todayDiscounts: todayCount,
                expiredDiscounts: discounts.filter(d => d.status === 'İndirim Bitti').length,
            });
            setLastUpdated(new Date());
        } catch (err) {
            console.warn('Dashboard istatistikleri yüklenemedi:', err);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        loadStats();
    }, []);

    const now = new Date();
    const hour = now.getHours();
    const greeting = hour < 12 ? 'Günaydın' : hour < 18 ? 'İyi günler' : 'İyi akşamlar';

    return (
        <div className="space-y-6 max-w-4xl">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold text-white">{greeting} 👋</h1>
                    <p className="text-gray-400 text-sm mt-1">INDIVA Yönetim Paneli</p>
                </div>
                <button
                    onClick={loadStats}
                    disabled={loading}
                    className="flex items-center gap-2 text-sm text-gray-400 hover:text-white transition-colors px-3 py-2 rounded-lg hover:bg-gray-800"
                >
                    <svg xmlns="http://www.w3.org/2000/svg" className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                    </svg>
                    {loading ? 'Yükleniyor...' : 'Yenile'}
                </button>
            </div>

            {/* Affiliate Warning Block */}
            {!loading && stats.pendingAffiliate > 0 && (
                <button
                    onClick={() => setActiveView('affiliateLinks')}
                    className="w-full bg-gradient-to-r from-orange-600 to-red-600 p-4 rounded-2xl shadow-lg shadow-orange-900/20 flex items-center justify-between group hover:scale-[1.01] transition-all"
                >
                    <div className="flex items-center gap-4">
                        <div className="w-12 h-12 bg-white/20 rounded-xl flex items-center justify-center text-2xl animate-bounce">
                            💰
                        </div>
                        <div>
                            <h3 className="text-white font-bold text-lg">Affiliate Linkler Bekliyor!</h3>
                            <p className="text-white/80 text-sm">Güncellenmesi gereken <span className="font-bold underline">{stats.pendingAffiliate}</span> yeni ürün var. Hemen başla!</p>
                        </div>
                    </div>
                    <div className="bg-white/20 px-4 py-2 rounded-lg text-white font-bold group-hover:bg-white/30 transition-colors">
                        Tıkla & Başla →
                    </div>
                </button>
            )}

            {/* AI Link Analysis Card */}
            <div className="bg-gray-800 border-2 border-blue-500/30 rounded-2xl p-5 shadow-xl">
                <div className="flex items-center gap-3 mb-4">
                    <div className="w-10 h-10 bg-blue-500/20 rounded-lg flex items-center justify-center text-xl">
                        ✨
                    </div>
                    <div>
                        <h3 className="text-white font-bold">Yapay Zeka Link Analizi</h3>
                        <p className="text-gray-400 text-xs mt-0.5">Linki yapıştırın, AI her şeyi hazırlasın!</p>
                    </div>
                </div>
                
                <form onSubmit={handleAnalyzeLink} className="flex gap-2">
                    <input
                        type="url"
                        value={analysisLink}
                        onChange={(e) => setAnalysisLink(e.target.value)}
                        placeholder="Ürün linkini buraya yapıştırın (Trendyol, Amazon, Hepsiburada vb.)"
                        className="flex-1 bg-gray-900 border border-gray-700 rounded-xl px-4 py-3 text-sm text-white focus:ring-2 focus:ring-blue-500 outline-none transition-all placeholder:text-gray-600"
                        disabled={isAnalyzing}
                    />
                    <button
                        type="submit"
                        disabled={isAnalyzing || !analysisLink}
                        className="bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-bold px-6 py-3 rounded-xl transition-all flex items-center gap-2 whitespace-nowrap shadow-lg shadow-blue-900/20"
                    >
                        {isAnalyzing ? (
                            <>
                                <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                                Analiz Ediliyor...
                            </>
                        ) : (
                            <>Analiz Et</>
                        )}
                    </button>
                </form>
            </div>

            {/* Pipeline Status Toast */}
            {pipelineMessage && (
                <div className={`p-3 rounded-xl border text-sm flex items-center gap-2 ${pipelineStatus === 'success'
                    ? 'bg-green-500/15 border-green-500/30 text-green-400'
                    : pipelineStatus === 'error'
                        ? 'bg-red-500/15 border-red-500/30 text-red-400'
                        : 'bg-blue-500/15 border-blue-500/30 text-blue-400'
                    }`}>
                    {pipelineStatus === 'loading' && (
                        <div className="w-4 h-4 border-2 border-blue-400/30 border-t-blue-400 rounded-full animate-spin flex-shrink-0"></div>
                    )}
                    {pipelineMessage}
                </div>
            )}

            {/* Stats Grid */}
            <div>
                <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-3">Genel Bakış</h2>
                {loading ? (
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                        {[...Array(6)].map((_, i) => (
                            <div key={i} className="bg-gray-800 rounded-xl p-5 h-28 animate-pulse border border-gray-700" />
                        ))}
                    </div>
                ) : (
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                        <StatCard
                            icon="🏷️"
                            label="Toplam İndirim"
                            value={stats.totalDiscounts}
                            color="bg-blue-500/20"
                            onClick={() => setActiveView('manageDiscounts')}
                        />
                        <StatCard
                            icon="💰"
                            label="Bekleyen Affiliate"
                            value={stats.pendingAffiliate}
                            color="bg-orange-500/20"
                            onClick={() => setActiveView('affiliateLinks')}
                            badge={stats.pendingAffiliate > 0 ? stats.pendingAffiliate : undefined}
                        />
                        <StatCard
                            icon="📅"
                            label="Bugün Eklenen"
                            value={stats.todayDiscounts}
                            color="bg-green-500/20"
                        />
                        <StatCard
                            icon="✅"
                            label="Bekleyen Onay"
                            value={stats.pendingSubmissions}
                            color="bg-yellow-500/20"
                            onClick={() => setActiveView('submissions')}
                            badge={stats.pendingSubmissions > 0 ? stats.pendingSubmissions : undefined}
                        />
                        <StatCard
                            icon="📢"
                            label="Aktif Reklam"
                            value={stats.activeAds}
                            color="bg-purple-500/20"
                            onClick={() => setActiveView('ads')}
                        />
                        <StatCard
                            icon="🚩"
                            label="Biten İndirimler"
                            value={stats.expiredDiscounts}
                            color="bg-red-500/20"
                            onClick={() => setActiveView('manageDiscounts')}
                        />
                    </div>
                )}
                {/* Quick Actions */}
                <div>
                    <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-3">Hızlı İşlemler</h2>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <QuickAction
                            icon="📡"
                            label="Yeni Ürünleri Çek"
                            description="OnuAl sitesini şimdi tara ve yeni indirimleri ekle"
                            onClick={triggerOnualPipeline}
                            highlight={true}
                        />
                        <QuickAction
                            icon="🔍"
                            label="Fiyatları Kontrol Et"
                            description="Mevcut ilanların fiyatlarını tara ve bitenleri kapat"
                            onClick={triggerPriceChecker}
                        />
                    </div>
                </div>

                {lastUpdated && !loading && (
                    <p className="text-xs text-gray-600 mt-2 text-right">
                        Son güncelleme: {lastUpdated.toLocaleTimeString('tr-TR')}
                    </p>
                )}
            </div>

        </div>
    );
};

export default Dashboard;
