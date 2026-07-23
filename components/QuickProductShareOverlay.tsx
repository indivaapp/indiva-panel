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

const STAGE_INFO: Record<Stage, { label: string; progress: number }> = {
    reading:    { label: 'Görsel ve link okunuyor...',        progress: 15 },
    analyzing:  { label: 'Yapay zeka fiyatları analiz ediyor...', progress: 45 },
    uploading:  { label: 'Ürün görseli alınıyor...',          progress: 72 },
    publishing: { label: 'İndirim yayınlanıyor...',           progress: 90 },
    success:    { label: 'Ürün yayınlandı! ✅',                progress: 100 },
    error:      { label: 'Hata oluştu',                       progress: 0 },
};

const AUTO_CLOSE_MS = 1800;

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
    const discount = result
        ? (result.discountPercent || (result.oldPrice > 0
            ? Math.round(((result.oldPrice - result.newPrice) / result.oldPrice) * 100)
            : 0))
        : 0;

    return (
        /* Arkaplan tamamen görünür bırakılıyor — sadece küçük bir toast, tam ekran karartma YOK. */
        <div className="fixed inset-x-0 bottom-6 z-50 flex justify-center px-4 pointer-events-none">
            <div
                className="max-w-xs w-full bg-gray-900/95 rounded-2xl border border-gray-700 shadow-2xl px-4 py-3 pointer-events-auto"
                style={{ animation: 'slideUpProd 0.25s cubic-bezier(0.34,1.56,0.64,1)', backdropFilter: 'blur(6px)' }}
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
                ) : stage === 'success' && result ? (
                    <div className="space-y-1.5">
                        {result.title && (
                            <p className="text-white text-xs font-medium leading-snug line-clamp-1">{result.title}</p>
                        )}
                        <div className="flex items-center gap-3 flex-wrap">
                            <p className="text-green-400 font-semibold text-xs">✅ Yayınlandı</p>
                            {result.oldPrice > 0 && (
                                <span className="text-gray-500 text-[11px] line-through">
                                    {Math.floor(result.oldPrice).toLocaleString('tr-TR')} TL
                                </span>
                            )}
                            <span className="text-green-400 font-bold text-xs">
                                {Math.floor(result.newPrice).toLocaleString('tr-TR')} TL
                            </span>
                            {discount > 0 && (
                                <span className="text-orange-400 font-bold text-xs">%{discount}</span>
                            )}
                        </div>
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
                @keyframes slideUpProd {
                    from { transform: translateY(40px); opacity: 0; }
                    to   { transform: translateY(0); opacity: 1; }
                }
            `}</style>
        </div>
    );
};

export default QuickProductShareOverlay;
