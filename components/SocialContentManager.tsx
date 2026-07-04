import React, { useState, useEffect, useCallback, useRef } from 'react';
import { getSocialContentQueue, markSocialContentPosted } from '../services/firebase';
import { uploadImageFromUrl } from '../services/dealFinder';
import { Clipboard } from '@capacitor/clipboard';
import type { SocialContentItem } from '../types';

interface SocialContentManagerProps {
    isAdmin: boolean;
}

const CANVAS_W = 1080;
const CANVAS_H = 1350;

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

async function renderDealImage(canvas: HTMLCanvasElement, item: SocialContentItem, safeImageUrl: string | null) {
    canvas.width = CANVAS_W;
    canvas.height = CANVAS_H;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Arka plan — koyu diyagonal gradyan (uygulamanın marka teması)
    const bgGrad = ctx.createLinearGradient(0, 0, CANVAS_W, CANVAS_H);
    bgGrad.addColorStop(0, '#1a1a2e');
    bgGrad.addColorStop(1, '#0d0d16');
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

    // Üst satır: kategori etiketi (solda) + İNDİVA imzası (sağda)
    ctx.textBaseline = 'middle';
    if (item.category) {
        const catText = item.category.toUpperCase();
        ctx.font = '700 26px Arial';
        const catWidth = ctx.measureText(catText).width;
        ctx.fillStyle = 'rgba(255,122,26,0.18)';
        drawRoundedRect(ctx, 64, 60, catWidth + 48, 58, 29);
        ctx.fillStyle = '#FF9A56';
        ctx.fillText(catText, 88, 90);
    }
    ctx.font = '900 34px Arial';
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.textAlign = 'right';
    ctx.fillText('İNDİVA', CANVAS_W - 64, 90);
    ctx.textAlign = 'left';

    // Ürün görseli — beyaz kart üzerinde ortalanmış
    const cardX = 90, cardY = 180, cardW = CANVAS_W - 180, cardH = 610;
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.45)';
    ctx.shadowBlur = 50;
    ctx.shadowOffsetY = 25;
    ctx.fillStyle = '#ffffff';
    drawRoundedRect(ctx, cardX, cardY, cardW, cardH, 36);
    ctx.restore();

    if (safeImageUrl) {
        try {
            const img = await loadImage(safeImageUrl);
            const pad = 55;
            const availW = cardW - pad * 2, availH = cardH - pad * 2;
            const scale = Math.min(availW / img.width, availH / img.height, 1);
            const drawW = img.width * scale, drawH = img.height * scale;
            ctx.drawImage(
                img,
                cardX + (cardW - drawW) / 2,
                cardY + (cardH - drawH) / 2,
                drawW, drawH,
            );
        } catch {
            // Görsel yüklenemezse kart boş beyaz kalır — yine de devam edilir
        }
    }

    // İndirim rozeti — kartın sol üst köşesinde, hafif eğik
    const discountPct = item.oldPrice > 0 && item.newPrice > 0
        ? Math.round(((item.oldPrice - item.newPrice) / item.oldPrice) * 100)
        : 0;
    if (discountPct > 0) {
        ctx.save();
        ctx.translate(cardX + 30, cardY - 6);
        ctx.rotate(-0.07);
        const badgeText = `%${discountPct} İNDİRİM`;
        ctx.font = '900 36px Arial';
        const bw = ctx.measureText(badgeText).width + 60;
        const grad = ctx.createLinearGradient(0, 0, bw, 0);
        grad.addColorStop(0, '#FF9A3D');
        grad.addColorStop(1, '#E24B4A');
        ctx.fillStyle = grad;
        drawRoundedRect(ctx, 0, 0, bw, 72, 36);
        ctx.fillStyle = '#2a0d00';
        ctx.textBaseline = 'middle';
        ctx.fillText(badgeText, 30, 38);
        ctx.restore();
    }

    // Ürün başlığı
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = '#f5f5fa';
    ctx.font = '700 42px Arial';
    const titleLines = wrapText(ctx, item.title, CANVAS_W - 180, 2);
    let ty = cardY + cardH + 90;
    titleLines.forEach(line => {
        ctx.fillText(line, 90, ty);
        ty += 56;
    });

    // Fiyat satırı
    ty += 34;
    ctx.font = '900 78px Arial';
    ctx.fillStyle = '#FF8A3D';
    const newPriceText = `${Math.floor(item.newPrice).toLocaleString('tr-TR')} TL`;
    ctx.fillText(newPriceText, 90, ty);

    if (item.oldPrice > item.newPrice) {
        const newPriceWidth = ctx.measureText(newPriceText).width;
        const oldX = 90 + newPriceWidth + 34;
        const oldText = `${Math.floor(item.oldPrice).toLocaleString('tr-TR')} TL`;
        ctx.font = '500 42px Arial';
        ctx.fillStyle = 'rgba(255,255,255,0.42)';
        ctx.fillText(oldText, oldX, ty);
        const oldWidth = ctx.measureText(oldText).width;
        ctx.strokeStyle = 'rgba(255,255,255,0.42)';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(oldX, ty - 15);
        ctx.lineTo(oldX + oldWidth, ty - 15);
        ctx.stroke();
    }

    // Alt bant — çağrı metni
    const footerH = 116;
    ctx.fillStyle = 'rgba(255,122,26,0.14)';
    ctx.fillRect(0, CANVAS_H - footerH, CANVAS_W, footerH);
    ctx.font = '700 34px Arial';
    ctx.fillStyle = '#FF9A56';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('📲  İNDİVA\'da fırsatı yakala', CANVAS_W / 2, CANVAS_H - footerH / 2);
    ctx.textAlign = 'left';
}

// ─── Tekil kart bileşeni ────────────────────────────────────────────────────

interface CardProps {
    item: SocialContentItem;
    onPosted: (id: string) => void;
}

const SocialContentCard: React.FC<CardProps> = ({ item, onPosted }) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const [renderState, setRenderState] = useState<'loading' | 'ready' | 'error'>('loading');
    const [copied, setCopied] = useState(false);
    const [marking, setMarking] = useState(false);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            setRenderState('loading');
            let safeUrl: string | null = null;
            try {
                const uploaded = await uploadImageFromUrl(item.imageUrl);
                safeUrl = uploaded?.downloadURL || null;
            } catch {
                safeUrl = null;
            }
            if (cancelled || !canvasRef.current) return;
            try {
                await renderDealImage(canvasRef.current, item, safeUrl);
                if (!cancelled) setRenderState('ready');
            } catch {
                if (!cancelled) setRenderState('error');
            }
        })();
        return () => { cancelled = true; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [item.id]);

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
                    <div className="aspect-[4/5] w-full flex items-center justify-center">
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
                        Kalite Puanı: {item.score}/10
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
                        disabled={renderState !== 'ready'}
                        className="flex-1 min-w-[140px] py-2.5 bg-gradient-to-r from-orange-600 to-red-600 disabled:opacity-40 text-white text-sm font-bold rounded-xl transition-all active:scale-95 shadow-lg shadow-orange-900/30"
                    >
                        ⬇ Görseli İndir
                    </button>
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
