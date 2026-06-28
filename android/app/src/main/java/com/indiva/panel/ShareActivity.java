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

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * ShareActivity — Şeffaf Overlay ile Hızlı Story Paylaşımı
 *
 * singleTask değil → WhatsApp/Telegram gibi uygulamanın üzerinde şeffaf olarak açılır.
 * excludeFromRecents → son uygulamalar listesinde görünmez.
 * noHistory → back stack'e eklenmez, finish() ile tamamen kaybolur.
 */
public class ShareActivity extends BridgeActivity {

    private volatile String pendingSharedImage = null;
    private final Handler mainHandler = new Handler(Looper.getMainLooper());

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        // Pencerenin arka planını şeffaf yap
        getWindow().setBackgroundDrawableResource(android.R.color.transparent);

        super.onCreate(savedInstanceState);

        // WebView arka planını şeffaf yap — aksi hâlde beyaz görünür
        WebView webView = getBridge().getWebView();
        webView.setBackgroundColor(0x00000000);

        // React tarafına "bu ShareActivity" olduğunu bildiren marker arayüzü
        webView.addJavascriptInterface(new Object() {
            @JavascriptInterface
            public boolean isShareMode() { return true; }
        }, "INDIVAShareMode");

        // React'ın kullanacağı asıl arayüz
        webView.addJavascriptInterface(new ShareHandler(), "AndroidShareHandler");

        // Gelen intent'i işle
        processIntent(getIntent());
    }

    private void processIntent(Intent intent) {
        if (intent == null) return;
        String type = intent.getType();
        if (type == null || !type.startsWith("image/")) return;

        Uri imageUri = intent.getParcelableExtra(Intent.EXTRA_STREAM);
        if (imageUri == null) return;

        new Thread(() -> {
            String base64 = uriToBase64(imageUri);
            if (base64 == null) return;

            pendingSharedImage = base64;

            // WebView yüklenince React'a "görsel hazır" sinyali gönder
            mainHandler.postDelayed(() -> {
                try {
                    WebView wv = getBridge().getWebView();
                    if (wv != null) {
                        wv.evaluateJavascript(
                            "window.dispatchEvent(new CustomEvent('sharedImage', { detail: 'ready' }));",
                            null
                        );
                    }
                } catch (Exception e) { e.printStackTrace(); }
            }, 900);
        }).start();
    }

    private String uriToBase64(Uri uri) {
        try {
            final int TARGET_PX = 1920;

            BitmapFactory.Options opts = new BitmapFactory.Options();
            opts.inJustDecodeBounds = true;
            InputStream is = getContentResolver().openInputStream(uri);
            if (is == null) return null;
            BitmapFactory.decodeStream(is, null, opts);
            is.close();

            int sample = 1;
            while (Math.max(opts.outWidth, opts.outHeight) / sample > TARGET_PX * 2) sample *= 2;

            opts = new BitmapFactory.Options();
            opts.inSampleSize = sample;
            is = getContentResolver().openInputStream(uri);
            if (is == null) return null;
            Bitmap rough = BitmapFactory.decodeStream(is, null, opts);
            is.close();
            if (rough == null) return null;

            int w = rough.getWidth(), h = rough.getHeight();
            int maxSide = Math.max(w, h);
            Bitmap bmp;
            if (maxSide > TARGET_PX) {
                float scale = (float) TARGET_PX / maxSide;
                bmp = Bitmap.createScaledBitmap(rough, Math.round(w * scale), Math.round(h * scale), true);
                rough.recycle();
            } else {
                bmp = rough;
            }

            ByteArrayOutputStream baos = new ByteArrayOutputStream();
            bmp.compress(Bitmap.CompressFormat.JPEG, 90, baos);
            bmp.recycle();

            return Base64.encodeToString(baos.toByteArray(), Base64.NO_WRAP);
        } catch (Exception e) {
            e.printStackTrace();
            return null;
        }
    }

    // ── JavaScript Interface ───────────────────────────────────────────────────

    public class ShareHandler {

        @JavascriptInterface
        public String getSharedImage() {
            String img = pendingSharedImage;
            pendingSharedImage = null;
            return img != null ? img : "";
        }

        @JavascriptInterface
        public String getSharedText() { return ""; }

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
            } catch (Exception e) { /* sessizce geç */ }
            return "";
        }

        /** React overlay tamamlandığında bu metodu çağırır → Activity kapanır */
        @JavascriptInterface
        public void finishActivity() {
            mainHandler.post(() -> finish());
        }
    }
}
