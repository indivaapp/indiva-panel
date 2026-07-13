package com.indiva.panel;

import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.util.Base64;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;

import com.getcapacitor.BridgeActivity;
import com.google.firebase.messaging.FirebaseMessaging;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

public class MainActivity extends BridgeActivity {

    private volatile String pendingSharedUrl   = null;
    private volatile String pendingSharedImage = null;
    private final Handler mainHandler = new Handler(Looper.getMainLooper());

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getBridge().getWebView().addJavascriptInterface(new AndroidShareHandler(), "AndroidShareHandler");
        handleShareIntent(getIntent());
        subscribeToAdminAlertsTopic();
    }

    /**
     * Admin'e özel push bildirimleri için 'panel_admin_alerts' topic'ine abone
     * ol (scripts/alertService.js bu topic'e gönderiyor). @capacitor/push-
     * notifications topic aboneliği desteklemediği için native SDK ile
     * yapılıyor. google-services.json yoksa Firebase hiç başlamaz, bu da
     * sessizce (try/catch ile) hiçbir şey yapmadan geçer.
     */
    private void subscribeToAdminAlertsTopic() {
        try {
            FirebaseMessaging.getInstance().subscribeToTopic("panel_admin_alerts");
        } catch (Exception e) {
            e.printStackTrace();
        }
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handleShareIntent(intent);
    }

    private void handleShareIntent(Intent intent) {
        if (intent == null) return;
        String action = intent.getAction();
        String type   = intent.getType();
        if (!Intent.ACTION_SEND.equals(action) || type == null) return;

        if ("text/plain".equals(type)) {
            // ── URL paylaşımı ─────────────────────────────────────────────────
            String shared = intent.getStringExtra(Intent.EXTRA_TEXT);
            if (shared == null) return;
            String url = extractUrl(shared);
            if (url == null) return;

            pendingSharedUrl = url;
            mainHandler.postDelayed(() -> {
                try {
                    WebView webView = getBridge().getWebView();
                    if (webView != null) {
                        String safeUrl = url.replace("\\", "\\\\").replace("'", "\\'");
                        webView.evaluateJavascript(
                            "window.dispatchEvent(new CustomEvent('sharedUrl', { detail: '" + safeUrl + "' }));",
                            null
                        );
                    }
                } catch (Exception e) { e.printStackTrace(); }
            }, 800);

        } else if (type.startsWith("image/")) {
            // ── Görsel paylaşımı (Story için) ─────────────────────────────────
            Uri imageUri = intent.getParcelableExtra(Intent.EXTRA_STREAM);
            if (imageUri == null) return;

            // Ana thread'i bloklamadan arka planda sıkıştır
            new Thread(() -> {
                String base64 = uriToBase64(imageUri);
                if (base64 == null) return;

                pendingSharedImage = base64;
                mainHandler.postDelayed(() -> {
                    try {
                        WebView webView = getBridge().getWebView();
                        if (webView != null) {
                            webView.evaluateJavascript(
                                "window.dispatchEvent(new CustomEvent('sharedImage', { detail: 'ready' }));",
                                null
                            );
                        }
                    } catch (Exception e) { e.printStackTrace(); }
                }, 1000);
            }).start();
        }
    }

    /** URI'den yüksek kaliteli JPEG → base64 */
    private String uriToBase64(Uri uri) {
        try {
            final int TARGET_PX = 1920;

            // 1. Yalnızca boyutu ölç
            BitmapFactory.Options opts = new BitmapFactory.Options();
            opts.inJustDecodeBounds = true;
            InputStream is = getContentResolver().openInputStream(uri);
            if (is == null) return null;
            BitmapFactory.decodeStream(is, null, opts);
            is.close();

            // 2. inSampleSize: hedefin 2 katından küçük olmayacak şekilde kaba ölçek
            //    (2'nin katı zorunluluğu nedeniyle TARGET_PX/2 eşiğini kullan)
            int sample = 1;
            while (Math.max(opts.outWidth, opts.outHeight) / sample > TARGET_PX * 2) sample *= 2;

            // 3. Bitmap yükle
            opts = new BitmapFactory.Options();
            opts.inSampleSize = sample;
            is = getContentResolver().openInputStream(uri);
            if (is == null) return null;
            Bitmap rough = BitmapFactory.decodeStream(is, null, opts);
            is.close();
            if (rough == null) return null;

            // 4. Tam hedef boyuta hassas ölçekleme
            int w = rough.getWidth();
            int h = rough.getHeight();
            int maxSide = Math.max(w, h);
            Bitmap bmp;
            if (maxSide > TARGET_PX) {
                float scale = (float) TARGET_PX / maxSide;
                bmp = Bitmap.createScaledBitmap(rough, Math.round(w * scale), Math.round(h * scale), true);
                rough.recycle();
            } else {
                bmp = rough; // Zaten küçükse olduğu gibi kullan
            }

            // 5. JPEG yüksek kalite ile sıkıştır
            ByteArrayOutputStream baos = new ByteArrayOutputStream();
            bmp.compress(Bitmap.CompressFormat.JPEG, 90, baos);
            bmp.recycle();

            return Base64.encodeToString(baos.toByteArray(), Base64.NO_WRAP);
        } catch (Exception e) {
            e.printStackTrace();
            return null;
        }
    }

    private String extractUrl(String text) {
        if (text == null) return null;
        Matcher m = Pattern.compile("https?://[^\\s<>\"{}|\\\\^`\\[\\]]+").matcher(text);
        return m.find() ? m.group() : null;
    }

    // ── JavaScript Interface ───────────────────────────────────────────────────
    public class AndroidShareHandler {

        /** Cold-start URL polling */
        @JavascriptInterface
        public String getSharedText() {
            String url = pendingSharedUrl;
            pendingSharedUrl = null;
            return url != null ? url : "";
        }

        /** Cold-start görsel polling — base64 JPEG döner */
        @JavascriptInterface
        public String getSharedImage() {
            String img = pendingSharedImage;
            pendingSharedImage = null;
            return img != null ? img : "";
        }

        /** Panodaki ilk URL'yi döner (affiliate link otomatik doldurma için) */
        @JavascriptInterface
        public String getClipboardUrl() {
            try {
                ClipboardManager cm = (ClipboardManager) getSystemService(Context.CLIPBOARD_SERVICE);
                if (cm != null && cm.hasPrimaryClip()) {
                    ClipData cd = cm.getPrimaryClip();
                    if (cd != null && cd.getItemCount() > 0) {
                        CharSequence text = cd.getItemAt(0).getText();
                        if (text != null) {
                            Matcher m = Pattern.compile("https?://[^\\s<>\"{}|\\\\^`\\[\\]]+")
                                .matcher(text.toString());
                            return m.find() ? m.group() : "";
                        }
                    }
                }
            } catch (Exception e) { /* pano erişimi yoksa sessizce geç */ }
            return "";
        }
    }
}
