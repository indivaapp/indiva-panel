import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
    getSocialContentQueue, markSocialContentPosted, getDiscountsForPicker, addManualSocialContent,
    getRecentDiscountsForSocialAi, suggestSocialCandidates, generateSocialContentForProduct, addSocialContentFromAiSuggestion,
    getLatestAiSocialSuggestion, markAiSocialSuggestionOpened,
    type SocialContentCandidate,
} from '../services/firebase';
import { uploadImageFromUrl } from '../services/dealFinder';
import { Clipboard } from '@capacitor/clipboard';
import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { Media } from '@capacitor-community/media';
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

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob | null> {
    return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
}

function blobToBase64(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve((reader.result as string).split(',')[1] ?? '');
        reader.onerror = reject;
        reader.readAsDataURL(blob);
    });
}

// İNDİVA albümünü (yoksa) bir kere oluşturup identifier'ını önbelleğe alır —
// Media.saveVideo/savePhoto Android'de bir albümün identifier'ını istiyor.
let indivaAlbumPromise: Promise<string | undefined> | null = null;
function ensureIndivaAlbum(): Promise<string | undefined> {
    if (!indivaAlbumPromise) {
        indivaAlbumPromise = (async () => {
            try { await Media.createAlbum({ name: 'İNDİVA' }); } catch { /* zaten varsa hata verir, sorun değil */ }
            const { albums } = await Media.getAlbums();
            return albums.find(a => a.name === 'İNDİVA')?.identifier ?? albums[0]?.identifier;
        })();
    }
    return indivaAlbumPromise;
}

// Görsel/videoyu cihaza kaydeder.
// NOT: Önce Directory.Documents'a (uygulama-özel, görünmez klasör), sonra
// sadece native paylaşım sayfasını açmayı denedik — ama paylaşım ekranındaki
// hedeflerin hiçbiri "Galeriye kaydet" yapmıyordu, kullanıcı dosyayı telefonda
// bulamıyordu. Artık @capacitor-community/media ile Android'in MediaStore
// API'sini kullanıp gerçekten Galeri'de görünen bir "İNDİVA" albümüne
// kaydediyoruz — bu, ek izin gerektirmeyen resmi/modern yöntem.
// Web'de mevcut blob-URL + <a download> yöntemi (zaten çalıştığı için) aynen duruyor.
async function saveFileToDevice(blob: Blob, filename: string, title: string): Promise<void> {
    if (Capacitor.isNativePlatform()) {
        const albumIdentifier = await ensureIndivaAlbum();
        const base64 = await blobToBase64(blob);
        const dataUri = `data:${blob.type};base64,${base64}`;
        const baseName = filename.replace(/\.[^.]+$/, '');
        if (blob.type.startsWith('video/')) {
            await Media.saveVideo({ path: dataUri, albumIdentifier, fileName: baseName });
        } else {
            await Media.savePhoto({ path: dataUri, albumIdentifier, fileName: baseName });
        }
    } else {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        // NOT: revokeObjectURL'i hemen çağırmak, tarayıcının blob'u henüz okumaya
        // başlamadan indirmeyi iptal etmesine yol açabiliyordu (özellikle büyük
        // video dosyalarında) — indirmenin gerçekten başlaması için biraz bekliyoruz.
        setTimeout(() => URL.revokeObjectURL(url), 4000);
    }
}

// Görseli/videoyu native paylaşım sayfasıyla (WhatsApp, Instagram vb.) paylaşır.
// Web'de Web Share API'ye (destekleniyorsa) düşer, yoksa hata fırlatır.
async function shareFile(blob: Blob, filename: string, mimeType: string, title: string): Promise<void> {
    if (Capacitor.isNativePlatform()) {
        const base64 = await blobToBase64(blob);
        const written = await Filesystem.writeFile({ path: filename, data: base64, directory: Directory.Cache });
        await Share.share({ title, url: written.uri });
    } else if (navigator.share) {
        const file = new File([blob], filename, { type: mimeType });
        if (navigator.canShare && !navigator.canShare({ files: [file] })) {
            throw new Error('Bu tarayıcı dosya paylaşımını desteklemiyor.');
        }
        await navigator.share({ title, files: [file] });
    } else {
        throw new Error('Bu tarayıcı paylaşımı desteklemiyor.');
    }
}

// İNDİVA uygulama ikonu (alışveriş sepeti) — statik dosya, tüm kartlarda aynı,
// bir kere yükleyip önbelleğe alıyoruz.
let appIconPromise: Promise<HTMLImageElement> | null = null;
function loadAppIcon(): Promise<HTMLImageElement> {
    if (!appIconPromise) appIconPromise = loadImage('/indiva-app-icon.png');
    return appIconPromise;
}

interface CroppedLogo { img: HTMLImageElement; sx: number; sy: number; sw: number; sh: number }

