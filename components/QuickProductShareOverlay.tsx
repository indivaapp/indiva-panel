/**
 * QuickProductShareOverlay — AI Destekli Hızlı Story Görseli Üretimi
 *
 * ProductShareActivity tarafından açılan şeffaf overlay.
 * Paylaşılan ekran görüntüsü (tam hali) + açıklama metni → Gemini Vision analizi
 * → 9:16 İNDİVA markalı story görseli üretme → native paylaşım ekranı → kapat.
 */

import React, { useEffect, useRef, useState } from 'react';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { Capacitor } from '@capacitor/core';
import { extractProductFromScreenshot, type VisualProductData } from '../services/geminiVisionService';
import { base64ToArrayBuffer } from '../services/imageCrop';

type Stage = 'reading' | 'analyzing' | 'processing' | 'rendering' | 'sharing' | 'success' | 'error';

const STAGE_INFO: Record<Stage, { label: string; progress: number }> = {
    reading:    { label: 'Görsel okunuyor...',                        progress: 10 },
    analyzing:  { label: 'Yapay zeka ürünü analiz ediyor...',         progress: 40 },
    processing: { label: '✍️ Açıklama metni düzenleniyor...',         progress: 60 },
    rendering:  { label: '🎨 İNDİVA story görseli oluşturuluyor...', progress: 75 },
    sharing:    { label: 'Paylaşım hazırlanıyor...',                  progress: 92 },
    success:    { label: 'Story görseli hazır! ✅',                   progress: 100 },
    error:      { label: 'Hata oluştu',                               progress: 0 },
};

const CANVAS_W = 1080;
const CANVAS_H = 1920;

const BG_PALETTES: [string, string, string][] = [
    ['#1a0800', '#c1440e', '#FF7A1A'],
    ['#3a1454', '#c2287a', '#ff7a1a'],
    ['#0f2f4a', '#0e6ba8', '#2ec4b6'],
    ['#1a1a2e', '#e94560', '#ff9f1c'],
    ['#2d1b4e', '#8338ec', '#ff006e'],
    ['#0b3d2e', '#1b998b', '#f4d35e'],
    ['#3d0e14', '#d7263d', '#f46036'],
    ['#131a3a', '#3f37c9', '#4cc9f0'],
    ['#3a1c1c', '#c1440e', '#ffbe0b'],
    ['#2b0f0f', '#9d0208', '#faa307'],
    ['#0a2f2f', '#00a896', '#f0e442'],
    ['#1e1a3c', '#7209b7', '#f72585'],
    ['#241005', '#9a3412', '#fbbf24'],
    ['#170a12', '#7a1f3d', '#ff8c42'],
];

function randomPalette(): [string, string, string] {
    return BG_PALETTES[Math.floor(Math.random() * BG_PALETTES.length)];
}

declare global {
    interface Window {
        INDIVAProductShareMode?: { isShareMode: () => boolean };
    }
}

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

