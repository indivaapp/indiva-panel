package com.indiva.panel;

import android.content.Intent;
import android.os.Bundle;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;

import com.getcapacitor.BridgeActivity;
import com.getcapacitor.Plugin;
import java.util.ArrayList;

public class MainActivity extends BridgeActivity {
    
    private String sharedText = null;
    
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        registerPlugin(BotPlugin.class);
        super.onCreate(savedInstanceState);
        
        // Check if app was opened via share intent
        handleShareIntent(getIntent());
    }
    
    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handleShareIntent(intent);
    }
    
    private void handleShareIntent(Intent intent) {
        String action = intent.getAction();
        String type = intent.getType();
        
        if (Intent.ACTION_SEND.equals(action) && type != null) {
            if ("text/plain".equals(type)) {
                String shared = intent.getStringExtra(Intent.EXTRA_TEXT);
                if (shared != null) {
                    sharedText = shared;
                    
                    // Inject shared text into WebView
                    runOnUiThread(() -> {
                        try {
                            WebView webView = getBridge().getWebView();
                            if (webView != null) {
                                // URL'yi çıkar ve JavaScript ile aktar
                                String url = extractUrl(shared);
                                if (url != null) {
                                    String js = "window.dispatchEvent(new CustomEvent('sharedUrl', { detail: '" + url.replace("'", "\\'") + "' }));";
                                    webView.evaluateJavascript(js, null);
                                }
                            }
                        } catch (Exception e) {
                            e.printStackTrace();
                        }
                    });
                }
            }
        }
    }
    
    private String extractUrl(String text) {
        if (text == null) return null;
        
        // URL regex pattern
        java.util.regex.Pattern pattern = java.util.regex.Pattern.compile(
            "https?://[^\\s<>\"{}|\\\\^`\\[\\]]+"
        );
        java.util.regex.Matcher matcher = pattern.matcher(text);
        
        if (matcher.find()) {
            return matcher.group();
        }
        return null;
    }
    
    // JavaScript interface for getting shared text
    public class AndroidShareHandler {
        @JavascriptInterface
        public String getSharedText() {
            String text = sharedText;
            sharedText = null; // Clear after reading
            return text;
        }
    }
}
