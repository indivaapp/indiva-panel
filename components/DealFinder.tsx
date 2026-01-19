
import React, { useState, useEffect } from 'react';
import { collection, query, where, getDocs, doc, deleteDoc, updateDoc, orderBy, limit } from 'firebase/firestore';
import { db } from '../firebaseConfig';
import type { ViewType } from '../types';

// ScrapedDeal tipi
interface ScrapedDeal {
    id: string;
    title: string;
    description: string;
    newPrice: number;
    oldPrice: number;
    link: string;
    imageUrl?: string;
    storeName?: string;
    status?: string;
    needsReview?: boolean;
    createdAt?: any;
}

// Türkçe karakter düzeltme fonksiyonu
function fixTurkishChars(text: string): string {
    if (!text) return '';

    // HTML entities decode
    const htmlEntities: { [key: string]: string } = {
        '&amp;': '&',
        '&lt;': '<',
        '&gt;': '>',
        '&quot;': '"',
        '&#39;': "'",
        '&#x27;': "'",
        '&nbsp;': ' ',
        '&#8217;': "'",
        '&#8211;': '-',
        '&#8220;': '"',
        '&#8221;': '"',
    };

    let result = text;
    for (const [entity, char] of Object.entries(htmlEntities)) {
        result = result.replace(new RegExp(entity, 'g'), char);
    }

    // Common Turkish character encoding fixes
    const replacements: { [key: string]: string } = {
        'Ä±': 'ı',
        'Ä°': 'İ',
        'ÅŸ': 'ş',
        'Å': 'Ş',
        'ÄŸ': 'ğ',
        'Ä': 'Ğ',
        'Ãœ': 'Ü',
        'Ã¼': 'ü',
        'Ã–': 'Ö',
        'Ã¶': 'ö',
        'Ã‡': 'Ç',
        'Ã§': 'ç',
        'â€™': "'",
        'â€œ': '"',
        'â€': '"',
        'Ã‚': '',
        'Ã¢': 'â',
        '\u0000': '',
    };

    for (const [wrong, correct] of Object.entries(replacements)) {
        result = result.replace(new RegExp(wrong, 'g'), correct);
    }

    // Fazla boşlukları temizle
    result = result.replace(/\s+/g, ' ').trim();

    return result;
}

// Görülen ilanları localStorage'da sakla
const SEEN_DEALS_KEY = 'indiva_seen_deal_ids';

function getSeenDealIds(): Set<string> {
    try {
        const stored = localStorage.getItem(SEEN_DEALS_KEY);
        return new Set(stored ? JSON.parse(stored) : []);
    } catch {
        return new Set();
    }
}

function markDealsAsSeen(dealIds: string[]): void {
    try {
        const seen = getSeenDealIds();
        dealIds.forEach(id => seen.add(id));
        // Son 500 görülen ilanı sakla (bellek tasarrufu)
        const arr = [...seen].slice(-500);
        localStorage.setItem(SEEN_DEALS_KEY, JSON.stringify(arr));
    } catch {
        // localStorage hatası
    }
}

function clearSeenDeals(): void {
    try {
        localStorage.removeItem(SEEN_DEALS_KEY);
    } catch {
        // hata
    }
}

interface DealFinderProps {
    isAdmin: boolean;
    setActiveView?: (view: ViewType) => void;
    setSelectedDeal?: (deal: any) => void;
}

