/**
 * QuickShareOverlay — AI Destekli Hızlı Story Görseli Üretimi
 *
 * ShareActivity tarafından açılan şeffaf overlay.
 * Paylaşılan ekran görüntüsü → Gemini Vision analizi → ürün görseli kırpma
 * → 9:16 İNDİVA markalı story görseli üretme → native paylaşım ekranı → kapat.
 * (QuickProductShareOverlay ile aynı akış — ShareActivity rotasından gelenleri karşılar.)
 */

import React, { useEffect, useRef, useState } from 'react';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { Capacitor } from '@capacitor/core';
import { extractProductFromScreenshot, type VisualProductData } from '../services/geminiVisionService';
import { cropImageByBox, base64ToArrayBuffer } from '../services/imageCrop';

type Stage = 'reading' | 'analyzing' | 'rendering' | 'sharing' | 'success' | 'error';

const STAGE_INFO: Record<Stage, { label: string; progress: number }> = {
    reading:   { label: 'Görsel okunuyor...',                        progress: 10 },
    analyzing: { label: 'Yapay zeka ürünü analiz ediyor...',         progress: 40 },
    rendering: { label: '🎨 İNDİVA story görseli oluşturuluyor...', progress: 75 },
    sharing:   { label: 'Paylaşım hazırlanıyor...',                  progress: 92 },
    success:   { label: 'Story görseli hazır! ✅',                   progress: 100 },
    error:     { label: 'Hata oluştu',                               progress: 0 },
};

const CANVAS_W = 1080;
const CANVAS_H = 1920;
const PALETTE: [string, string, string] = ['#1a0800', '#c1440e', '#FF7A1A'];

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

// ── Canvas yardımcıları ─────────────────────────────────────────────────────

function drawRoundedRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
    ctx.fill();
}

function strokeRoundedRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
    ctx.stroke();
}

function drawBurstPath(ctx: CanvasRenderingContext2D, cx: number, cy: number, spikes: number, outerR: number, innerR: number) {
    ctx.beginPath();
    const step = Math.PI / spikes;
    let rot = -Math.PI / 2;
    for (let i = 0; i < spikes; i++) {
        ctx.lineTo(cx + Math.cos(rot) * outerR, cy + Math.sin(rot) * outerR);
        rot += step;
        ctx.lineTo(cx + Math.cos(rot) * innerR, cy + Math.sin(rot) * innerR);
        rot += step;
    }
    ctx.closePath();
}

function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, maxLines: number): string[] {
    const words = text.split(' ');
    const lines: string[] = [];
    let current = '';
    for (const word of words) {
        const test = current ? `${current} ${word}` : word;
        if (current && ctx.measureText(test).width > maxWidth) {
            lines.push(current);
            current = word;
            if (lines.length === maxLines) break;
        } else {
            current = test;
        }
    }
    if (current && lines.length < maxLines) lines.push(current);
    const consumed = lines.join(' ').split(' ').length;
    if (consumed < words.length && lines.length > 0) {
        let last = lines[lines.length - 1];
        while (ctx.measureText(last + '…').width > maxWidth && last.length > 0) last = last.slice(0, -1).trim();
        lines[lines.length - 1] = last + '…';
    }
    return lines;
}

function loadImage(src: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error('Görsel yüklenemedi'));
        img.src = src;
    });
}

function blobToBase64(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve((reader.result as string).split(',')[1] ?? '');
        reader.onerror = reject;
        reader.readAsDataURL(blob);
    });
}

function drawBackground(ctx: CanvasRenderingContext2D) {
    const [c0, c1, c2] = PALETTE;
    const grad = ctx.createLinearGradient(0, 0, CANVAS_W, CANVAS_H);
    grad.addColorStop(0, c0);
    grad.addColorStop(0.50, c1);
    grad.addColorStop(1, c2);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

    ctx.save();
    ctx.filter = 'blur(70px)';
    ctx.fillStyle = 'rgba(255,150,50,0.18)';
    ctx.beginPath(); ctx.arc(200, 300, 250, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.10)';
    ctx.beginPath(); ctx.arc(CANVAS_W - 150, CANVAS_H - 500, 280, 0, Math.PI * 2); ctx.fill();
    ctx.restore();

    const marks: [number, number, number, number, number, string][] = [
        [140, 150, -18, 90,  0.30, '%'],
        [950, 120,  16, 76,  0.28, '%50'],
        [1010, 410, -12, 58, 0.22, '%'],
        [55,  380,  22, 72,  0.26, '%70'],
        [540,  50,  -8, 54,  0.18, '%'],
        [990, 930, -15, 82,  0.24, '%30'],
        [70, 1190,  18, 68,  0.24, '🔥'],
        [1025,1600,-20, 78,  0.28, '%'],
        [65, 1710,  14, 66,  0.24, '%40'],
        [320, 1880, 10, 50,  0.16, '🛍️'],
        [800, 1890,-12, 50,  0.16, '%20'],
        [1010,1200, 20, 56,  0.20, '%'],
        [190,  900, -8, 62,  0.20, '🔥'],
        [850,  700,  9, 58,  0.18, '🛍️'],
    ];
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    marks.forEach(([x, y, rot, size, alpha, text], i) => {
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.translate(x, y);
        ctx.rotate(rot * Math.PI / 180);
        ctx.font = `900 ${size}px Arial`;
        ctx.fillStyle = i % 3 === 0 ? '#FFD966' : i % 3 === 1 ? '#ffffff' : '#FFB020';
        ctx.fillText(text, 0, 0);
        ctx.restore();
    });
    ctx.restore();
}

