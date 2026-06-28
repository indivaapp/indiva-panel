/**
 * QuickShareOverlay — Hızlı Story Paylaşımı
 *
 * ShareActivity tarafından açılan şeffaf overlay.
 * Kullanıcı etkileşimi gerektirmez: görsel + pano linki → ImgBB yükleme → Firebase story → kapat.
 */

import React, { useEffect, useRef, useState } from 'react';
import { addInfluencerStory } from '../services/firebase';
import { uploadToImgbb } from '../services/imgbb';

type Stage = 'reading' | 'uploading' | 'publishing' | 'success' | 'error';

const STAGE_INFO: Record<Stage, { label: string; progress: number; color: string }> = {
    reading:    { label: 'Görsel ve link okunuyor...',  progress: 20,  color: 'bg-blue-500' },
    uploading:  { label: 'Görsel yükleniyor...',        progress: 55,  color: 'bg-yellow-500' },
    publishing: { label: 'Story yayınlanıyor...',       progress: 85,  color: 'bg-orange-500' },
    success:    { label: 'Story yayınlandı! ✅',        progress: 100, color: 'bg-green-500' },
    error:      { label: 'Hata oluştu',                 progress: 0,   color: 'bg-red-500' },
};

const AUTO_CLOSE_MS = 2200;

declare global {
    interface Window {
        INDIVAShareMode?: { isShareMode: () => boolean };
        AndroidShareHandler?: {
            getSharedImage:  () => string;
            getClipboardUrl: () => string;
            getSharedText:   () => string;
            finishActivity:  () => void;
        };
    }
}