const DealFinder: React.FC<DealFinderProps> = ({ isAdmin, setActiveView, setSelectedDeal }) => {
    // State
    const [deals, setDeals] = useState<ScrapedDeal[]>([]);
    const [allDeals, setAllDeals] = useState<ScrapedDeal[]>([]); // Tüm ilanlar (filtre için)
    const [isLoading, setIsLoading] = useState(false);
    const [isFetching, setIsFetching] = useState(false);
    const [isGeneratingAI, setIsGeneratingAI] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [successMessage, setSuccessMessage] = useState<string | null>(null);
    const [editingDeal, setEditingDeal] = useState<ScrapedDeal | null>(null);
    const [showOnlyNew, setShowOnlyNew] = useState(true); // Sadece yenileri göster
    const [editForm, setEditForm] = useState({
        title: '',
        description: '',
        oldPrice: 0,
        newPrice: 0,
        link: ''
    });

    // Gemini API ile açıklama oluştur
    const generateAIDescription = async () => {
        if (!editingDeal) return;

        setIsGeneratingAI(true);

        try {
            // @ts-ignore
            const GEMINI_API_KEY = (import.meta as any).env?.VITE_GEMINI_API_KEY || '';

            if (!GEMINI_API_KEY) {
                throw new Error('Gemini API key tanımlı değil');
            }

            const storeName = editingDeal.storeName || 'Online Mağaza';
            const price = editForm.newPrice || editingDeal.newPrice || 0;
            const title = editForm.title || editingDeal.title;

            const prompt = `Sen profesyonel bir Türk e-ticaret pazarlamacısısın. Aşağıdaki ürün için çekici bir satış açıklaması yaz.

Ürün: ${title}
Fiyat: ${price} TL
Mağaza: ${storeName}

Kurallar:
- Türkçe yaz, 50-80 kelime olsun
- Ürünün faydalarını vurgula
- ${price} TL fiyatın iyi bir fırsat olduğunu belirt
- ${storeName}'ın güvenilirliğini vurgula
- 2-3 emoji kullan (🔥 💰 ⭐ ✨ 🎁)
- Aciliyet hissi yarat (stoklar sınırlı vb.)
- Doğrudan açıklamayı yaz, başka bir şey ekleme`;

            const response = await fetch(
                `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        contents: [{ parts: [{ text: prompt }] }],
                        generationConfig: {
                            temperature: 0.8,
                            maxOutputTokens: 300
                        }
                    })
                }
            );

            if (!response.ok) {
                throw new Error(`API hatası: ${response.status}`);
            }

            const data = await response.json();
            const generatedText = data.candidates?.[0]?.content?.parts?.[0]?.text || '';

            if (generatedText) {
                setEditForm(prev => ({ ...prev, description: generatedText.trim() }));
                setSuccessMessage('✨ AI açıklama oluşturdu!');
                setTimeout(() => setSuccessMessage(null), 2000);
            } else {
                throw new Error('AI yanıt vermedi');
            }
        } catch (err: any) {
            console.error('AI hatası:', err);
            setError('AI açıklama oluşturulamadı: ' + err.message);
            setTimeout(() => setError(null), 3000);
        } finally {
            setIsGeneratingAI(false);
        }
    };

    // Sayfa yüklendiğinde ilanları çek
    useEffect(() => {
        loadDeals();
    }, []);

    // Firebase'den draft ilanları çek
    const loadDeals = async () => {
        setIsLoading(true);
        setError(null);

        try {
            const q = query(
                collection(db, 'discounts'),
                where('status', '==', 'draft'),
                orderBy('createdAt', 'desc'),
                limit(50)
            );

            const snapshot = await getDocs(q);
            const seenIds = getSeenDealIds();

            let fetchedDeals: ScrapedDeal[] = snapshot.docs.map(docSnap => {
                const data = docSnap.data();
                return {
                    id: docSnap.id,
                    title: fixTurkishChars(data.title || ''),
                    description: data.description || '',
                    newPrice: data.newPrice || 0,
                    oldPrice: data.oldPrice || 0,
                    link: data.link || '',
                    imageUrl: data.imageUrl || '',
                    storeName: data.storeName || 'Mağaza',
                    status: data.status,
                    needsReview: data.needsReview,
                    createdAt: data.createdAt
                };
            });

            setAllDeals(fetchedDeals);

            // Sadece yeni (görülmemiş) ilanları filtrele
            const newDeals = fetchedDeals.filter(d => !seenIds.has(d.id));

            if (showOnlyNew) {
                setDeals(newDeals);
            } else {
                setDeals(fetchedDeals);
            }

            if (newDeals.length === 0 && fetchedDeals.length > 0) {
                setError(`Tüm ilanları gördünüz! (${fetchedDeals.length} ilan mevcut)`);
            } else if (fetchedDeals.length === 0) {
                setError('Bekleyen taslak yok. "Yeni İndirim Çek" butonuna tıklayın.');
            }
        } catch (err: any) {
            console.error('Firebase hatası:', err);
            setError(err.message || 'Veriler çekilirken bir hata oluştu.');
        } finally {
            setIsLoading(false);
        }
    };

    // GitHub Actions Workflow'u tetikle
    const triggerGitHubWorkflow = async () => {
        setIsFetching(true);
        setError(null);

        try {
            // @ts-ignore
            const GITHUB_TOKEN = (import.meta as any).env?.VITE_GITHUB_TOKEN || '';
            const REPO_OWNER = 'AdemHan';
            const REPO_NAME = 'indiva-app';
            const WORKFLOW_ID = 'auto-publish.yml';

            if (!GITHUB_TOKEN) {
                throw new Error('GitHub token tanımlı değil. VITE_GITHUB_TOKEN environment variable ekleyin.');
            }

            const response = await fetch(
                `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/actions/workflows/${WORKFLOW_ID}/dispatches`,
                {
                    method: 'POST',
                    headers: {
                        'Accept': 'application/vnd.github.v3+json',
                        'Authorization': `token ${GITHUB_TOKEN}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        ref: 'main'
                    })
                }
            );

            if (response.status === 204) {
                setSuccessMessage('✅ GitHub Actions tetiklendi! 30 saniye sonra otomatik yenilenecek...');
                // 30 saniye sonra verileri yenile
                setTimeout(() => {
                    loadDeals();
                    setSuccessMessage(null);
                }, 30000);
            } else if (response.status === 401 || response.status === 403) {
                throw new Error('GitHub token geçersiz veya workflow yetkisi yok.');
            } else {
                const errorData = await response.json();
                throw new Error(errorData.message || `HTTP ${response.status}`);
            }
        } catch (err: any) {
            console.error('GitHub API hatası:', err);
            setError('Workflow tetiklenemedi: ' + err.message);
        } finally {
            setIsFetching(false);
        }
    };

    // Tüm ilanları göster/gizle toggle
    const toggleShowAll = () => {
        if (showOnlyNew) {
            // Tümünü göster
            setDeals(allDeals);
            setShowOnlyNew(false);
        } else {
            // Sadece yenileri göster
            const seenIds = getSeenDealIds();
            setDeals(allDeals.filter(d => !seenIds.has(d.id)));
            setShowOnlyNew(true);
        }
    };

    // Tümünü görüldü olarak işaretle
    const markAllAsSeen = () => {
        const dealIds = deals.map(d => d.id);
        markDealsAsSeen(dealIds);
        setDeals([]);
        setSuccessMessage('Tüm ilanlar görüldü olarak işaretlendi');
        setTimeout(() => setSuccessMessage(null), 3000);
    };

    // Görüldü geçmişini temizle
    const resetSeenHistory = () => {
        clearSeenDeals();
        setDeals(allDeals);
        setShowOnlyNew(true);
        setSuccessMessage('Görüldü geçmişi temizlendi');
        setTimeout(() => setSuccessMessage(null), 3000);
    };

    // Düzenlemeye başla
    const startEditing = (deal: ScrapedDeal) => {
        // İlanı görüldü olarak işaretle
        markDealsAsSeen([deal.id]);

        setEditingDeal(deal);
        setEditForm({
            title: deal.title,
            description: deal.description,
            oldPrice: deal.oldPrice,
            newPrice: deal.newPrice,
            link: deal.link
        });
    };

    // Düzenlemeyi kaydet ve yayınla
    const saveAndPublish = async () => {
        if (!editingDeal) return;

        try {
            setIsLoading(true);

            await updateDoc(doc(db, 'discounts', editingDeal.id), {
                title: editForm.title,
                description: editForm.description,
                oldPrice: editForm.oldPrice,
                newPrice: editForm.newPrice,
                link: editForm.link,
                status: 'published',
                needsReview: false,
                publishedAt: new Date()
            });

            setSuccessMessage('✅ İlan yayınlandı!');
            setEditingDeal(null);

            // Listeden kaldır
            setDeals(prev => prev.filter(d => d.id !== editingDeal.id));
            setAllDeals(prev => prev.filter(d => d.id !== editingDeal.id));
        } catch (err: any) {
            console.error('Kaydetme hatası:', err);
            setError('Kaydetme hatası: ' + err.message);
        } finally {
            setIsLoading(false);
            setTimeout(() => setSuccessMessage(null), 3000);
        }
    };

    // İlanı sil
    const deleteDeal = async (dealId: string) => {
        if (!confirm('Bu ilanı silmek istediğinize emin misiniz?')) return;

        try {
            await deleteDoc(doc(db, 'discounts', dealId));
            markDealsAsSeen([dealId]); // Silinen de görüldü sayılsın
            setDeals(prev => prev.filter(d => d.id !== dealId));
            setAllDeals(prev => prev.filter(d => d.id !== dealId));
            setSuccessMessage('İlan silindi');
            setTimeout(() => setSuccessMessage(null), 3000);
        } catch (err: any) {
            console.error('Silme hatası:', err);
        }
    };

    // Admin değilse erişim yok
    if (!isAdmin) {
        return (
            <div className="flex items-center justify-center h-96">
                <p className="text-red-400">Bu sayfaya erişim yetkiniz yok.</p>
            </div>
        );
    }

    return (
        <div className="max-w-4xl mx-auto px-4 py-6">
            {/* Başlık */}
            <div className="mb-6">
                <h1 className="text-2xl font-bold text-white mb-1 flex items-center gap-2">
                    📥 Taslak İlanlar
                    {deals.length > 0 && (
                        <span className="bg-orange-500 text-white text-sm px-2 py-0.5 rounded-full">
                            {deals.length} yeni
                        </span>
                    )}
                </h1>
                <p className="text-gray-400 text-sm">
                    {showOnlyNew ? 'Sadece yeni ilanlar gösteriliyor' : `Tüm taslaklar gösteriliyor (${allDeals.length})`}
                </p>
            </div>

            {/* Üst butonlar */}
            <div className="flex gap-2 mb-4">
                <button
                    onClick={triggerGitHubWorkflow}
                    disabled={isFetching}
                    className="flex-1 py-3 px-4 bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-500 hover:to-blue-600 text-white font-bold rounded-xl shadow-lg transition-all duration-300 disabled:opacity-50 flex items-center justify-center gap-2"
                >
                    {isFetching ? (
                        <>
                            <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                            Çekiliyor...
                        </>
                    ) : (
                        <>🚀 Yeni İndirim Çek</>
                    )}
                </button>

                <button
                    onClick={loadDeals}
                    disabled={isLoading}
                    className="py-3 px-4 bg-gray-700 hover:bg-gray-600 text-white rounded-xl transition-colors disabled:opacity-50"
                    title="Yenile"
                >
                    🔄
                </button>
            </div>

            {/* Filtre butonları */}
            <div className="flex gap-2 mb-4 flex-wrap">
                <button
                    onClick={toggleShowAll}
                    className={`px-3 py-1.5 rounded-lg text-sm transition-colors ${showOnlyNew
                        ? 'bg-blue-500/20 text-blue-400 border border-blue-500/50'
                        : 'bg-gray-700 text-gray-400'
                        }`}
                >
                    {showOnlyNew ? '👁️ Tümünü Göster' : '✨ Sadece Yeniler'}
                </button>

                {deals.length > 0 && (
                    <button
                        onClick={markAllAsSeen}
                        className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 text-gray-400 rounded-lg text-sm transition-colors"
                    >
                        ✓ Tümünü Görüldü Yap
                    </button>
                )}

                <button
                    onClick={resetSeenHistory}
                    className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 text-gray-400 rounded-lg text-sm transition-colors"
                >
                    🗑️ Geçmişi Sıfırla
                </button>
            </div>

            {/* Mesajlar */}
            {successMessage && (
                <div className="mb-4 p-4 bg-green-500/20 border border-green-500/30 rounded-lg text-green-400">
                    {successMessage}
                </div>
            )}

            {error && (
                <div className="mb-4 p-4 bg-yellow-500/20 border border-yellow-500/30 rounded-lg text-yellow-400">
                    {error}
                </div>
            )}

            {/* Yükleniyor */}
            {isLoading && !editingDeal && (
                <div className="text-center py-10">
                    <div className="inline-block w-8 h-8 border-2 border-blue-500/30 border-t-blue-500 rounded-full animate-spin"></div>
                    <p className="text-gray-400 mt-4">Yükleniyor...</p>
                </div>
            )}

            {/* Düzenleme Modal */}
            {editingDeal && (
                <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4">
                    <div className="bg-gray-800 rounded-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
                        <div className="p-6">
                            <h2 className="text-xl font-bold text-white mb-4">📝 İlanı Düzenle</h2>

                            {editingDeal.imageUrl && (
                                <img
                                    src={editingDeal.imageUrl}
                                    alt=""
                                    className="w-full h-40 object-cover rounded-lg mb-4"
                                />
                            )}

                            <div className="space-y-4">
                                <div>
                                    <label className="block text-gray-400 text-sm mb-1">Başlık</label>
                                    <input
                                        type="text"
                                        value={editForm.title}
                                        onChange={(e) => setEditForm(prev => ({ ...prev, title: e.target.value }))}
                                        className="w-full px-4 py-3 bg-gray-900 border border-gray-600 rounded-lg text-white focus:outline-none focus:border-blue-500"
                                    />
                                </div>

                                <div>
                                    <div className="flex items-center justify-between mb-1">
                                        <label className="block text-gray-400 text-sm">Açıklama</label>
                                        <button
                                            type="button"
                                            onClick={generateAIDescription}
                                            disabled={isGeneratingAI}
                                            className="px-3 py-1 bg-purple-600 hover:bg-purple-500 text-white text-xs rounded-lg transition-colors disabled:opacity-50 flex items-center gap-1"
                                        >
                                            {isGeneratingAI ? (
                                                <>
                                                    <div className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                                                    Oluşturuluyor...
                                                </>
                                            ) : (
                                                <>✨ AI ile Yaz</>
                                            )}
                                        </button>
                                    </div>
                                    <textarea
                                        value={editForm.description}
                                        onChange={(e) => setEditForm(prev => ({ ...prev, description: e.target.value }))}
                                        rows={4}
                                        placeholder="Ürün açıklamasını buraya yazın veya AI ile oluşturun..."
                                        className="w-full px-4 py-3 bg-gray-900 border border-gray-600 rounded-lg text-white focus:outline-none focus:border-blue-500 resize-none"
                                    />
                                </div>

                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <label className="block text-gray-400 text-sm mb-1">Eski Fiyat (TL)</label>
                                        <input
                                            type="number"
                                            value={editForm.oldPrice || ''}
                                            onChange={(e) => setEditForm(prev => ({ ...prev, oldPrice: Number(e.target.value) }))}
                                            placeholder="0"
                                            className="w-full px-4 py-3 bg-gray-900 border border-gray-600 rounded-lg text-white focus:outline-none focus:border-blue-500"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-gray-400 text-sm mb-1">Yeni Fiyat (TL)</label>
                                        <input
                                            type="number"
                                            value={editForm.newPrice || ''}
                                            onChange={(e) => setEditForm(prev => ({ ...prev, newPrice: Number(e.target.value) }))}
                                            className="w-full px-4 py-3 bg-gray-900 border border-gray-600 rounded-lg text-white focus:outline-none focus:border-blue-500"
                                        />
                                    </div>
                                </div>

                                <div>
                                    <label className="block text-gray-400 text-sm mb-1">Ürün Linki</label>
                                    <input
                                        type="url"
                                        value={editForm.link}
                                        onChange={(e) => setEditForm(prev => ({ ...prev, link: e.target.value }))}
                                        placeholder="https://..."
                                        className="w-full px-4 py-3 bg-gray-900 border border-gray-600 rounded-lg text-white focus:outline-none focus:border-blue-500"
                                    />
                                    <a
                                        href={editForm.link}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="text-blue-400 text-sm mt-1 inline-block hover:underline"
                                    >
                                        🔗 Linki Aç
                                    </a>
                                </div>
                            </div>

                            <div className="flex gap-3 mt-6">
                                <button
                                    onClick={() => setEditingDeal(null)}
                                    className="flex-1 py-3 bg-gray-700 hover:bg-gray-600 text-white rounded-lg transition-colors"
                                >
                                    İptal
                                </button>
                                <button
                                    onClick={saveAndPublish}
                                    disabled={isLoading || !editForm.title || !editForm.description}
                                    className="flex-1 py-3 bg-green-600 hover:bg-green-500 text-white font-bold rounded-lg transition-colors disabled:opacity-50"
                                >
                                    ✅ Kaydet ve Yayınla
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* İlan Listesi */}
            {!isLoading && deals.length > 0 && (
                <div className="space-y-3">
                    {deals.map((deal) => (
                        <div
                            key={deal.id}
                            onClick={() => startEditing(deal)}
                            className="bg-gray-800 rounded-xl p-4 cursor-pointer hover:bg-gray-750 transition-colors border border-gray-700 hover:border-blue-500/50"
                        >
                            <div className="flex gap-4">
                                <div className="w-20 h-20 flex-shrink-0 bg-gray-700 rounded-lg overflow-hidden">
                                    {deal.imageUrl ? (
                                        <img
                                            src={deal.imageUrl}
                                            alt=""
                                            className="w-full h-full object-cover"
                                            onError={(e) => {
                                                (e.target as HTMLImageElement).src = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect fill="%23374151" width="100" height="100"/><text x="50" y="55" text-anchor="middle" fill="%239CA3AF" font-size="30">📷</text></svg>';
                                            }}
                                        />
                                    ) : (
                                        <div className="w-full h-full flex items-center justify-center text-2xl">📷</div>
                                    )}
                                </div>

                                <div className="flex-1 min-w-0">
                                    <h3 className="text-white font-medium line-clamp-2 text-sm mb-1">
                                        {deal.title}
                                    </h3>
                                    <div className="flex items-center gap-2 text-sm">
                                        <span className="text-orange-400 font-bold">
                                            {deal.newPrice > 0 ? `${deal.newPrice.toLocaleString('tr-TR')}₺` : 'Fiyat yok'}
                                        </span>
                                        <span className="text-gray-500">•</span>
                                        <span className="text-gray-500">{deal.storeName}</span>
                                    </div>
                                    {!deal.description && (
                                        <span className="text-xs text-yellow-500 mt-1 inline-block">⚠️ Açıklama gerekli</span>
                                    )}
                                </div>

                                <button
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        deleteDeal(deal.id);
                                    }}
                                    className="flex-shrink-0 w-8 h-8 bg-red-500/20 hover:bg-red-500/30 text-red-400 rounded-lg flex items-center justify-center transition-colors"
                                >
                                    🗑️
                                </button>
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {/* Boş durum */}
            {!isLoading && deals.length === 0 && !error && (
                <div className="text-center py-16 bg-gray-800/50 rounded-2xl border border-gray-700">
                    <div className="text-6xl mb-4">🎉</div>
                    <h2 className="text-xl font-bold text-white mb-2">Tüm yeni ilanları gördünüz!</h2>
                    <p className="text-gray-400 mb-4">
                        "Yeni İndirim Çek" ile daha fazla veri çekebilirsiniz
                    </p>
                </div>
            )}
        </div>
    );
};

export default DealFinder;