// Google Play rozeti kaynak dosyası (PNG, alfa kanallı) — etrafındaki boşluğu
// otomatik kırpıp (piksel taraması) sadece üçgen+"Google Play" yazısını
// bırakıyoruz, yoksa rozet küçük görünür. Hem şeffaf hem beyaz-zeminli
// kaynaklarla çalışsın diye alfa VE beyazlık birlikte kontrol ediliyor.
// Bir kere hesaplayıp önbelleğe alıyoruz.
let playStoreLogoPromise: Promise<CroppedLogo> | null = null;
function loadPlayStoreLogo(): Promise<CroppedLogo> {
    if (!playStoreLogoPromise) {
        playStoreLogoPromise = loadImage('/google-play-logo.png').then((img) => {
            const off = document.createElement('canvas');
            off.width = img.width;
            off.height = img.height;
            const octx = off.getContext('2d')!;
            octx.drawImage(img, 0, 0);
            const { data } = octx.getImageData(0, 0, img.width, img.height);
            let minX = img.width, minY = img.height, maxX = 0, maxY = 0;
            for (let y = 0; y < img.height; y += 2) {
                for (let x = 0; x < img.width; x += 2) {
                    const i = (y * img.width + x) * 4;
                    const isTransparent = data[i + 3] < 10;
                    const isNearWhite = data[i] > 245 && data[i + 1] > 245 && data[i + 2] > 245;
                    if (!isTransparent && !isNearWhite) {
                        if (x < minX) minX = x;
                        if (x > maxX) maxX = x;
                        if (y < minY) minY = y;
                        if (y > maxY) maxY = y;
                    }
                }
            }
            const pad = 12;
            const sx = Math.max(0, minX - pad), sy = Math.max(0, minY - pad);
            const sw = Math.min(img.width, maxX + pad) - sx;
            const sh = Math.min(img.height, maxY + pad) - sy;
            return { img, sx, sy, sw, sh };
        });
    }
    return playStoreLogoPromise;
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
// Elemanlar belirdikten sonra tamamen durgun kalmasın diye hafif, sürekli
// bir salınım — progress'e bağlı (video boyunca yumuşak devam eder).
function idleWave(progress: number, freq: number, phase = 0): number {
    return Math.sin(progress * Math.PI * 2 * freq + phase);
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

// ── Arka plan renk paletleri ─────────────────────────────────────────────
// Her palet [koyu köşe, orta canlı ton, parlak vurgu] — aynı ışık/kontrast
// yapısını korur (koyudan parlağa) ki üstteki beyaz/altın metin/rozetler
// her palette'te okunaklı kalsın. Ürün bazında seçilir (bkz. pickPalette)
// — aynı gönderi içindeki fırsat + promo sahnesi aynı paleti kullanır,
// ama gönderiden gönderiye renk değişir; profil tek tonda dolmaz.
const BG_PALETTES: [string, string, string][] = [
    ['#3a1454', '#c2287a', '#ff7a1a'], // mor-pembe-turuncu (orijinal)
    ['#0f2f4a', '#0e6ba8', '#2ec4b6'], // lacivert-mavi-turkuaz
    ['#1a1a2e', '#e94560', '#ff9f1c'], // gece lacivert-kırmızı-amber
    ['#2d1b4e', '#8338ec', '#ff006e'], // mor-eflatun-magenta
    ['#0b3d2e', '#1b998b', '#f4d35e'], // koyu yeşil-teal-sarı
    ['#3d0e14', '#d7263d', '#f46036'], // bordo-kırmızı-mercan
    ['#131a3a', '#3f37c9', '#4cc9f0'], // gece mavisi-indigo-camgöbeği
    ['#3a1c1c', '#c1440e', '#ffbe0b'], // toprak kırmızı-turuncu-altın
    ['#1b1035', '#5f2eea', '#ff5da2'], // mor-menekşe-pembe
    ['#0d2b3e', '#118ab2', '#06d6a0'], // koyu mavi-turkuaz-yeşil
    ['#2b0f0f', '#9d0208', '#faa307'], // bordo-kızıl-amber
    ['#1e1a3c', '#7209b7', '#f72585'], // koyu mor-mor-pembe
    ['#0a2f2f', '#00a896', '#f0e442'], // koyu teal-yeşil-limon
    ['#2c1a4d', '#a4133c', '#ff8500'], // mor-bordo-turuncu
];

// Kategoriye göre "ruh hali" — her grup BG_PALETTES içindeki index'lere işaret
// eder (Teknoloji → soğuk mavi/neon, Giyim & Moda → mor/pembe editoryal, vb.)
// Eşlenmemiş bir kategori gelirse tüm palet havuzuna düşer (eski davranış).
const CATEGORY_PALETTE_GROUPS: Record<string, number[]> = {
    'Teknoloji':            [1, 6, 9],
    'Beyaz Eşya':           [1, 6, 9],
    'Otomotiv':             [1, 6, 9],
    'Giyim & Moda':         [3, 8, 11],
    'Ayakkabı & Çanta':     [3, 8, 11],
    'Kozmetik & Bakım':     [3, 8, 11],
    'Ev & Yaşam':           [5, 7, 10, 13],
    'Mobilya & Dekorasyon': [5, 7, 10, 13],
    'Bahçe & Yapı':         [5, 7, 10, 13],
    'Süpermarket':          [5, 7, 10, 13],
    'Yemek & İçecek':       [5, 7, 10, 13],
    'Anne & Bebek':         [4, 12],
    'Oyun & Oyuncak':       [4, 12],
    'Kitap & Kırtasiye':    [4, 12],
    'Pet Shop':             [4, 12],
    'Spor & Outdoor':       [2, 10],
    'Seyahat':              [2, 10],
    'Sağlık':               [2, 10],
};

// Ürün id'sinden (discountId/id) deterministik palet seçer — aynı ürün her
// zaman aynı paleti alır (fırsat sahnesi + promo sayfası tutarlı olur),
// aynı kategori içinde de gönderiden gönderiye renk değişir. Kategori
// verilmezse (veya eşlenmemişse) tüm palet havuzuna düşer.
function pickPalette(seed: string, category?: string): [string, string, string] {
    let hash = 0;
    for (let i = 0; i < seed.length; i++) {
        hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
    }
    const pool = (category && CATEGORY_PALETTE_GROUPS[category]) || null;
    if (pool && pool.length > 0) {
        return BG_PALETTES[pool[hash % pool.length]];
    }
    return BG_PALETTES[hash % BG_PALETTES.length];
}

// ── Arka plan: gradyan + ışık lekeleri + % işaretleri + parıltılar ──────────
// renderDealImage VE promo sayfası (renderPromoFrame) ortak kullanır — marka
// kimliği (İNDİVA renkleri, "indirim çılgınlığı" dokusu) her yerde aynı kalsın.
function drawBackground(ctx: CanvasRenderingContext2D, palette: [string, string, string] = BG_PALETTES[0]) {
    const bgGrad = ctx.createLinearGradient(0, 0, CANVAS_W, CANVAS_H);
    bgGrad.addColorStop(0, palette[0]);
    bgGrad.addColorStop(0.55, palette[1]);
    bgGrad.addColorStop(1, palette[2]);
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

    // ── İndirim çılgınlığı: arka planda dağınık % işaretleri (fırsat görseli olduğu ilk bakışta belli olsun) ──
    const bgMarks: [number, number, number, number, number, string][] = [
        // x, y, rotationDeg, fontSize, opacity, text
        [140, 155, -18, 92, 0.32, '%'],
        [940, 110, 16, 78, 0.30, '%50'],
        [1010, 400, -12, 60, 0.24, '%'],
        [50, 370, 22, 74, 0.28, '%70'],
        [530, 45, -8, 56, 0.20, '%'],
        [990, 920, -15, 84, 0.26, '%30'],
        [70, 1180, 18, 70, 0.26, '%'],
        [1025, 1580, -20, 80, 0.30, '%'],
        [60, 1690, 14, 68, 0.26, '%40'],
        [310, 1875, 10, 52, 0.18, '%'],
        [790, 1885, -12, 50, 0.18, '%20'],
        [1000, 1180, 20, 58, 0.22, '%'],
    ];
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    bgMarks.forEach(([x, y, rot, size, alpha, text], i) => {
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.translate(x, y);
        ctx.rotate(rot * Math.PI / 180);
        ctx.font = `900 ${size}px Arial`;
        ctx.fillStyle = i % 2 === 0 ? '#FFD966' : '#ffffff';
        ctx.fillText(text, 0, 0);
        ctx.restore();
    });
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
}

// renderDealImage/recordSequenceVideo'nun gerçekte ihtiyaç duyduğu alanların
// alt kümesi — tam SocialContentItem (caption/voiceover/status/createdAt vb.
// içerir) yerine bunu kabul ediyoruz ki AI aday listesindeki (henüz kuyruğa
// kaydedilmemiş, o alanları olmayan) ürünler de doğrudan video üretimine
// verilebilsin (bkz. "3'lü hızlı fırsat videosu"). Gerçek SocialContentItem
// nesneleri de yapısal olarak bunu karşıladığı için mevcut çağrılar bozulmaz.
type DealRenderItem = Pick<SocialContentItem, 'id' | 'discountId' | 'title' | 'category' | 'newPrice' | 'oldPrice'>;

/**
 * @param progress 0-1. Varsayılan 1 = statik/final görünüm (mevcut kullanım bozulmaz).
 *   Video animasyonu için 0'dan 1'e kadar art arda çağrılır.
 * @param cachedImg Önceden yüklenmiş ürün görseli — video her frame'de yeniden
 *   indirmesin diye. Verilmezse (statik kullanım) her zamanki gibi kendi yükler.
 * @returns Yüklenen görsel — çağıran, sonraki frame'ler için cache'leyebilir.
 */
async function renderDealImage(
    canvas: HTMLCanvasElement,
    item: DealRenderItem,
    safeImageUrl: string | null,
    progress: number = 1,
    cachedImg?: HTMLImageElement | null,
    // Video kaydı sırasında bu fonksiyon SANİYEDE ONLARCA kez çağrılıyor —
    // 'high' yumuşatma (özellikle görsel/gradyan kompozisyonunda) fark
    // edilir derecede daha pahalı. Tek seferlik statik görsel/paylaşım
    // render'ında kalite için 'high' kalıyor (varsayılan), video kaydı
    // çağrılarından 'medium' geçiriliyor — sıkıştırılmış sosyal medya
    // videosunda fark neredeyse görünmez, CPU tasarrufu ise belirgin.
    smoothingQuality: ImageSmoothingQuality = 'high',
): Promise<HTMLImageElement | null> {
    if (canvas.width !== CANVAS_W) canvas.width = CANVAS_W;
    if (canvas.height !== CANVAS_H) canvas.height = CANVAS_H;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = smoothingQuality;
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

    const palette = pickPalette(item.discountId || item.id, item.category);
    drawBackground(ctx, palette);

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
            const pad = 40;
            const availW = cardW - pad * 2, availH = cardH - pad * 2;

            // Ürün görseli kartın oranına tam oturmuyorsa (çoğu ürün fotoğrafı
            // kare/dikey değildir) kalan boşluk çıplak beyazdı — Instagram
            // Stories'in yaptığı gibi, aynı görselin bulanık "cover" halini
            // arkaya doldurup boş/amatör görünümü ortadan kaldırıyoruz.
            ctx.save();
            drawRoundedRect(ctx, cardX + 10, cardY + 10, cardW - 20, cardH - 20, 36);
            ctx.clip();
            const coverScale = Math.max(cardW / loadedImg.width, cardH / loadedImg.height);
            const coverW = loadedImg.width * coverScale, coverH = loadedImg.height * coverScale;
            ctx.filter = 'blur(45px) brightness(0.75) saturate(1.15)';
            ctx.drawImage(
                loadedImg,
                cardX + (cardW - coverW) / 2,
                cardY + (cardH - coverH) / 2,
                coverW, coverH,
            );
            ctx.filter = 'none';
            ctx.restore();

            // NOT: Üst sınır tamamen kaldırıldı — görsel, dar olan eksende
            // (genişlik ya da yükseklik) çerçeveyi UCA KADAR doldursun istendi.
            // Küçük kaynak görsellerde hafif bulanıklaşma olabilir ama bu,
            // kenarlarda boşluk kalmasından çok daha iyi görünüyor.
            const scale = Math.min(availW / loadedImg.width, availH / loadedImg.height);
            const drawW = loadedImg.width * scale, drawH = loadedImg.height * scale;
            ctx.save();
            ctx.shadowColor = 'rgba(0,0,0,0.4)';
            ctx.shadowBlur = 30;
            ctx.drawImage(
                loadedImg,
                cardX + (cardW - drawW) / 2,
                cardY + (cardH - drawH) / 2,
                drawW, drawH,
            );
            ctx.restore();
        }
    });

    // ── Slogan: ürün görselinin TAM ÜSTÜNDE, el yazısı tarzı (Caveat) ────────
    // Kullanıcı defalarca görselin üstüne bindiğini belirtti — artık kartın
    // dışında, header ile kart arasındaki boşlukta, gerçek bir "slogan" gibi.
    // İki satıra bölündü (altlı üstlü) — tek satırken sol taraftaki indirim
    // yıldızının altına giriyordu; alt alta durunca yatayda daha dar bir alan
    // kaplıyor ve yıldıza çarpmıyor.
    // KÖK NEDEN (video yırtılması — bulundu): bu satır KOŞULSUZ olarak await
    // ediliyordu — video kaydı sırasında renderDealImage saniyede onlarca kez
    // çağrıldığı için, HER karede fonksiyon tam ortasında (arka plan+kart
    // çizilmiş ama başlık/fiyat/CTA henüz çizilmemişken) askıya alınıp
    // tarayıcının başka işler (setInterval tüketicisi dahil) yapmasına izin
    // veriyordu — tüketici bu ANDA arabelleği kopyalarsa YARIM ÇİZİLMİŞ
    // (yırtık) bir kare kaydediliyordu. document.fonts.check() SENKRON bir
    // kontrol — font zaten yüklenmişse (ilk çağrıdan sonra hep öyle olur)
    // await'e hiç uğramadan devam ediyoruz, animasyon döngüsü artık gerçekten
    // bölünmez/atomik çalışıyor.
    if (!document.fonts.check("700 80px Caveat")) {
        try { await document.fonts.load("700 80px Caveat"); } catch { /* font yoksa sistem fontuna düşer */ }
    }
    withSlideFade(ctx, (1 - headerP) * -12, headerP, () => {
        ctx.save();
        ctx.translate(CANVAS_W / 2, 195);
        ctx.rotate(-3 * Math.PI / 180);
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const sloganLine1 = 'İNDİVA\'da';
        const sloganLine2 = 'İndirim Var!';
        const maxSloganW = CANVAS_W - 160;
        let sloganSize = 76;
        ctx.font = `700 ${sloganSize}px Caveat, cursive`;
        const maxRawW = Math.max(ctx.measureText(sloganLine1).width, ctx.measureText(sloganLine2).width);
        if (maxRawW > maxSloganW) sloganSize = Math.floor(sloganSize * (maxSloganW / maxRawW));
        ctx.font = `700 ${sloganSize}px Caveat, cursive`;
        ctx.shadowColor = 'rgba(0,0,0,0.45)';
        ctx.shadowBlur = 16;
        ctx.fillStyle = '#ffffff';
        const sloganLineGap = sloganSize * 0.64;
        ctx.fillText(sloganLine1, 0, -sloganLineGap / 2);
        ctx.fillText(sloganLine2, 0, sloganLineGap / 2);
        ctx.restore();
    });

    // ── İndirim rozeti: altın "kampanya çıkartması" (patlarcasına büyür) ─────
    if (discountPct > 0) {
        const bx = cardX + 60, by = cardY + 10, outerR = 140, innerR = 118;
        const burstSettle = segProgress(progress, 0.220, 0.260);
        const burstIdle = 1 + 0.025 * idleWave(progress, 5.5) * burstSettle;
        withPop(ctx, bx, by, burstP * burstIdle, burstP, () => {
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
    const urgencySettle = segProgress(progress, 0.260, 0.300);
    const urgencyIdleY = 3 * idleWave(progress, 5, 0.8) * urgencySettle;
    withSlideFade(ctx, (1 - urgencyP) * 20 + urgencyIdleY, urgencyP, () => {
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.font = '800 30px Arial';
        const urgencyText = '🔥 GÜNÜN ÖNE ÇIKAN FIRSATI!';
        const urgencyW = ctx.measureText(urgencyText).width + 56;
        ctx.fillStyle = 'rgba(255,255,255,0.22)';
        drawRoundedRect(ctx, CANVAS_W / 2 - urgencyW / 2, cardY + cardH + 40, urgencyW, 66, 33);
        ctx.fillStyle = '#ffffff';
        ctx.fillText(urgencyText, CANVAS_W / 2, cardY + cardH + 73);
        ctx.textAlign = 'left';
    });

    // ── Ürün başlığı (ortalı, gölgeli, aşağıdan kayarak belirir) ─────────────
    let ty = cardY + cardH + 195;
    const titleSettle = segProgress(progress, 0.300, 0.340);
    const titleIdleY = 3 * idleWave(progress, 4.5, 0.4) * titleSettle;
    withSlideFade(ctx, (1 - titleP) * 15 + titleIdleY, titleP, () => {
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

    const priceSettle = segProgress(progress, 0.360, 0.400);
    const priceIdle = 1 + 0.02 * idleWave(progress, 6, 1.1) * priceSettle;
    withPop(ctx, CANVAS_W / 2, ty - 25, (0.7 + 0.3 * priceP) * priceIdle, priceP, () => {
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
        const savingsSettle = segProgress(progress, 0.410, 0.450);
        const savingsIdle = 1 + 0.03 * idleWave(progress, 5, 2.2) * savingsSettle;
        withPop(ctx, CANVAS_W / 2, saveY + 35, savingsP * savingsIdle, savingsP, () => {
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

    // ── Alt CTA butonu (beyaz pil, koyu mor yazı, zıplayarak büyür) ──────────
    // NOT: Ayrı bir "Google Play'den İndir" banner'ı buradan kaldırıldı —
    // promo sayfasında (video/2. sahne) zaten Play Store yönlendirmesi var,
    // burada tekrar etmek yerine CTA o boşluğu doldursun diye yukarı taşındı.
    const ctaW = 780, ctaH = 110, ctaX = (CANVAS_W - ctaW) / 2, ctaY = 1650;
    const ctaSettle = segProgress(progress, 0.470, 0.510);
    const ctaIdle = 1 + 0.015 * idleWave(progress, 4, 3.0) * ctaSettle;
    withPop(ctx, CANVAS_W / 2, ctaY + ctaH / 2, ctaP * ctaIdle, ctaP, () => {
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
        ctx.textAlign = 'left';
        ctx.textBaseline = 'alphabetic';
    });

    // ── Alt footer: uygulamayı çok kısa tanıtan satır ────────────────────────
    // Görseli/videoyu tek başına gören biri (context'siz) İNDİVA'nın ne
    // olduğunu anlayabilsin diye — CTA butonunun hemen altında, küçük ve sade.
    withPop(ctx, CANVAS_W / 2, ctaY + ctaH + 55, ctaP, ctaP, () => {
        ctx.textAlign = 'center';
        ctx.font = '600 28px Arial';
        ctx.fillStyle = 'rgba(255,255,255,0.75)';
        const footerLines = wrapText(ctx, 'İNDİVA — Online Alışverişte İndirim & Fırsat Uygulaması', CANVAS_W - 140, 2);
        let fy = ctaY + ctaH + 50;
        footerLines.forEach(line => { ctx.fillText(line, CANVAS_W / 2, fy); fy += 36; });
        ctx.textAlign = 'left';
    });

    return loadedImg;
}

// ── "Daha fazla fırsat" promo sayfası — videonun son bölümü. İçeriği üründen
// bağımsız (her video için aynı metin/logo), ama arka plan rengi fırsat
// sahnesiyle tutarlı olsun diye aynı palette parametresini alır. ────────────
async function renderPromoFrame(canvas: HTMLCanvasElement, appIconImg: HTMLImageElement | null, palette: [string, string, string] = BG_PALETTES[0]): Promise<void> {
    if (canvas.width !== CANVAS_W) canvas.width = CANVAS_W;
    if (canvas.height !== CANVAS_H) canvas.height = CANVAS_H;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);
    drawBackground(ctx, palette);

    const iconSize = 220, iconX = CANVAS_W / 2 - iconSize / 2, iconY = 360;
    if (appIconImg) {
        ctx.save();
        ctx.shadowColor = 'rgba(0,0,0,0.5)';
        ctx.shadowBlur = 50;
        ctx.shadowOffsetY = 20;
        ctx.fillStyle = '#ffffff';
        drawRoundedRect(ctx, iconX, iconY, iconSize, iconSize, 48);
        ctx.restore();
        ctx.save();
        drawRoundedRect(ctx, iconX, iconY, iconSize, iconSize, 48);
        ctx.clip();
        ctx.drawImage(appIconImg, iconX, iconY, iconSize, iconSize);
        ctx.restore();
        ctx.strokeStyle = '#FFD966';
        ctx.lineWidth = 6;
        strokeRoundedRect(ctx, iconX + 3, iconY + 3, iconSize - 6, iconSize - 6, 46);
    }

    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.35)';
    ctx.shadowBlur = 14;
    ctx.fillStyle = '#ffffff';
    ctx.font = '900 62px Arial';
    const headlineLines = wrapText(ctx, 'Daha Fazla Fırsat Seni Bekliyor!', CANVAS_W - 160, 2);
    let hy = 700;
    headlineLines.forEach(line => { ctx.fillText(line, CANVAS_W / 2, hy); hy += 76; });
    ctx.restore();

    ctx.font = '600 34px Arial';
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    const subLines = wrapText(ctx, 'Yüzlerce mağazadaki anlık indirimleri kaçırmamak için sen de İNDİVA uygulamasını indir!', CANVAS_W - 220, 3);
    let sy = hy + 20;
    subLines.forEach(line => { ctx.fillText(line, CANVAS_W / 2, sy); sy += 46; });

    const ctaW = 840, ctaH = 130, ctaX = (CANVAS_W - ctaW) / 2, ctaY = 1500;

    // Google Play rozeti — kullanıcının sağladığı gerçek logo, beyaz kenar
    // boşlukları kırpılıp doğrudan (beyaz plaka OLMADAN) şeffaf haliyle
    // çiziliyor — arka planla kaynaşsın diye, sadece hafif bir gölgeyle.
    let playStoreLogo: CroppedLogo | null = null;
    try { playStoreLogo = await loadPlayStoreLogo(); } catch { playStoreLogo = null; }
    if (playStoreLogo) {
        const aspect = playStoreLogo.sw / playStoreLogo.sh;
        const availTop = sy + 20;
        const availBottom = ctaY - 40;
        const maxH = Math.max(0, availBottom - availTop);
        const maxW = CANVAS_W - 280;
        const logoH = Math.min(maxH, maxW / aspect);
        const logoW = logoH * aspect;
        const logoX = CANVAS_W / 2 - logoW / 2;
        const logoY = availTop + (maxH - logoH) / 2;
        ctx.save();
        ctx.shadowColor = 'rgba(0,0,0,0.4)';
        ctx.shadowBlur = 24;
        ctx.shadowOffsetY = 10;
        ctx.drawImage(
            playStoreLogo.img,
            playStoreLogo.sx, playStoreLogo.sy, playStoreLogo.sw, playStoreLogo.sh,
            logoX, logoY, logoW, logoH,
        );
        ctx.restore();
    }
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.35)';
    ctx.shadowBlur = 30;
    ctx.shadowOffsetY = 10;
    const ctaGrad = ctx.createLinearGradient(ctaX, 0, ctaX + ctaW, 0);
    ctaGrad.addColorStop(0, '#2563eb');
    ctaGrad.addColorStop(1, '#0ea5a4');
    ctx.fillStyle = ctaGrad;
    drawRoundedRect(ctx, ctaX, ctaY, ctaW, ctaH, 65);
    ctx.restore();
    ctx.fillStyle = '#ffffff';
    ctx.font = '900 40px Arial';
    ctx.textBaseline = 'middle';
    ctx.fillText('📲 Google Play\'den Ücretsiz İndir', CANVAS_W / 2, ctaY + ctaH / 2 + 2);
    ctx.textBaseline = 'alphabetic';

    ctx.font = '700 30px Arial';
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.fillText('İNDİVA ile hiçbir fırsatı kaçırma!', CANVAS_W / 2, ctaY + ctaH + 70);
    ctx.textAlign = 'left';
}

// ── Sayfa çevirme geçişi: fırsat sahnesi yatayda katlanıp promo sayfasına
// döner (klasik "kart çevirme" efekti — cos(açı) ile yatay ölçek) ───────────
function easeInOutCubic(t: number): number {
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

// ─── Animasyonlu video kaydı (tarayıcı içi, sunucuya gerek yok) ─────────────
// canvas.captureStream + MediaRecorder ile kaydeder. Sırasıyla: fırsat sahnesi
// (mevcut animasyon) → sayfa çevirme geçişi → "daha fazla fırsat" promo sayfası.
// MP4 (H.264) destekleniyorsa onu, yoksa WebM'e düşer.
// Varsayılan: ilk sayfa 14sn, geçiş 0.6sn, ikinci sayfa 5.4sn (~20sn toplam).
// Admin bu iki süreyi (ilk/ikinci sayfa) her video için ayrı ayarlayabilir —
// bkz. SocialContentCard'daki dealSec/promoSec state'i.
const DEAL_DURATION_MS_DEFAULT = 14000;
const SLIDE_DURATION_MS = 600;
const PROMO_DURATION_MS_DEFAULT = 5400;
// NOT: 60fps'te bu kadar ağır bir çizimi (gradyan/gölge/metin/1080x1920) her
// karede yetiştirmek WebView'de (telefonda) genelde mümkün olmuyordu —
// captureStream(60) yetişemeyen kareleri bir öncekiyle dolduruyor, bu da
// oynatımda "takılma" olarak görünüyordu. 30fps, bu çizim karmaşıklığı için
// gerçekçi bir hedef; kare başına bütçe iki katına çıkıyor (16.6ms → 33ms).
const VIDEO_FPS = 30;

function pickSupportedMimeType(): string {
    const candidates = [
        'video/mp4;codecs=avc1.42E01E',
        'video/mp4',
        'video/webm;codecs=vp9',
        'video/webm;codecs=vp8',
        'video/webm',
    ];
    for (const type of candidates) {
        if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(type)) return type;
    }
    return 'video/webm';
}

interface VideoSegment {
    item: DealRenderItem;
    cachedImg: HTMLImageElement | null;
    durationMs: number;
}

/**
 * recordDealVideo'nun genelleştirilmiş hali — TEK ürün yerine bir DİZİ ürünü
 * arka arkaya kaydedip sonunda TEK bir paylaşılan promo/outro'ya geçiş yapar
 * (bkz. "3'lü hızlı fırsat videosu"). Tüm performans mimarisi (üretici/
 * tüketici ayrımı, durgun-kare önbelleği, GC baskısı düzeltmesi, font ısıtma)
 * korunuyor — sadece tek segment yerine N segment üzerinde döngü kuruluyor.
 * recordDealVideo artık bunun tek-segmentlik bir sarmalayıcısı.
 */
async function recordSequenceVideo(
    canvas: HTMLCanvasElement,
    segments: VideoSegment[],
    onProgress?: (fraction: number) => void,
    promoDurationMs: number = PROMO_DURATION_MS_DEFAULT,
): Promise<Blob> {
    if (segments.length === 0) throw new Error('En az bir ürün seçilmeli.');

    // Her segment kendi süresi + bir sonraki sahneye (segment veya promo)
    // geçiş payı kaplar. Son segmentin geçişi promo'ya gider.
    const bounds: { start: number; end: number }[] = [];
    let cursor = 0;
    for (const seg of segments) {
        bounds.push({ start: cursor, end: cursor + seg.durationMs });
        cursor += seg.durationMs + SLIDE_DURATION_MS;
    }
    const videoDurationMs = cursor + promoDurationMs;

    if (typeof (canvas as any).captureStream !== 'function' || typeof MediaRecorder === 'undefined') {
        throw new Error('Bu tarayıcı video kaydını desteklemiyor.');
    }
    if (canvas.width !== CANVAS_W) canvas.width = CANVAS_W;
    if (canvas.height !== CANVAS_H) canvas.height = CANVAS_H;
    const visibleCtx = canvas.getContext('2d');
    if (!visibleCtx) throw new Error('Canvas context alınamadı.');
    visibleCtx.imageSmoothingEnabled = true;
    visibleCtx.imageSmoothingQuality = 'high';

    // Her kare önce bu görünmez arabellek canvas'ına çiziliyor, sonra TEK
    // senkron drawImage ile asıl (captureStream'e bağlı) canvas'a aktarılıyor.
    // Render fonksiyonları clearRect + await adımlarından oluştuğu için,
    // doğrudan görünen canvas'a çizersek MediaRecorder bazen "temizlenmiş ama
    // henüz yeniden çizilmemiş" bir kareyi yakalayıp videoda flaş/titreme
    // olarak kaydediyordu — bu arabellek bunu tamamen ortadan kaldırıyor.
    const buffer = document.createElement('canvas');
    buffer.width = CANVAS_W;
    buffer.height = CANVAS_H;

    // ── captureStream(0) + track.requestFrame() DENENDİ, GERİ ALINDI ─────────
    // Android WebView'de bu kombinasyon güvenilmez çıktı — canlı testte video
    // sadece 2. sahneyi (promo) içeriyordu, 1. sahne (ürün) hiç kaydedilmedi
    // ve ilerleme çubuğu doğrudan ~%75'ten başlıyordu; yani manuel requestFrame()
    // çağrıları büyük ölçüde yok sayılıp kayıt gerçekte geç başlamış gibi
    // davrandı. Bu yüzden OTOMATİK captureStream(fps) moduna dönüldü (kanıtlanmış,
    // çalışan yol) — ama üretici/tüketici ayrımı (aşağıda) korunuyor: pahalı
    // çizim hâlâ arka planda bağımsız çalışıyor, görünen canvas'a aktarım
    // (blit) hâlâ SABİT aralıklı bir zamanlayıcıyla yapılıyor — bu da eski
    // "sadece yavaş render bitince blit et" düzensizliğini ortadan kaldırıp
    // otomatik yakalamanın daha DÜZENLİ kareler görmesini sağlıyor, riskli
    // manuel-frame API'sine ihtiyaç duymadan.
    const stream: MediaStream = (canvas as any).captureStream(VIDEO_FPS);
    const mimeType = pickSupportedMimeType();
    // 12Mbps -> 8Mbps: sosyal medya zaten agresif sıkıştırıyor, fark
    // neredeyse görünmez ama kodlayıcı (encoder) yükü belirgin azalıyor —
    // JS çizim işiyle aynı anda CPU'yu paylaşan encoder da takılmanın bir
    // parçasıydı.
    const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 8_000_000 });
    const chunks: Blob[] = [];

    let appIconImg: HTMLImageElement | null = null;
    try { appIconImg = await loadAppIcon(); } catch { appIconImg = null; }
    // Kayıt başlamadan ÖNCE "Caveat" fontunu bir kez ısıt — böylece animasyon
    // döngüsündeki İLK kare bile document.fonts.check() ile senkron geçer,
    // hiçbir kare yarım çizilmiş halde yakalanamaz (bkz. renderDealImage
    // içindeki kök neden notu).
    try { await document.fonts.load("700 80px Caveat"); } catch { /* yoksa sorun değil */ }

    // Geçiş ve ikinci sayfa kendi içinde ayrıca animasyon oynatmıyor (statik) —
    // önceden her karede İKİ tam sahneyi (blur filtreleri dahil) yeniden çizmek
    // özellikle geçişte videoyu belirgin şekilde kasıyordu. Artık ilk (fırsat,
    // progress=1) ve ikinci (promo) sahne BİR KEZ render edilip önbelleğe
    // alınıyor; geçiş sırasında sadece bu iki hazır kareyi kaydırarak
    // birleştiriyoruz (ucuz, sadece drawImage).
    // NOT: İlk denemede bu önbelleğe alma işlemi geçiş TAM BAŞLARKEN (ilk
    // ihtiyaç duyulduğu anda) yapılıyordu — bu tek seferlik ama pahalı işlem
    // (blur filtreli tam sahne render'ı) tam da akıcılığın en çok önemli
    // olduğu anda bir kare atlanmasına/donmaya yol açıyordu. Artık promo
    // sayfası (ürüne bağlı olmadığı için) kayıt başlamadan HEMEN önce, fırsat
    // sahnesinin dondurulmuş hali de geçişten ~300ms önce arka planda
    // önceden ısıtılıyor — geçiş anına geldiğimizde ikisi de zaten hazır.
    // Promo/outro ürüne bağlı değil (marka/CTA) — paletini SON segmentin
    // ürününden alıyoruz (o segmentten geçişte renk sürekliliği en iyi olsun diye).
    const lastItem = segments[segments.length - 1].item;
    const promoSnapshot = document.createElement('canvas');
    promoSnapshot.width = CANVAS_W;
    promoSnapshot.height = CANVAS_H;
    await renderPromoFrame(promoSnapshot, appIconImg, pickPalette(lastItem.discountId || lastItem.id, lastItem.category));

    // Her segment kendi durgun-kare önbelleğini alır (bkz. SETTLE_PROGRESS notu).
    const dealSnapshotPromises: (Promise<HTMLCanvasElement> | null)[] = segments.map(() => null);
    const getDealSnapshot = (idx: number) => {
        if (!dealSnapshotPromises[idx]) {
            dealSnapshotPromises[idx] = (async () => {
                const c = document.createElement('canvas');
                c.width = CANVAS_W;
                c.height = CANVAS_H;
                await renderDealImage(c, segments[idx].item, null, 1, segments[idx].cachedImg, 'medium');
                return c;
            })();
        }
        return dealSnapshotPromises[idx]!;
    };
    // Tüm giriş animasyonlarının segProgress aralıkları en geç 0.470'te
    // biter (bkz. ctaP) — yani progress >= SETTLE_PROGRESS için
    // renderDealImage'ın çizdiği HER ŞEY (gradyan/kart/başlık/fiyat/CTA)
    // progress=1 ile MATEMATİKSEL OLARAK BİREBİR AYNIDIR (idleWave'in çok
    // hafif "nefes alma" salınımı hariç — bu ihmal edilebilir bir görsel
    // fark karşılığında devasa bir performans kazancı). Bu yüzden her
    // segmentin ~ikinci yarısı boyunca ağır (10+ gölge bulanıklığı içeren)
    // tam render yerine ÖNCEDEN hazırlanmış aynı kareyi tekrar tekrar
    // kullanabiliyoruz — takılmanın en büyük kaynağı buydu.
    const SETTLE_PROGRESS = 0.5;

    return new Promise((resolve, reject) => {
        recorder.ondataavailable = (e: BlobEvent) => { if (e.data.size > 0) chunks.push(e.data); };
        recorder.onerror = () => reject(new Error('Video kaydı başarısız oldu.'));
        recorder.onstop = () => {
            stream.getTracks().forEach(t => t.stop());
            resolve(new Blob(chunks, { type: mimeType }));
        };

        const bufferCtx = buffer.getContext('2d')!;
        bufferCtx.imageSmoothingEnabled = true;
        bufferCtx.imageSmoothingQuality = 'medium';
        const startTime = performance.now();
        // İlk segmentin durgun kareyi ARKA PLANDA hemen hesaplamaya başla —
        // SETTLE_PROGRESS'e ulaşıldığında (ilk ~%50'nin sonunda) zaten hazır
        // olsun, tekrar beklemeye gerek kalmasın.
        getDealSnapshot(0).catch(() => {});
        const prewarmed = new Set<number>([0]);

        // ── Üretici: TÜKETİCİYLE AYNI HIZDA (VIDEO_FPS) çizer ─────────────────
        // KANIT (canlı videoyu ffprobe ile kare kare analiz ettikten sonra
        // bulundu): önceki sürüm üretici döngüsünü "setTimeout(r, 0)" ile
        // olabildiğince hızlı çalıştırıyordu — tüketicinin ihtiyacından
        // (saniyede ${VIDEO_FPS} kare) 2-3 KAT daha fazla kare üretip
        // arabelleğe yazıyordu, ama bunların çoğu tüketici tarafından hiç
        // okunmadan bir sonraki render tarafından ÜZERİNE YAZILIYORDU — saf
        // israf. Bu aşırı üretim, gradyan/gölge çizimlerinin yarattığı çöpü
        // (garbage) gereksiz yere 2-3 katına çıkarıp tarayıcının çöp
        // toplayıcısını (GC) tetikliyordu — ffprobe analizinde tam olarak
        // animasyonlu bölümde (ilk ~6.5sn) periyodik 150-330ms'lik donmalar
        // olarak görüldü. Artık üretici de frameIntervalMs kadar bekliyor —
        // gereksiz kare üretimi (ve GC baskısı) ortadan kalkıyor, hâlâ
        // gerçek bir makro-görev sınırı (setTimeout) olduğu için önceki
        // "1. sahne kaybı" hatası da geri gelmiyor.
        const frameIntervalMs = 1000 / VIDEO_FPS;
        let stopProducing = false;
        const runProducer = async () => {
            while (!stopProducing) {
                const elapsed = performance.now() - startTime;
                if (elapsed >= videoDurationMs) break;

                // Elapsed zamana karşılık gelen segmenti bul (N küçük, döngü ucuz).
                let segIdx = -1;
                for (let i = 0; i < bounds.length; i++) {
                    if (elapsed < bounds[i].end + SLIDE_DURATION_MS) { segIdx = i; break; }
                }

                if (segIdx === -1) {
                    // Tüm segmentler bitti — promo/outro sahnesindeyiz.
                    bufferCtx.setTransform(1, 0, 0, 1, 0, 0);
                    bufferCtx.drawImage(promoSnapshot, 0, 0);
                } else {
                    const { start, end } = bounds[segIdx];
                    // Bir sonraki segmente (veya promo'ya) geçişten ~300ms önce
                    // hedef kareyi arka planda ısıt.
                    if (elapsed >= end - 300 && !prewarmed.has(segIdx + 1)) {
                        prewarmed.add(segIdx + 1);
                        if (segIdx + 1 < segments.length) getDealSnapshot(segIdx + 1).catch(() => {});
                    }

                    if (elapsed < end) {
                        const p = (elapsed - start) / (end - start);
                        if (p >= SETTLE_PROGRESS) {
                            // Sahne artık "durgun" — ağır tam render yerine
                            // önbellekteki hazır kareyi kopyala (ucuz).
                            const settled = await getDealSnapshot(segIdx);
                            bufferCtx.setTransform(1, 0, 0, 1, 0, 0);
                            bufferCtx.clearRect(0, 0, CANVAS_W, CANVAS_H);
                            bufferCtx.drawImage(settled, 0, 0);
                        } else {
                            await renderDealImage(buffer, segments[segIdx].item, null, p, segments[segIdx].cachedImg, 'medium');
                        }
                    } else {
                        // Geçiş: bu segmentten bir sonrakine (veya son segmentse promo'ya).
                        const flipT = (elapsed - end) / SLIDE_DURATION_MS;
                        const current = await getDealSnapshot(segIdx);
                        const next = segIdx + 1 < segments.length ? await getDealSnapshot(segIdx + 1) : promoSnapshot;
                        const offset = easeInOutCubic(flipT) * CANVAS_W;
                        bufferCtx.setTransform(1, 0, 0, 1, 0, 0);
                        bufferCtx.clearRect(0, 0, CANVAS_W, CANVAS_H);
                        bufferCtx.drawImage(current, -offset, 0);
                        bufferCtx.drawImage(next, CANVAS_W - offset, 0);
                    }
                }
                // Gerçek bir makro-görev sınırına (setTimeout) uğruyoruz — hem
                // tüketicinin (setInterval) düzenli aralıklarla araya girmesini
                // garantiliyor (bkz. "1. sahne kaybı" geçmişi) HEM DE üretimi
                // tüketicinin gerçek ihtiyacıyla (VIDEO_FPS) sınırlayarak
                // gereksiz kare/çöp üretimini (GC donmalarının kaynağı) önlüyor.
                await new Promise(r => setTimeout(r, frameIntervalMs));
            }
        };
        const producerPromise = runProducer();

        // ── Tüketici: SABİT aralıkla (üretim hızından bağımsız) kaydeder ─────
        let stopped = false;
        const stopAndResolve = () => {
            if (stopped) return;
            stopped = true;
            clearInterval(outputTimer);
            stopProducing = true;
            setTimeout(() => recorder.stop(), 150);
        };
        const outputTimer = setInterval(() => {
            const elapsed = performance.now() - startTime;
            onProgress?.(Math.min(1, elapsed / videoDurationMs));
            // Arabelleği SABİT aralıklarla görünen canvas'a basıyoruz — canvas'ı
            // "kirletip" otomatik captureStream(VIDEO_FPS) mekanizmasının
            // düzenli aralıklarla yakalamasını sağlıyoruz.
            visibleCtx.drawImage(buffer, 0, 0);
            if (elapsed >= videoDurationMs) stopAndResolve();
        }, frameIntervalMs);

        recorder.start();
        producerPromise.catch(() => {});
    });
}

async function recordDealVideo(
    canvas: HTMLCanvasElement,
    item: SocialContentItem,
    cachedImg: HTMLImageElement | null,
    onProgress?: (fraction: number) => void,
    dealDurationMs: number = DEAL_DURATION_MS_DEFAULT,
    promoDurationMs: number = PROMO_DURATION_MS_DEFAULT,
): Promise<Blob> {
    return recordSequenceVideo(canvas, [{ item, cachedImg, durationMs: dealDurationMs }], onProgress, promoDurationMs);
}

/**
 * Ürün görselini CORS-güvenli şekilde yükleyip verilen canvas'a çizer —
 * önce görseli doğrudan dener (çoğu CDN zaten CORS'a izin veriyor), tainted
 * çıkarsa proxy üzerinden CORS-safe bir kopyaya düşer. SocialContentCard'ın
 * kendi önizlemesi VE çoklu ürün videosu (bkz. handleCreateMultiVideo)
 * tarafından ortak kullanılır — mantık tek bir yerde.
 */
async function loadCleanProductImage(
    canvas: HTMLCanvasElement,
    item: DealRenderItem,
    imageUrl: string,
): Promise<HTMLImageElement | null> {
    try {
        const img = await renderDealImage(canvas, item, imageUrl);
        canvas.toDataURL(); // tainted canvas mı diye ucuz bir kontrol — öyleyse burada atar
        return img;
    } catch {
        // Görsel CORS'a kapalı (tainted) veya yüklenemedi — proxy'ye düş
    }
    let safeUrl: string | null = null;
    try {
        const uploaded = await uploadImageFromUrl(imageUrl);
        safeUrl = uploaded?.downloadURL || null;
    } catch {
        safeUrl = null;
    }
    try {
        return await renderDealImage(canvas, item, safeUrl);
    } catch {
        return null;
    }
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
    const [voiceoverCopied, setVoiceoverCopied] = useState(false);
    const [marking, setMarking] = useState(false);
    const [videoState, setVideoState] = useState<'idle' | 'recording' | 'ready' | 'error'>('idle');
    const [videoProgress, setVideoProgress] = useState(0);
    const [videoUrl, setVideoUrl] = useState<string | null>(null);
    const [videoExt, setVideoExt] = useState<'mp4' | 'webm'>('mp4');
    const videoBlobRef = useRef<Blob | null>(null);
    const [shareError, setShareError] = useState<'image' | 'video' | null>(null);
    // İndirme butonlarına tıklayınca (özellikle video — base64 kodlama +
    // galeriye yazma birkaç saniye sürebiliyor) hiçbir geri bildirim
    // olmaması "buton çalışmıyor" izlenimi veriyordu — artık "İndiriliyor…"
    // / "İndirildi ✓" durumları gösteriliyor.
    const [imageDownloadState, setImageDownloadState] = useState<'idle' | 'saving' | 'done'>('idle');
    const [videoDownloadState, setVideoDownloadState] = useState<'idle' | 'saving' | 'done'>('idle');
    // Video iki sahneden oluşuyor: ilk sahne ürünü, ikinci sahne uygulamayı
    // tanıtıyor. Her video için ayrı ayarlanabilsin diye kart bazında state —
    // saniye cinsinden, kayıt sırasında ms'ye çevrilip recordDealVideo'ya verilir.
    const [dealSec, setDealSec] = useState(Math.round(DEAL_DURATION_MS_DEFAULT / 1000));
    const [promoSec, setPromoSec] = useState(Math.round(PROMO_DURATION_MS_DEFAULT / 1000));

    useEffect(() => {
        let cancelled = false;
        (async () => {
            setRenderState('loading');
            const canvas = canvasRef.current;
            if (!canvas) return;
            const img = await loadCleanProductImage(canvas, item, item.imageUrl);
            if (cancelled) return;
            if (img) {
                cachedImgRef.current = img;
                setRenderState('ready');
            } else {
                setRenderState('error');
            }
        })();
        return () => { cancelled = true; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [item.id]);

    // Bileşen kapanırken oluşturulmuş video object URL'ini serbest bırak
    useEffect(() => () => { if (videoUrl) URL.revokeObjectURL(videoUrl); }, [videoUrl]);

    const handleDownload = async () => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const blob = await canvasToBlob(canvas);
        if (!blob) return;
        setImageDownloadState('saving');
        try {
            await saveFileToDevice(blob, `indiva-${item.discountId}.png`, item.title);
            setImageDownloadState('done');
            setTimeout(() => setImageDownloadState('idle'), 2000);
        } catch {
            setImageDownloadState('idle');
            setShareError('image');
            setTimeout(() => setShareError(null), 2500);
        }
    };

    const handleShareImage = async () => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const blob = await canvasToBlob(canvas);
        if (!blob) return;
        try {
            await shareFile(blob, `indiva-${item.discountId}.png`, 'image/png', item.title);
        } catch {
            setShareError('image');
            setTimeout(() => setShareError(null), 2500);
        }
    };

    const handleCreateVideo = async () => {
        const canvas = canvasRef.current;
        if (!canvas || videoState === 'recording') return;
        setVideoState('recording');
        setVideoProgress(0);
        try {
            const dealMs = Math.max(3, Math.min(60, dealSec)) * 1000;
            const promoMs = Math.max(3, Math.min(60, promoSec)) * 1000;
            const blob = await recordDealVideo(canvas, item, cachedImgRef.current, setVideoProgress, dealMs, promoMs);
            videoBlobRef.current = blob;
            const url = URL.createObjectURL(blob);
            setVideoUrl(url);
            setVideoExt(blob.type.includes('mp4') ? 'mp4' : 'webm');
            setVideoState('ready');
        } catch {
            setVideoState('error');
        }
    };

    const handleDownloadVideo = async () => {
        if (!videoBlobRef.current) return;
        setVideoDownloadState('saving');
        try {
            await saveFileToDevice(videoBlobRef.current, `indiva-${item.discountId}.${videoExt}`, item.title);
            setVideoDownloadState('done');
            setTimeout(() => setVideoDownloadState('idle'), 2000);
        } catch {
            setVideoDownloadState('idle');
            setShareError('video');
            setTimeout(() => setShareError(null), 2500);
        }
    };

    const handleShareVideo = async () => {
        if (!videoBlobRef.current) return;
        try {
            await shareFile(videoBlobRef.current, `indiva-${item.discountId}.${videoExt}`, videoBlobRef.current.type, item.title);
        } catch {
            setShareError('video');
            setTimeout(() => setShareError(null), 2500);
        }
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

    const handleCopyVoiceover = async () => {
        if (!item.voiceover) return;
        try {
            await Clipboard.write({ string: item.voiceover });
            setVoiceoverCopied(true);
            setTimeout(() => setVoiceoverCopied(false), 2000);
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

                {item.voiceover && (
                    <div className="bg-gray-900 border border-indigo-600/30 rounded-xl p-3">
                        <div className="flex items-center justify-between gap-2 mb-1.5">
                            <p className="text-indigo-300 text-xs font-bold flex items-center gap-1">
                                🎙️ Seslendirme Metni (ElevenLabs için)
                            </p>
                            <button
                                onClick={handleCopyVoiceover}
                                className="shrink-0 text-[11px] font-semibold px-2.5 py-1 rounded-lg bg-indigo-600/80 hover:bg-indigo-500 text-white transition-colors"
                            >
                                {voiceoverCopied ? '✓ Kopyalandı' : '📋 Kopyala'}
                            </button>
                        </div>
                        <p className="text-gray-300 text-xs leading-relaxed whitespace-pre-line">{item.voiceover}</p>
                    </div>
                )}

                <div className="flex flex-wrap gap-2">
                    <button
                        onClick={handleCopyCaption}
                        className="flex-1 min-w-[140px] py-2.5 bg-gray-700 hover:bg-gray-600 text-white text-sm font-medium rounded-xl transition-colors active:scale-95"
                    >
                        {copied ? '✓ Kopyalandı' : '📋 Metni Kopyala'}
                    </button>
                    <button
                        onClick={handleDownload}
                        disabled={renderState !== 'ready' || videoState === 'recording' || imageDownloadState === 'saving'}
                        className="flex-1 min-w-[140px] py-2.5 bg-gradient-to-r from-orange-600 to-red-600 disabled:opacity-40 text-white text-sm font-bold rounded-xl transition-all active:scale-95 shadow-lg shadow-orange-900/30"
                    >
                        {imageDownloadState === 'saving'
                            ? <><span className="inline-block w-3.5 h-3.5 border-2 border-white/40 border-t-white rounded-full animate-spin align-[-2px] mr-1.5" />İndiriliyor…</>
                            : imageDownloadState === 'done'
                            ? '✓ İndirildi'
                            : '⬇ Görseli İndir'}
                    </button>
                    <button
                        onClick={handleShareImage}
                        disabled={renderState !== 'ready' || videoState === 'recording'}
                        className="flex-1 min-w-[140px] py-2.5 bg-gray-700 hover:bg-gray-600 disabled:opacity-40 text-white text-sm font-bold rounded-xl transition-all active:scale-95"
                    >
                        📤 Görseli Paylaş
                    </button>

                    {videoState !== 'ready' && (
                        <div className="w-full flex items-center gap-3 bg-gray-900/60 border border-gray-700 rounded-xl px-3 py-2">
                            <label className="flex items-center gap-1.5 text-[11px] text-gray-400 flex-1">
                                1. Ekran (sn)
                                <input
                                    type="number"
                                    min={3}
                                    max={60}
                                    value={dealSec}
                                    disabled={videoState === 'recording'}
                                    onChange={e => setDealSec(Number(e.target.value) || 0)}
                                    className="w-14 bg-gray-800 border border-gray-600 rounded-lg px-1.5 py-1 text-white text-xs text-center disabled:opacity-50"
                                />
                            </label>
                            <label className="flex items-center gap-1.5 text-[11px] text-gray-400 flex-1">
                                2. Ekran (sn)
                                <input
                                    type="number"
                                    min={3}
                                    max={60}
                                    value={promoSec}
                                    disabled={videoState === 'recording'}
                                    onChange={e => setPromoSec(Number(e.target.value) || 0)}
                                    className="w-14 bg-gray-800 border border-gray-600 rounded-lg px-1.5 py-1 text-white text-xs text-center disabled:opacity-50"
                                />
                            </label>
                        </div>
                    )}
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
                            disabled={videoDownloadState === 'saving'}
                            className="flex-1 min-w-[140px] py-2.5 bg-gradient-to-r from-purple-600 to-pink-600 disabled:opacity-60 text-white text-sm font-bold rounded-xl transition-all active:scale-95 shadow-lg shadow-purple-900/30"
                        >
                            {videoDownloadState === 'saving'
                                ? <><span className="inline-block w-3.5 h-3.5 border-2 border-white/40 border-t-white rounded-full animate-spin align-[-2px] mr-1.5" />İndiriliyor…</>
                                : videoDownloadState === 'done'
                                ? '✓ İndirildi'
                                : `⬇ Videoyu İndir (.${videoExt})`}
                        </button>
                    )}
                    {videoState === 'ready' && (
                        <button
                            onClick={handleShareVideo}
                            className="flex-1 min-w-[140px] py-2.5 bg-gray-700 hover:bg-gray-600 text-white text-sm font-bold rounded-xl transition-all active:scale-95"
                        >
                            📤 Videoyu Paylaş
                        </button>
                    )}

                    {shareError && (
                        <p className="w-full text-[11px] text-red-400 text-center -mt-1">
                            {shareError === 'video' ? 'Video' : 'Görsel'} kaydedilemedi/paylaşılamadı — tekrar dener misin?
                        </p>
                    )}

                    {videoState === 'ready' && videoExt === 'webm' && (
                        <p className="w-full text-[11px] text-gray-500 text-center -mt-1">
                            Bu tarayıcı MP4 kaydını desteklemediği için .webm formatında indi.
                            Instagram MP4 istiyorsa, paylaşmadan önce telefonundaki bir
                            dönüştürücü uygulamayla MP4'e çevirmen gerekebilir.
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

    // AI ile sosyal medya içerik önerisi — İKİ AŞAMALI:
    // 1) suggestSocialCandidates: son 100 ilandan en iyi 10'u PUANLAR (içerik yok).
    // 2) Admin bunlardan birini seçince generateSocialContentForProduct SADECE
    //    o ürün için başlık+caption üretir — "Yeniden Üret" aynı fonksiyonu
    //    tekrar çağırır. Önceden 3 ürünün TAMAMI için içerik üretiliyordu; artık
    //    sadece admin'in seçtiği TEK ürün için üretiliyor (gereksiz AI çağrısı yok).
    // AiPickProduct: hem canlı "AI ile Öner" akışının (tam Discount) hem de
    // zamanlı öneri kaydının (kısaltılmış ürün özeti) ortak alt kümesi.
    type AiPickProduct = Pick<Discount, 'id' | 'title' | 'imageUrl' | 'link' | 'category' | 'brand' | 'oldPrice' | 'newPrice' | 'reviewCount'>;
    const [aiLoading, setAiLoading] = useState(false);
    const [aiError, setAiError] = useState<string | null>(null);
    const [aiCandidates, setAiCandidates] = useState<Array<{ candidate: SocialContentCandidate; product: AiPickProduct }>>([]);
    const [showAiModal, setShowAiModal] = useState(false);
    // Adım 1: aday listesi (selectedCandidate null). Adım 2: seçilen ürün için içerik üretimi/gösterimi.
    const [selectedCandidate, setSelectedCandidate] = useState<{ candidate: SocialContentCandidate; product: AiPickProduct } | null>(null);
    const [generatedContent, setGeneratedContent] = useState<{ title: string; caption: string; voiceover: string } | null>(null);
    const [voiceoverCopied, setVoiceoverCopied] = useState(false);
    const [generatingContent, setGeneratingContent] = useState(false);
    const [contentError, setContentError] = useState<string | null>(null);
    const [usingPickId, setUsingPickId] = useState<string | null>(null);

    // ── 3'lü hızlı fırsat videosu (aday listesinden çoklu seçim) ────────────
    const [multiSelectIds, setMultiSelectIds] = useState<Set<string>>(new Set());
    const [multiVideoMode, setMultiVideoMode] = useState(false);
    const [multiVideoState, setMultiVideoState] = useState<'idle' | 'recording' | 'ready' | 'error'>('idle');
    const [multiVideoProgress, setMultiVideoProgress] = useState(0);
    const [multiVideoUrl, setMultiVideoUrl] = useState<string | null>(null);
    const [multiVideoDownloadState, setMultiVideoDownloadState] = useState<'idle' | 'saving' | 'done'>('idle');
    const multiCanvasRef = useRef<HTMLCanvasElement>(null);
    const multiVideoBlobRef = useRef<Blob | null>(null);
    const multiVideoExtRef = useRef<'mp4' | 'webm'>('mp4');

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

    // Zamanlı öneriyi kontrol et (scripts/auto-social-ai-suggest.js günde 3 kez
    // yazıyor + admin'e push bildirimi gönderiyor). Sayfa açıldığında (bildirime
    // tıklanınca veya elle gezinilince) taze ve henüz görülmemiş bir öneri varsa
    // otomatik göster — AI çağrısı TEKRAR yapılmaz, hazır sonuç kullanılır.
    useEffect(() => {
        (async () => {
            try {
                const suggestion = await getLatestAiSocialSuggestion();
                if (!suggestion || suggestion.opened) return;
                const ageMin = (Date.now() - suggestion.createdAtMs) / 60000;
                if (ageMin > 20) return; // 20dk'dan eski — artık güncel sayılmaz
                const matched = suggestion.candidates.map(c => ({ candidate: c, product: c.product }));
                if (matched.length === 0) return;
                setAiCandidates(matched);
                setShowAiModal(true);
                markAiSocialSuggestionOpened().catch(() => {});
            } catch {
                // sessiz — zamanlı öneri opsiyonel bir kolaylık, hata akışı bozmasın
            }
        })();
    }, []);

    const handlePosted = (id: string) => {
        setItems(prev => prev.filter(i => i.id !== id));
    };

    const togglePicker = async () => {
        const next = !pickerOpen;
        setPickerOpen(next);
        if (next && allDiscounts.length === 0) {
            setDiscountsLoading(true);
            try {
                const data = await getDiscountsForPicker(300);
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

    // Son 100 ilanı tarayıp AI'a en iyi 10 adayı puanlatan akış (henüz içerik
    // üretmez). Sadece bu buton tıklandığında çalışır — otomatik/periyodik değil.
    const handleAiSuggest = async () => {
        setAiLoading(true);
        setAiError(null);
        try {
            const discounts = await getRecentDiscountsForSocialAi();
            if (discounts.length === 0) {
                setAiError('Henüz analiz edilecek yeterli ilan yok.');
                return;
            }
            const candidates = await suggestSocialCandidates(discounts);
            const matched = candidates
                .map(candidate => {
                    const product = discounts.find(d => d.id === candidate.productId);
                    return product ? { candidate, product } : null;
                })
                .filter((x): x is { candidate: SocialContentCandidate; product: Discount } => x !== null);

            if (matched.length === 0) {
                setAiError('AI geçerli ürün seçemedi, tekrar deneyin.');
                return;
            }
            setAiCandidates(matched);
            setShowAiModal(true);
        } catch (e: any) {
            setAiError(e?.message || 'AI önerisi alınamadı.');
        } finally {
            setAiLoading(false);
        }
    };

    // Adaylardan biri seçildiğinde SADECE o ürün için içerik üretir.
    const handleSelectCandidate = async (item: { candidate: SocialContentCandidate; product: AiPickProduct }) => {
        setSelectedCandidate(item);
        setGeneratedContent(null);
        setContentError(null);
        setVoiceoverCopied(false);
        setGeneratingContent(true);
        try {
            const content = await generateSocialContentForProduct(item.product);
            setGeneratedContent(content);
        } catch (e: any) {
            setContentError(e?.message || 'İçerik üretilemedi.');
        } finally {
            setGeneratingContent(false);
        }
    };

    // Beğenilmeyen içerik için aynı ürüne yeniden içerik ürettirir.
    const handleRegenerateContent = async () => {
        if (!selectedCandidate) return;
        setContentError(null);
        setVoiceoverCopied(false);
        setGeneratingContent(true);
        try {
            const content = await generateSocialContentForProduct(selectedCandidate.product);
            setGeneratedContent(content);
        } catch (e: any) {
            setContentError(e?.message || 'İçerik üretilemedi.');
        } finally {
            setGeneratingContent(false);
        }
    };

    const handleBackToCandidates = () => {
        setSelectedCandidate(null);
        setGeneratedContent(null);
        setContentError(null);
        setVoiceoverCopied(false);
    };

    const closeAiModal = () => {
        setShowAiModal(false);
        setSelectedCandidate(null);
        setGeneratedContent(null);
        setContentError(null);
        setVoiceoverCopied(false);
        setMultiVideoMode(false);
        setMultiSelectIds(new Set());
        setMultiVideoState('idle');
        if (multiVideoUrl) URL.revokeObjectURL(multiVideoUrl);
        setMultiVideoUrl(null);
    };

    const toggleMultiSelect = (e: React.MouseEvent, productId: string) => {
        e.stopPropagation();
        setMultiSelectIds(prev => {
            const next = new Set(prev);
            if (next.has(productId)) {
                next.delete(productId);
            } else if (next.size < 5) {
                next.add(productId);
            }
            return next;
        });
    };

    // Seçilen 2-5 ürünü tek bir videoda birleştirir (bkz. recordSequenceVideo).
    // Her ürün için önce CORS-güvenli görseli hazırlar, sonra kayda başlar.
    const handleCreateMultiVideo = async () => {
        const selected = aiCandidates.filter(c => multiSelectIds.has(c.candidate.productId));
        if (selected.length < 2) return;

        setMultiVideoMode(true);
        setMultiVideoState('recording');
        setMultiVideoProgress(0);

        const canvas = multiCanvasRef.current;
        if (!canvas) { setMultiVideoState('error'); return; }

        try {
            const prepCanvas = document.createElement('canvas');
            const segments = [];
            for (const c of selected) {
                const renderItem: DealRenderItem = {
                    id: c.product.id,
                    discountId: c.product.id,
                    title: c.product.title,
                    category: c.product.category,
                    newPrice: c.product.newPrice,
                    oldPrice: c.product.oldPrice,
                };
                const cachedImg = await loadCleanProductImage(prepCanvas, renderItem, c.product.imageUrl);
                segments.push({ item: renderItem, cachedImg, durationMs: 3800 });
            }
            const blob = await recordSequenceVideo(canvas, segments, setMultiVideoProgress, PROMO_DURATION_MS_DEFAULT);
            multiVideoBlobRef.current = blob;
            multiVideoExtRef.current = blob.type.includes('mp4') ? 'mp4' : 'webm';
            setMultiVideoUrl(URL.createObjectURL(blob));
            setMultiVideoState('ready');
        } catch {
            setMultiVideoState('error');
        }
    };

    const handleBackFromMultiVideo = () => {
        setMultiVideoMode(false);
        setMultiVideoState('idle');
        if (multiVideoUrl) URL.revokeObjectURL(multiVideoUrl);
        setMultiVideoUrl(null);
        multiVideoBlobRef.current = null;
    };

    const handleDownloadMultiVideo = async () => {
        if (!multiVideoBlobRef.current) return;
        setMultiVideoDownloadState('saving');
        try {
            await saveFileToDevice(multiVideoBlobRef.current, `indiva-derleme-${Date.now()}.${multiVideoExtRef.current}`, 'İNDİVA Fırsat Derlemesi');
            setMultiVideoDownloadState('done');
            setTimeout(() => setMultiVideoDownloadState('idle'), 2000);
        } catch {
            setMultiVideoDownloadState('idle');
        }
    };

    const handleShareMultiVideo = async () => {
        if (!multiVideoBlobRef.current) return;
        try {
            await shareFile(
                multiVideoBlobRef.current,
                `indiva-derleme-${Date.now()}.${multiVideoExtRef.current}`,
                multiVideoBlobRef.current.type,
                'İNDİVA Fırsat Derlemesi',
            );
        } catch { /* sessiz — kullanıcı paylaşım penceresini iptal etmiş olabilir */ }
    };

    const handleCopyVoiceover = async () => {
        if (!generatedContent?.voiceover) return;
        try {
            await Clipboard.write({ string: generatedContent.voiceover });
            setVoiceoverCopied(true);
            setTimeout(() => setVoiceoverCopied(false), 2000);
        } catch {
            // Clipboard API kullanılamıyorsa sessizce yok say
        }
    };

    const handleUseAiPick = async () => {
        if (!selectedCandidate || !generatedContent) return;
        setUsingPickId(selectedCandidate.candidate.productId);
        try {
            await addSocialContentFromAiSuggestion(selectedCandidate.product, generatedContent);
            await fetchItems();
            closeAiModal();
        } catch {
            setContentError('İçerik kuyruğa eklenemedi, tekrar deneyin.');
        } finally {
            setUsingPickId(null);
        }
    };

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
                <div className="flex items-center gap-2 shrink-0">
                    <button
                        onClick={handleAiSuggest}
                        disabled={aiLoading}
                        className="flex items-center gap-1.5 text-xs font-bold px-3 py-2.5 rounded-lg bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-500 hover:to-pink-500 disabled:opacity-50 text-white transition-all"
                    >
                        {aiLoading
                            ? <><span className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Taranıyor…</>
                            : <>🤖 AI ile Öner</>}
                    </button>
                    <button
                        onClick={fetchItems}
                        className="text-sm text-gray-400 hover:text-white px-3 py-2 rounded-lg hover:bg-gray-800 transition-colors"
                    >
                        ↻ Yenile
                    </button>
                </div>
            </div>

            {aiError && (
                <p className="text-red-400 text-xs mb-4 -mt-3">{aiError}</p>
            )}

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

            {/* AI Sosyal Medya İçerik Önerisi Modalı — Adım 1: 10 aday, Adım 2: seçilenin içeriği */}
            {showAiModal && aiCandidates.length > 0 && (
                <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4" onClick={closeAiModal}>
                    <div
                        className="bg-gray-800 border border-purple-600/40 rounded-2xl w-full max-w-lg max-h-[85vh] overflow-y-auto p-5"
                        onClick={e => e.stopPropagation()}
                    >
                        {multiVideoMode ? (
                            <>
                                <div className="flex items-center justify-between mb-1">
                                    <button onClick={handleBackFromMultiVideo} className="text-gray-400 hover:text-white text-xs flex items-center gap-1">
                                        ← Listeye dön
                                    </button>
                                    <button onClick={closeAiModal} className="text-gray-400 hover:text-white text-xl leading-none">×</button>
                                </div>
                                <h3 className="text-white font-bold text-base mb-3">🎬 {multiSelectIds.size}'lü Fırsat Derlemesi</h3>

                                <canvas ref={multiCanvasRef} className={multiVideoState === 'ready' ? 'hidden' : 'w-full rounded-xl bg-gray-950'} width={1080} height={1920} style={{ aspectRatio: '9/16', maxHeight: '50vh', objectFit: 'contain' }} />

                                {multiVideoState === 'recording' && (
                                    <div className="mt-3 space-y-2">
                                        <div className="w-full h-2 bg-gray-800 rounded-full overflow-hidden">
                                            <div className="h-full bg-purple-500 transition-all" style={{ width: `${multiVideoProgress}%` }} />
                                        </div>
                                        <p className="text-gray-400 text-xs text-center">Video oluşturuluyor… %{multiVideoProgress}</p>
                                    </div>
                                )}

                                {multiVideoState === 'error' && (
                                    <div className="mt-3 space-y-2.5">
                                        <div className="bg-red-950/50 border border-red-500/20 rounded-xl px-3 py-2.5">
                                            <p className="text-red-300 text-xs">❌ Video oluşturulamadı. Tekrar deneyin.</p>
                                        </div>
                                        <button
                                            onClick={handleCreateMultiVideo}
                                            className="w-full py-2 text-xs font-semibold bg-purple-600 hover:bg-purple-500 text-white rounded-lg transition-colors"
                                        >
                                            🔄 Tekrar Dene
                                        </button>
                                    </div>
                                )}

                                {multiVideoState === 'ready' && multiVideoUrl && (
                                    <div className="mt-3 space-y-3">
                                        <video src={multiVideoUrl} controls loop className="w-full rounded-xl bg-gray-950" style={{ maxHeight: '50vh' }} />
                                        <div className="flex gap-2">
                                            <button
                                                onClick={handleDownloadMultiVideo}
                                                disabled={multiVideoDownloadState === 'saving'}
                                                className="flex-1 py-2 text-xs font-semibold bg-gray-700 hover:bg-gray-600 disabled:opacity-50 text-gray-200 rounded-lg transition-colors"
                                            >
                                                {multiVideoDownloadState === 'saving' ? 'Kaydediliyor…' : multiVideoDownloadState === 'done' ? '✓ Kaydedildi' : '⬇️ İndir'}
                                            </button>
                                            <button
                                                onClick={handleShareMultiVideo}
                                                className="flex-1 py-2 text-xs font-semibold bg-purple-600 hover:bg-purple-500 text-white rounded-lg transition-colors"
                                            >
                                                📤 Paylaş
                                            </button>
                                        </div>
                                    </div>
                                )}
                            </>
                        ) : !selectedCandidate ? (
                            <>
                                <div className="flex items-center justify-between mb-1">
                                    <h3 className="text-white font-bold text-base flex items-center gap-2">🤖 AI'nın Önerdiği {aiCandidates.length} Ürün</h3>
                                    <button onClick={closeAiModal} className="text-gray-400 hover:text-white text-xl leading-none">×</button>
                                </div>
                                <p className="text-gray-500 text-xs mb-4">Beğendiğiniz ürünü seçin — içerik SADECE o ürün için üretilecek. Ya da birden fazla ürün işaretleyip tek bir derleme videosu oluşturun.</p>

                                <div className="space-y-2.5 pb-2">
                                    {aiCandidates.map((item) => {
                                        const discountPct = item.product.oldPrice > item.product.newPrice && item.product.oldPrice > 0
                                            ? Math.round(((item.product.oldPrice - item.product.newPrice) / item.product.oldPrice) * 100)
                                            : 0;
                                        const isChecked = multiSelectIds.has(item.candidate.productId);
                                        return (
                                            <div
                                                key={item.candidate.productId}
                                                onClick={() => handleSelectCandidate(item)}
                                                role="button"
                                                tabIndex={0}
                                                className={`w-full text-left bg-gray-900/60 border rounded-xl p-3 transition-colors cursor-pointer ${isChecked ? 'border-purple-500' : 'border-gray-700 hover:border-purple-500/50'}`}
                                            >
                                                <div className="flex items-center gap-3">
                                                    <button
                                                        onClick={(e) => toggleMultiSelect(e, item.candidate.productId)}
                                                        className={`shrink-0 w-5 h-5 rounded-md border-2 flex items-center justify-center text-[11px] font-bold transition-colors ${isChecked ? 'bg-purple-600 border-purple-600 text-white' : 'border-gray-600 text-transparent hover:border-purple-400'}`}
                                                        aria-label="Derlemeye ekle"
                                                    >
                                                        ✓
                                                    </button>
                                                    {item.product.imageUrl && (
                                                        <img src={item.product.imageUrl} alt="" className="w-14 h-14 object-contain bg-white rounded-lg shrink-0" />
                                                    )}
                                                    <div className="min-w-0 flex-1">
                                                        <div className="flex items-center gap-1.5">
                                                            <span className="shrink-0 text-[10px] font-bold px-1.5 py-0.5 rounded bg-purple-600/30 text-purple-300">
                                                                ⭐ {item.candidate.score}/10
                                                            </span>
                                                            <p className="text-white text-sm font-semibold line-clamp-1">{item.product.title}</p>
                                                        </div>
                                                        <p className="text-purple-300 text-xs mt-0.5">
                                                            {Math.floor(item.product.newPrice)} TL
                                                            {item.product.oldPrice > item.product.newPrice && (
                                                                <span className="text-gray-500 line-through ml-1.5">{Math.floor(item.product.oldPrice)} TL</span>
                                                            )}
                                                            {discountPct > 0 && <span className="text-green-400 ml-1.5">%{discountPct}</span>}
                                                        </p>
                                                        {item.candidate.reasoning && (
                                                            <p className="text-gray-500 text-[11px] mt-1 italic line-clamp-1">"{item.candidate.reasoning}"</p>
                                                        )}
                                                    </div>
                                                    {item.product.link && (
                                                        <a
                                                            href={item.product.link}
                                                            target="_blank"
                                                            rel="noopener noreferrer"
                                                            onClick={e => e.stopPropagation()}
                                                            className="shrink-0 flex flex-col items-center gap-0.5 px-2.5 py-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-300 hover:text-white text-[10px] font-semibold transition-colors"
                                                        >
                                                            <span className="text-sm leading-none">🔗</span>
                                                            İndirime Git
                                                        </a>
                                                    )}
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>

                                {multiSelectIds.size > 0 && (
                                    <div className="sticky bottom-0 -mx-5 -mb-5 mt-3 px-5 py-3 bg-gray-800/95 border-t border-purple-600/30 flex items-center justify-between gap-3">
                                        <p className="text-gray-300 text-xs">
                                            {multiSelectIds.size} ürün seçildi{multiSelectIds.size < 2 ? ' (en az 2 gerekli)' : ''}
                                        </p>
                                        <button
                                            onClick={handleCreateMultiVideo}
                                            disabled={multiSelectIds.size < 2}
                                            className="shrink-0 px-4 py-2 text-xs font-semibold bg-purple-600 hover:bg-purple-500 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-lg transition-colors"
                                        >
                                            🎬 {multiSelectIds.size}'lü Video Oluştur
                                        </button>
                                    </div>
                                )}
                            </>
                        ) : (
                            <>
                                <div className="flex items-center justify-between mb-1">
                                    <button onClick={handleBackToCandidates} className="text-gray-400 hover:text-white text-xs flex items-center gap-1">
                                        ← Listeye dön
                                    </button>
                                    <button onClick={closeAiModal} className="text-gray-400 hover:text-white text-xl leading-none">×</button>
                                </div>

                                <div className="flex items-center gap-3 my-3 bg-gray-900/60 border border-gray-700 rounded-xl p-3">
                                    {selectedCandidate.product.imageUrl && (
                                        <img src={selectedCandidate.product.imageUrl} alt="" className="w-14 h-14 object-contain bg-white rounded-lg shrink-0" />
                                    )}
                                    <div className="min-w-0 flex-1">
                                        <p className="text-white text-sm font-semibold line-clamp-1">{selectedCandidate.product.title}</p>
                                        <p className="text-purple-300 text-xs mt-0.5">{Math.floor(selectedCandidate.product.newPrice)} TL</p>
                                        {selectedCandidate.product.link && (
                                            <a
                                                href={selectedCandidate.product.link}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="text-blue-400 text-[11px] hover:underline"
                                            >
                                                🔗 İndirimi linkten kontrol et
                                            </a>
                                        )}
                                    </div>
                                </div>

                                {generatingContent && (
                                    <div className="flex items-center justify-center gap-2 py-8 text-gray-400 text-sm">
                                        <span className="w-4 h-4 border-2 border-gray-500 border-t-purple-400 rounded-full animate-spin" />
                                        İçerik üretiliyor...
                                    </div>
                                )}

                                {!generatingContent && contentError && (
                                    <div className="bg-red-950/50 border border-red-500/20 rounded-xl px-3 py-2.5 mb-3">
                                        <p className="text-red-300 text-xs">{contentError}</p>
                                    </div>
                                )}

                                {!generatingContent && generatedContent && (
                                    <div className="bg-gray-900/60 border border-gray-700 rounded-xl p-3 mb-3">
                                        <p className="text-white text-sm font-bold mb-1">{generatedContent.title}</p>
                                        <p className="text-gray-300 text-xs leading-relaxed whitespace-pre-line">{generatedContent.caption}</p>
                                    </div>
                                )}

                                {!generatingContent && generatedContent?.voiceover && (
                                    <div className="bg-gray-900/60 border border-indigo-600/30 rounded-xl p-3 mb-3">
                                        <div className="flex items-center justify-between gap-2 mb-1.5">
                                            <p className="text-indigo-300 text-xs font-bold flex items-center gap-1">
                                                🎙️ Seslendirme Metni (ElevenLabs için)
                                            </p>
                                            <button
                                                onClick={handleCopyVoiceover}
                                                className="shrink-0 text-[11px] font-semibold px-2.5 py-1 rounded-lg bg-indigo-600/80 hover:bg-indigo-500 text-white transition-colors"
                                            >
                                                {voiceoverCopied ? '✓ Kopyalandı' : '📋 Kopyala'}
                                            </button>
                                        </div>
                                        <p className="text-gray-300 text-xs leading-relaxed whitespace-pre-line">{generatedContent.voiceover}</p>
                                    </div>
                                )}

                                {!generatingContent && (
                                    <div className="flex gap-2">
                                        <button
                                            onClick={handleRegenerateContent}
                                            className="flex-1 py-2 text-xs font-semibold bg-gray-700 hover:bg-gray-600 text-gray-200 rounded-lg transition-colors"
                                        >
                                            🔄 Yeniden Üret
                                        </button>
                                        <button
                                            onClick={handleUseAiPick}
                                            disabled={!generatedContent || usingPickId !== null}
                                            className="flex-1 py-2 text-xs font-semibold bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white rounded-lg transition-colors"
                                        >
                                            {usingPickId ? 'Ekleniyor…' : 'Kuyruğa Ekle'}
                                        </button>
                                    </div>
                                )}
                            </>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
};

export default SocialContentManager;
