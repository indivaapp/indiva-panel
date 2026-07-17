/**
 * QuickProductShareOverlay — AI Destekli Hızlı Ürün Paylaşımı
 *
 * ProductShareActivity tarafından açılan şeffaf overlay.
 * Kullanıcı etkileşimi gerektirmez: görsel + pano linki → Gemini Vision analiz
 * → ürün görselini kırp → ImgBB yükleme → Firebase indirim → kapat.
 *
 * QuickShareOverlay.tsx (Story) ile aynı native köprü desenini kullanır, ama
 * addInfluencerStory yerine addDiscount çağırır ve araya Gemini Vision analiz
 * adımı girer (ShareTarget.tsx'teki PWA tabanlı akışın native eşleniği —
 * native APK'da image/* share intent'i her zaman bir Activity'ye gittiği için
 * PWA share_target hiç tetiklenmiyordu, bu yüzden aynı mantık buraya taşındı).
 */

import React, { useEffect, useRef, useState } from 'react';
import { addDiscount } from '../services/firebase';
import { uploadToImgbb } from '../services/imgbb';
import { extractProductFromScreenshot, type VisualProductData } from '../services/geminiVisionService';
import { cropImageByBox, base64ToArrayBuffer } from '../services/imageCrop';

type Stage = 'reading' | 'analyzing' | 'uploading' | 'publishing' | 'success' | 'error';

const STAGE_INFO: Record<Stage, { label: string; progress: number; color: string }> = {
    reading:    { label: 'Görsel ve link okunuyor...',        progress: 15,  color: 'bg-blue-500' },
    analyzing:  { label: 'Yapay zeka fiyatları analiz ediyor...', progress: 45, color: 'bg-purple-500' },
    uploading:  { label: 'Ürün görseli alınıyor...',          progress: 72,  color: 'bg-yellow-500' },
    publishing: { label: 'İndirim yayınlanıyor...',           progress: 90,  color: 'bg-orange-500' },
    success:    { label: 'Ürün yayınlandı! ✅',                progress: 100, color: 'bg-green-500' },
    error:      { label: 'Hata oluştu',                       progress: 0,   color: 'bg-red-500' },
};

const AUTO_CLOSE_MS = 3200;

declare global {
    interface Window {
        INDIVAProductShareMode?: { isShareMode: () => boolean };
    }
}

