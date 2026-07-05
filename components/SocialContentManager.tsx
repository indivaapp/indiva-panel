import React, { useState, useEffect, useCallback, useRef } from 'react';
import { getSocialContentQueue, markSocialContentPosted, getDiscounts, addManualSocialContent } from '../services/firebase';
import { uploadImageFromUrl } from '../services/dealFinder';
import { Clipboard } from '@capacitor/clipboard';
import type { SocialContentItem, Discount } from '../types';

interface SocialContentManagerProps {
    isAdmin: boolean;
}

const CANVAS_W = 1080;
const CANVAS_H = 1920; // 9:16 — Instagram Hikaye/Reels formatı

// ─── Canvas çizim yardımcıları ──────────────────────────────────────────────

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

// Küçük "parıltı" (✨ tarzı) şekli — glam/dikkat çekici dekor için
function drawSparkle(ctx: CanvasRenderingContext2D, cx: number, cy: number, size: number, color: string) {
    ctx.save();
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(cx, cy - size);
    ctx.quadraticCurveTo(cx + size * 0.15, cy - size * 0.15, cx + size, cy);
    ctx.quadraticCurveTo(cx + size * 0.15, cy + size * 0.15, cx, cy + size);
    ctx.quadraticCurveTo(cx - size * 0.15, cy + size * 0.15, cx - size, cy);
    ctx.quadraticCurveTo(cx - size * 0.15, cy - size * 0.15, cx, cy - size);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
}

// Dişli/patlama şekli — indirim rozetini bir "kampanya çıkartması" gibi gösterir
function drawBurstPath(ctx: CanvasRenderingContext2D, cx: number, cy: number, spikes: number, outerR: number, innerR: number) {
    ctx.beginPath();
    const step = Math.PI / spikes;
    let rot = -Math.PI / 2;
    for (let i = 0; i < spikes; i++) {
        let x = cx + Math.cos(rot) * outerR;
        let y = cy + Math.sin(rot) * outerR;
        ctx.lineTo(x, y);
        rot += step;
        x = cx + Math.cos(rot) * innerR;
        y = cy + Math.sin(rot) * innerR;
        ctx.lineTo(x, y);
        rot += step;
    }
    ctx.closePath();
}

