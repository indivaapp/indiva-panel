package com.indiva.panel;

import android.accessibilityservice.AccessibilityService;
import android.accessibilityservice.GestureDescription;
import android.content.Context;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.Path;
import android.graphics.PixelFormat;
import android.graphics.Rect;
import android.os.Handler;
import android.os.Looper;
import android.view.Gravity;
import android.view.MotionEvent;
import android.view.WindowManager;
import android.view.accessibility.AccessibilityEvent;
import android.view.accessibility.AccessibilityNodeInfo;
import android.widget.FrameLayout;
import android.widget.TextView;

public class BotAccessibilityService extends AccessibilityService {

    public static BotAccessibilityService instance;

    public interface CaptureCallback {
        void onCaptured(float x, float y);
    }

    @Override
    protected void onServiceConnected() {
        instance = this;
    }

    @Override
    public void onDestroy() {
        instance = null;
        super.onDestroy();
    }

    @Override
    public void onAccessibilityEvent(AccessibilityEvent event) {}

    @Override
    public void onInterrupt() {}

    /**
     * Yarı saydam overlay açar — kullanıcı hedef butona dokunur, koordinat döner.
     * TYPE_ACCESSIBILITY_OVERLAY ile her uygulamanın üstünde çalışır.
     */
    public void showCaptureOverlay(String instruction, CaptureCallback callback) {
        WindowManager wm = (WindowManager) getSystemService(Context.WINDOW_SERVICE);

        FrameLayout overlay = new FrameLayout(this);
        overlay.setBackgroundColor(Color.argb(160, 0, 0, 0));

        // Üst bilgi etiketi
        TextView label = new TextView(this);
        label.setText(instruction);
        label.setTextColor(Color.WHITE);
        label.setTextSize(18f);
        label.setGravity(Gravity.CENTER);
        label.setPadding(40, 40, 40, 40);
        label.setBackgroundColor(Color.argb(200, 0, 0, 0));

        FrameLayout.LayoutParams lp = new FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.MATCH_PARENT,
            FrameLayout.LayoutParams.WRAP_CONTENT
        );
        lp.gravity = Gravity.TOP;
        overlay.addView(label, lp);

        WindowManager.LayoutParams params = new WindowManager.LayoutParams(
            WindowManager.LayoutParams.MATCH_PARENT,
            WindowManager.LayoutParams.MATCH_PARENT,
            WindowManager.LayoutParams.TYPE_ACCESSIBILITY_OVERLAY,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE
                | WindowManager.LayoutParams.FLAG_WATCH_OUTSIDE_TOUCH,
            PixelFormat.TRANSLUCENT
        );

        overlay.setOnTouchListener((v, event) -> {
            if (event.getAction() == MotionEvent.ACTION_DOWN) {
                float x = event.getRawX();
                float y = event.getRawY();
                new Handler(Looper.getMainLooper()).post(() -> {
                    try { wm.removeView(overlay); } catch (Exception ignored) {}
                });
                callback.onCaptured(x, y);
                return true;
            }
            return false;
        });

        new Handler(Looper.getMainLooper()).post(() -> wm.addView(overlay, params));
    }

    public void dismissOverlay(FrameLayout overlay) {
        try {
            WindowManager wm = (WindowManager) getSystemService(Context.WINDOW_SERVICE);
            wm.removeView(overlay);
        } catch (Exception ignored) {}
    }

    /**
     * Accessibility tree içinde belirtilen metinlerden birini içeren düğümü bul ve tıkla.
     */
    public boolean findAndClickByText(String... keywords) {
        AccessibilityNodeInfo root = getRootInActiveWindow();
        if (root == null) return false;
        for (String kw : keywords) {
            AccessibilityNodeInfo node = findNodeByText(root, kw.toLowerCase());
            if (node != null) {
                if (node.isClickable()) {
                    node.performAction(AccessibilityNodeInfo.ACTION_CLICK);
                    return true;
                }
                AccessibilityNodeInfo parent = node.getParent();
                while (parent != null) {
                    if (parent.isClickable()) {
                        parent.performAction(AccessibilityNodeInfo.ACTION_CLICK);
                        return true;
                    }
                    parent = parent.getParent();
                }
                Rect bounds = new Rect();
                node.getBoundsInScreen(bounds);
                if (bounds.centerX() > 0 || bounds.centerY() > 0) {
                    performTap(bounds.centerX(), bounds.centerY());
                    return true;
                }
            }
        }
        return false;
    }

    private AccessibilityNodeInfo findNodeByText(AccessibilityNodeInfo node, String keyword) {
        if (node == null) return null;
        CharSequence text = node.getText();
        CharSequence desc = node.getContentDescription();
        if ((text != null && text.toString().toLowerCase().contains(keyword)) ||
            (desc != null && desc.toString().toLowerCase().contains(keyword))) {
            return node;
        }
        for (int i = 0; i < node.getChildCount(); i++) {
            AccessibilityNodeInfo result = findNodeByText(node.getChild(i), keyword);
            if (result != null) return result;
        }
        return null;
    }

    /**
     * Belirtilen ekran koordinatına dokunma hareketi gönder
     */
    public void performTap(float x, float y) {
        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.N) {
            Path path = new Path();
            path.moveTo(x, y);
            GestureDescription gesture = new GestureDescription.Builder()
                .addStroke(new GestureDescription.StrokeDescription(path, 0, 50))
                .build();
            dispatchGesture(gesture, null, null);
        }
    }

    /**
     * Belirtilen uygulamayı aç
     */
    public void openApp(String packageName) {
        Intent intent = getPackageManager().getLaunchIntentForPackage(packageName);
        if (intent != null) {
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
            getApplicationContext().startActivity(intent);
        }
    }
}
