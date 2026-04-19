/**
 * Uygulama genelinde kullanılan timeout sabitleri (ms)
 */

/** Kısa işlemler (link çözümleme, basit API) */
export const TIMEOUT_SHORT = 10_000;

/** Standart proxy/API istekleri */
export const TIMEOUT_DEFAULT = 15_000;

/** Uzun süren fetch (Jina, Vercel scrape) */
export const TIMEOUT_LONG = 30_000;

/** Görsel yükleme (ImgBB, Vercel image-upload) */
export const TIMEOUT_IMAGE_UPLOAD = 45_000;

/** IP engelleme bekleme süresi (5 dakika) */
export const TIMEOUT_IP_BLOCK = 5 * 60_000;

/** Rate limiting minimum bekleme */
export const RATE_LIMIT_INTERVAL = 2_000;

/** Cache TTL (10 dakika) */
export const CACHE_TTL = 10 * 60_000;