// Metni verilen genişliğe göre satırlara böler; sığmazsa son satırı "…" ile keser.
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

    const consumedWords = lines.join(' ').split(' ').length;
    const truncated = consumedWords < words.length;
    if (truncated && lines.length > 0) {
        let last = lines[lines.length - 1];
        while (ctx.measureText(last + '…').width > maxWidth && last.length > 0) {
            last = last.slice(0, -1).trim();
        }
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

// ─── Animasyon yardımcıları ─────────────────────────────────────────────────
// progress: 0 (animasyon başı) → 1 (durağan/final görünüm, statik görsel de bunu kullanır)

function easeOutCubic(t: number): number { return 1 - Math.pow(1 - t, 3); }
function easeOutBack(t: number): number {
    const c1 = 1.70158, c3 = c1 + 1;
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}
// Genel progress'ten (0-1), bir elemanın kendi [start,end] aralığındaki alt-progress'i
function segProgress(overall: number, start: number, end: number): number {
    if (overall <= start) return 0;
    if (overall >= end) return 1;
    return (overall - start) / (end - start);
}
function withPop(ctx: CanvasRenderingContext2D, cx: number, cy: number, scale: number, alpha: number, draw: () => void) {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(cx, cy);
    ctx.scale(Math.max(0.001, scale), Math.max(0.001, scale));
    ctx.translate(-cx, -cy);
    draw();
    ctx.restore();
}
function withSlideFade(ctx: CanvasRenderingContext2D, offsetY: number, alpha: number, draw: () => void) {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(0, offsetY);
    draw();
    ctx.restore();
}

/**
 * @param progress 0-1. Varsayılan 1 = statik/final görünüm (mevcut kullanım bozulmaz).
 *   Video animasyonu için 0'dan 1'e kadar art arda çağrılır.
 * @param cachedImg Önceden yüklenmiş ürün görseli — video her frame'de yeniden
 *   indirmesin diye. Verilmezse (statik kullanım) her zamanki gibi kendi yükler.
 * @returns Yüklenen görsel — çağıran, sonraki frame'ler için cache'leyebilir.
 */
async function renderDealImage(
    canvas: HTMLCanvasElement,
    item: SocialContentItem,
    safeImageUrl: string | null,
    progress: number = 1,
    cachedImg?: HTMLImageElement | null,
): Promise<HTMLImageElement | null> {
    if (canvas.width !== CANVAS_W) canvas.width = CANVAS_W;
    if (canvas.height !== CANVAS_H) canvas.height = CANVAS_H;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);

    const discountPct = item.oldPrice > 0 && item.newPrice > 0
        ? Math.round(((item.oldPrice - item.newPrice) / item.oldPrice) * 100)
        : 0;

    // Eleman bazlı animasyon segmentleri (genel progress'in hangi aralığında oynar).
    // Video 4sn'den 8sn'ye uzatıldığında aynı mutlak hızda kalması için (yani
    // fırsat 8sn'nin ilk yarısında aynı tempoda belirir) eski 4sn'lik oranlar
    // yarıya bölündü. İkinci yarı: kısa bir bekleme + yeni "uygulamayı indir"
    // banner'ı + final bekleme (izleyicinin okuyacak zamanı olsun).
    const headerP     = easeOutCubic(segProgress(progress, 0.000, 0.075));
    const cardP       = easeOutBack(segProgress(progress, 0.040, 0.150));
    const burstP      = easeOutBack(segProgress(progress, 0.120, 0.220));
    const urgencyP    = easeOutCubic(segProgress(progress, 0.180, 0.260));
    const titleP      = easeOutCubic(segProgress(progress, 0.220, 0.300));
    const priceP      = easeOutBack(segProgress(progress, 0.260, 0.360));
    const savingsP    = easeOutBack(segProgress(progress, 0.330, 0.410));
    const ctaP        = easeOutBack(segProgress(progress, 0.380, 0.470));
    const appBannerP  = easeOutBack(segProgress(progress, 0.550, 0.680));

    // ── Arka plan: mor → pembe → turuncu canlı gradyan (glam/alışveriş enerjisi) ──
    const bgGrad = ctx.createLinearGradient(0, 0, CANVAS_W, CANVAS_H);
    bgGrad.addColorStop(0, '#3a1454');
    bgGrad.addColorStop(0.55, '#c2287a');
    bgGrad.addColorStop(1, '#ff7a1a');
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

    // Yumuşak ışık lekeleri (derinlik için)
    ctx.save();
    ctx.filter = 'blur(60px)';
    ctx.fillStyle = 'rgba(255,255,255,0.10)';
    ctx.beginPath(); ctx.arc(160, 220, 180, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(255,214,102,0.14)';
    ctx.beginPath(); ctx.arc(CANVAS_W - 120, CANVAS_H - 420, 220, 0, Math.PI * 2); ctx.fill();
    ctx.restore();

    // Parıltı dekorları
    const sparkles: [number, number, number, string][] = [
        [90, 400, 16, 'rgba(255,255,255,0.55)'],
        [1000, 240, 12, 'rgba(255,224,140,0.6)'],
        [960, 520, 20, 'rgba(255,255,255,0.4)'],
        [70, 700, 10, 'rgba(255,224,140,0.5)'],
        [1010, 1250, 14, 'rgba(255,255,255,0.45)'],
        [60, 1300, 18, 'rgba(255,224,140,0.4)'],
    ];
    sparkles.forEach(([x, y, s, c]) => drawSparkle(ctx, x, y, s, c));

    // ── Üst satır: kategori + İNDİVA (yukarıdan kayarak belirir) ─────────────
    withSlideFade(ctx, (1 - headerP) * -20, headerP, () => {
        ctx.textBaseline = 'middle';
        if (item.category) {
            const catText = item.category.toUpperCase();
            ctx.font = '700 26px Arial';
            const catWidth = ctx.measureText(catText).width;
            ctx.fillStyle = 'rgba(255,255,255,0.24)';
            drawRoundedRect(ctx, 64, 70, catWidth + 48, 58, 29);
            ctx.fillStyle = '#ffffff';
            ctx.fillText(catText, 88, 100);
        }
        ctx.font = '900 34px Arial';
        ctx.fillStyle = '#ffffff';
        ctx.textAlign = 'right';
        ctx.fillText('✨ İNDİVA', CANVAS_W - 64, 100);
        ctx.textAlign = 'left';
    });

    // ── Ürün kartı: beyaz zemin + altın çerçeve (hafif zıplayarak büyür) ─────
    // NOT: cardH 860'tan 740'a küçültüldü — geri kalan her şey (uyarı, başlık,
    // fiyat, tasarruf) cardY+cardH'e göre hesaplandığı için otomatik yukarı
    // kayıyor, bu da CTA'nın (sabit, canvas altına göre) üstünde yeni "uygulamayı
    // indir" banner'ı için yer açıyor — üstteki hiçbir sabiti değiştirmeye gerek yok.
    const cardX = 90, cardY = 300, cardW = CANVAS_W - 180, cardH = 740;
    let loadedImg: HTMLImageElement | null = cachedImg ?? null;
    if (!loadedImg && safeImageUrl) {
        try { loadedImg = await loadImage(safeImageUrl); } catch { loadedImg = null; }
    }
    withPop(ctx, cardX + cardW / 2, cardY + cardH / 2, 0.85 + 0.15 * cardP, cardP, () => {
        ctx.save();
        ctx.shadowColor = 'rgba(0,0,0,0.5)';
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

        if (loadedImg) {
            const pad = 70;
            const availW = cardW - pad * 2, availH = cardH - pad * 2;
            const scale = Math.min(availW / loadedImg.width, availH / loadedImg.height, 1);
            const drawW = loadedImg.width * scale, drawH = loadedImg.height * scale;
            ctx.drawImage(
                loadedImg,
                cardX + (cardW - drawW) / 2,
                cardY + (cardH - drawH) / 2,
                drawW, drawH,
            );
        }
    });

    // ── İndirim rozeti: altın "kampanya çıkartması" (patlarcasına büyür) ─────
    if (discountPct > 0) {
        const bx = cardX + 60, by = cardY + 10, outerR = 140, innerR = 118;
        withPop(ctx, bx, by, burstP, burstP, () => {
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
            ctx.font = '900 66px Arial';
            ctx.fillText(`%${discountPct}`, bx, by - 18);
            ctx.font = '800 28px Arial';
            ctx.fillText('İNDİRİM', bx, by + 38);
            ctx.textAlign = 'left';
        });
    }

    // ── Aciliyet etiketi (kartın altında, aşağıdan kayarak belirir) ──────────
    withSlideFade(ctx, (1 - urgencyP) * 20, urgencyP, () => {
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.font = '800 30px Arial';
        const urgencyText = '🔥 SINIRLI SÜRE — KAÇIRMA!';
        const urgencyW = ctx.measureText(urgencyText).width + 56;
        ctx.fillStyle = 'rgba(255,255,255,0.22)';
        drawRoundedRect(ctx, CANVAS_W / 2 - urgencyW / 2, cardY + cardH + 40, urgencyW, 66, 33);
        ctx.fillStyle = '#ffffff';
        ctx.fillText(urgencyText, CANVAS_W / 2, cardY + cardH + 73);
        ctx.textAlign = 'left';
    });

    // ── Ürün başlığı (ortalı, gölgeli, aşağıdan kayarak belirir) ─────────────
    let ty = cardY + cardH + 195;
    withSlideFade(ctx, (1 - titleP) * 15, titleP, () => {
        ctx.textAlign = 'center';
        ctx.textBaseline = 'alphabetic';
        ctx.shadowColor = 'rgba(0,0,0,0.35)';
        ctx.shadowBlur = 10;
        ctx.fillStyle = '#ffffff';
        ctx.font = '800 46px Arial';
        const titleLines = wrapText(ctx, item.title, CANVAS_W - 200, 2);
        let lineY = ty;
        titleLines.forEach(line => {
            ctx.fillText(line, CANVAS_W / 2, lineY);
            lineY += 60;
        });
        ctx.shadowBlur = 0;
        ctx.textAlign = 'left';
    });
    // Başlık kaç satır sürdüyse fiyatın başlangıcı ona göre kaysın — bunu
    // animasyon dışında (progress'ten bağımsız) sabit hesaplamak için burada
    // bir kez daha (gerçek) satır sayısını ölç.
    ctx.font = '800 46px Arial';
    const titleLineCount = wrapText(ctx, item.title, CANVAS_W - 200, 2).length;
    ty += titleLineCount * 60;

    // ── Fiyat satırı (ortalı grup: yeni fiyat + eski fiyat, zıplayarak büyür) ─
    ty += 55;
    const newPriceText = `${Math.floor(item.newPrice).toLocaleString('tr-TR')} TL`;
    const oldPriceText = item.oldPrice > item.newPrice
        ? `${Math.floor(item.oldPrice).toLocaleString('tr-TR')} TL` : '';

    ctx.font = '900 96px Arial';
    const newW = ctx.measureText(newPriceText).width;
    let oldW = 0;
    if (oldPriceText) {
        ctx.font = '600 46px Arial';
        oldW = ctx.measureText(oldPriceText).width;
    }
    const gap = oldPriceText ? 30 : 0;
    const totalW = newW + gap + oldW;
    const startX = CANVAS_W / 2 - totalW / 2;

    withPop(ctx, CANVAS_W / 2, ty - 25, 0.7 + 0.3 * priceP, priceP, () => {
        // NOT: textAlign burada kesin 'left' olmalı — startX/oldX manuel
        // sol-hizalı hesaplandı, yoksa metnin yarısı canvas dışına çizilir.
        ctx.textAlign = 'left';
        ctx.save();
        ctx.shadowColor = 'rgba(255,224,102,0.6)';
        ctx.shadowBlur = 30;
        ctx.font = '900 96px Arial';
        ctx.fillStyle = '#FFE066';
        ctx.fillText(newPriceText, startX, ty);
        ctx.restore();

        if (oldPriceText) {
            const oldX = startX + newW + gap;
            const oldY = ty - 14;
            ctx.font = '600 46px Arial';
            ctx.fillStyle = 'rgba(255,255,255,0.65)';
            ctx.fillText(oldPriceText, oldX, oldY);
            ctx.strokeStyle = 'rgba(255,255,255,0.65)';
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.moveTo(oldX, oldY - 16);
            ctx.lineTo(oldX + oldW, oldY - 16);
            ctx.stroke();
        }
    });

    // ── Tasarruf rozeti (yeşil, ortalı, zıplayarak büyür) ────────────────────
    const savings = item.oldPrice > item.newPrice ? Math.round(item.oldPrice - item.newPrice) : 0;
    const saveY = ty + 60;
    if (savings > 0) {
        withPop(ctx, CANVAS_W / 2, saveY + 35, savingsP, savingsP, () => {
            ctx.textAlign = 'center';
            const saveText = `💚 ${savings.toLocaleString('tr-TR')} TL TASARRUF`;
            ctx.font = '800 32px Arial';
            const saveW = ctx.measureText(saveText).width + 56;
            ctx.fillStyle = '#22c55e';
            drawRoundedRect(ctx, CANVAS_W / 2 - saveW / 2, saveY, saveW, 70, 35);
            ctx.fillStyle = '#ffffff';
            ctx.fillText(saveText, CANVAS_W / 2, saveY + 45);
            ctx.textAlign = 'left';
        });
    }

    // ── "Uygulamayı indir" banner'ı — videoda geç aşamada belirir ────────────
    // NOT: Google'ın resmi "Play Store'da İndir" rozetini birebir taklit ETMİYORUZ
    // (üçüncü taraf marka/logo telif riski) — kendi stilimizde net bir indirme
    // çağrısı kullanıyoruz, aynı teşvik etkisini sağlıyor.
    const ctaYForBanner = CANVAS_H - 190;
    const appBannerH = 90;
    const appBannerY = ctaYForBanner - 140;
    withPop(ctx, CANVAS_W / 2, appBannerY + appBannerH / 2, appBannerP, appBannerP, () => {
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.font = '800 30px Arial';
        const appText = '📲 İNDİVA\'yı Google Play\'de Ücretsiz İndir';
        const appW = Math.min(CANVAS_W - 120, ctx.measureText(appText).width + 70);
        ctx.save();
        ctx.shadowColor = 'rgba(0,0,0,0.35)';
        ctx.shadowBlur = 25;
        ctx.shadowOffsetY = 8;
        const bannerGrad = ctx.createLinearGradient(CANVAS_W / 2 - appW / 2, 0, CANVAS_W / 2 + appW / 2, 0);
        bannerGrad.addColorStop(0, '#2563eb');
        bannerGrad.addColorStop(1, '#0ea5a4');
        ctx.fillStyle = bannerGrad;
        drawRoundedRect(ctx, CANVAS_W / 2 - appW / 2, appBannerY, appW, appBannerH, 45);
        ctx.restore();
        ctx.fillStyle = '#ffffff';
        ctx.fillText(appText, CANVAS_W / 2, appBannerY + appBannerH / 2 + 2);
        ctx.textAlign = 'left';
        ctx.textBaseline = 'alphabetic';
    });

    // ── Alt CTA butonu (beyaz pil, koyu mor yazı, zıplayarak büyür) ──────────
    const ctaW = 780, ctaH = 110, ctaX = (CANVAS_W - ctaW) / 2, ctaY = CANVAS_H - 190;
    withPop(ctx, CANVAS_W / 2, ctaY + ctaH / 2, ctaP, ctaP, () => {
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
        ctx.fillText('İNDİVA\'DA FIRSATI YAKALA >', CANVAS_W / 2, ctaY + ctaH / 2 + 2);
        ctx.textAlign = 'left';
        ctx.textBaseline = 'alphabetic';
    });

    return loadedImg;
}

// ─── Animasyonlu video kaydı (tarayıcı içi, sunucuya gerek yok) ─────────────
// canvas.captureStream + MediaRecorder ile animasyonu WebM'e kaydeder.
// Çıktı formatı WebM'dir — Instagram MP4 istiyor, paylaşmadan önce dönüştürme
// gerekebilir (bkz. panel ekranındaki not).
const VIDEO_DURATION_MS = 8000;
const VIDEO_FPS = 30;

function pickSupportedMimeType(): string {
    const candidates = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];
    for (const type of candidates) {
        if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(type)) return type;
    }
    return 'video/webm';
}

