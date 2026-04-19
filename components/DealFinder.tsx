
import React, { useState, useEffect, useRef } from 'react';
import { collection, query, where, getDocs, doc, deleteDoc, updateDoc, addDoc, orderBy, limit, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebaseConfig';
import type { ViewType } from '../types';
import { isSystemEnabled } from '../utils/systemStatus';

// ─── Tipler ──────────────────────────────────────────────────────────────────
interface ScrapedDeal {
    id: string;
    title: string;
    newPrice: number;
    oldPrice: number;
    link: string;
    imageUrl?: string;
    storeName?: string;
    status?: string;
    needsReview?: boolean;
    createdAt?: any;
}

interface AIAnalysisResult {
    title: string;
    cleanTitle: string;
    newPrice: number;
    oldPrice: number;
    discountPercent: number;
    category: string;
    description: string;
    aiFomoScore: number;
    imageUrl: string;
    storeName: string;
    isValidDeal: boolean;
    reason?: string;
}

// ─── Yardımcı Fonksiyonlar ────────────────────────────────────────────────────
function fixTurkishChars(text: string): string {
    if (!text) return '';
    const htmlEntities: { [k: string]: string } = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'" };
    let result = text;
    for (const [e, c] of Object.entries(htmlEntities)) result = result.replace(new RegExp(e, 'g'), c);
    return result.replace(/\s+/g, ' ').trim();
}

const SEEN_DEALS_KEY = 'indiva_seen_deal_ids';
function getSeenDealIds() { try { return new Set(JSON.parse(localStorage.getItem(SEEN_DEALS_KEY) || '[]')); } catch { return new Set(); } }
function markDealsAsSeen(ids: string[]) { try { const s = getSeenDealIds(); ids.forEach(id => s.add(id)); localStorage.setItem(SEEN_DEALS_KEY, JSON.stringify([...s].slice(-500))); } catch {} }
function clearSeenDeals() { try { localStorage.removeItem(SEEN_DEALS_KEY); } catch {} }

function detectStore(url: string): string {
    if (url.includes('trendyol.com')) return 'Trendyol';
    if (url.includes('hepsiburada.com')) return 'Hepsiburada';
    if (url.includes('amazon.com.tr') || url.includes('amazon.com')) return 'Amazon';
    if (url.includes('n11.com')) return 'n11';
    if (url.includes('ciceksepeti.com')) return 'Çiçeksepeti';
    if (url.includes('morhipo.com')) return 'Morhipo';
    if (url.includes('teknosa.com')) return 'Teknosa';
    if (url.includes('mediamarkt.com.tr')) return 'MediaMarkt';
    if (url.includes('gittigidiyor.com')) return 'GittiGidiyor';
    return 'Mağaza';
}

// ─── Props ────────────────────────────────────────────────────────────────────
interface DealFinderProps {
    isAdmin: boolean;
    setActiveView?: (view: ViewType) => void;
    setSelectedDeal?: (deal: any) => void;
    startDealQueue?: (deals: ScrapedDeal[]) => void;
}

// ─── Bileşen ──────────────────────────────────────────────────────────────────
const DealFinder: React.FC<DealFinderProps> = ({ isAdmin, setActiveView, setSelectedDeal, startDealQueue }) => {
    // Sekme: 'drafts' | 'analyzer'
    const [activeTab, setActiveTab] = useState<'drafts' | 'analyzer'>('drafts');

    // ── Taslak İlanlar ──
    const [deals, setDeals] = useState<ScrapedDeal[]>([]);
    const [allDeals, setAllDeals] = useState<ScrapedDeal[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [isFetching, setIsFetching] = useState(false);
    const [showOnlyNew, setShowOnlyNew] = useState(true);
    const [editingDeal, setEditingDeal] = useState<ScrapedDeal | null>(null);
    const [editForm, setEditForm] = useState({ title: '', oldPrice: 0, newPrice: 0, link: '' });
    const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

    // ── Link Analiz (Arka Plan) ──
    const [analyzerUrl, setAnalyzerUrl] = useState('');
    const [isAddingToQueue, setIsAddingToQueue] = useState(false);
    const [queueStatus, setQueueStatus] = useState<null | 'running' | 'done' | 'error'>(null);
    const [queueError, setQueueError] = useState('');
    const [analysisStep, setAnalysisStep] = useState('');
    const queueUnsubRef = useRef<(() => void) | null>(null);

    useEffect(() => { loadDeals(); }, []);

    const showMessage = (type: 'success' | 'error', text: string) => {
        setMessage({ type, text });
        setTimeout(() => setMessage(null), 4000);
    };

    // ── Taslak İlanları Yükle ──────────────────────────────────────────────────
    const loadDeals = async () => {
        setIsLoading(true);
        try {
            const q = query(collection(db, 'discounts'), where('status', '==', 'draft'), orderBy('createdAt', 'desc'), limit(50));
            const snap = await getDocs(q);
            const seenIds = getSeenDealIds();
            const fetched: ScrapedDeal[] = snap.docs.map(d => {
                const data = d.data();
                return { id: d.id, title: fixTurkishChars(data.title || ''), newPrice: data.newPrice || 0, oldPrice: data.oldPrice || 0, link: data.link || '', imageUrl: data.imageUrl, storeName: data.storeName || 'Mağaza', status: data.status, needsReview: data.needsReview, createdAt: data.createdAt };
            });
            setAllDeals(fetched);
            setDeals(showOnlyNew ? fetched.filter(d => !seenIds.has(d.id)) : fetched);
        } catch (err: any) {
            showMessage('error', err.message);
        } finally {
            setIsLoading(false);
        }
    };

    // ── GitHub Workflow Tetikle ────────────────────────────────────────────────
    const triggerGitHubWorkflow = async () => {
        setIsFetching(true);
        try {
            const GITHUB_TOKEN = (import.meta as any).env?.VITE_GITHUB_TOKEN || '';
            if (!GITHUB_TOKEN || GITHUB_TOKEN === 'YOUR_GITHUB_TOKEN_HERE') throw new Error('VITE_GITHUB_TOKEN tanımlı değil.');
            const res = await fetch('https://api.github.com/repos/AdemHan/indiva-app/actions/workflows/auto-onual.yml/dispatches', {
                method: 'POST',
                headers: { Accept: 'application/vnd.github.v3+json', Authorization: `token ${GITHUB_TOKEN}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ ref: 'main' })
            });
            if (res.status === 204) {
                showMessage('success', '✅ GitHub Actions tetiklendi! 30sn sonra yenilenecek...');
                setTimeout(() => { loadDeals(); }, 30000);
            } else {
                throw new Error(`HTTP ${res.status}`);
            }
        } catch (err: any) {
            showMessage('error', 'Workflow tetiklenemedi: ' + err.message);
        } finally {
            setIsFetching(false);
        }
    };

    // ── Taslak Düzenle & Yayınla ──────────────────────────────────────────────
    const saveAndPublish = async () => {
        if (!editingDeal) return;
        setIsLoading(true);
        try {
            await updateDoc(doc(db, 'discounts', editingDeal.id), { ...editForm, status: 'aktif', needsReview: false, publishedAt: new Date() });
            showMessage('success', '✅ İlan yayınlandı!');
            setEditingDeal(null);
            setDeals(p => p.filter(d => d.id !== editingDeal.id));
            setAllDeals(p => p.filter(d => d.id !== editingDeal.id));
        } catch (err: any) {
            showMessage('error', 'Kaydetme hatası: ' + err.message);
        } finally {
            setIsLoading(false);
        }
    };

    const deleteDeal = async (id: string) => {
        if (!confirm('Silmek istiyor musunuz?')) return;
        await deleteDoc(doc(db, 'discounts', id));
        markDealsAsSeen([id]);
        setDeals(p => p.filter(d => d.id !== id));
        setAllDeals(p => p.filter(d => d.id !== id));
    };

    // ── Arka Planda Analiz Et & Yayınla ──────────────────────────────────
    const addToQueue = async () => {
        if (!isSystemEnabled()) {
            showMessage('error', 'Sistem kapalı. Lütfen sistemi açıp tekrar deneyin.');
            return;
        }

        const url = analyzerUrl.trim();
        if (!url || !url.startsWith('http')) {
            showMessage('error', 'Geçerli bir URL girin (https://...)');
            return;
        }

        setIsAddingToQueue(true);
        setQueueStatus('running');
        setQueueError('');
        setAnalyzerUrl(''); // URL alanını hemen temizle

        // Arka planda analiz başlat (await yok — kullanıcı beklemez)
        runAnalyzeAndPublish(url);

        // UI'yi hemen serbest bırak
        setIsAddingToQueue(false);
    };

    const runAnalyzeAndPublish = async (url: string) => {
        try {
            const GEMINI_KEY = (import.meta as any).env?.VITE_GEMINI_API_KEY || '';
            const storeName = detectStore(url);

            // ── 1. Vercel proxy'den yapılandırılmış ürün verisi çek ──────────
            setAnalysisStep('Ürün sayfası okunuyor...');
            let title = '', imageUrl = '', newPrice = 0, oldPrice = 0, brand = '';
            let proxyHasTitle = false;   // başlık + görsel geldi
            let proxySuccess  = false;   // başlık + görsel + fiyat geldi

            try {
                const proxyRes = await fetch(
                    `https://indiva-proxy.vercel.app/api/scrape?action=product&url=${encodeURIComponent(url)}`,
                    { signal: AbortSignal.timeout(35000) }
                );
                if (proxyRes.ok) {
                    const proxyData = await proxyRes.json();
                    if (proxyData.success && proxyData.product) {
                        const p = proxyData.product;
                        title = p.title || '';
                        imageUrl = p.imageUrl || '';
                        newPrice = p.newPrice || 0;
                        oldPrice = p.oldPrice || 0;
                        brand = p.brand || storeName;
                        proxyHasTitle = !!title;
                        proxySuccess  = !!(title && newPrice > 0);
                    }
                }
            } catch (e) {
                console.warn('Proxy hatası:', e);
            }

            // ── 2. Görsel yoksa Jina JSON'dan OG image dene ─────────────────
            if (!imageUrl) {
                try {
                    const jinaJsonRes = await fetch(`https://r.jina.ai/${url}`, {
                        headers: { Accept: 'application/json' },
                        signal: AbortSignal.timeout(8000)
                    });
                    if (jinaJsonRes.ok) {
                        const j = await jinaJsonRes.json();
                        imageUrl = j?.data?.ogImage || j?.data?.image || '';
                    }
                } catch {}
            }

            // ── 3. Gemini ile içerik zenginleştir ────────────────────────────
            setAnalysisStep('AI analizi yapılıyor...');
            let cleanTitle = title;
            let category = 'Diğer';
            let description = '';
            let aiFomoScore = 5;
            let discountPercent = oldPrice > newPrice && newPrice > 0
                ? Math.round(((oldPrice - newPrice) / oldPrice) * 100) : 0;

            if (GEMINI_KEY) {
                let prompt: string;

                // Her durumda Jina'dan sayfa içeriği çek (fiyat için güvenilir kaynak)
                let pageContent = '';
                try {
                    const jinaRes = await fetch(`https://r.jina.ai/${url}`, {
                        headers: { Accept: 'text/plain' },
                        signal: AbortSignal.timeout(20000)
                    });
                    if (jinaRes.ok) pageContent = (await jinaRes.text()).substring(0, 8000);
                } catch {}

                if (proxySuccess) {
                    // Proxy başarılı → sadece başlık düzeltme + içerik
                    prompt = `E-ticaret ürünü:
- Ham başlık: "${title}"
- Fiyat: ${newPrice} TL${oldPrice > 0 ? ` (eski fiyat: ${oldPrice} TL)` : ''}
- Mağaza: ${storeName}

SAYFA İÇERİĞİ (fiyat doğrulaması için):
${pageContent.substring(0, 3000)}

Ham başlık URL slug'dan gelmiş olabilir. Düzelt.
SADECE JSON döndür:
{
  "title": "Düzgün ürün başlığı, Title Case, max 80 karakter",
  "cleanTitle": "Kısa başlık, max 50 karakter",
  "category": "Teknoloji/Giyim/Ev & Yaşam/Market/Kozmetik/Anne & Bebek/Spor/Kitap/Sağlık/Pet/Otomotiv/Diğer",
  "description": "2-3 cümle etkileyici Türkçe, FOMO içerecek",
  "aiFomoScore": 1-10
}`;
                } else if (proxyHasTitle) {
                    // Proxy başlık buldu ama fiyat bulamadı → Gemini sadece fiyat + içerik
                    prompt = `E-ticaret ürünü:
- Ürün adı: "${title}"
- Mağaza: ${storeName}

SAYFA İÇERİĞİ:
${pageContent}

Bu ürünün güncel fiyatını sayfadan çıkar.
SADECE JSON döndür:
{
  "title": "Düzgün ürün başlığı, Title Case, max 80 karakter",
  "cleanTitle": "Kısa başlık, max 50 karakter",
  "newPrice": indirimli/güncel fiyat (TL, sadece rakam, KESİNLİKLE tahmin yapma — sayfada yoksa 0),
  "oldPrice": orijinal fiyat (TL, yoksa 0),
  "category": "Teknoloji/Giyim/Ev & Yaşam/Market/Kozmetik/Anne & Bebek/Spor/Kitap/Sağlık/Pet/Otomotiv/Diğer",
  "description": "2-3 cümle etkileyici Türkçe, FOMO içerecek",
  "aiFomoScore": 1-10
}`;
                } else {
                    // Proxy tamamen başarısız → Gemini her şeyi çıkarıyor
                    prompt = `E-ticaret ürün sayfasını analiz et:
URL: ${url}
Mağaza: ${storeName}

SAYFA İÇERİĞİ:
${pageContent}

SADECE JSON döndür:
{
  "title": "ürün başlığı, Title Case, max 80 karakter",
  "cleanTitle": "kısa başlık, max 50 karakter",
  "newPrice": indirimli/güncel fiyat (TL, sadece rakam, KESİNLİKLE tahmin yapma — sayfada yoksa 0),
  "oldPrice": orijinal fiyat (TL, yoksa 0),
  "category": "Teknoloji/Giyim/Ev & Yaşam/Market/Kozmetik/Anne & Bebek/Spor/Kitap/Sağlık/Pet/Otomotiv/Diğer",
  "description": "2-3 cümle etkileyici Türkçe, FOMO içerecek",
  "aiFomoScore": 1-10
}`;
                }

                try {
                    const aiRes = await fetch(
                        'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=' + GEMINI_KEY,
                        {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                contents: [{ role: 'user', parts: [{ text: prompt }] }],
                                generationConfig: { temperature: 0.2, responseMimeType: 'application/json' }
                            })
                        }
                    );
                    if (aiRes.ok) {
                        const aiData = await aiRes.json();
                        const aiText = aiData.candidates?.[0]?.content?.parts?.[0]?.text || '';
                        const jsonMatch = aiText.match(/\{[\s\S]*\}/);
                        if (jsonMatch) {
                            const result = JSON.parse(jsonMatch[0]);
                            // Her durumda Gemini'nin düzelttiği başlığı kullan
                            if (result.title) title = result.title;
                            cleanTitle = result.cleanTitle || title;
                            category = result.category || 'Diğer';
                            description = result.description || '';
                            aiFomoScore = result.aiFomoScore || 5;
                            // Fiyat proxy'den gelmediyse Gemini'den al
                            if (!proxySuccess) {
                                if (!title) title = result.title || 'Ürün';
                                newPrice = parseFloat(String(result.newPrice || 0)) || 0;
                                oldPrice = parseFloat(String(result.oldPrice || 0)) || 0;
                                discountPercent = result.discountPercent || 0;
                            }
                        }
                    }
                } catch (aiErr) {
                    console.warn('Gemini hatası:', aiErr);
                }
            }

            if (!title && !newPrice) throw new Error('Ürün bilgisi alınamadı. Farklı bir link deneyin.');

            if (oldPrice === 0 && newPrice > 0) oldPrice = Math.round(newPrice * 1.3);
            if (discountPercent === 0 && oldPrice > newPrice && newPrice > 0)
                discountPercent = Math.round(((oldPrice - newPrice) / oldPrice) * 100);

            // ── 4. Firebase'e yaz ────────────────────────────────────────────
            setAnalysisStep('Firebase\'e yayınlanıyor...');
            await addDoc(collection(db, 'discounts'), {
                title: title || 'Ürün',
                cleanTitle: cleanTitle || title || 'Ürün',
                newPrice,
                oldPrice,
                discountPercent,
                category,
                description,
                aiFomoScore,
                imageUrl,
                link: url,
                originalStoreLink: url,
                storeName,
                brand: storeName,  // INDIVA'da mağaza adı olarak gösterilir
                status: 'aktif',
                source: 'link_analyzer',
                createdAt: serverTimestamp(),
            });

            setQueueStatus('done');
            showMessage('success', 'İndirim yayınlandı!');
        } catch (err: any) {
            setQueueStatus('error');
            setQueueError(err.message || 'Bilinmeyen hata');
            showMessage('error', 'Analiz başarısız: ' + err.message);
        } finally {
            setAnalysisStep('');
        }
    };

    const resetQueue = () => {
        setQueueStatus(null);
        setQueueError('');
        setAnalyzerUrl('');
        setAnalysisStep('');
    };

    if (!isAdmin) return <div className="flex items-center justify-center h-96"><p className="text-red-400">Bu sayfaya erişim yetkiniz yok.</p></div>;

    return (
        <div className="max-w-4xl mx-auto px-4 py-6">
            {/* Sekme Başlıkları */}
            <div className="flex gap-1 mb-6 bg-gray-800 p-1 rounded-xl">
                <button
                    onClick={() => setActiveTab('drafts')}
                    className={`flex-1 py-2.5 px-4 rounded-lg text-sm font-semibold transition-all ${activeTab === 'drafts' ? 'bg-blue-600 text-white shadow' : 'text-gray-400 hover:text-white'}`}
                >
                    📥 Taslak İlanlar {allDeals.length > 0 && <span className="ml-1 bg-orange-500 text-white text-xs px-1.5 py-0.5 rounded-full">{allDeals.length}</span>}
                </button>
                <button
                    onClick={() => setActiveTab('analyzer')}
                    className={`flex-1 py-2.5 px-4 rounded-lg text-sm font-semibold transition-all ${activeTab === 'analyzer' ? 'bg-purple-600 text-white shadow' : 'text-gray-400 hover:text-white'}`}
                >
                    🔗 Link ile İndirim Ekle
                </button>
            </div>

            {/* Bildirim */}
            {message && (
                <div className={`mb-4 p-4 rounded-lg text-sm ${message.type === 'success' ? 'bg-green-500/20 border border-green-500/30 text-green-400' : 'bg-red-500/20 border border-red-500/30 text-red-400'}`}>
                    {message.text}
                </div>
            )}

            {/* ── TAB 1: Taslak İlanlar ── */}
            {activeTab === 'drafts' && (
                <div>
                    <div className="flex gap-2 mb-4">
                        <button onClick={triggerGitHubWorkflow} disabled={isFetching} className="flex-1 py-3 px-4 bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-500 hover:to-blue-600 text-white font-bold rounded-xl shadow-lg transition-all disabled:opacity-50 flex items-center justify-center gap-2">
                            {isFetching ? <><div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Çekiliyor...</> : '🚀 Yeni İndirim Çek'}
                        </button>
                        <button onClick={loadDeals} disabled={isLoading} className="py-3 px-4 bg-gray-700 hover:bg-gray-600 text-white rounded-xl transition-colors disabled:opacity-50" title="Yenile">🔄</button>
                    </div>

                    <div className="flex gap-2 mb-4 flex-wrap">
                        <button onClick={() => { setShowOnlyNew(p => !p); setDeals(showOnlyNew ? allDeals : allDeals.filter(d => !getSeenDealIds().has(d.id))); }} className={`px-3 py-1.5 rounded-lg text-sm transition-colors ${showOnlyNew ? 'bg-blue-500/20 text-blue-400 border border-blue-500/50' : 'bg-gray-700 text-gray-400'}`}>
                            {showOnlyNew ? '👁️ Tümünü Göster' : '✨ Sadece Yeniler'}
                        </button>
                        {deals.length > 0 && <button onClick={() => { markDealsAsSeen(deals.map(d => d.id)); setDeals([]); }} className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 text-gray-400 rounded-lg text-sm">✓ Tümünü Görüldü Yap</button>}
                        <button onClick={() => { clearSeenDeals(); setDeals(allDeals); }} className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 text-gray-400 rounded-lg text-sm">🗑️ Geçmişi Sıfırla</button>
                    </div>

                    {isLoading && <div className="text-center py-10"><div className="inline-block w-8 h-8 border-2 border-blue-500/30 border-t-blue-500 rounded-full animate-spin" /></div>}

                    {!isLoading && deals.length === 0 && (
                        <div className="text-center py-16 bg-gray-800/50 rounded-2xl border border-gray-700">
                            <div className="text-5xl mb-3">🎉</div>
                            <p className="text-white font-bold">Tüm yeni ilanları gördünüz!</p>
                            <p className="text-gray-400 text-sm mt-1">"Yeni İndirim Çek" ile daha fazla veri çekebilirsiniz.</p>
                        </div>
                    )}

                    <div className="space-y-3">
                        {deals.map(deal => (
                            <div key={deal.id} onClick={() => { markDealsAsSeen([deal.id]); setEditingDeal(deal); setEditForm({ title: deal.title, oldPrice: deal.oldPrice, newPrice: deal.newPrice, link: deal.link }); }}
                                className="bg-gray-800 rounded-xl p-4 cursor-pointer hover:bg-gray-750 transition-all border border-gray-700 hover:border-blue-500/50 flex gap-4 items-center">
                                <div className="w-16 h-16 flex-shrink-0 bg-gray-700 rounded-lg overflow-hidden">
                                    {deal.imageUrl ? <img src={deal.imageUrl} alt="" className="w-full h-full object-cover" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} /> : <div className="w-full h-full flex items-center justify-center text-xl">📷</div>}
                                </div>
                                <div className="flex-1 min-w-0">
                                    <p className="text-white font-medium text-sm line-clamp-2">{deal.title}</p>
                                    <div className="flex items-center gap-2 mt-1 text-sm">
                                        <span className="text-orange-400 font-bold">{deal.newPrice > 0 ? `${deal.newPrice.toLocaleString('tr-TR')}₺` : '—'}</span>
                                        {deal.oldPrice > 0 && <span className="text-gray-500 line-through">{deal.oldPrice.toLocaleString('tr-TR')}₺</span>}
                                        <span className="text-gray-600">· {deal.storeName}</span>
                                    </div>
                                </div>
                                <button onClick={(e) => { e.stopPropagation(); deleteDeal(deal.id); }} className="flex-shrink-0 w-8 h-8 bg-red-500/20 hover:bg-red-500/40 text-red-400 rounded-lg flex items-center justify-center text-sm">🗑️</button>
                            </div>
                        ))}
                    </div>

                    {/* Düzenleme Modal */}
                    {editingDeal && (
                        <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4">
                            <div className="bg-gray-800 rounded-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto p-6">
                                <h2 className="text-xl font-bold text-white mb-4">📝 İlanı Düzenle</h2>
                                {editingDeal.imageUrl && <img src={editingDeal.imageUrl} alt="" className="w-full h-40 object-cover rounded-lg mb-4" />}
                                <div className="space-y-4">
                                    <div>
                                        <label className="block text-gray-400 text-sm mb-1">Başlık</label>
                                        <input type="text" value={editForm.title} onChange={e => setEditForm(p => ({ ...p, title: e.target.value }))} className="w-full px-4 py-3 bg-gray-900 border border-gray-600 rounded-lg text-white focus:outline-none focus:border-blue-500" />
                                    </div>
                                    <div className="grid grid-cols-2 gap-4">
                                        <div>
                                            <label className="block text-gray-400 text-sm mb-1">Eski Fiyat (₺)</label>
                                            <input type="number" value={editForm.oldPrice || ''} onChange={e => setEditForm(p => ({ ...p, oldPrice: Number(e.target.value) }))} className="w-full px-4 py-3 bg-gray-900 border border-gray-600 rounded-lg text-white focus:outline-none focus:border-blue-500" />
                                        </div>
                                        <div>
                                            <label className="block text-gray-400 text-sm mb-1">Yeni Fiyat (₺)</label>
                                            <input type="number" value={editForm.newPrice || ''} onChange={e => setEditForm(p => ({ ...p, newPrice: Number(e.target.value) }))} className="w-full px-4 py-3 bg-gray-900 border border-gray-600 rounded-lg text-white focus:outline-none focus:border-blue-500" />
                                        </div>
                                    </div>
                                    <div>
                                        <label className="block text-gray-400 text-sm mb-1">Ürün Linki</label>
                                        <input type="url" value={editForm.link} onChange={e => setEditForm(p => ({ ...p, link: e.target.value }))} className="w-full px-4 py-3 bg-gray-900 border border-gray-600 rounded-lg text-white focus:outline-none focus:border-blue-500" />
                                    </div>
                                </div>
                                <div className="flex gap-3 mt-6">
                                    <button onClick={() => setEditingDeal(null)} className="flex-1 py-3 bg-gray-700 hover:bg-gray-600 text-white rounded-lg transition-colors">İptal</button>
                                    <button onClick={saveAndPublish} disabled={isLoading} className="flex-1 py-3 bg-green-600 hover:bg-green-500 text-white font-bold rounded-lg transition-colors disabled:opacity-50">✅ Kaydet & Yayınla</button>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            )}

            {/* ── TAB 2: Link ile İndirim Ekle (Kuyruk Sistemi) ── */}
            {activeTab === 'analyzer' && (
                <div>
                    {/* URL Giriş Kartı - sadece kuyruk yokken göster */}
                    {!queueStatus && (
                        <div className="bg-gray-800 rounded-2xl p-6 border border-purple-500/30 mb-6">
                            <h2 className="text-xl font-bold text-white mb-1">🔗 Link ile İndirim Ekle</h2>
                            <p className="text-gray-400 text-sm mb-4">
                                Ürün linkini yapıştırın ve kuyruğa ekleyin. Arka planda analiz edilip otomatik yayınlanır — uygulamayı kapatabilirsiniz.
                            </p>

                            <div className="flex gap-2">
                                <input
                                    type="url"
                                    value={analyzerUrl}
                                    onChange={e => setAnalyzerUrl(e.target.value)}
                                    placeholder="https://www.trendyol.com/marka/urun-p-123456.html"
                                    className="flex-1 px-4 py-3 bg-gray-900 border border-gray-600 rounded-xl text-white text-sm focus:outline-none focus:border-purple-500 placeholder-gray-600"
                                    onKeyDown={e => { if (e.key === 'Enter' && !isAddingToQueue) addToQueue(); }}
                                />
                                <button
                                    onClick={addToQueue}
                                    disabled={isAddingToQueue || !analyzerUrl.trim()}
                                    className="px-5 py-3 bg-gradient-to-r from-purple-600 to-purple-700 hover:from-purple-500 hover:to-purple-600 text-white font-bold rounded-xl transition-all disabled:opacity-50 flex items-center gap-2 whitespace-nowrap"
                                >
                                    {isAddingToQueue
                                        ? <><div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Ekleniyor...</>
                                        : '➕ Kuyruğa Ekle'}
                                </button>
                            </div>

                            {/* Desteklenen mağazalar */}
                            <div className="grid grid-cols-2 gap-2 mt-4">
                                {['trendyol.com', 'hepsiburada.com', 'amazon.com.tr', 'n11.com', 'ciceksepeti.com', 'temu.com'].map(store => (
                                    <div key={store} className="bg-gray-900/50 border border-gray-700 rounded-lg p-2 text-center">
                                        <p className="text-gray-400 text-xs">✅ {store}</p>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Kuyruk Durum Kartı */}
                    {queueStatus && (
                        <div className="bg-gray-800 rounded-2xl p-6 border border-gray-700">

                            {/* İşleniyor */}
                            {queueStatus === 'running' && (
                                <div className="text-center py-6">
                                    <div className="w-14 h-14 border-4 border-blue-500/30 border-t-blue-500 rounded-full animate-spin mx-auto mb-4" />
                                    <h3 className="text-white font-bold text-lg mb-1">Analiz Ediliyor...</h3>
                                    {analysisStep && (
                                        <p className="text-blue-400 text-sm font-medium mb-2">{analysisStep}</p>
                                    )}
                                    <div className="flex flex-col gap-1 mt-3 text-xs">
                                        {['Ürün sayfası okunuyor...', 'AI analizi yapılıyor...', "Firebase'e yayınlanıyor..."].map(step => (
                                            <span key={step} className={step === analysisStep ? 'text-blue-400 font-semibold' : 'text-gray-600'}>
                                                {step === analysisStep ? '▶' : '○'} {step}
                                            </span>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {/* Tamamlandı */}
                            {queueStatus === 'done' && (
                                <div className="text-center py-8">
                                    <div className="text-6xl mb-4">🎉</div>
                                    <h3 className="text-xl font-bold text-white mb-2">İndirim Yayında!</h3>
                                    <p className="text-gray-400 text-sm mb-6">İlan analiz edildi ve İNDİVA kullanıcılarına gösterilmeye başladı.</p>
                                    <button
                                        onClick={resetQueue}
                                        className="px-6 py-3 bg-purple-600 hover:bg-purple-500 text-white font-bold rounded-xl transition-colors"
                                    >
                                        ➕ Yeni İndirim Ekle
                                    </button>
                                </div>
                            )}

                            {/* Hata */}
                            {queueStatus === 'error' && (
                                <div className="text-center py-6">
                                    <div className="text-5xl mb-4">❌</div>
                                    <h3 className="text-white font-bold text-lg mb-2">Analiz Başarısız</h3>
                                    <p className="text-red-400 text-sm mb-1">{queueError || 'Bir hata oluştu.'}</p>
                                    <p className="text-gray-500 text-xs mb-6">Farklı bir link veya daha sonra tekrar deneyin.</p>
                                    <button
                                        onClick={resetQueue}
                                        className="px-6 py-3 bg-gray-700 hover:bg-gray-600 text-white font-bold rounded-xl transition-colors"
                                    >
                                        🔄 Tekrar Dene
                                    </button>
                                </div>
                            )}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};

export default DealFinder;
