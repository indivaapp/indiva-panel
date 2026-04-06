/**
 * ShareTarget — Ekran Görüntüsü Paylaşım Overlay'i
 * ─────────────────────────────────────────────────────────────────────────────
 * Kullanıcı bir e-ticaret ekran görüntüsünü İNDİVA Panel'e paylaştığında
 * bu bileşen otomatik olarak:
 *   1. Service Worker cache'inden görüntüyü okur
 *   2. Pano (clipboard) üzerinden affiliate linkini çeker
 *   3. Gemini Vision ile fiyat/başlık/marka bilgilerini çıkarır
 *   4. Görüntüyü ImgBB'ye yükler
 *   5. Firebase'e indirimi yayınlar
 *   6. Başarı bildirimi gösterir ve otomatik kapanır
 */

import React, { useEffect, useState, useCallback, useRef } from 'react';
import { addDiscount } from '../services/firebase';
import { uploadToImgbb } from '../services/imgbb';
import { extractProductFromScreenshot, type VisualProductData } from '../services/geminiVisionService';

// ─── Tipler ───────────────────────────────────────────────────────────────────

type Stage =
    | 'reading'     // Cache ve pano okunuyor
    | 'analyzing'   // Gemini Vision analiz ediyor
    | 'uploading'   // ImgBB'ye görsel yükleniyor
    | 'publishing'  // Firebase'e yazılıyor
    | 'success'     // Tamamlandı
    | 'error';      // Hata oluştu

interface StageInfo {
    label: string;
    emoji: string;
    progress: number;
    color: string;
}

const STAGES: Record<Stage, StageInfo> = {
    reading:    { label: 'Görüntü ve link okunuyor...',         emoji: '📖', progress: 15,  color: 'bg-blue-500' },
    analyzing:  { label: 'Yapay zeka fiyatları analiz ediyor...', emoji: '🤖', progress: 45,  color: 'bg-purple-500' },
    uploading:  { label: 'Görsel yükleniyor...',                emoji: '☁️', progress: 72,  color: 'bg-yellow-500' },
    publishing: { label: 'Firebase\'e yayınlanıyor...',         emoji: '🚀', progress: 90,  color: 'bg-orange-500' },
    success:    { label: 'Yayınlandı!',                         emoji: '✅', progress: 100, color: 'bg-green-500' },
    error:      { label: 'Hata oluştu',                         emoji: '❌', progress: 0,   color: 'bg-red-500' },
};

const AUTO_CLOSE_DELAY_MS = 2800;

// ─── Props ────────────────────────────────────────────────────────────────────

interface ShareTargetProps {
    onClose: () => void;
}

// ─── Bileşen ──────────────────────────────────────────────────────────────────