async function recordDealVideo(
    canvas: HTMLCanvasElement,
    item: SocialContentItem,
    cachedImg: HTMLImageElement | null,
    onProgress?: (fraction: number) => void,
): Promise<Blob> {
    if (typeof (canvas as any).captureStream !== 'function' || typeof MediaRecorder === 'undefined') {
        throw new Error('Bu tarayıcı video kaydını desteklemiyor.');
    }
    const stream: MediaStream = (canvas as any).captureStream(VIDEO_FPS);
    const mimeType = pickSupportedMimeType();
    const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 4_000_000 });
    const chunks: Blob[] = [];

    return new Promise((resolve, reject) => {
        recorder.ondataavailable = (e: BlobEvent) => { if (e.data.size > 0) chunks.push(e.data); };
        recorder.onerror = () => reject(new Error('Video kaydı başarısız oldu.'));
        recorder.onstop = () => {
            stream.getTracks().forEach(t => t.stop());
            resolve(new Blob(chunks, { type: mimeType }));
        };

        const startTime = performance.now();
        const tick = () => {
            const elapsed = performance.now() - startTime;
            const progress = Math.min(1, elapsed / VIDEO_DURATION_MS);
            onProgress?.(progress);
            renderDealImage(canvas, item, null, progress, cachedImg).catch(() => {});
            if (progress < 1) {
                requestAnimationFrame(tick);
            } else {
                // Son karenin de kaydedilmesi için kısa bir bekleme sonrası durdur
                setTimeout(() => recorder.stop(), 150);
            }
        };
        recorder.start();
        requestAnimationFrame(tick);
    });
}

