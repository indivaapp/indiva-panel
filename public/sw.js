/**
 * İNDİVA Panel - Service Worker
 *
 * Görevler:
 * 1. PWA Share Target POST isteğini yakalar (ekran görüntüsü + link)
 * 2. Paylaşılan görüntüyü Cache Storage'a kaydeder
 * 3. Ana uygulamaya "share hazır" sinyali gönderir
 */

const SW_VERSION = '1.0.0';
const SHARE_CACHE = 'indiva-share-v1';

// ─── Kurulum ──────────────────────────────────────────────────────────────────
self.addEventListener('install', (event) => {
    console.log('[SW] Kurulum:', SW_VERSION);
    self.skipWaiting(); // Hemen aktif ol
});

// ─── Aktivasyon ───────────────────────────────────────────────────────────────
self.addEventListener('activate', (event) => {
    console.log('[SW] Aktif:', SW_VERSION);
    event.waitUntil(
        Promise.all([
            clients.claim(), // Tüm sayfaları hemen kontrol et
            // Eski cache'leri temizle
            caches.keys().then(keys =>
                Promise.all(
                    keys
                        .filter(k => k.startsWith('indiva-share-') && k !== SHARE_CACHE)
                        .map(k => caches.delete(k))
                )
            )
        ])
    );
});

// ─── Fetch Yakalayıcı ─────────────────────────────────────────────────────────
self.addEventListener('fetch', (event) => {
    const url = new URL(event.request.url);

    // Share Target POST isteğini yakala
    if (event.request.method === 'POST' && url.pathname === '/') {
        const hasShareParam = url.searchParams.has('share') ||
            event.request.headers.get('content-type')?.includes('multipart/form-data');

        // FormData içeren POST → share target isteği
        if (event.request.headers.get('content-type')?.includes('multipart/form-data')) {
            event.respondWith(handleShareTarget(event.request));
            return;
        }
    }

    // Diğer tüm istekler: network-first, cache fallback
    event.respondWith(
        fetch(event.request).catch(() => caches.match(event.request))
    );
});

// ─── Share Target İşleyici ────────────────────────────────────────────────────
async function handleShareTarget(request) {
    try {
        const formData = await request.formData();

        const screenshotFile = formData.get('screenshot');
        const title   = formData.get('title')  || '';
        const text    = formData.get('text')   || '';
        const url     = formData.get('url')    || '';

        const cache = await caches.open(SHARE_CACHE);

        // 1. Görüntüyü kaydet
        if (screenshotFile && screenshotFile instanceof File && screenshotFile.size > 0) {
            const arrayBuffer = await screenshotFile.arrayBuffer();
            const mimeType = screenshotFile.type || 'image/jpeg';
            await cache.put(
                '/share-screenshot',
                new Response(arrayBuffer, {
                    headers: {
                        'Content-Type': mimeType,
                        'X-File-Name': screenshotFile.name || 'screenshot.jpg',
                        'X-File-Size': String(screenshotFile.size),
                        'X-Timestamp': String(Date.now()),
                    }
                })
            );
            console.log('[SW] Görüntü kaydedildi:', screenshotFile.name, screenshotFile.size, 'bytes');
        }

        // 2. Meta verileri kaydet (URL, başlık, metin)
        const meta = JSON.stringify({
            title,
            text,
            url,
            timestamp: Date.now(),
            hasImage: !!(screenshotFile && screenshotFile instanceof File && screenshotFile.size > 0)
        });
        await cache.put(
            '/share-meta',
            new Response(meta, { headers: { 'Content-Type': 'application/json' } })
        );

        // 3. Açık sekmelere (client) bildirim gönder
        const allClients = await clients.matchAll({ type: 'window', includeUncontrolled: true });
        for (const client of allClients) {
            client.postMessage({ type: 'SHARE_RECEIVED', hasImage: true, title, url, text });
        }

        // 4. Ana sayfaya yönlendir, ?share=1 parametresiyle ShareTarget overlay'ini tetikle
        return Response.redirect('/?share=1', 303);

    } catch (err) {
        console.error('[SW] Share target hatası:', err);
        return Response.redirect('/?share=error', 303);
    }
}

// ─── Mesaj Alıcı (App'ten gelen komutlar) ────────────────────────────────────
self.addEventListener('message', async (event) => {
    if (!event.data) return;

    // App cache'i okudu → temizle
    if (event.data.type === 'SHARE_DATA_CONSUMED') {
        try {
            const cache = await caches.open(SHARE_CACHE);
            await Promise.all([
                cache.delete('/share-screenshot'),
                cache.delete('/share-meta'),
            ]);
            console.log('[SW] Share cache temizlendi');
        } catch (err) {
            console.warn('[SW] Cache temizleme hatası:', err);
        }
    }
});
