/**
 * ShareUrlTarget — Android'den Link Paylaşım Overlay'i
 * ─────────────────────────────────────────────────────────────────────────────
 * Kullanıcı Trendyol / Hepsiburada vb.'den "Paylaş → İNDİVA Panel" dediğinde
 * bu overlay açılır, linki otomatik analiz edip Firebase'e yayınlar.
 */

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { addDoc, collection, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebaseConfig';

// ─── Tipler ───────────────────────────────────────────────────────────────────

type Stage = 'reading' | 'analyzing' | 'publishing' | 'success' | 'error';

interface StageInfo { label: string; emoji: string; progress: number; color: string; }

const STAGES: Record<Stage, StageInfo> = {
    reading:    { label: 'Ürün sayfası okunuyor...',      emoji: '🌐', progress: 20,  color: 'bg-blue-500' },
    analyzing:  { label: 'AI analiz ediyor...',           emoji: '🤖', progress: 60,  color: 'bg-purple-500' },
    publishing: { label: "Firebase'e yayınlanıyor...",    emoji: '🚀', progress: 90,  color: 'bg-orange-500' },
    success:    { label: 'Yayınlandı!',                   emoji: '✅', progress: 100, color: 'bg-green-500' },
    error:      { label: 'Hata oluştu',                   emoji: '❌', progress: 0,   color: 'bg-red-500' },
};

const AUTO_CLOSE_MS = 3000;

interface Result {
    title: string;
    newPrice: number;
    oldPrice: number;
    discountPercent: number;
    category: string;
    storeName: string;
    imageUrl: string;
}

interface Props {
    url: string;
    onClose: () => void;
}

// ─── Yardımcılar ──────────────────────────────────────────────────────────────

function detectStore(url: string): string {
    if (url.includes('trendyol') || url.includes('ty.gl')) return 'Trendyol';
    if (url.includes('hepsiburada') || url.includes('hb.biz')) return 'Hepsiburada';
    if (url.includes('amazon') || url.includes('amzn.to')) return 'Amazon';
    if (url.includes('n11.com')) return 'N11';
    if (url.includes('ciceksepeti')) return 'Çiçeksepeti';
    if (url.includes('temu.com')) return 'Temu';
    return 'Online Mağaza';
}

// ─── Bileşen ──────────────────────────────────────────────────────────────────

const ShareUrlTarget: React.FC<Props> = ({ url, onClose }) => {
    const [stage, setStage]   = useState<Stage>('reading');
    const [error, setError]   = useState('');
    const [result, setResult] = useState<Result | null>(null);
    const hasStarted          = useRef(false);

    const run = useCallback(async () => {
        try {
            const GEMINI_KEY = (import.meta as any).env?.VITE_GEMINI_API_KEY || '';
            const storeName  = detectStore(url);

            // ── 1. Vercel proxy → yapılandırılmış veri ────────────────────────
            setStage('reading');
            let title = '', imageUrl = '', newPrice = 0, oldPrice = 0, brand = '';
            let proxySuccess = false;

            try {
                const res = await fetch(
                    `https://indiva-proxy.vercel.app/api/scrape?action=product&url=${encodeURIComponent(url)}`,
                    { signal: AbortSignal.timeout(35000) }
                );
                if (res.ok) {
                    const data = await res.json();
                    if (data.success && data.product) {
                        const p = data.product;
                        title    = p.title    || '';
                        imageUrl = p.imageUrl || '';
                        newPrice = p.newPrice || 0;
                        oldPrice = p.oldPrice || 0;
                        brand    = p.brand    || storeName;
                        proxySuccess = !!(title && newPrice > 0);
                    }
                }
            } catch (e) { console.warn('Proxy hatası:', e); }

            // ── 2. Görsel yoksa Jina dene ─────────────────────────────────────
            if (!imageUrl) {
                try {
                    const r = await fetch(`https://r.jina.ai/${url}`, {
                        headers: { Accept: 'application/json' },
                        signal: AbortSignal.timeout(8000),
                    });
                    if (r.ok) {
                        const j = await r.json();
                        imageUrl = j?.data?.ogImage || j?.data?.image || '';
                    }
                } catch {}
            }

            // ── 3. Gemini → içerik zenginleştir / fallback ────────────────────
            setStage('analyzing');
            let cleanTitle = title, category = 'Diğer', description = '', aiFomoScore = 5;
            let discountPercent = oldPrice > newPrice && newPrice > 0
                ? Math.round(((oldPrice - newPrice) / oldPrice) * 100) : 0;

            if (GEMINI_KEY) {
                let prompt: string;
                if (proxySuccess) {
                    prompt = `Ürün bilgileri:
- Ham başlık: "${title}"
- Fiyat: ${newPrice} TL${oldPrice > 0 ? ` (eski: ${oldPrice} TL)` : ''}
- Mağaza: ${storeName}

Ham başlık URL slug'dan gelmiş olabilir. Düzelt.
SADECE JSON döndür:
{
  "title": "Düzgün ürün başlığı, Title Case, max 80 karakter",
  "cleanTitle": "Kısa başlık, max 50 karakter",
  "category": "Teknoloji/Giyim/Ev & Yaşam/Market/Kozmetik/Anne & Bebek/Spor/Kitap/Sağlık/Pet/Otomotiv/Diğer",
  "description": "2-3 cümle etkileyici Türkçe, FOMO içerecek",
  "aiFomoScore": 1-10
}`;
                } else {
                    let pageContent = `URL: ${url}\nMağaza: ${storeName}`;
                    try {
                        const r = await fetch(`https://r.jina.ai/${url}`, {
                            headers: { Accept: 'text/plain' },
                            signal: AbortSignal.timeout(20000),
                        });
                        if (r.ok) pageContent = (await r.text()).substring(0, 8000);
                    } catch {}

                    prompt = `E-ticaret ürün sayfasını analiz et:
URL: ${url}
Mağaza: ${storeName}
SAYFA İÇERİĞİ:
${pageContent}

SADECE JSON döndür:
{
  "title": "ürün başlığı, Title Case, max 80 karakter",
  "cleanTitle": "kısa başlık, max 50 karakter",
  "newPrice": indirimli fiyat (sayı TL),
  "oldPrice": orijinal fiyat (sayı TL, yoksa 0),
  "category": "Teknoloji/Giyim/Ev & Yaşam/Market/Kozmetik/Anne & Bebek/Spor/Kitap/Sağlık/Pet/Otomotiv/Diğer",
  "description": "2-3 cümle etkileyici Türkçe, FOMO içerecek",
  "aiFomoScore": 1-10
}`;
                }

                try {
                    const r = await fetch(
                        'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=' + GEMINI_KEY,
                        {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                contents: [{ role: 'user', parts: [{ text: prompt }] }],
                                generationConfig: { temperature: 0.2, responseMimeType: 'application/json' },
                            }),
                        }
                    );
                    if (r.ok) {
                        const data = await r.json();
                        const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
                        const m    = text.match(/\{[\s\S]*\}/);
                        if (m) {
                            const ai = JSON.parse(m[0]);
                            if (ai.title) title = ai.title;
                            cleanTitle      = ai.cleanTitle || title;
                            category        = ai.category   || 'Diğer';
                            description     = ai.description || '';
                            aiFomoScore     = ai.aiFomoScore || 5;
                            if (!proxySuccess) {
                                newPrice        = parseFloat(String(ai.newPrice || 0)) || 0;
                                oldPrice        = parseFloat(String(ai.oldPrice || 0)) || 0;
                                discountPercent = ai.discountPercent || 0;
                            }
                        }
                    }
                } catch (e) { console.warn('Gemini hatası:', e); }
            }

            if (!title && !newPrice) throw new Error('Ürün bilgisi alınamadı.');

            if (oldPrice === 0 && newPrice > 0) oldPrice = Math.round(newPrice * 1.3);
            if (discountPercent === 0 && oldPrice > newPrice && newPrice > 0)
                discountPercent = Math.round(((oldPrice - newPrice) / oldPrice) * 100);

            // ── 4. Firebase ───────────────────────────────────────────────────
            setStage('publishing');
            await addDoc(collection(db, 'discounts'), {
                title:           title || 'Ürün',
                cleanTitle:      cleanTitle || title || 'Ürün',
                newPrice,
                oldPrice,
                discountPercent,
                category,
                description,
                aiFomoScore,
                imageUrl,
                link:            url,
                originalStoreLink: url,
                storeName,
                brand:           brand || storeName,
                status:          'aktif',
                source:          'share_target',
                createdAt:       serverTimestamp(),
            });

            setResult({ title, newPrice, oldPrice, discountPercent, category, storeName, imageUrl });
            setStage('success');
            setTimeout(onClose, AUTO_CLOSE_MS);

        } catch (err: any) {
            setError(err.message || 'Bilinmeyen hata');
            setStage('error');
        }
    }, [url, onClose]);

    useEffect(() => {
        if (hasStarted.current) return;
        hasStarted.current = true;
        run();
    }, [run]);

    const info     = STAGES[stage];
    const isActive = stage !== 'success' && stage !== 'error';

    return (
        <div
            className="fixed inset-0 z-50 flex items-end justify-center px-4 pb-8"
            style={{ backgroundColor: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(4px)' }}
        >
            <div
                className="w-full max-w-sm bg-gray-800 rounded-2xl shadow-2xl border border-gray-700 overflow-hidden"
                style={{ animation: 'slideUp 0.35s cubic-bezier(0.34,1.56,0.64,1)' }}
            >
                {/* Drag handle */}
                <div className="flex justify-center pt-3 pb-1">
                    <div className="w-10 h-1 bg-gray-600 rounded-full" />
                </div>

                <div className="px-5 pt-3 pb-6 space-y-4">
                    {/* Başlık */}
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-purple-600 rounded-xl flex items-center justify-center text-lg shadow">
                            🔗
                        </div>
                        <div className="flex-1 min-w-0">
                            <p className="text-white font-bold text-sm">İNDİVA Panel</p>
                            <p className="text-gray-400 text-xs truncate">{url.replace(/^https?:\/\//, '').substring(0, 45)}…</p>
                        </div>
                        {!isActive && (
                            <button onClick={onClose} className="text-gray-500 hover:text-gray-300 text-2xl leading-none">×</button>
                        )}
                    </div>

                    {/* İlerleme */}
                    {stage !== 'error' && (
                        <div>
                            <div className="flex items-center justify-between mb-1.5">
                                <span className="text-gray-300 text-xs flex items-center gap-1.5">
                                    {isActive && <span className="inline-block w-3 h-3 border-2 border-gray-400 border-t-purple-400 rounded-full animate-spin" />}
                                    {info.emoji} {info.label}
                                </span>
                                <span className="text-gray-500 text-xs font-mono">{info.progress}%</span>
                            </div>
                            <div className="h-2 bg-gray-700 rounded-full overflow-hidden">
                                <div
                                    className={`h-full rounded-full transition-all duration-700 ease-out ${info.color}`}
                                    style={{ width: `${info.progress}%` }}
                                />
                            </div>
                        </div>
                    )}

                    {/* Adımlar */}
                    {isActive && (
                        <div className="space-y-1.5 text-xs">
                            {([
                                ['reading',    'Ürün sayfası ve fiyat okunuyor'],
                                ['analyzing',  'AI başlık, kategori ve açıklama üretiyor'],
                                ['publishing', "Firebase'e yayınlanıyor"],
                            ] as [Stage, string][]).map(([s, label]) => {
                                const stages: Stage[] = ['reading', 'analyzing', 'publishing', 'success'];
                                const done   = stages.indexOf(stage) > stages.indexOf(s);
                                const active = stage === s;
                                return (
                                    <div key={s} className={`flex items-center gap-2 transition-colors ${active ? 'text-purple-400' : done ? 'text-green-500' : 'text-gray-600'}`}>
                                        <span className="w-4 text-center">{done ? '✓' : active ? '▶' : '○'}</span>
                                        <span className={active ? 'font-medium' : ''}>{label}</span>
                                    </div>
                                );
                            })}
                        </div>
                    )}

                    {/* Başarı */}
                    {stage === 'success' && result && (
                        <div className="bg-green-950/40 border border-green-800/50 rounded-xl p-4 space-y-3">
                            <p className="text-green-400 font-bold text-sm">✅ İNDİVA'da yayınlandı!</p>
                            {result.imageUrl && (
                                <img src={result.imageUrl} alt="" className="w-full h-32 object-contain rounded-lg bg-gray-900" />
                            )}
                            <p className="text-white text-sm font-medium leading-snug line-clamp-2">{result.title}</p>
                            <div className="flex gap-3 items-center flex-wrap">
                                <span className="text-green-400 font-bold text-lg">{result.newPrice.toLocaleString('tr-TR')} TL</span>
                                {result.oldPrice > result.newPrice && (
                                    <span className="text-gray-500 text-sm line-through">{result.oldPrice.toLocaleString('tr-TR')} TL</span>
                                )}
                                {result.discountPercent > 0 && (
                                    <span className="bg-orange-600 text-white text-xs px-2 py-0.5 rounded-full font-bold">%{result.discountPercent} İNDİRİM</span>
                                )}
                            </div>
                            <div className="flex gap-2 flex-wrap">
                                <span className="bg-gray-700 text-gray-300 text-xs px-2 py-0.5 rounded-full">{result.storeName}</span>
                                {result.category !== 'Diğer' && (
                                    <span className="bg-gray-700 text-gray-300 text-xs px-2 py-0.5 rounded-full">{result.category}</span>
                                )}
                            </div>
                        </div>
                    )}

                    {/* Hata */}
                    {stage === 'error' && (
                        <div className="space-y-3">
                            <div className="bg-red-950/50 border border-red-800/60 rounded-xl p-4">
                                <p className="text-red-400 font-semibold text-sm mb-1">❌ Analiz başarısız</p>
                                <p className="text-gray-300 text-xs leading-relaxed">{error}</p>
                            </div>
                            <div className="flex gap-2">
                                <button
                                    onClick={() => { hasStarted.current = false; setStage('reading'); setError(''); run(); }}
                                    className="flex-1 py-2.5 bg-purple-600 hover:bg-purple-500 text-white text-sm font-medium rounded-xl transition-colors"
                                >
                                    Tekrar Dene
                                </button>
                                <button
                                    onClick={onClose}
                                    className="flex-1 py-2.5 bg-gray-700 hover:bg-gray-600 text-gray-300 text-sm rounded-xl transition-colors"
                                >
                                    Kapat
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            </div>

            <style>{`
                @keyframes slideUp {
                    from { transform: translateY(120px); opacity: 0; }
                    to   { transform: translateY(0);     opacity: 1; }
                }
            `}</style>
        </div>
    );
};

export default ShareUrlTarget;