async function renderStoryImage(productData: VisualProductData, productBlob: Blob): Promise<Blob> {
    const canvas = document.createElement('canvas');
    canvas.width = CANVAS_W;
    canvas.height = CANVAS_H;
    const ctx = canvas.getContext('2d')!;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';

    drawBackground(ctx);

    const blobUrl = URL.createObjectURL(productBlob);
    let productImg: HTMLImageElement | null = null;
    try { productImg = await loadImage(blobUrl); } catch { /* görselsiz devam */ }
    URL.revokeObjectURL(blobUrl);

    const discountPct = productData.discountPercent || (
        productData.oldPrice > productData.newPrice
            ? Math.round(((productData.oldPrice - productData.newPrice) / productData.oldPrice) * 100)
            : 0
    );

    // Üst başlık
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const headline = '🔥 FLAŞ İNDİRİM ÇILGINLIĞI!';
    ctx.font = '900 54px Arial';
    const rawW = ctx.measureText(headline).width;
    if (rawW > CANVAS_W - 120) {
        const fs = Math.floor(54 * ((CANVAS_W - 120) / rawW));
        ctx.font = `900 ${fs}px Arial`;
    }
    ctx.lineJoin = 'round';
    ctx.lineWidth = 10;
    ctx.strokeStyle = 'rgba(0,0,0,0.55)';
    ctx.strokeText(headline, CANVAS_W / 2, 170);
    ctx.fillStyle = '#FFD966';
    ctx.fillText(headline, CANVAS_W / 2, 170);
    ctx.restore();

    // Ürün kartı
    const cardX = 80, cardY = 290, cardW = CANVAS_W - 160, cardH = 760;
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.55)';
    ctx.shadowBlur = 60;
    ctx.shadowOffsetY = 30;
    ctx.fillStyle = '#ffffff';
    drawRoundedRect(ctx, cardX, cardY, cardW, cardH, 44);
    ctx.restore();
    ctx.save();
    ctx.strokeStyle = '#FFD966';
    ctx.lineWidth = 6;
    strokeRoundedRect(ctx, cardX + 3, cardY + 3, cardW - 6, cardH - 6, 42);
    ctx.restore();

    if (productImg) {
        ctx.save();
        drawRoundedRect(ctx, cardX + 10, cardY + 10, cardW - 20, cardH - 20, 36);
        ctx.clip();
        const coverScale = Math.max(cardW / productImg.width, cardH / productImg.height);
        const coverW = productImg.width * coverScale, coverH = productImg.height * coverScale;
        ctx.filter = 'blur(40px) brightness(0.7) saturate(1.2)';
        ctx.drawImage(productImg, cardX + (cardW - coverW) / 2, cardY + (cardH - coverH) / 2, coverW, coverH);
        ctx.filter = 'none';
        ctx.restore();

        const pad = 40;
        const scale = Math.min((cardW - pad * 2) / productImg.width, (cardH - pad * 2) / productImg.height);
        const drawW = productImg.width * scale, drawH = productImg.height * scale;
        ctx.save();
        ctx.shadowColor = 'rgba(0,0,0,0.3)';
        ctx.shadowBlur = 20;
        ctx.drawImage(productImg, cardX + (cardW - drawW) / 2, cardY + (cardH - drawH) / 2, drawW, drawH);
        ctx.restore();
    }

    // İndirim rozeti
    if (discountPct > 0) {
        const bx = cardX + 65, by = cardY + 15;
        const outerR = 148, innerR = 124;
        ctx.save();
        ctx.shadowColor = 'rgba(0,0,0,0.4)';
        ctx.shadowBlur = 30;
        ctx.shadowOffsetY = 10;
        const burstGrad = ctx.createRadialGradient(bx, by, 10, bx, by, outerR);
        burstGrad.addColorStop(0, '#FFE066');
        burstGrad.addColorStop(1, '#FFB020');
        ctx.fillStyle = burstGrad;
        drawBurstPath(ctx, bx, by, 18, outerR, innerR);
        ctx.fill();
        ctx.restore();
        ctx.save();
        ctx.strokeStyle = 'rgba(255,255,255,0.85)';
        ctx.lineWidth = 4;
        drawBurstPath(ctx, bx, by, 18, outerR - 10, innerR - 10);
        ctx.stroke();
        ctx.restore();
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = '#6b1642';
        ctx.font = '900 70px Arial';
        ctx.fillText(`%${discountPct}`, bx, by - 18);
        ctx.font = '800 30px Arial';
        ctx.fillText('İNDİRİM', bx, by + 40);
        ctx.textAlign = 'left';
    }

    // Mağaza etiketi
    const storeName = productData.storeName || productData.brand || '';
    if (storeName) {
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.font = '700 30px Arial';
        const storeW = ctx.measureText(storeName.toUpperCase()).width + 56;
        ctx.fillStyle = 'rgba(255,255,255,0.20)';
        drawRoundedRect(ctx, CANVAS_W / 2 - storeW / 2, cardY + cardH + 30, storeW, 62, 31);
        ctx.fillStyle = '#FFD966';
        ctx.fillText(storeName.toUpperCase(), CANVAS_W / 2, cardY + cardH + 61);
        ctx.textAlign = 'left';
    }

    // Aciliyet satırı
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '800 30px Arial';
    const urgencyText = '🛍️ GÜNÜN FIRSATINI KAÇIRMA!';
    const urgencyW = ctx.measureText(urgencyText).width + 56;
    ctx.fillStyle = 'rgba(255,255,255,0.18)';
    drawRoundedRect(ctx, CANVAS_W / 2 - urgencyW / 2, cardY + cardH + 112, urgencyW, 64, 32);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(urgencyText, CANVAS_W / 2, cardY + cardH + 144);
    ctx.textAlign = 'left';

    // Ürün başlığı
    const titleY = cardY + cardH + 230;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.shadowColor = 'rgba(0,0,0,0.4)';
    ctx.shadowBlur = 10;
    ctx.fillStyle = '#ffffff';
    ctx.font = '800 46px Arial';
    const titleLines = wrapText(ctx, productData.title || 'Özel Fırsat', CANVAS_W - 180, 3);
    let lineY = titleY;
    titleLines.forEach(line => { ctx.fillText(line, CANVAS_W / 2, lineY); lineY += 60; });
    ctx.shadowBlur = 0;
    ctx.textAlign = 'left';

    // Fiyat satırı
    const priceY = lineY + 55;
    const newPriceText = `${Math.floor(productData.newPrice).toLocaleString('tr-TR')} TL`;
    const oldPrice = productData.oldPrice > productData.newPrice ? productData.oldPrice : 0;
    const oldPriceText = oldPrice > 0 ? `${Math.floor(oldPrice).toLocaleString('tr-TR')} TL` : '';

    ctx.font = '900 96px Arial';
    const newW = ctx.measureText(newPriceText).width;
    let oldW = 0;
    if (oldPriceText) { ctx.font = '600 46px Arial'; oldW = ctx.measureText(oldPriceText).width; }
    const gap = oldPriceText ? 30 : 0;
    const startX = CANVAS_W / 2 - (newW + gap + oldW) / 2;

    ctx.textAlign = 'left';
    ctx.save();
    ctx.shadowColor = 'rgba(255,224,102,0.6)';
    ctx.shadowBlur = 30;
    ctx.font = '900 96px Arial';
    ctx.fillStyle = '#FFE066';
    ctx.fillText(newPriceText, startX, priceY);
    ctx.restore();

    if (oldPriceText) {
        const oldX = startX + newW + gap;
        const oldYPos = priceY - 14;
        ctx.font = '600 46px Arial';
        ctx.fillStyle = 'rgba(255,255,255,0.60)';
        ctx.fillText(oldPriceText, oldX, oldYPos);
        ctx.strokeStyle = 'rgba(255,255,255,0.60)';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(oldX, oldYPos - 16);
        ctx.lineTo(oldX + oldW, oldYPos - 16);
        ctx.stroke();
    }

    // Tasarruf rozeti
    const savings = oldPrice > 0 ? Math.round(oldPrice - productData.newPrice) : 0;
    const saveY = priceY + 60;
    if (savings > 0) {
        ctx.textAlign = 'center';
        const saveText = `💚 ${savings.toLocaleString('tr-TR')} TL TASARRUF`;
        ctx.font = '800 32px Arial';
        const saveW = ctx.measureText(saveText).width + 56;
        ctx.fillStyle = '#22c55e';
        drawRoundedRect(ctx, CANVAS_W / 2 - saveW / 2, saveY, saveW, 70, 35);
        ctx.fillStyle = '#ffffff';
        ctx.fillText(saveText, CANVAS_W / 2, saveY + 45);
        ctx.textAlign = 'left';
    }

    // CTA butonu
    const ctaY = 1650, ctaW = 780, ctaH = 110, ctaX = (CANVAS_W - ctaW) / 2;
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.3)';
    ctx.shadowBlur = 30;
    ctx.shadowOffsetY = 10;
    ctx.fillStyle = '#ffffff';
    drawRoundedRect(ctx, ctaX, ctaY, ctaW, ctaH, 55);
    ctx.restore();
    ctx.font = '900 36px Arial';
    ctx.fillStyle = '#4a1454';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('İNDİVA ile Fırsatları Kaçırma!', CANVAS_W / 2, ctaY + ctaH / 2 + 2);

    // Footer
    ctx.textAlign = 'center';
    ctx.font = '600 28px Arial';
    ctx.fillStyle = 'rgba(255,255,255,0.70)';
    const footerText = 'İNDİVA — Online Alışverişte İndirim & Fırsat Uygulaması';
    const fLines = wrapText(ctx, footerText, CANVAS_W - 140, 2);
    let fy = ctaY + ctaH + 50;
    fLines.forEach(line => { ctx.fillText(line, CANVAS_W / 2, fy); fy += 36; });

    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';

    return new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(
            (blob) => blob ? resolve(blob) : reject(new Error('Canvas PNG dönüşümü başarısız.')),
            'image/png',
        );
    });
}