function drawBackground(ctx: CanvasRenderingContext2D, palette: [string, string, string]) {
    const [c0, c1, c2] = palette;
    const grad = ctx.createLinearGradient(0, 0, CANVAS_W, CANVAS_H);
    grad.addColorStop(0, c0);
    grad.addColorStop(0.50, c1);
    grad.addColorStop(1, c2);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

    ctx.save();
    ctx.filter = 'blur(70px)';
    ctx.fillStyle = 'rgba(255,200,100,0.15)';
    ctx.beginPath(); ctx.arc(200, 300, 250, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    ctx.beginPath(); ctx.arc(CANVAS_W - 150, CANVAS_H - 500, 280, 0, Math.PI * 2); ctx.fill();
    ctx.restore();

    const marks: [number, number, number, number, number, string][] = [
        [140, 150, -18, 90,  0.28, '%'],
        [950, 120,  16, 76,  0.26, '%50'],
        [1010, 410, -12, 58, 0.20, '%'],
        [55,  380,  22, 72,  0.24, '%70'],
        [540,  50,  -8, 54,  0.16, '%'],
        [990, 930, -15, 82,  0.22, '%30'],
        [70, 1190,  18, 68,  0.22, '🔥'],
        [1025,1600,-20, 78,  0.26, '%'],
        [65, 1710,  14, 66,  0.22, '%40'],
        [320, 1880, 10, 50,  0.14, '🛍️'],
        [800, 1890,-12, 50,  0.14, '%20'],
        [1010,1200, 20, 56,  0.18, '%'],
        [190,  900, -8, 62,  0.18, '🔥'],
        [850,  700,  9, 58,  0.16, '🛍️'],
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

function drawDescriptionBox(
    ctx: CanvasRenderingContext2D,
    rawText: string,
    x: number, y: number, w: number,
    maxH: number,
): number {
    const allLines = rawText.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    const urlLines = allLines.filter(l => /^https?:\/\//i.test(l));
    const textLines = allLines.filter(l => !/^https?:\/\//i.test(l));

    const fontSize = 26, lineH = 38, padX = 28, padY = 22;
    const urlFontSize = 23;
    const hasUrl = urlLines.length > 0;

    const maxTextLines = Math.max(1, Math.floor((maxH - padY * 2 - (hasUrl ? urlFontSize + 14 : 0)) / lineH));
    const visible = textLines.slice(0, maxTextLines);
    if (textLines.length > maxTextLines && visible.length > 0) {
        let last = visible[visible.length - 1];
        ctx.font = `500 ${fontSize}px Arial`;
        while (ctx.measureText(last + '…').width > w - padX * 2 && last.length > 0) last = last.slice(0, -1).trim();
        visible[visible.length - 1] = last + '…';
    }

    const boxH = visible.length * lineH + (hasUrl ? urlFontSize + 14 : 0) + padY * 2;

    ctx.fillStyle = 'rgba(0,0,0,0.52)';
    drawRoundedRect(ctx, x, y, w, boxH, 22);

    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillStyle = '#ffffff';
    ctx.font = `500 ${fontSize}px Arial`;

    let ty = y + padY;
    for (const line of visible) {
        ctx.fillText(line, x + padX, ty, w - padX * 2);
        ty += lineH;
    }

    if (hasUrl) {
        ctx.font = `600 ${urlFontSize}px Arial`;
        ctx.fillStyle = '#FFD966';
        const shortUrl = urlLines[0].replace(/^https?:\/\//, '');
        ctx.fillText('🔗 ' + shortUrl, x + padX, ty + 6, w - padX * 2);
    }

    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    return boxH;
}

async function processDescriptionText(rawText: string, productTitle?: string): Promise<string> {
    try {
        const res = await fetch('https://indiva-proxy.vercel.app/api/social-content', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ descriptionText: rawText, productTitle }),
            signal: AbortSignal.timeout(18000),
        });
        if (!res.ok) return rawText;
        const data = await res.json();
        return data.success && data.description ? String(data.description) : rawText;
    } catch {
        return rawText;
    }
}

async function renderStoryImage(
    productData: VisualProductData,
    screenshotBlob: Blob,
    descriptionText: string,
): Promise<Blob> {
    const canvas = document.createElement('canvas');
    canvas.width = CANVAS_W;
    canvas.height = CANVAS_H;
    const ctx = canvas.getContext('2d')!;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';

    const palette = randomPalette();
    drawBackground(ctx, palette);

    const blobUrl = URL.createObjectURL(screenshotBlob);
    let screenshotImg: HTMLImageElement | null = null;
    try { screenshotImg = await loadImage(blobUrl); } catch { /* görselsiz devam */ }
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
    if (rawW > CANVAS_W - 120) ctx.font = `900 ${Math.floor(54 * ((CANVAS_W - 120) / rawW))}px Arial`;
    ctx.lineJoin = 'round';
    ctx.lineWidth = 10;
    ctx.strokeStyle = 'rgba(0,0,0,0.55)';
    ctx.strokeText(headline, CANVAS_W / 2, 170);
    ctx.fillStyle = '#FFD966';
    ctx.fillText(headline, CANVAS_W / 2, 170);
    ctx.restore();

    // Ürün kartı
    const cardX = 80, cardY = 290, cardW = CANVAS_W - 160, cardH = 720;

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

    if (screenshotImg) {
        ctx.save();
        drawRoundedRect(ctx, cardX + 10, cardY + 10, cardW - 20, cardH - 20, 36);
        ctx.clip();
        const coverScale = Math.max(cardW / screenshotImg.width, cardH / screenshotImg.height);
        const coverW = screenshotImg.width * coverScale, coverH = screenshotImg.height * coverScale;
        ctx.filter = 'blur(35px) brightness(0.65) saturate(1.2)';
        ctx.drawImage(screenshotImg, cardX + (cardW - coverW) / 2, cardY + (cardH - coverH) / 2, coverW, coverH);
        ctx.filter = 'none';
        ctx.restore();

        const pad = 32;
        const scale = Math.min((cardW - pad * 2) / screenshotImg.width, (cardH - pad * 2) / screenshotImg.height);
        const drawW = screenshotImg.width * scale, drawH = screenshotImg.height * scale;
        ctx.save();
        ctx.shadowColor = 'rgba(0,0,0,0.3)';
        ctx.shadowBlur = 18;
        ctx.drawImage(screenshotImg, cardX + (cardW - drawW) / 2, cardY + (cardH - drawH) / 2, drawW, drawH);
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
    let nextY = cardY + cardH + 28;
    if (storeName) {
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.font = '700 28px Arial';
        const storeW = ctx.measureText(storeName.toUpperCase()).width + 52;
        ctx.fillStyle = 'rgba(255,255,255,0.18)';
        drawRoundedRect(ctx, CANVAS_W / 2 - storeW / 2, nextY, storeW, 58, 29);
        ctx.fillStyle = '#FFD966';
        ctx.fillText(storeName.toUpperCase(), CANVAS_W / 2, nextY + 29);
        nextY += 78;
        ctx.textAlign = 'left';
    }

    // Aciliyet satırı
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '800 28px Arial';
    const urgencyText = '🛍️ GÜNÜN FIRSATINI KAÇIRMA!';
    const urgencyW = ctx.measureText(urgencyText).width + 52;
    ctx.fillStyle = 'rgba(255,255,255,0.16)';
    drawRoundedRect(ctx, CANVAS_W / 2 - urgencyW / 2, nextY, urgencyW, 60, 30);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(urgencyText, CANVAS_W / 2, nextY + 30);
    nextY += 80;
    ctx.textAlign = 'left';

    // Ürün başlığı
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.shadowColor = 'rgba(0,0,0,0.4)';
    ctx.shadowBlur = 10;
    ctx.fillStyle = '#ffffff';
    ctx.font = '800 44px Arial';
    const titleLines = wrapText(ctx, productData.title || 'Özel Fırsat', CANVAS_W - 180, 2);
    let lineY = nextY + 44;
    titleLines.forEach(line => { ctx.fillText(line, CANVAS_W / 2, lineY); lineY += 56; });
    ctx.shadowBlur = 0;
    nextY = lineY + 12;
    ctx.textAlign = 'left';

    // Açıklama metni veya fiyat
    const ctaY = 1650, ctaH = 110;
    const availH = ctaY - nextY - 20;

    if (descriptionText.trim()) {
        drawDescriptionBox(ctx, descriptionText, 60, nextY, CANVAS_W - 120, availH);
    } else {
        const newPriceText = `${Math.floor(productData.newPrice).toLocaleString('tr-TR')} TL`;
        const oldPrice = productData.oldPrice > productData.newPrice ? productData.oldPrice : 0;
        const oldPriceText = oldPrice > 0 ? `${Math.floor(oldPrice).toLocaleString('tr-TR')} TL` : '';

        ctx.font = '900 90px Arial';
        const newW = ctx.measureText(newPriceText).width;
        let oldW = 0;
        if (oldPriceText) { ctx.font = '600 44px Arial'; oldW = ctx.measureText(oldPriceText).width; }
        const gap = oldPriceText ? 28 : 0;
        const startX = CANVAS_W / 2 - (newW + gap + oldW) / 2;
        const priceY = nextY + 90;

        ctx.textAlign = 'left';
        ctx.save();
        ctx.shadowColor = 'rgba(255,224,102,0.6)';
        ctx.shadowBlur = 28;
        ctx.font = '900 90px Arial';
        ctx.fillStyle = '#FFE066';
        ctx.fillText(newPriceText, startX, priceY);
        ctx.restore();

        if (oldPriceText) {
            const oldX = startX + newW + gap;
            ctx.font = '600 44px Arial';
            ctx.fillStyle = 'rgba(255,255,255,0.60)';
            ctx.fillText(oldPriceText, oldX, priceY - 14);
            ctx.strokeStyle = 'rgba(255,255,255,0.60)';
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.moveTo(oldX, priceY - 28);
            ctx.lineTo(oldX + oldW, priceY - 28);
            ctx.stroke();
        }

        const savings = oldPrice > 0 ? Math.round(oldPrice - productData.newPrice) : 0;
        if (savings > 0) {
            ctx.textAlign = 'center';
            const saveText = `💚 ${savings.toLocaleString('tr-TR')} TL TASARRUF`;
            ctx.font = '800 30px Arial';
            const saveW = ctx.measureText(saveText).width + 52;
            ctx.fillStyle = '#22c55e';
            drawRoundedRect(ctx, CANVAS_W / 2 - saveW / 2, priceY + 20, saveW, 66, 33);
            ctx.fillStyle = '#ffffff';
            ctx.fillText(saveText, CANVAS_W / 2, priceY + 63);
            ctx.textAlign = 'left';
        }
    }

    // CTA butonu
    const ctaW = 780, ctaX = (CANVAS_W - ctaW) / 2;
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.3)';
    ctx.shadowBlur = 28;
    ctx.shadowOffsetY = 10;
    ctx.fillStyle = '#ffffff';
    drawRoundedRect(ctx, ctaX, ctaY, ctaW, ctaH, 55);
    ctx.restore();
    ctx.font = '900 34px Arial';
    ctx.fillStyle = '#4a1454';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('İNDİVA ile Fırsatları Kaçırma!', CANVAS_W / 2, ctaY + ctaH / 2 + 2);

    // Footer
    ctx.textAlign = 'center';
    ctx.font = '600 26px Arial';
    ctx.fillStyle = 'rgba(255,255,255,0.65)';
    let fy = ctaY + ctaH + 48;
    ctx.fillText('İNDİVA — Online Alışverişte İndirim & Fırsat Uygulaması', CANVAS_W / 2, fy);

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

const QuickProductShareOverlay: React.FC = () => {
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
                // ── 1. Görsel + metin al ───────────────────────────────────────
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

                const descriptionText = window.AndroidShareHandler?.getSharedText?.() || '';
                const buffer = base64ToArrayBuffer(base64);
                const screenshotBlob = new Blob([buffer], { type: 'image/jpeg' });

                // ── 2. Gemini Vision ile analiz ────────────────────────────────
                setStage('analyzing');

                const productData = await extractProductFromScreenshot(buffer, 'image/jpeg');

                if (!productData.newPrice || productData.newPrice <= 0) {
                    throw new Error(
                        'Fiyat ekrandan okunamadı. Fiyatın açıkça göründüğü daha net bir ekran görüntüsü paylaşın.'
                    );
                }
                if (productData.confidence < 30) {
                    throw new Error(
                        `Yapay zeka ekranı yeterince analiz edemedi (${productData.confidence}/100). Daha net bir ekran görüntüsü deneyin.`
                    );
                }

                setResult(productData);

                // ── 3. Açıklama metnini AI ile işle ───────────────────────────
                let finalDescription = descriptionText;
                if (descriptionText.trim()) {
                    setStage('processing');
                    finalDescription = await processDescriptionText(descriptionText, productData.title);
                }

                // ── 4. İNDİVA markalı 9:16 story görseli üret ─────────────────
                setStage('rendering');
                const storyBlob = await renderStoryImage(productData, screenshotBlob, finalDescription);

                // ── 5. Native paylaşım ekranını aç ────────────────────────────
                setStage('sharing');
                await shareStoryImage(storyBlob);

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
                @keyframes slideUpProd {
                    from { transform: translateY(40px); opacity: 0; }
                    to   { transform: translateY(0); opacity: 1; }
                }
            `}</style>
        </div>
    );
};

export default QuickProductShareOverlay;
