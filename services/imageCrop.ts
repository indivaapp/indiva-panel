/**
 * Gemini'nin döndürdüğü [y1,x1,y2,x2] (0-1000 normalize) bounding box ile
 * bir görüntüyü kırpar. Başarısız olursa orijinal görüntüyü döndürür.
 * ShareTarget.tsx ve QuickProductShareOverlay.tsx tarafından ortak kullanılır.
 */
export async function cropImageByBox(
    buffer: ArrayBuffer,
    mimeType: string,
    box: [number, number, number, number]
): Promise<Blob> {
    return new Promise((resolve) => {
        const blob = new Blob([buffer], { type: mimeType });
        const url  = URL.createObjectURL(blob);
        const img  = new Image();

        img.onload = () => {
            try {
                const [y1, x1, y2, x2] = box;
                const W = img.naturalWidth;
                const H = img.naturalHeight;

                const sx = Math.max(0, Math.round((x1 / 1000) * W));
                const sy = Math.max(0, Math.round((y1 / 1000) * H));
                const sw = Math.min(W - sx, Math.round(((x2 - x1) / 1000) * W));
                const sh = Math.min(H - sy, Math.round(((y2 - y1) / 1000) * H));

                if (sw < 50 || sh < 50) {
                    URL.revokeObjectURL(url);
                    resolve(blob);
                    return;
                }

                const canvas = document.createElement('canvas');
                canvas.width  = sw;
                canvas.height = sh;
                const ctx = canvas.getContext('2d')!;
                ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);

                canvas.toBlob(
                    (cropped) => {
                        URL.revokeObjectURL(url);
                        resolve(cropped || blob);
                    },
                    'image/jpeg',
                    0.90
                );
            } catch {
                URL.revokeObjectURL(url);
                resolve(blob);
            }
        };

        img.onerror = () => {
            URL.revokeObjectURL(url);
            resolve(blob);
        };

        img.src = url;
    });
}

/** Base64 (data URI öneki olmadan) → ArrayBuffer */
export function base64ToArrayBuffer(base64: string): ArrayBuffer {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes.buffer;
}