// ─── Tekil kart bileşeni ────────────────────────────────────────────────────

interface CardProps {
    item: SocialContentItem;
    onPosted: (id: string) => void;
}

const SocialContentCard: React.FC<CardProps> = ({ item, onPosted }) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const cachedImgRef = useRef<HTMLImageElement | null>(null);
    const [renderState, setRenderState] = useState<'loading' | 'ready' | 'error'>('loading');
    const [copied, setCopied] = useState(false);
    const [marking, setMarking] = useState(false);
    const [videoState, setVideoState] = useState<'idle' | 'recording' | 'ready' | 'error'>('idle');
    const [videoProgress, setVideoProgress] = useState(0);
    const [videoUrl, setVideoUrl] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            setRenderState('loading');
            const canvas = canvasRef.current;
            if (!canvas) return;

            // 1) Önce ürün görselini DOĞRUDAN dene — birçok CDN (Amazon, n11 vb.)
            // zaten CORS'a izin veriyor, proxy'ye hiç gerek kalmaz (daha hızlı,
            // proxy servisi çökse bile çalışmaya devam eder).
            try {
                const img = await renderDealImage(canvas, item, item.imageUrl);
                canvas.toDataURL(); // tainted canvas mı diye ucuz bir kontrol — öyleyse burada atar
                cachedImgRef.current = img;
                if (!cancelled) setRenderState('ready');
                return;
            } catch {
                // Görsel CORS'a kapalı (tainted) veya yüklenemedi — proxy'ye düş
            }

            // 2) Proxy üzerinden CORS-safe bir kopya al ve yeniden çiz
            let safeUrl: string | null = null;
            try {
                const uploaded = await uploadImageFromUrl(item.imageUrl);
                safeUrl = uploaded?.downloadURL || null;
            } catch {
                safeUrl = null;
            }
            if (cancelled || !canvasRef.current) return;
            try {
                const img = await renderDealImage(canvasRef.current, item, safeUrl);
                cachedImgRef.current = img;
                if (!cancelled) setRenderState('ready');
            } catch {
                if (!cancelled) setRenderState('error');
            }
        })();
        return () => { cancelled = true; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [item.id]);

    // Bileşen kapanırken oluşturulmuş video object URL'ini serbest bırak
    useEffect(() => () => { if (videoUrl) URL.revokeObjectURL(videoUrl); }, [videoUrl]);

    const handleDownload = () => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        canvas.toBlob((blob) => {
            if (!blob) return;
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `indiva-${item.discountId}.png`;
            a.click();
            URL.revokeObjectURL(url);
        }, 'image/png');
    };

    const handleCreateVideo = async () => {
        const canvas = canvasRef.current;
        if (!canvas || videoState === 'recording') return;
        setVideoState('recording');
        setVideoProgress(0);
        try {
            const blob = await recordDealVideo(canvas, item, cachedImgRef.current, setVideoProgress);
            const url = URL.createObjectURL(blob);
            setVideoUrl(url);
            setVideoState('ready');
        } catch {
            setVideoState('error');
        }
    };

    const handleDownloadVideo = () => {
        if (!videoUrl) return;
        const a = document.createElement('a');
        a.href = videoUrl;
        a.download = `indiva-${item.discountId}.webm`;
        a.click();
    };

    const handleCopyCaption = async () => {
        try {
            await Clipboard.write({ string: item.caption });
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        } catch {
            // Clipboard API kullanılamıyorsa sessizce yok say
        }
    };

    const handleMarkPosted = async () => {
        setMarking(true);
        try {
            await markSocialContentPosted(item.id);
            onPosted(item.id);
        } catch {
            setMarking(false);
        }
    };

    return (
        <div className="bg-gray-800 rounded-2xl border border-gray-700 overflow-hidden flex flex-col md:flex-row">
            <div className="w-full md:w-72 shrink-0 bg-gray-900 flex items-center justify-center p-3">
                {renderState === 'loading' && (
                    <div className="aspect-[9/16] w-full flex items-center justify-center">
                        <div className="w-10 h-10 border-4 border-orange-500/30 border-t-orange-500 rounded-full animate-spin" />
                    </div>
                )}
                <canvas
                    ref={canvasRef}
                    className={`w-full h-auto rounded-xl ${renderState === 'ready' ? 'block' : 'hidden'}`}
                />
                {renderState === 'error' && (
                    <p className="text-xs text-red-400 text-center">Görsel üretilemedi</p>
                )}
            </div>

            <div className="flex-1 p-5 flex flex-col gap-3">
                <div className="flex items-center justify-between gap-2">
                    <span className="bg-orange-500/20 text-orange-300 text-xs font-bold px-2.5 py-1 rounded-full">
                        {item.source === 'manual' ? '✋ Manuel Seçim' : `Kalite Puanı: ${item.score}/10`}
                    </span>
                    <span className="text-gray-500 text-xs">{item.storeName}</span>
                </div>

                <h3 className="text-white font-semibold text-sm leading-snug">{item.title}</h3>

                <textarea
                    readOnly
                    value={item.caption}
                    className="flex-1 min-h-[140px] bg-gray-900 border border-gray-700 rounded-xl p-3 text-sm text-gray-300 resize-none focus:outline-none"
                />

                <div className="flex flex-wrap gap-2">
                    <button
                        onClick={handleCopyCaption}
                        className="flex-1 min-w-[140px] py-2.5 bg-gray-700 hover:bg-gray-600 text-white text-sm font-medium rounded-xl transition-colors active:scale-95"
                    >
                        {copied ? '✓ Kopyalandı' : '📋 Metni Kopyala'}
                    </button>
                    <button
                        onClick={handleDownload}
                        disabled={renderState !== 'ready' || videoState === 'recording'}
                        className="flex-1 min-w-[140px] py-2.5 bg-gradient-to-r from-orange-600 to-red-600 disabled:opacity-40 text-white text-sm font-bold rounded-xl transition-all active:scale-95 shadow-lg shadow-orange-900/30"
                    >
                        ⬇ Görseli İndir
                    </button>

                    {videoState !== 'ready' && (
                        <button
                            onClick={handleCreateVideo}
                            disabled={renderState !== 'ready' || videoState === 'recording'}
                            className="flex-1 min-w-[140px] py-2.5 bg-gradient-to-r from-purple-600 to-pink-600 disabled:opacity-40 text-white text-sm font-bold rounded-xl transition-all active:scale-95 shadow-lg shadow-purple-900/30"
                        >
                            {videoState === 'recording'
                                ? `🎬 Kaydediliyor… %${Math.round(videoProgress * 100)}`
                                : videoState === 'error'
                                ? '🎬 Tekrar dene'
                                : '🎬 Video Oluştur'}
                        </button>
                    )}
                    {videoState === 'ready' && (
                        <button
                            onClick={handleDownloadVideo}
                            className="flex-1 min-w-[140px] py-2.5 bg-gradient-to-r from-purple-600 to-pink-600 text-white text-sm font-bold rounded-xl transition-all active:scale-95 shadow-lg shadow-purple-900/30"
                        >
                            ⬇ Videoyu İndir (.webm)
                        </button>
                    )}

                    {videoState === 'ready' && (
                        <p className="w-full text-[11px] text-gray-500 text-center -mt-1">
                            .webm formatında indi. Instagram MP4 istiyorsa, paylaşmadan önce
                            telefonundaki bir dönüştürücü uygulamayla MP4'e çevirmen gerekebilir.
                        </p>
                    )}

                    <button
                        onClick={handleMarkPosted}
                        disabled={marking}
                        className="w-full py-2 text-gray-500 hover:text-gray-300 text-xs transition-colors"
                    >
                        {marking ? 'İşaretleniyor…' : 'Paylaşıldı, listeden kaldır'}
                    </button>
                </div>
            </div>
        </div>
    );
};