const QuickProductShareOverlay: React.FC = () => {
    const [stage, setStage]       = useState<Stage>('reading');
    const [errorMsg, setErrorMsg] = useState('');
    const [result, setResult]     = useState<VisualProductData | null>(null);
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
                // ── 1. Görseli + pano linkini al ──────────────────────────────
                setStage('reading');

                let base64 = '';
                const tryGet = () => window.AndroidShareHandler?.getSharedImage?.() || '';

                base64 = tryGet();
                if (!base64) {
                    await new Promise<void>((resolve) => {
                        const handler = () => { window.removeEventListener('sharedImage', handler); resolve(); };
                        window.addEventListener('sharedImage', handler);
                        setTimeout(resolve, 3000);
                    });
                    base64 = tryGet();
                }

                if (!base64) throw new Error('Paylaşılan görsel alınamadı. Tekrar deneyin.');

                const clipUrl = window.AndroidShareHandler?.getClipboardUrl?.() || '';
                setLink(clipUrl);

                const buffer = base64ToArrayBuffer(base64);

                // ── 2. Gemini Vision ile analiz ────────────────────────────────
                setStage('analyzing');

                const productData = await extractProductFromScreenshot(buffer, 'image/jpeg');

                if (!productData.newPrice || productData.newPrice <= 0) {
                    throw new Error(
                        'Fiyat ekrandan okunamadı. Fiyatın açıkça göründüğü, daha net bir ekran görüntüsü paylaşın.'
                    );
                }
                if (productData.confidence < 30) {
                    throw new Error(
                        `Yapay zeka ekranı yeterince analiz edemedi (${productData.confidence}/100). Daha net veya yakın bir ekran görüntüsü deneyin.`
                    );
                }

                setResult(productData);

                // ── 3. Ürün görselini kırp + ImgBB'ye yükle ────────────────────
                setStage('uploading');

                const imageToUpload = productData.productImageBox
                    ? await cropImageByBox(buffer, 'image/jpeg', productData.productImageBox)
                    : new Blob([buffer], { type: 'image/jpeg' });

                const imageFile = new File(
                    [imageToUpload],
                    `indiva-${Date.now()}.jpg`,
                    { type: 'image/jpeg' }
                );
                const { downloadURL, deleteUrl } = await uploadToImgbb(imageFile);

                // ── 4. Firebase'e ürün olarak yayınla ──────────────────────────
                setStage('publishing');

                const oldPrice = productData.oldPrice > productData.newPrice
                    ? productData.oldPrice
                    : Math.round(productData.newPrice * 1.3);

                await addDiscount({
                    title:                productData.title || 'Fırsat',
                    brand:                productData.brand || '',
                    category:             productData.category || 'Diğer',
                    link:                 clipUrl || '',
                    oldPrice,
                    newPrice:             productData.newPrice,
                    imageUrl:             downloadURL,
                    deleteUrl,
                    screenshotUrl:        downloadURL,
                    screenshotDeleteUrl:  deleteUrl,
                    storeName:            productData.storeName || '',
                    submittedBy:          'admin',
                    affiliateLinkUpdated: !!clipUrl,
                });

                // ── 5. Başarı → otomatik kapat ─────────────────────────────────
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
    const discount = result
        ? (result.discountPercent || (result.oldPrice > 0
            ? Math.round(((result.oldPrice - result.newPrice) / result.oldPrice) * 100)
            : 0))
        : 0;

    return (
        <div
            className="fixed inset-0 z-50 flex items-end justify-center px-4 pb-10"
            style={{ backgroundColor: 'rgba(0,0,0,0.72)', backdropFilter: 'blur(3px)' }}
        >
            <div
                className="w-full max-w-sm bg-gray-900 rounded-2xl border border-gray-700 shadow-2xl overflow-hidden"
                style={{ animation: 'slideUpProd 0.3s cubic-bezier(0.34,1.56,0.64,1)' }}
            >
                <div className="flex justify-center pt-3 pb-1">
                    <div className="w-10 h-1 bg-gray-600 rounded-full" />
                </div>

                <div className="px-5 pt-2 pb-6 space-y-4">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-blue-600 rounded-xl flex items-center justify-center text-lg">
                            🤖
                        </div>
                        <div>
                            <p className="text-white font-bold text-sm">İNDİVA Panel</p>
                            <p className="text-gray-400 text-xs">Ürün AI ile analiz ediliyor...</p>
                        </div>
                        {stage === 'error' && (
                            <button onClick={finish} className="ml-auto text-gray-500 text-xl">×</button>
                        )}
                    </div>

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

                    {stage === 'success' && result && (
                        <div className="bg-green-900/30 border border-green-700/50 rounded-xl p-3 space-y-2">
                            {result.title && (
                                <p className="text-white text-xs font-medium leading-snug line-clamp-2">
                                    {result.title}
                                </p>
                            )}
                            <div className="flex items-center gap-4 flex-wrap">
                                {result.oldPrice > 0 && (
                                    <div className="text-center">
                                        <p className="text-gray-500 text-[10px]">Eski</p>
                                        <p className="text-gray-400 text-xs line-through">
                                            {Math.floor(result.oldPrice).toLocaleString('tr-TR')} TL
                                        </p>
                                    </div>
                                )}
                                <div className="text-center">
                                    <p className="text-gray-400 text-[10px]">Yeni</p>
                                    <p className="text-green-400 font-bold text-sm">
                                        {Math.floor(result.newPrice).toLocaleString('tr-TR')} TL
                                    </p>
                                </div>
                                {discount > 0 && (
                                    <div className="text-center">
                                        <p className="text-gray-400 text-[10px]">İndirim</p>
                                        <p className="text-orange-400 font-bold text-sm">%{discount}</p>
                                    </div>
                                )}
                            </div>
                            {link ? (
                                <p className="text-gray-400 text-xs truncate">{link}</p>
                            ) : (
                                <p className="text-yellow-500 text-xs">⚠ Link panoda bulunamadı</p>
                            )}
                        </div>
                    )}

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
                @keyframes slideUpProd {
                    from { transform: translateY(100px); opacity: 0; }
                    to   { transform: translateY(0); opacity: 1; }
                }
            `}</style>
        </div>
    );
};

export default QuickProductShareOverlay;
