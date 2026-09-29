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
import androidx.core.content.FileProvider;
import com.getcapacitor.BridgeActivity;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;

public class MainActivity extends BridgeActivity {
    private long lastBackPressTime = 0;
    private String pendingDeepLink = null;
    private static final String CHANNEL_ID = "materio_updates_channel";
    private static final int UPDATE_NOTIFICATION_ID = 1002;

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

            @JavascriptInterface
            public void downloadAndInstallUpdate(String apkUrl, String version) {
                if (apkUrl == null || apkUrl.isEmpty()) return;
                // Reject non-APK URLs up front: a GitHub 404 HTML page saved
                // as .apk is what produces "package invalid" on install.
                String lower = apkUrl.toLowerCase().split("\\?")[0];
                if (!apkUrl.startsWith("https://") || !lower.endsWith(".apk")) {
                    runOnUiThread(() -> Toast.makeText(MainActivity.this, "Update not published for Android yet", Toast.LENGTH_SHORT).show());
                    return;
                }
                runOnUiThread(() -> startUpdateDownload(apkUrl, version != null ? version : ""));
            }

            @JavascriptInterface
            public void openExternal(String url) {
                if (url == null) return;
                String u = url.trim();
                if (!(u.startsWith("https://") || u.startsWith("http://"))) return;
                try {
                    Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(u));
                    intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                    startActivity(intent);
                } catch (Exception e) {
                    e.printStackTrace();
                }
            }
        }, "AndroidBridge");
    }

    // Self-update: download the APK in our own process straight into the
    // app's internal temp dir (getCacheDir, like Windows %TEMP%), then hand
    // it to the package installer. DownloadManager is deliberately NOT used:
    // it can only write to external storage and throws when pointed at
    // internal temp. Android always shows one system "Install" confirmation
    // (no silent sideloads for non-Play apps), but the old install is
    // replaced in place automatically — no manual uninstall and app data is
    // preserved. Temp files are cleared on the next attempt.
    private void startUpdateDownload(String apkUrl, String version) {
        final String label = (version == null || version.isEmpty()) ? "" : " " + version;
        runOnUiThread(() -> Toast.makeText(MainActivity.this, "Downloading update" + label + "…", Toast.LENGTH_SHORT).show());

        new Thread(() -> {
            File tmpDir = new File(getCacheDir(), "updates");
            try {
                if (!tmpDir.exists()) tmpDir.mkdirs();
            } catch (Exception ignored) {}
            // Clear stale temp APKs from previous attempts.
            try {
                File[] stale = tmpDir.listFiles();
                if (stale != null) {
                    for (File f : stale) {
                        try { if (f.isFile()) f.delete(); } catch (Exception ignored) {}
                    }
                }
            } catch (Exception ignored) {}

            String v = version != null ? version : "";
            String safeVer = v.replaceAll("[^A-Za-z0-9._-]", "_");
            File dest = new File(tmpDir, safeVer.isEmpty() ? "materio-update.apk" : "materio-update-" + safeVer + ".apk");
            try {
                if (dest.exists()) dest.delete();
            } catch (Exception ignored) {}

            showUpdateProgress(0, true);
            HttpURLConnection conn = null;
            InputStream in = null;
            FileOutputStream out = null;
            try {
                // Resolve manually so GitHub release URLs (302 -> objects
                // .githubusercontent.com) are followed explicitly.
                URL url = new URL(apkUrl);
                int redirects = 0;
                while (true) {
                    conn = (HttpURLConnection) url.openConnection();
                    conn.setInstanceFollowRedirects(false);
                    conn.setConnectTimeout(20000);
                    conn.setReadTimeout(30000);
                    conn.setRequestProperty("User-Agent", "Materio-Android-Updater");
                    conn.setRequestProperty("Accept", "application/vnd.android.package-archive, application/octet-stream");
                    int code = conn.getResponseCode();
                    if (code == HttpURLConnection.HTTP_MOVED_PERM
                            || code == HttpURLConnection.HTTP_MOVED_TEMP
                            || code == HttpURLConnection.HTTP_SEE_OTHER
                            || code == 307 || code == 308) {
                        String loc = conn.getHeaderField("Location");
                        conn.disconnect();
                        conn = null;
                        if (loc == null || redirects++ >= 5) throw new IOException("Too many redirects");
                        url = new URL(url, loc);
                        continue;
                    }
                    if (code != HttpURLConnection.HTTP_OK) throw new IOException("HTTP " + code);
                    break;
                }

                // getContentLength() (int) is used instead of
                // getContentLengthLong() so updates also work on minSdk 22/23.
                long total = -1;
                try {
                    total = conn.getContentLength();
                } catch (Exception ignored) {}
                String contentType = conn.getContentType();
                if (contentType != null && contentType.contains("text/html")) {
                    throw new IOException("Unexpected content type " + contentType);
                }

                in = conn.getInputStream();
                out = new FileOutputStream(dest);
                byte[] buf = new byte[64 * 1024];
                long done = 0;
                int n;
                long lastUi = 0;
                while ((n = in.read(buf)) != -1) {
                    out.write(buf, 0, n);
                    done += n;
                    long now = System.currentTimeMillis();
                    if (total > 0 && now - lastUi > 500) {
                        lastUi = now;
                        showUpdateProgress((int) Math.min(100, (done * 100) / total), false);
                    }
                }
                out.flush();

                // Guard against error pages saved as .apk ("package invalid").
                if (dest.length() < 1024 * 1024) throw new IOException("File too small, likely an error page");
                if (total > 0 && dest.length() < total) throw new IOException("Incomplete download");

                hideUpdateProgress();
                runOnUiThread(() -> launchApkInstall(dest));
            } catch (Exception e) {
                e.printStackTrace();
                try {
                    if (dest.exists()) dest.delete();
                } catch (Exception ignored) {}
                hideUpdateProgress();
                runOnUiThread(() -> Toast.makeText(MainActivity.this, "Update download failed", Toast.LENGTH_SHORT).show());
            } finally {
                try { if (in != null) in.close(); } catch (Exception ignored) {}
                try { if (out != null) out.close(); } catch (Exception ignored) {}
                try { if (conn != null) conn.disconnect(); } catch (Exception ignored) {}
            }
        }).start();
    }

    private void showUpdateProgress(int percent, boolean indeterminate) {
        try {
            Intent intent = new Intent(this, MainActivity.class);
            int piFlags = PendingIntent.FLAG_UPDATE_CURRENT;
            // FLAG_IMMUTABLE only exists on API 23+; resolve it by value so
            // the updater also runs on the minSdk 22 devices.
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                piFlags |= PendingIntent.FLAG_IMMUTABLE;
            }
            PendingIntent pi = PendingIntent.getActivity(this, 0, intent, piFlags);
            NotificationCompat.Builder builder = new NotificationCompat.Builder(this, CHANNEL_ID)
                .setSmallIcon(R.mipmap.ic_launcher)
                .setContentTitle("Downloading Materio update…")
                .setContentIntent(pi)
                .setOngoing(true)
                .setOnlyAlertOnce(true)
                .setProgress(100, percent, indeterminate);
            NotificationManager manager = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
            if (manager != null) manager.notify(UPDATE_NOTIFICATION_ID, builder.build());
        } catch (Exception e) {
            e.printStackTrace();
        }
    }

    private void hideUpdateProgress() {
        try {
            NotificationManager manager = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
            if (manager != null) manager.cancel(UPDATE_NOTIFICATION_ID);
        } catch (Exception e) {
            e.printStackTrace();
        }
    }

    private void launchApkInstall(File apk) {
        try {
            // Guard against error pages saved as .apk (GitHub 404 HTML is a
            // few KB; a real APK is tens of MB).
            if (apk == null || !apk.exists() || apk.length() < 1024 * 1024) {
                Toast.makeText(this, "Update file invalid — please try again", Toast.LENGTH_SHORT).show();
                return;
            }
            Uri uri = FileProvider.getUriForFile(this, getPackageName() + ".fileprovider", apk);
            Intent intent = new Intent(Intent.ACTION_VIEW);
            intent.setDataAndType(uri, "application/vnd.android.package-archive");
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_GRANT_READ_URI_PERMISSION);
            intent.addFlags(Intent.FLAG_GRANT_PREFIX_URI_PERMISSION);
            startActivity(intent);
        } catch (Exception e) {
            e.printStackTrace();
            Toast.makeText(this, "Couldn't open installer", Toast.LENGTH_SHORT).show();
        }
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
