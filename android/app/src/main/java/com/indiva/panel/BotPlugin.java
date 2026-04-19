package com.indiva.panel;

import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "BotPlugin")
public class BotPlugin extends Plugin {

    private static final String PREFS = "AffiliateBot";
    private final Handler handler = new Handler(Looper.getMainLooper());

    // ── İzin Kontrolü ────────────────────────────────────────────────────────

    @PluginMethod
    public void isAccessibilityEnabled(PluginCall call) {
        JSObject ret = new JSObject();
        // Settings.Secure kontrolü veya servis instance'ı aktifse true döndür
        ret.put("enabled", isServiceEnabled() || BotAccessibilityService.instance != null);
        call.resolve(ret);
    }

    @PluginMethod
    public void openAccessibilitySettings(PluginCall call) {
        Intent intent = new Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS);
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        getContext().startActivity(intent);
        call.resolve();
    }

    // ── Koordinat Kaydet / Oku ────────────────────────────────────────────────

    @PluginMethod
    public void saveCoordinates(PluginCall call) {
        String store = call.getString("store", "default");
        float shareX = call.getFloat("shareX", 0f);
        float shareY = call.getFloat("shareY", 0f);
        float copyX  = call.getFloat("copyX",  0f);
        float copyY  = call.getFloat("copyY",  0f);

        float fallbackX = call.getFloat("fallbackX", 0f);
        float fallbackY = call.getFloat("fallbackY", 0f);
        getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
            .putFloat(store + "_shareX",    shareX)
            .putFloat(store + "_shareY",    shareY)
            .putFloat(store + "_copyX",     copyX)
            .putFloat(store + "_copyY",     copyY)
            .putFloat(store + "_fallbackX", fallbackX)
            .putFloat(store + "_fallbackY", fallbackY)
            .apply();

        call.resolve();
    }

    @PluginMethod
    public void getCoordinates(PluginCall call) {
        String store = call.getString("store", "default");
        SharedPreferences prefs = getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);

        JSObject ret = new JSObject();
        ret.put("shareX",    prefs.getFloat(store + "_shareX",    0f));
        ret.put("shareY",    prefs.getFloat(store + "_shareY",    0f));
        ret.put("copyX",     prefs.getFloat(store + "_copyX",     0f));
        ret.put("copyY",     prefs.getFloat(store + "_copyY",     0f));
        ret.put("fallbackX", prefs.getFloat(store + "_fallbackX", 0f));
        ret.put("fallbackY", prefs.getFloat(store + "_fallbackY", 0f));
        call.resolve(ret);
    }

    // ── Koordinat Yakalama (Öğretme) ──────────────────────────────────────────

    @PluginMethod
    public void startCapture(PluginCall call) {
        call.setKeepAlive(true);

        if (BotAccessibilityService.instance == null) {
            call.reject("Erişilebilirlik Servisi aktif değil");
            return;
        }

        String type = call.getString("type", "share");
        String storeName = call.getString("storeName", "uygulama");
        String instruction = type.equals("share")
            ? storeName + "'da bir ürün açın ve paylaş butonuna dokunun"
            : "Paylaş menüsünde kopyala butonuna dokunun";

        BotAccessibilityService.instance.showCaptureOverlay(instruction, (x, y) -> {
            JSObject ret = new JSObject();
            ret.put("x", x);
            ret.put("y", y);
            call.resolve(ret);
        });
    }

    @PluginMethod
    public void cancelCapture(PluginCall call) {
        call.resolve();
    }

    // ── Bot Döngüsü ───────────────────────────────────────────────────────────

    /**
     * Tek ürün için döngüyü çalıştır:
     * 1. URL'yi dışarıda aç
     * 2. shareDelay ms bekle → paylaş butonuna dokun
     * 3. 1500ms bekle → kopyala butonuna dokun
     * 4. 1000ms bekle → panele dön
     * 5. resolve() → panel clipboard'ı okuyup bir sonraki ürünü tetikler
     */
    @PluginMethod
    public void runCycle(PluginCall call) {
        call.setKeepAlive(true);

        if (BotAccessibilityService.instance == null) {
            call.reject("Erişilebilirlik Servisi aktif değil");
            return;
        }

        String url   = call.getString("url",   "");
        String store = call.getString("store", "default");
        int shareDelay = call.getInt("shareDelay", 3000); // sayfa yüklenmesi için bekleme
        int copyDelay  = call.getInt("copyDelay",  1500); // paylaş sayfası açılması
        int backDelay  = call.getInt("backDelay",  1000); // kopyalandıktan sonra dönüş

        SharedPreferences prefs = getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        float shareX    = prefs.getFloat(store + "_shareX",    0f);
        float shareY    = prefs.getFloat(store + "_shareY",    0f);
        float fallbackX = prefs.getFloat(store + "_fallbackX", 0f);
        float fallbackY = prefs.getFloat(store + "_fallbackY", 0f);

        if (shareX == 0 && shareY == 0) {
            call.reject("Bu mağaza için koordinatlar ayarlanmamış");
            return;
        }

        // Adım 1: URL'yi aç
        Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        getContext().startActivity(intent);

        final float fShareX = shareX, fShareY = shareY;
        final float fFallbackX = fallbackX, fFallbackY = fallbackY;
        final boolean hasFallback = fallbackX > 0 || fallbackY > 0;

        // Adım 2: Sayfa yüklensin → paylaş butonunu bul (önce metinden, yoksa koordinatla)
        handler.postDelayed(() -> {
            BotAccessibilityService svc = BotAccessibilityService.instance;
            boolean foundByText = svc.findAndClickByText("paylaş", "share", "paylaşım");
            if (!foundByText && hasFallback) {
                // Paylaş bulunamadı → fallback koordinatına bas (örn: arama sonucu ürünü)
                svc.performTap(fFallbackX, fFallbackY);
                // 4sn bekle, ürün sayfası açılsın → tekrar paylaş dene
                handler.postDelayed(() -> {
                    BotAccessibilityService svc2 = BotAccessibilityService.instance;
                    boolean found2 = svc2.findAndClickByText("paylaş", "share", "paylaşım");
                    if (!found2) svc2.performTap(fShareX, fShareY);
                }, 2500);
            } else if (!foundByText) {
                svc.performTap(fShareX, fShareY);
            }

            // Adım 3: Paylaş menüsü açılsın → "Linki Kopyala" butonunu metinden bul ve tıkla
            handler.postDelayed(() -> {
                BotAccessibilityService svc2 = BotAccessibilityService.instance;
                String[] copyKeywords = {"linki kopyala", "link kopyala", "bağlantıyı kopyala", "bağlantı kopyala", "kopyala", "copy link", "copy url", "copy"};
                boolean clicked = svc2.findAndClickByText(copyKeywords);
                // Bulunamadıysa birkaç kez tekrar dene
                if (!clicked) {
                    handler.postDelayed(() -> {
                        if (BotAccessibilityService.instance == null) return;
                        boolean c2 = BotAccessibilityService.instance.findAndClickByText(copyKeywords);
                        if (!c2) {
                            handler.postDelayed(() -> {
                                if (BotAccessibilityService.instance != null)
                                    BotAccessibilityService.instance.findAndClickByText(copyKeywords);
                            }, 1000);
                        }
                    }, 800);
                }

                // Adım 4: Kopyalandı → panele dön
                handler.postDelayed(() -> {
                    BotAccessibilityService.instance.openApp("com.indiva.panel");
                    call.resolve(); // Panel clipboard okur, kaydeder, sıradakini başlatır
                }, backDelay);

            }, copyDelay);
        }, shareDelay);
    }

    // ── Yardımcı ──────────────────────────────────────────────────────────────

    private boolean isServiceEnabled() {
        String services = Settings.Secure.getString(
            getContext().getContentResolver(),
            Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES
        );
        if (services == null) return false;
        String target = getContext().getPackageName() + "/" + BotAccessibilityService.class.getName();
        return services.toLowerCase().contains(target.toLowerCase());
    }
}
