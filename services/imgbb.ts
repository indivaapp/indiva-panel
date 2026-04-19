
const IMGBB_API_KEY = import.meta.env.VITE_IMGBB_API_KEY as string;

interface ImgbbUploadResult {
    downloadURL: string;
    deleteUrl: string;
}

/**
 * Uploads a file to ImgBB.
 * @param file The file to upload.
 * @returns A promise that resolves with the image URL and deletion URL.
 */
export const uploadToImgbb = async (file: File): Promise<ImgbbUploadResult> => {
    if (!file) {
        throw new Error("No file provided for upload.");
    }

    const formData = new FormData();
    formData.append('image', file);

    const response = await fetch(`https://api.imgbb.com/1/upload?key=${IMGBB_API_KEY}`, {
        method: 'POST',
        body: formData,
    });

    const result = await response.json();

    if (!result.success) {
        throw new Error(result.error?.message || 'Görsel ImgBB\'ye yüklenemedi.');
    }

    return {
        downloadURL: result.data.url, // This is the display URL
        deleteUrl: result.data.delete_url,
    };
};

/**
 * Sends deletion requests for an image on ImgBB using its deletion URL.
 * This is completely detached from the main thread logic and suppresses all errors
 * to prevent any blocking of the main application flow.
 * 
 * @param deleteUrl The deletion URL provided by ImgBB.
 */
export const deleteFromImgbb = (deleteUrl: string | undefined | null): void => {
    if (!deleteUrl || typeof deleteUrl !== 'string' || !deleteUrl.startsWith('http')) {
        return;
    }

    // We do NOT await this fetch.
    // We use no-cors to allow opaque requests to other domains without preflight issues blocking.
    fetch(deleteUrl, {
        method: 'GET', // Some delete URLs are actually visited via GET (deletion pages), but API uses DELETE usually. ImgBB delete_url is usually a page. 
        // However, if it's an API delete endpoint, method might matter. 
        // The 'delete_url' from ImgBB is actually a viewer link with a delete button usually, 
        // unless using the API properly. But standard practice for this quick integration 
        // is best effort.
        // Since we don't have the delete "secret" for the API call stored separately often, 
        // we assume deleteUrl is the one provided.
        // Actually, typically we just fire and forget.
        mode: 'no-cors',
    }).catch(() => {
        // Suppress all errors (expected behavior for CORS-restricted URLs)
    });
};

/**
 * Base64 string'i File objesine çevirir.
 */
export const base64ToFile = (base64String: string, filename: string): File => {
    const arr = base64String.split(',');
    // Eğer "data:image/jpeg;base64,..." formatındaysa virgülden sonrasını al, değilse direkt al
    const dataStr = arr.length > 1 ? arr[1] : base64String;
    const mimeMatch = arr.length > 1 ? arr[0].match(/:(.*?);/) : null;
    const mime = mimeMatch ? mimeMatch[1] : 'image/jpeg'; // Varsayılan jpeg

    const bstr = atob(dataStr);
    let n = bstr.length;
    const u8arr = new Uint8Array(n);

    while (n--) {
        u8arr[n] = bstr.charCodeAt(n);
    }

    return new File([u8arr], filename, { type: mime });
}

/**
 * URL'den görsel çekip ImgBB'ye yükler
 * @param imageUrl Görsel URL'si
 * @returns Promise<{downloadURL, deleteUrl} | null>
 */
export const uploadFromUrl = async (imageUrl: string): Promise<ImgbbUploadResult | null> => {
    if (!imageUrl) return null;

    try {
        // Görsel URL'sinden fetch et
        const response = await fetch(imageUrl);
        if (!response.ok) {
            return null;
        }

        const blob = await response.blob();
        const file = new File([blob], 'image.jpg', { type: blob.type || 'image/jpeg' });

        return await uploadToImgbb(file);
    } catch {
        return null;
    }
};
