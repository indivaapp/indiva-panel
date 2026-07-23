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

const STAGE_INFO: Record<Stage, { label: string; progress: number }> = {
    reading:    { label: 'Görsel ve link okunuyor...',  progress: 20 },
    uploading:  { label: 'Görsel yükleniyor...',        progress: 55 },
    publishing: { label: 'Story yayınlanıyor...',       progress: 85 },
    success:    { label: 'Story yayınlandı! ✅',        progress: 100 },
    error:      { label: 'Hata oluştu',                 progress: 0 },
};

const AUTO_CLOSE_MS = 1200;

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

    const info = STAGE_INFO[stage];

    return (
        /* Arkaplan tamamen tıklanabilir/görünür bırakılıyor — sadece küçük bir
           toast gösteriliyor, tam ekran karartma YOK (arkadaki uygulama net görünsün). */
        <div
            className="fixed inset-x-0 z-50 flex justify-center px-4 pointer-events-none"
            style={{ bottom: 'calc(env(safe-area-inset-bottom, 0px) + 28px)' }}
        >
            <div
                className="max-w-xs w-full bg-gray-900/95 rounded-2xl border border-gray-700 shadow-2xl px-4 py-3 pointer-events-auto"
                style={{ animation: 'slideUp 0.25s cubic-bezier(0.34,1.56,0.64,1)', backdropFilter: 'blur(6px)' }}
            >
                {stage === 'error' ? (
                    <div className="space-y-2.5">
                        <div className="flex items-center gap-2">
                            <p className="text-red-400 font-semibold text-xs flex-1">❌ {errorMsg}</p>
                            <button onClick={finish} className="text-gray-500 text-lg leading-none">×</button>
                        </div>
                        <div className="flex gap-2">
                            <button
                                onClick={() => { hasRun.current = false; setStage('reading'); setErrorMsg(''); }}
                                className="flex-1 py-1.5 bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium rounded-lg"
                            >
                                Tekrar Dene
                            </button>
                            <button
                                onClick={finish}
                                className="flex-1 py-1.5 bg-gray-700 text-gray-300 text-xs rounded-lg"
                            >
                                Kapat
                            </button>
                        </div>
                    </div>
                ) : stage === 'success' ? (
                    <div className="flex items-center gap-2.5">
                        {imageUrl && (
                            <img src={imageUrl} alt="" className="w-8 h-8 rounded-lg object-cover flex-shrink-0" />
                        )}
                        <p className="text-green-400 font-semibold text-xs">Story yayınlandı! ✅</p>
                    </div>
                ) : (
                    <div className="flex items-center gap-2.5">
                        <span className="w-3.5 h-3.5 border-2 border-gray-500 border-t-blue-400 rounded-full animate-spin inline-block flex-shrink-0" />
                        <span className="text-gray-200 text-xs flex-1">{info.label}</span>
                        <span className="text-gray-500 text-[10px] font-mono">{info.progress}%</span>
                    </div>
                )}
            </div>

            <style>{`
                @keyframes slideUp {
                    from { transform: translateY(40px); opacity: 0; }
                    to   { transform: translateY(0); opacity: 1; }
                }
            `}</style>
        </div>
    );
};

export default QuickShareOverlay;