const QuickShareOverlay: React.FC = () => {
    const [stage, setStage]       = useState<Stage>('reading');
    const [errorMsg, setErrorMsg] = useState('');
    const [imageUrl, setImageUrl] = useState('');
    const [link, setLink]         = useState('');
    const hasRun = useRef(false);

    const finish = () => {
        try { window.AndroidShareHandler?.finishActivity(); } catch {}
    };

    useEffect(() => {
        if (hasRun.current) return;
        hasRun.current = true;

        const run = async () => {
            try {
                // ── 1. Görseli al ──────────────────────────────────────────────
                setStage('reading');

                // Warm-start: 'sharedImage' event bekleniyor olabilir; önce doğrudan dene
                let base64 = '';
                const tryGet = () => window.AndroidShareHandler?.getSharedImage?.() || '';

                base64 = tryGet();
                if (!base64) {
                    // Event henüz gelmemişse kısa bekle
                    await new Promise<void>((resolve) => {
                        const handler = () => { window.removeEventListener('sharedImage', handler); resolve(); };
                        window.addEventListener('sharedImage', handler);
                        setTimeout(resolve, 3000); // max 3 saniye bekle
                    });
                    base64 = tryGet();
                }

                if (!base64) throw new Error('Paylaşılan görsel alınamadı. Tekrar deneyin.');

                // Pano linki
                const clipUrl = window.AndroidShareHandler?.getClipboardUrl?.() || '';
                setLink(clipUrl);

                // ── 2. ImgBB'ye yükle ─────────────────────────────────────────
                setStage('uploading');

                const byteChars = atob(base64);
                const byteArr   = new Uint8Array(byteChars.length).map((_, i) => byteChars.charCodeAt(i));
                const blob      = new Blob([byteArr], { type: 'image/jpeg' });
                const file      = new File([blob], `story-${Date.now()}.jpg`, { type: 'image/jpeg' });

                const { downloadURL } = await uploadToImgbb(file);
                setImageUrl(downloadURL);

                // ── 3. Firebase'e story kaydet ────────────────────────────────
                setStage('publishing');

                const expiresAt = new Date();
                expiresAt.setHours(expiresAt.getHours() + 24);

                await addInfluencerStory({
                    productImage:  downloadURL,
                    affiliateLink: clipUrl,
                    discountCode:  '',
                    isActive:      true,
                    expiresAt,
                });

                // ── 4. Başarı → otomatik kapat ────────────────────────────────
                setStage('success');
                setTimeout(finish, AUTO_CLOSE_MS);

            } catch (err: any) {
                setErrorMsg(err?.message || 'Bilinmeyen hata.');
                setStage('error');
            }
        };

        run();
    }, []);

    const info     = STAGE_INFO[stage];
    const spinning = stage !== 'success' && stage !== 'error';

    return (
        /* Yarı-karanlık arka plan — arkadaki uygulama hâlâ görünür */
        <div
            className="fixed inset-0 z-50 flex items-end justify-center px-4 pb-10"
            style={{ backgroundColor: 'rgba(0,0,0,0.72)', backdropFilter: 'blur(3px)' }}
        >
            {/* Alt kart */}
            <div
                className="w-full max-w-sm bg-gray-900 rounded-2xl border border-gray-700 shadow-2xl overflow-hidden"
                style={{ animation: 'slideUp 0.3s cubic-bezier(0.34,1.56,0.64,1)' }}
            >
                {/* Tutaç */}
                <div className="flex justify-center pt-3 pb-1">
                    <div className="w-10 h-1 bg-gray-600 rounded-full" />
                </div>

                <div className="px-5 pt-2 pb-6 space-y-4">
                    {/* Başlık */}
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-indigo-600 rounded-xl flex items-center justify-center text-lg">
                            📸
                        </div>
                        <div>
                            <p className="text-white font-bold text-sm">İNDİVA Panel</p>
                            <p className="text-gray-400 text-xs">Story paylaşılıyor...</p>
                        </div>
                        {stage === 'error' && (
                            <button onClick={finish} className="ml-auto text-gray-500 text-xl">×</button>
                        )}
                    </div>

                    {/* İlerleme */}
                    {stage !== 'error' && (
                        <div>
                            <div className="flex items-center justify-between mb-1.5">
                                <span className="text-gray-300 text-xs flex items-center gap-1.5">
                                    {spinning && (
                                        <span className="w-3 h-3 border-2 border-gray-500 border-t-blue-400 rounded-full animate-spin inline-block" />
                                    )}
                                    {info.label}
                                </span>
                                <span className="text-gray-500 text-xs font-mono">{info.progress}%</span>
                            </div>
                            <div className="h-2 bg-gray-700 rounded-full overflow-hidden">
                                <div
                                    className={`h-full rounded-full transition-all duration-700 ${info.color}`}
                                    style={{ width: `${info.progress}%` }}
                                />
                            </div>
                        </div>
                    )}

                    {/* Başarı özeti */}
                    {stage === 'success' && (
                        <div className="bg-green-900/30 border border-green-700/50 rounded-xl p-3 flex items-center gap-3">
                            {imageUrl && (
                                <img src={imageUrl} alt="" className="w-12 h-12 rounded-lg object-cover flex-shrink-0" />
                            )}
                            <div className="min-w-0">
                                <p className="text-green-400 font-semibold text-sm">Story yayınlandı!</p>
                                {link ? (
                                    <p className="text-gray-400 text-xs truncate">{link}</p>
                                ) : (
                                    <p className="text-yellow-500 text-xs">⚠ Link panoda bulunamadı</p>
                                )}
                            </div>
                        </div>
                    )}

                    {/* Hata */}
                    {stage === 'error' && (
                        <div className="space-y-3">
                            <div className="bg-red-950/60 border border-red-800/60 rounded-xl p-3">
                                <p className="text-red-400 font-semibold text-sm mb-1">❌ Yayınlanamadı</p>
                                <p className="text-gray-300 text-xs">{errorMsg}</p>
                            </div>
                            <div className="flex gap-2">
                                <button
                                    onClick={() => { hasRun.current = false; setStage('reading'); setErrorMsg(''); }}
                                    className="flex-1 py-2.5 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium rounded-xl"
                                >
                                    Tekrar Dene
                                </button>
                                <button
                                    onClick={finish}
                                    className="flex-1 py-2.5 bg-gray-700 text-gray-300 text-sm rounded-xl"
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
                    from { transform: translateY(100px); opacity: 0; }
                    to   { transform: translateY(0); opacity: 1; }
                }
            `}</style>
        </div>
    );
};

export default QuickShareOverlay;