async function shareStoryImage(blob: Blob): Promise<void> {
    const filename = `indiva-story-${Date.now()}.png`;
    if (Capacitor.isNativePlatform()) {
        const base64 = await blobToBase64(blob);
        const written = await Filesystem.writeFile({ path: filename, data: base64, directory: Directory.Cache });
        await Share.share({ title: 'İNDİVA Fırsat Story', url: written.uri });
    } else if (navigator.share) {
        const file = new File([blob], filename, { type: 'image/png' });
        await navigator.share({ title: 'İNDİVA Fırsat Story', files: [file] });
    } else {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 4000);
    }
}

const QuickShareOverlay: React.FC = () => {
    const [stage, setStage]       = useState<Stage>('reading');
    const [errorMsg, setErrorMsg] = useState('');
    const [result, setResult]     = useState<VisualProductData | null>(null);
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

                // ── 3. Ürün görselini kırp ─────────────────────────────────────
                setStage('rendering');

                const productBlob = productData.productImageBox
                    ? await cropImageByBox(buffer, 'image/jpeg', productData.productImageBox)
                    : new Blob([buffer], { type: 'image/jpeg' });

                // ── 4. İNDİVA markalı 9:16 story görseli üret ─────────────────
                const storyBlob = await renderStoryImage(productData, productBlob);

                // ── 5. Native paylaşım ekranını aç ────────────────────────────
                setStage('sharing');
                await shareStoryImage(storyBlob);

                // ── 6. Başarı → kapat ─────────────────────────────────────────
                setStage('success');
                setTimeout(finish, 1200);

            } catch (err: any) {
                setErrorMsg(err?.message || 'Bilinmeyen hata.');
                setStage('error');
            }
        };

        run();
    }, []);

    const info = STAGE_INFO[stage];
    const discount = result
        ? (result.discountPercent || (result.oldPrice > 0
            ? Math.round(((result.oldPrice - result.newPrice) / result.oldPrice) * 100)
            : 0))
        : 0;

    return (
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
                ) : stage === 'success' && result ? (
                    <div className="space-y-1.5">
                        {result.title && (
                            <p className="text-white text-xs font-medium leading-snug line-clamp-1">{result.title}</p>
                        )}
                        <div className="flex items-center gap-3 flex-wrap">
                            <p className="text-green-400 font-semibold text-xs">✅ Story hazır, paylaşıldı!</p>
                            {discount > 0 && (
                                <span className="text-orange-400 font-bold text-xs">%{discount} İndirim</span>
                            )}
                        </div>
                    </div>
                ) : (
                    <div className="flex items-center gap-2.5">
                        <span className="w-3.5 h-3.5 border-2 border-gray-500 border-t-orange-400 rounded-full animate-spin inline-block flex-shrink-0" />
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
