package com.materio.app;

import android.app.DownloadManager;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebView;
import android.widget.Toast;
import androidx.activity.OnBackPressedCallback;
import androidx.core.app.NotificationCompat;
import androidx.core.content.ContextCompat;
import androidx.core.content.FileProvider;
import com.getcapacitor.BridgeActivity;
import java.io.File;

public class MainActivity extends BridgeActivity {
    private long lastBackPressTime = 0;
    private String pendingDeepLink = null;
    private static final String CHANNEL_ID = "materio_updates_channel";
    private long updateDownloadId = -1;
    private BroadcastReceiver updateDownloadReceiver = null;

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
        }, "AndroidBridge");
    }

    // Self-update: download the APK with the system DownloadManager into the
    // app's internal temp dir (getCacheDir, like Windows %TEMP%), then hand
    // it to the package installer. Android always shows one system "Install"
    // confirmation (no silent sideloads for non-Play apps), but the old
    // install is replaced in place automatically — no manual uninstall and
    // app data is preserved. Temp files are cleared on next launch.
    private void startUpdateDownload(String apkUrl, String version) {
        try {
            Toast.makeText(MainActivity.this, "Downloading update…", Toast.LENGTH_SHORT).show();
            DownloadManager dm = (DownloadManager) getSystemService(Context.DOWNLOAD_SERVICE);
            if (dm == null) return;

            File tmpDir = new File(getCacheDir(), "updates");
            if (!tmpDir.exists()) tmpDir.mkdirs();
            // Clear stale temp APKs from previous attempts.
            File[] stale = tmpDir.listFiles();
            if (stale != null) {
                for (File f : stale) {
                    try { if (f.isFile()) f.delete(); } catch (Exception ignored) {}
                }
            }
            String safeVer = version.replaceAll("[^A-Za-z0-9._-]", "_");
            File dest = new File(tmpDir, safeVer.isEmpty() ? "materio-update.apk" : "materio-update-" + safeVer + ".apk");
            if (dest.exists()) dest.delete();

            DownloadManager.Request req = new DownloadManager.Request(Uri.parse(apkUrl));
            req.setTitle("Materio update" + (version.isEmpty() ? "" : " " + version));
            req.setDescription("Downloading new version…");
            req.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
            req.setMimeType("application/vnd.android.package-archive");
            req.setDestinationUri(Uri.fromFile(dest));

            if (updateDownloadReceiver != null) {
                try { unregisterReceiver(updateDownloadReceiver); } catch (Exception ignored) {}
                updateDownloadReceiver = null;
            }
            updateDownloadReceiver = new BroadcastReceiver() {
                @Override
                public void onReceive(Context ctx, Intent intent) {
                    long id = intent.getLongExtra(DownloadManager.EXTRA_DOWNLOAD_ID, -1);
                    if (id != updateDownloadId) return;
                    Cursor c = null;
                    try {
                        c = dm.query(new DownloadManager.Query().setFilterById(id));
                        if (c != null && c.moveToFirst()) {
                            int status = c.getInt(c.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS));
                            if (status == DownloadManager.STATUS_SUCCESSFUL) {
                                launchApkInstall(dest);
                            } else if (status == DownloadManager.STATUS_FAILED) {
                                Toast.makeText(MainActivity.this, "Update download failed", Toast.LENGTH_SHORT).show();
                            }
                        }
                    } catch (Exception e) {
                        e.printStackTrace();
                    } finally {
                        if (c != null) c.close();
                    }
                }
            };
            ContextCompat.registerReceiver(
                this,
                updateDownloadReceiver,
                new IntentFilter(DownloadManager.ACTION_DOWNLOAD_COMPLETE),
                ContextCompat.RECEIVER_NOT_EXPORTED
            );

            updateDownloadId = dm.enqueue(req);
        } catch (Exception e) {
            e.printStackTrace();
            Toast.makeText(MainActivity.this, "Couldn't start update", Toast.LENGTH_SHORT).show();
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
