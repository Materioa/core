package com.materio.app;

import android.os.Bundle;
import android.webkit.ValueCallback;
import android.webkit.WebView;
import android.widget.Toast;
import androidx.activity.OnBackPressedCallback;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    private long lastBackPressTime = 0;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                WebView webView = getBridge() != null ? getBridge().getWebView() : null;
                if (webView != null) {
                    webView.evaluateJavascript(
                        "(function() { return typeof window.__materioHandleAndroidBack === 'function' ? window.__materioHandleAndroidBack() : false; })()",
                        new ValueCallback<String>() {
                            @Override
                            public void onReceiveValue(String value) {
                                boolean handled = "true".equalsIgnoreCase(value);
                                if (!handled) {
                                    if (webView.canGoBack()) {
                                        webView.goBack();
                                    } else {
                                        long now = System.currentTimeMillis();
                                        if (now - lastBackPressTime < 2000) {
                                            finish();
                                        } else {
                                            lastBackPressTime = now;
                                            Toast.makeText(MainActivity.this, "Press back again to exit", Toast.LENGTH_SHORT).show();
                                        }
                                    }
                                }
                            }
                        }
                    );
                } else {
                    finish();
                }
            }
        });
    }
}