const ShareTarget: React.FC<ShareTargetProps> = ({ onClose }) => {
    const [stage, setStage]           = useState<Stage>('reading');
    const [errorMsg, setErrorMsg]     = useState('');
    const [result, setResult]         = useState<VisualProductData | null>(null);
    const [affiliateUrl, setAffiliateUrl] = useState('');
    const hasStarted = useRef(false);

    // ─── Ana İşlem Akışı ──────────────────────────────────────────────────────
    const runShareFlow = useCallback(async () => {
        try {
            // ── 1. READING: Cache'den görüntü + panodan URL ──────────────────
            setStage('reading');

            const SHARE_CACHE = 'indiva-share-v1';
            let imageBuffer: ArrayBuffer | null = null;
            let imageMimeType = 'image/jpeg';
            let sharedUrl = '';

            if ('caches' in window) {
                const cache = await caches.open(SHARE_CACHE);
                const [imgResp, metaResp] = await Promise.all([
                    cache.match('/share-screenshot'),
                    cache.match('/share-meta'),
                ]);

                // Görüntü
                if (imgResp) {
                    imageBuffer   = await imgResp.arrayBuffer();
                    imageMimeType = imgResp.headers.get('Content-Type') || 'image/jpeg';
                }

                // Meta (URL share'den gelebilir)
                if (metaResp) {
                    try {
                        const meta = JSON.parse(await metaResp.text());
                        sharedUrl = meta.url || meta.text || '';
                    } catch {}
                }

                // SW'a cache tüketildi sinyali gönder
                if (navigator.serviceWorker?.controller) {
                    navigator.serviceWorker.controller.postMessage({ type: 'SHARE_DATA_CONSUMED' });
                }
            }

            if (!imageBuffer || imageBuffer.byteLength < 500) {
                throw new Error('Paylaşılan görüntü bulunamadı veya çok küçük. Ekran görüntüsü aldıktan sonra tekrar deneyin.');
            }

            // ── 2. Pano'dan affiliate linkini oku ────────────────────────────
            let clipboardUrl = sharedUrl;
            if (!clipboardUrl) {
                try {
                    const clipText = await navigator.clipboard.readText();
                    const trimmed  = clipText?.trim() ?? '';
                    const isLink   =
                        trimmed.includes('ty.gl') ||
                        trimmed.includes('trendyol.com') ||
                        trimmed.includes('n11.com') ||
                        trimmed.includes('n11.gl') ||
                        trimmed.includes('hepsiburada.com') ||
                        trimmed.includes('hb.biz') ||
                        trimmed.includes('amazon.com.tr') ||
                        trimmed.includes('amzn.to') ||
                        trimmed.includes('pazarama.com') ||
                        trimmed.includes('pzrm.gl') ||
                        trimmed.includes('ciceksepeti.com') ||
                        (trimmed.startsWith('http') && trimmed.length > 20);

                    if (isLink) clipboardUrl = trimmed;
                } catch {
                    // Pano izni yok — URL olmadan devam et
                    console.warn('[ShareTarget] Pano erişimi reddedildi, URL olmadan devam ediliyor.');
                }
            }

            setAffiliateUrl(clipboardUrl);

            // ── 3. ANALYZING: Gemini Vision ──────────────────────────────────
            setStage('analyzing');

            const blob        = new Blob([imageBuffer], { type: imageMimeType });
            const productData = await extractProductFromScreenshot(blob, imageMimeType);

            if (!productData.newPrice || productData.newPrice <= 0) {
                throw new Error(
                    'Fiyat ekrandan okunamadı. ' +
                    'Lütfen fiyatın açıkça göründüğü, daha net bir ekran görüntüsü alın.'
                );
            }

            if (productData.confidence < 30) {
                throw new Error(
                    'Yapay zeka ekranı yeterince analiz edemedi (' +
                    productData.confidence + '/100). ' +
                    'Daha net veya yakın bir ekran görüntüsü deneyin.'
                );
            }

            setResult(productData);

            // ── 4. UPLOADING: ImgBB'ye görsel yükle ─────────────────────────
            setStage('uploading');

            const imageFile = new File(
                [imageBuffer],
                `indiva-${Date.now()}.jpg`,
                { type: imageMimeType }
            );
            const { downloadURL: imageUrl, deleteUrl } = await uploadToImgbb(imageFile);

            // ── 5. PUBLISHING: Firebase'e yayınla ───────────────────────────
            setStage('publishing');

            // Eski fiyat yoksa %25 markup ile tahmin et
            const oldPrice = productData.oldPrice > productData.newPrice
                ? productData.oldPrice
                : Math.round(productData.newPrice * 1.3);

            // İndirim yüzdesi
            const discountPercent = productData.discountPercent ||
                (oldPrice > 0 ? Math.round(((oldPrice - productData.newPrice) / oldPrice) * 100) : 0);

            await addDiscount({
                title:                productData.title || 'Fırsat',
                brand:                productData.brand || '',
                category:             productData.category || 'Diğer',
                link:                 clipboardUrl || '',
                oldPrice,
                newPrice:             productData.newPrice,
                imageUrl,
                deleteUrl,
                screenshotUrl:        imageUrl,
                screenshotDeleteUrl:  deleteUrl,
                storeName:            productData.storeName || '',
                submittedBy:          'admin',
                affiliateLinkUpdated: !!clipboardUrl,
            });

            // ── 6. BAŞARI ────────────────────────────────────────────────────
            setStage('success');
            setTimeout(onClose, AUTO_CLOSE_DELAY_MS);

        } catch (err: any) {
            console.error('[ShareTarget] Hata:', err);
            setErrorMsg(err?.message || 'Bilinmeyen bir hata oluştu.');
            setStage('error');
        }
    }, [onClose]);

    // Bir kez çalıştır
    useEffect(() => {
        if (hasStarted.current) return;
        hasStarted.current = true;
        runShareFlow();
    }, [runShareFlow]);

    // ─── Render Yardımcıları ──────────────────────────────────────────────────
    const info     = STAGES[stage];
    const isActive = stage !== 'success' && stage !== 'error';

    return (
        /* Yarı saydam arka plan — tam ekran */
        <div
            className="fixed inset-0 z-50 flex items-end justify-center px-4 pb-8"
            style={{ backgroundColor: 'rgba(0,0,0,0.82)', backdropFilter: 'blur(4px)' }}
        >
            {/* Alt kart — bottom sheet */}
            <div
                className="w-full max-w-sm bg-gray-800 rounded-2xl shadow-2xl border border-gray-700 overflow-hidden"
                style={{ animation: 'shareSlideUp 0.35s cubic-bezier(0.34,1.56,0.64,1)' }}
            >
                {/* Üst çizgi */}
                <div className="flex justify-center pt-3 pb-1">
                    <div className="w-10 h-1 bg-gray-600 rounded-full" />
                </div>

                {/* İçerik */}
                <div className="px-5 pt-3 pb-6">

                    {/* Başlık satırı */}
                    <div className="flex items-center gap-3 mb-4">
                        <div className="w-10 h-10 bg-indigo-600 rounded-xl flex items-center justify-center text-lg shadow-lg">
                            📸
                        </div>
                        <div>
                            <p className="text-white font-bold text-sm">İNDİVA Panel</p>
                            <p className="text-gray-400 text-xs">Ekran görüntüsünden indirim paylaşılıyor</p>
                        </div>
                        {!isActive && stage !== 'analyzing' && (
                            <button
                                onClick={onClose}
                                className="ml-auto text-gray-500 hover:text-gray-300 text-xl leading-none"
                                aria-label="Kapat"
                            >
                                ×
                            </button>
                        )}
                    </div>

                    {/* İlerleme çubuğu */}
                    {stage !== 'error' && (
                        <div className="mb-4">
                            <div className="flex items-center justify-between mb-1.5">
                                <span className="text-gray-300 text-xs flex items-center gap-1.5">
                                    {isActive && (
                                        <span className="inline-block w-3 h-3 border-2 border-gray-400 border-t-blue-400 rounded-full animate-spin" />
                                    )}
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

                    {/* Adım açıklamaları (aktif süreçte) */}
                    {isActive && (
                        <div className="space-y-1.5 text-xs text-gray-500">
                            <StepRow done={['uploading','publishing','success'].includes(stage)}
                                     active={stage === 'reading'}
                                     label="Ekran görüntüsü + pano linki okunuyor" />
                            <StepRow done={['uploading','publishing','success'].includes(stage)}
                                     active={stage === 'analyzing'}
                                     label="Gemini Vision fiyat ve başlığı analiz ediyor" />
                            <StepRow done={['publishing','success'].includes(stage)}
                                     active={stage === 'uploading'}
                                     label="Görsel ImgBB'ye yükleniyor" />
                            <StepRow done={stage === 'success'}
                                     active={stage === 'publishing'}
                                     label="İndirim Firebase'e yayınlanıyor" />
                        </div>
                    )}

                    {/* Başarı kartı */}
                    {stage === 'success' && result && (
                        <SuccessCard result={result} affiliateUrl={affiliateUrl} />
                    )}

                    {/* Hata kartı */}
                    {stage === 'error' && (
                        <ErrorCard message={errorMsg} onClose={onClose} onRetry={() => {
                            hasStarted.current = false;
                            setStage('reading');
                            setErrorMsg('');
                            setResult(null);
                            runShareFlow();
                        }} />
                    )}
                </div>
            </div>

            {/* Animasyon tanımı */}
            <style>{`
                @keyframes shareSlideUp {
                    from { transform: translateY(120px); opacity: 0; }
                    to   { transform: translateY(0);     opacity: 1; }
                }
            `}</style>
        </div>
    );
};

// ─── Adım satırı ──────────────────────────────────────────────────────────────
const StepRow: React.FC<{ done: boolean; active: boolean; label: string }> = ({ done, active, label }) => (
    <div className={`flex items-center gap-2 transition-all duration-300 ${active ? 'text-blue-400' : done ? 'text-green-500' : 'text-gray-600'}`}>
        <span className="text-base w-4 text-center flex-shrink-0">
            {done ? '✓' : active ? '›' : '○'}
        </span>
        <span className={active ? 'font-medium' : ''}>{label}</span>
    </div>
);

// ─── Başarı Kartı ─────────────────────────────────────────────────────────────
const SuccessCard: React.FC<{ result: VisualProductData; affiliateUrl: string }> = ({ result, affiliateUrl }) => {
    const discount = result.discountPercent ||
        (result.oldPrice > 0
            ? Math.round(((result.oldPrice - result.newPrice) / result.oldPrice) * 100)
            : 0);

    return (
        <div className="bg-gray-750 border border-green-800/50 rounded-xl p-4 space-y-3"
             style={{ backgroundColor: 'rgba(6,78,59,0.15)' }}>
            {/* Başarı mesajı */}
            <div className="flex items-center gap-2">
                <span className="text-green-400 text-xl">✅</span>
                <div>
                    <p className="text-green-400 font-bold text-sm">Başarıyla yayınlandı!</p>
                    <p className="text-gray-400 text-xs">Uygulama kapanıyor...</p>
                </div>
            </div>

            {/* Ürün özeti */}
            <div className="bg-gray-800 rounded-lg p-3 space-y-2">
                {result.title && (
                    <p className="text-white text-xs font-medium leading-snug line-clamp-2">
                        {result.title}
                    </p>
                )}

                <div className="flex items-center gap-4 flex-wrap">
                    {/* Eski fiyat */}
                    {result.oldPrice > 0 && (
                        <div className="text-center">
                            <p className="text-gray-500 text-[10px]">Eski</p>
                            <p className="text-gray-400 text-xs line-through">
                                {result.oldPrice.toLocaleString('tr-TR')} TL
                            </p>
                        </div>
                    )}

                    {/* Yeni fiyat */}
                    <div className="text-center">
                        <p className="text-gray-400 text-[10px]">Yeni</p>
                        <p className="text-green-400 font-bold text-sm">
                            {result.newPrice.toLocaleString('tr-TR')} TL
                        </p>
                    </div>

                    {/* İndirim */}
                    {discount > 0 && (
                        <div className="text-center">
                            <p className="text-gray-400 text-[10px]">İndirim</p>
                            <p className="text-orange-400 font-bold text-sm">%{discount}</p>
                        </div>
                    )}
                </div>

                {/* Mağaza + kategori */}
                <div className="flex gap-2 flex-wrap">
                    {result.storeName && (
                        <span className="bg-gray-700 text-gray-300 text-[10px] px-2 py-0.5 rounded-full">
                            {result.storeName}
                        </span>
                    )}
                    {result.category && result.category !== 'Diğer' && (
                        <span className="bg-gray-700 text-gray-300 text-[10px] px-2 py-0.5 rounded-full">
                            {result.category}
                        </span>
                    )}
                    {!affiliateUrl && (
                        <span className="bg-yellow-900/50 text-yellow-400 text-[10px] px-2 py-0.5 rounded-full">
                            ⚠ Link panoda bulunamadı
                        </span>
                    )}
                </div>
            </div>
        </div>
    );
};

// ─── Hata Kartı ───────────────────────────────────────────────────────────────
const ErrorCard: React.FC<{ message: string; onClose: () => void; onRetry: () => void }> = ({
    message, onClose, onRetry
}) => (
    <div className="space-y-3">
        <div className="bg-red-950/50 border border-red-800/60 rounded-xl p-4">
            <p className="text-red-400 font-semibold text-sm mb-1">❌ İşlem başarısız</p>
            <p className="text-gray-300 text-xs leading-relaxed">{message}</p>
        </div>

        {/* İpuçları */}
        <div className="bg-gray-700/50 rounded-xl p-3 space-y-1">
            <p className="text-gray-400 text-xs font-semibold mb-1.5">İpuçları:</p>
            <p className="text-gray-400 text-xs">• Ekran görüntüsünde fiyat net görünmeli</p>
            <p className="text-gray-400 text-xs">• Affiliate linki panoya kopyalanmış olmalı</p>
            <p className="text-gray-400 text-xs">• Farklı/yakın bir ekran görüntüsü deneyin</p>
        </div>

        {/* Butonlar */}
        <div className="flex gap-2">
            <button
                onClick={onRetry}
                className="flex-1 py-2.5 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium rounded-xl transition-colors"
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
);

export default ShareTarget;
