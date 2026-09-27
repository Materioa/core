package com.materio.app;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebView;
import android.widget.Toast;
import androidx.activity.OnBackPressedCallback;
import androidx.core.app.NotificationCompat;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    private long lastBackPressTime = 0;
    private String pendingDeepLink = null;
    private static final String CHANNEL_ID = "materio_updates_channel";

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        createNotificationChannel();
        handleIntent(getIntent());

        // Intercept Android back gesture / back button
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

        // Register AndroidBridge on WebView for Toasts, Notifications, and Intents
        WebView webView = getBridge() != null ? getBridge().getWebView() : null;
        if (webView != null) {
            registerAndroidBridge(webView);
        }
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handleIntent(intent);
    }

    private void handleIntent(Intent intent) {
        if (intent != null && Intent.ACTION_VIEW.equals(intent.getAction())) {
            Uri data = intent.getData();
            if (data != null) {
                String url = data.toString();
                pendingDeepLink = url;
                WebView webView = getBridge() != null ? getBridge().getWebView() : null;
                if (webView != null) {
                    String js = "if (typeof window.__materioHandleDeepLink === 'function') { window.__materioHandleDeepLink('" + url + "'); }";
                    webView.evaluateJavascript(js, null);
                }
            }
        }
    }

    private void registerAndroidBridge(WebView webView) {
        webView.addJavascriptInterface(new Object() {
            @JavascriptInterface
            public void showToast(String message) {
                if (message == null) return;
                runOnUiThread(() -> Toast.makeText(MainActivity.this, message, Toast.LENGTH_SHORT).show());
            }

            @JavascriptInterface
            public void sendNotification(String title, String message, String downloadUrl) {
                runOnUiThread(() -> triggerUpdateNotification(title, message, downloadUrl));
            }

            @JavascriptInterface
            public String getPendingDeepLink() {
                String link = pendingDeepLink;
                pendingDeepLink = null;
                return link != null ? link : "";
            }
        }, "AndroidBridge");
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            CharSequence name = "Materio App Updates";
            String description = "Notifications for new Materio app releases and updates";
            int importance = NotificationManager.IMPORTANCE_DEFAULT;
            NotificationChannel channel = new NotificationChannel(CHANNEL_ID, name, importance);
            channel.setDescription(description);
            NotificationManager notificationManager = getSystemService(NotificationManager.class);
            if (notificationManager != null) {
                notificationManager.createNotificationChannel(channel);
            }
        }
    }

    private void triggerUpdateNotification(String title, String message, String downloadUrl) {
        try {
            Intent intent;
            if (downloadUrl != null && !downloadUrl.isEmpty()) {
                intent = new Intent(Intent.ACTION_VIEW, Uri.parse(downloadUrl));
            } else {
                intent = new Intent(this, MainActivity.class);
            }
            PendingIntent pendingIntent = PendingIntent.getActivity(
                this, 0, intent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
            );

            NotificationCompat.Builder builder = new NotificationCompat.Builder(this, CHANNEL_ID)
                .setSmallIcon(R.mipmap.ic_launcher)
                .setContentTitle(title != null ? title : "Materio Update Available")
                .setContentText(message != null ? message : "A new version of Materio is available.")
                .setPriority(NotificationCompat.PRIORITY_DEFAULT)
                .setContentIntent(pendingIntent)
                .setAutoCancel(true);

            NotificationManager manager = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
            if (manager != null) {
                manager.notify(1001, builder.build());
            }
        } catch (Exception e) {
            e.printStackTrace();
        }
    }
}
