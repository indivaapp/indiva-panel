/**
 * idCache.js — Süreli (TTL'li) yerel "zaten işlendi" ID önbelleği.
 *
 * auto-indirimradar.js ve auto-onual.js, Firestore okuma kotasını korumak
 * için taranan her ürünü önce yerel bir dosyadaki önbelleğe bakarak
 * eliyordu (bkz. QUOTA SAVING yorumları). Ama o önbellek girişleri HİÇBİR
 * ZAMAN süresi dolmuyordu — "önbellek 7 gündür hiç kullanılmadıysa tamamen
 * sıfırla" mantığı vardı, ama sürekli (birkaç dakikada bir) çalışan bir
 * pipeline'da bu koşul pratikte asla gerçekleşmiyordu.
 *
 * Sonuç: `cleanup-discounts.js` yayınlanan ürünleri ~24 saat sonra
 * Firestore'dan silerken, yerel önbellek o ürünü SONSUZA KADAR "zaten
 * işlendi" sayıp bir daha asla yeniden değerlendirmiyordu — kaynak sitede
 * hâlâ (fiyatı güncellenerek) yayında olsa bile. Haftalar/aylar boyunca
 * çalıştıkça bu, kaynağın neredeyse tüm kataloğunun kalıcı olarak
 * "yasaklanmasına" yol açtı; yeni ürün akışı yavaş yavaş sıfıra yaklaştı.
 *
 * Bu modül, her ID için AYRI bir zaman damgası tutup TTL'i (varsayılan
 * olarak ürünün discounts'taki ömrüyle aynı) geçen girişleri hem
 * sorgularken göz ardı eder hem de dosyaya yazarken temizler — böylece
 * dosya sonsuza kadar büyümez ve süresi dolan ürünler yeniden
 * değerlendirilebilir hale gelir.
 */

import * as fs from 'fs';

export function loadIdCache(cacheFile, ttlMs) {
    let raw = {};
    if (fs.existsSync(cacheFile)) {
        try {
            const parsed = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
            // Eski format ({ids: {...}, lastUpdate}) ile geriye dönük uyumluluk:
            // eski girişler `true` değeriyle saklanıyordu (zaman damgası yok).
            // Bunları hemen süresi dolmuş kabul edip atıyoruz — TTL'siz kalıcı
            // bir giriş, yeni mantıkta anlamsız/güvenilmez olur.
            raw = (parsed && typeof parsed === 'object' && parsed.ids) ? {} : (parsed || {});
        } catch { /* bozuk dosya, sıfırdan başla */ }
    }
    const now = Date.now();
    const cache = {};
    for (const [id, ts] of Object.entries(raw)) {
        if (typeof ts === 'number' && now - ts < ttlMs) cache[id] = ts;
    }
    return cache;
}

export function isCached(cache, id, ttlMs) {
    const ts = cache[id];
    return typeof ts === 'number' && (Date.now() - ts) < ttlMs;
}

export function markCached(cache, id) {
    cache[id] = Date.now();
}

export function saveIdCache(cacheFile, cacheDir, cache) {
    if (!fs.existsSync(cacheDir)) fs.mkdirSync(cacheDir, { recursive: true });
    fs.writeFileSync(cacheFile, JSON.stringify(cache, null, 2));
}