// ─── Ana bileşen ────────────────────────────────────────────────────────────

const SocialContentManager: React.FC<SocialContentManagerProps> = () => {
    const [items, setItems] = useState<SocialContentItem[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const [pickerOpen, setPickerOpen] = useState(false);
    const [allDiscounts, setAllDiscounts] = useState<Discount[]>([]);
    const [discountsLoading, setDiscountsLoading] = useState(false);
    const [pickerQuery, setPickerQuery] = useState('');
    const [creatingId, setCreatingId] = useState<string | null>(null);

    const fetchItems = useCallback(async () => {
        setIsLoading(true);
        setError(null);
        try {
            const data = await getSocialContentQueue();
            setItems(data);
        } catch {
            setError('İçerikler yüklenemedi.');
        } finally {
            setIsLoading(false);
        }
    }, []);

    useEffect(() => { fetchItems(); }, [fetchItems]);

    const handlePosted = (id: string) => {
        setItems(prev => prev.filter(i => i.id !== id));
    };

    const togglePicker = async () => {
        const next = !pickerOpen;
        setPickerOpen(next);
        if (next && allDiscounts.length === 0) {
            setDiscountsLoading(true);
            try {
                const data = await getDiscounts();
                setAllDiscounts(data.filter(d => !d.isAd));
            } catch {
                // sessizce yok say — arama kutusu boş kalır, kullanıcı tekrar açabilir
            } finally {
                setDiscountsLoading(false);
            }
        }
    };

    const filteredDiscounts = (pickerQuery.trim()
        ? allDiscounts.filter(d => d.title.toLowerCase().includes(pickerQuery.trim().toLowerCase()))
        : allDiscounts
    ).slice(0, 30);

    const handleManualCreate = async (discount: Discount) => {
        setCreatingId(discount.id);
        try {
            await addManualSocialContent(discount);
            await fetchItems();
            setPickerOpen(false);
            setPickerQuery('');
        } catch {
            // hata olursa sessizce bırak — kullanıcı tekrar deneyebilir
        } finally {
            setCreatingId(null);
        }
    };

    return (
        <div className="max-w-3xl mx-auto p-4 md:p-6">
            <div className="flex items-center justify-between mb-6">
                <div>
                    <h2 className="text-xl font-bold text-white">📱 Sosyal Medya İçeriği</h2>
                    <p className="text-sm text-gray-400 mt-1">
                        Kalite puanı 9/10 ve üzeri fırsatlar için otomatik üretilen, Instagram'a hazır görsel + metin.
                    </p>
                </div>
                <button
                    onClick={fetchItems}
                    className="text-sm text-gray-400 hover:text-white px-3 py-2 rounded-lg hover:bg-gray-800 transition-colors"
                >
                    ↻ Yenile
                </button>
            </div>

            <div className="mb-6 bg-gray-800 border border-gray-700 rounded-2xl overflow-hidden">
                <button
                    onClick={togglePicker}
                    className="w-full flex items-center justify-between px-5 py-4 text-left hover:bg-gray-750 transition-colors"
                >
                    <span className="text-white font-semibold text-sm">➕ İstediğim Fırsatı Seçip İçerik Üret</span>
                    <span className="text-gray-400 text-lg">{pickerOpen ? '−' : '+'}</span>
                </button>
                {pickerOpen && (
                    <div className="px-5 pb-5">
                        <input
                            type="text"
                            value={pickerQuery}
                            onChange={(e) => setPickerQuery(e.target.value)}
                            placeholder="Ürün adıyla ara…"
                            className="w-full bg-gray-900 border border-gray-700 rounded-xl px-4 py-2.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-orange-500 mb-3"
                        />
                        {discountsLoading && (
                            <p className="text-gray-500 text-sm text-center py-6">Fırsatlar yükleniyor…</p>
                        )}
                        {!discountsLoading && filteredDiscounts.length === 0 && (
                            <p className="text-gray-500 text-sm text-center py-6">Eşleşen fırsat bulunamadı.</p>
                        )}
                        {!discountsLoading && (
                            <div className="max-h-80 overflow-y-auto space-y-2">
                                {filteredDiscounts.map(d => (
                                    <div
                                        key={d.id}
                                        className="flex items-center gap-3 bg-gray-900 rounded-xl p-2.5"
                                    >
                                        <img
                                            src={d.imageUrl}
                                            alt=""
                                            className="w-12 h-12 rounded-lg object-contain bg-white shrink-0"
                                        />
                                        <div className="flex-1 min-w-0">
                                            <p className="text-white text-xs font-medium truncate">{d.title}</p>
                                            <p className="text-gray-500 text-[11px]">
                                                {Math.floor(d.newPrice).toLocaleString('tr-TR')} TL · {d.brand}
                                            </p>
                                        </div>
                                        <button
                                            onClick={() => handleManualCreate(d)}
                                            disabled={creatingId === d.id}
                                            className="shrink-0 text-xs font-bold px-3 py-2 rounded-lg bg-gradient-to-r from-orange-600 to-red-600 disabled:opacity-40 text-white transition-all active:scale-95"
                                        >
                                            {creatingId === d.id ? 'Oluşturuluyor…' : 'Oluştur'}
                                        </button>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                )}
            </div>

            {isLoading && (
                <div className="text-center py-16">
                    <div className="w-10 h-10 border-4 border-orange-500/30 border-t-orange-500 rounded-full animate-spin mx-auto mb-4" />
                    <p className="text-gray-400 text-sm">Yükleniyor…</p>
                </div>
            )}

            {!isLoading && error && (
                <p className="text-center text-red-400 py-16">{error}</p>
            )}

            {!isLoading && !error && items.length === 0 && (
                <div className="text-center py-16 text-gray-500">
                    <p className="text-sm">Şu an bekleyen içerik yok.</p>
                    <p className="text-xs mt-1">9/10 ve üzeri puanlı bir fırsat yayınlandığında burada görünecek.</p>
                </div>
            )}

            <div className="space-y-4">
                {items.map(item => (
                    <SocialContentCard key={item.id} item={item} onPosted={handlePosted} />
                ))}
            </div>
        </div>
    );
};

export default SocialContentManager;
