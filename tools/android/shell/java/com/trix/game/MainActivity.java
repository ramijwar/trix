package com.trix.game;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.Activity;
import android.app.DownloadManager;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.os.Handler;
import android.os.Looper;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.provider.Settings;
import android.view.KeyEvent;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import java.io.ByteArrayInputStream;
import java.io.File;
import java.io.FileNotFoundException;
import java.io.IOException;
import java.io.InputStream;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;

/**
 * غلاف التطبيق الأصلي (WebView Shell) — بدون أي مكتبات خارجية
 * ------------------------------------------------------------------
 * • يقدّم ملفات الواجهة من assets/www عبر أصل آمن https://trix.game/ حتى تعمل
 *   الذاكرة المحلية (localStorage) والاتصال بالشبكة بشكل موثوق.
 * • جسر أصلي (window.TrixNative) للاهتزاز والتنبيهات والحافظة والتخزين وبقاء الشاشة.
 */
public class MainActivity extends Activity {

    private static final String APP_HOST = "trix.game";
    private static final String START_URL = "https://" + APP_HOST + "/index.html";
    private static final String PREFS_NAME = "trix_native";

    private static final int REQ_MIC = 4711;
    private static final int REQ_INSTALL_PERMISSION = 4712;

    /** مفاتيح تخزين حالة التنزيل */
    private static final String K_DOWNLOAD_ID = "update_download_id";
    private static final String K_PENDING_APK = "update_pending_apk";

    private WebView web;
    private SharedPreferences store;
    private long lastBackPress = 0L;
    /** طلب إذن الصفحة (الميكروفون) بانتظار موافقة المستخدم */
    private PermissionRequest pendingPermission;
    /** مراقبة تقدّم تنزيل التحديث */
    private final Handler ui = new Handler(Looper.getMainLooper());
    private Runnable progressTask;
    private long downloadId = -1L;

    @SuppressLint({"SetJavaScriptEnabled", "AddJavascriptInterface"})
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        store = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);

        web = new WebView(this);
        web.setLayoutParams(new ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        web.setBackgroundColor(0xFF04100C);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setAllowFileAccess(true);
        s.setLoadWithOverviewMode(true);
        s.setUseWideViewPort(true);
        s.setSupportZoom(false);
        s.setBuiltInZoomControls(false);
        s.setDisplayZoomControls(false);
        s.setCacheMode(WebSettings.LOAD_DEFAULT);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setTextZoom(100);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            s.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
        }

        web.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                Uri url = request.getUrl();
                if (url != null && APP_HOST.equals(url.getHost())) {
                    return serveAsset(url.getPath());
                }
                return null;
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri url = request.getUrl();
                if (url != null && APP_HOST.equals(url.getHost())) {
                    return false;
                }
                openInBrowser(url);
                return true;
            }

            @SuppressWarnings("deprecation")
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, String url) {
                if (url != null && url.contains(APP_HOST)) {
                    return false;
                }
                openInBrowser(Uri.parse(url));
                return true;
            }
        });

        /* منح الصفحة إذن الميكروفون حتى تعمل رسائل الدردشة الصوتية */
        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onPermissionRequest(final PermissionRequest request) {
                runOnUiThread(new Runnable() {
                    @Override
                    public void run() {
                        boolean wantsAudio = false;
                        for (String resource : request.getResources()) {
                            if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(resource)) {
                                wantsAudio = true;
                            }
                        }
                        if (!wantsAudio) {
                            return; // نرفض أي إذن آخر (كاميرا/موقع) بالصمت
                        }
                        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M
                                && checkSelfPermission(Manifest.permission.RECORD_AUDIO)
                                != PackageManager.PERMISSION_GRANTED) {
                            pendingPermission = request;
                            requestPermissions(new String[]{Manifest.permission.RECORD_AUDIO}, REQ_MIC);
                            return;
                        }
                        request.grant(new String[]{PermissionRequest.RESOURCE_AUDIO_CAPTURE});
                    }
                });
            }
        });
        web.addJavascriptInterface(new Bridge(), "TrixNative");

        setContentView(web);
        web.loadUrl(START_URL);

        // إن كان هناك تنزيل تحديث جارٍ من جلسة سابقة نكمل مراقبته
        long saved = store.getLong(K_DOWNLOAD_ID, -1L);
        if (saved > 0) {
            downloadId = saved;
            watchDownload();
        }
    }

    /** مجلد تخزين ملفات التحديث (خارجي إن أمكن وإلا داخلي — بلا حاجة لأي إذن) */
    private File apkDir() {
        if (apkDirRef == null) {
            apkDirRef = ApkProvider.updateDir(this);
        }
        return apkDirRef;
    }

    private File apkDirRef = null;

    private void openInBrowser(Uri url) {
        if (url == null) {
            return;
        }
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, url));
        } catch (Exception ignored) {
        }
    }

    /** تقديم ملف من assets/www كأنه استجابة شبكة */
    private WebResourceResponse serveAsset(String urlPath) {
        String path = urlPath == null || urlPath.equals("/") ? "/index.html" : urlPath;
        try {
            InputStream in = getAssets().open("www" + path);
            Map<String, String> headers = new HashMap<String, String>();
            headers.put("Access-Control-Allow-Origin", "*");
            headers.put("Cache-Control", "no-cache");
            WebResourceResponse res = new WebResourceResponse(mimeOf(path), "UTF-8", in);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
                res.setResponseHeaders(headers);
            }
            return res;
        } catch (IOException e) {
            // مسار غير موجود: نعيد صفحة البداية (تطبيق أحادي الصفحة) أو 404
            if (path.contains(".")) {
                return new WebResourceResponse("text/plain", "UTF-8", 404, "Not Found",
                        new HashMap<String, String>(), new ByteArrayInputStream("404".getBytes()));
            }
            try {
                InputStream in = getAssets().open("www/index.html");
                return new WebResourceResponse("text/html", "UTF-8", in);
            } catch (IOException e2) {
                return null;
            }
        }
    }

    private static String mimeOf(String path) {
        String p = path.toLowerCase();
        if (p.endsWith(".html") || p.endsWith(".htm")) return "text/html";
        if (p.endsWith(".js") || p.endsWith(".mjs")) return "application/javascript";
        if (p.endsWith(".css")) return "text/css";
        if (p.endsWith(".json") || p.endsWith(".webmanifest")) return "application/json";
        if (p.endsWith(".svg")) return "image/svg+xml";
        if (p.endsWith(".png")) return "image/png";
        if (p.endsWith(".jpg") || p.endsWith(".jpeg")) return "image/jpeg";
        if (p.endsWith(".webp")) return "image/webp";
        if (p.endsWith(".gif")) return "image/gif";
        if (p.endsWith(".ico")) return "image/x-icon";
        if (p.endsWith(".mp3")) return "audio/mpeg";
        if (p.endsWith(".wav")) return "audio/wav";
        if (p.endsWith(".ogg") || p.endsWith(".opus")) return "audio/ogg";
        if (p.endsWith(".woff2")) return "font/woff2";
        if (p.endsWith(".woff")) return "font/woff";
        if (p.endsWith(".ttf")) return "font/ttf";
        if (p.endsWith(".txt")) return "text/plain";
        return "application/octet-stream";
    }

    /** جسر الوظائف الأصلية المتاح للواجهة عبر window.TrixNative */
    private class Bridge {

        @JavascriptInterface
        public void vibrate(int ms) {
            try {
                Vibrator v = (Vibrator) getSystemService(Context.VIBRATOR_SERVICE);
                if (v == null || !v.hasVibrator()) {
                    return;
                }
                int duration = Math.max(10, Math.min(ms, 400));
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    v.vibrate(VibrationEffect.createOneShot(duration, VibrationEffect.DEFAULT_AMPLITUDE));
                } else {
                    v.vibrate(duration);
                }
            } catch (Exception ignored) {
            }
        }

        @JavascriptInterface
        public void toast(final String text) {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    Toast.makeText(MainActivity.this, text, Toast.LENGTH_SHORT).show();
                }
            });
        }

        @JavascriptInterface
        public void setKeepScreenOn(final boolean on) {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    if (on) {
                        getWindow().addFlags(android.view.WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
                    } else {
                        getWindow().clearFlags(android.view.WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
                    }
                }
            });
        }

        @JavascriptInterface
        public void copyToClipboard(final String text) {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    try {
                        ClipboardManager cm = (ClipboardManager) getSystemService(Context.CLIPBOARD_SERVICE);
                        if (cm != null) {
                            cm.setPrimaryClip(ClipData.newPlainText("trix", text));
                        }
                    } catch (Exception ignored) {
                    }
                }
            });
        }

        @JavascriptInterface
        public void openExternal(final String url) {
            openInBrowser(Uri.parse(url));
        }

        @JavascriptInterface
        public void exitApp() {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    finish();
                }
            });
        }

        /* ---------- تخزين دائم أصلي (بديل موثوق للذاكرة المحلية) ---------- */

        @JavascriptInterface
        public void setItem(String key, String value) {
            try {
                store.edit().putString(key, value).apply();
            } catch (Exception ignored) {
            }
        }

        @JavascriptInterface
        public String getItem(String key) {
            try {
                return store.getString(key, "");
            } catch (Exception e) {
                return "";
            }
        }

        @JavascriptInterface
        public void removeItem(String key) {
            try {
                store.edit().remove(key).apply();
            } catch (Exception ignored) {
            }
        }

        @JavascriptInterface
        public String getInfo() {
            return "{\"platform\":\"android\",\"version\":\"" + versionName() + "\",\"versionCode\":" + versionCode()
                    + ",\"sdk\":" + Build.VERSION.SDK_INT + "}";
        }

        /* ---------- تحديث التطبيق من داخله ---------- */

        /** رقم نسخة التطبيق المثبّتة (الذي يُقارَن بنسخة الخادم) */
        @JavascriptInterface
        public int getVersionCode() {
            return versionCode();
        }

        @JavascriptInterface
        public String getVersionName() {
            return versionName();
        }

        /** هل يستطيع التطبيق تثبيت التحديث (إذن «تثبيت تطبيقات غير معروفة»)؟ */
        @JavascriptInterface
        public boolean canInstall() {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                return getPackageManager().canRequestPackageInstalls();
            }
            return true;
        }

        /** بدء تنزيل التحديث من رابط الخادم */
        @JavascriptInterface
        public void downloadAndInstall(final String url) {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    downloadUpdate(url);
                }
            });
        }

        /** تثبيت النسخة المُنزَّلة يدوياً (زر «تثبيت الآن») */
        @JavascriptInterface
        public boolean installUpdate() {
            final boolean[] ok = new boolean[]{false};
            final Object lock = new Object();
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    synchronized (lock) {
                        ok[0] = installPending();
                        lock.notifyAll();
                    }
                }
            });
            synchronized (lock) {
                try {
                    lock.wait(1500);
                } catch (InterruptedException ignored) {
                }
            }
            if (!ok[0]) {
                // نُنفّذ في الخلفية أيضاً في حال تأخّرت الواجهة
                runOnUiThread(new Runnable() {
                    @Override
                    public void run() {
                        installPending();
                    }
                });
            }
            return true;
        }

        /** فتح إعدادات السماح بتثبيت التطبيقات من هذا التطبيق */
        @JavascriptInterface
        public void openInstallSettings() {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    try {
                        Intent i = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES);
                        i.setData(Uri.parse("package:" + getPackageName()));
                        startActivityForResult(i, REQ_INSTALL_PERMISSION);
                    } catch (Exception ignored) {
                    }
                }
            });
        }

        /** حالة التنزيل الحالية (لاستئناف الواجهة بعد إعادة الفتح) */
        @JavascriptInterface
        public String getUpdateState() {
            String pending = store.getString(K_PENDING_APK, "");
            long id = store.getLong(K_DOWNLOAD_ID, -1L);
            return "{\"downloadId\":" + id + ",\"pending\":\"" + jsEscape(pending) + "\"}";
        }

        /** حذف ملف التحديث المُنزَّل (إلغاء) */
        @JavascriptInterface
        public void cancelUpdate() {
            try {
                DownloadManager dm = (DownloadManager) getSystemService(Context.DOWNLOAD_SERVICE);
                long id = store.getLong(K_DOWNLOAD_ID, -1L);
                if (dm != null && id > 0) {
                    dm.remove(id);
                }
            } catch (Exception ignored) {
            }
            store.edit().remove(K_DOWNLOAD_ID).remove(K_PENDING_APK).apply();
            if (progressTask != null) {
                ui.removeCallbacks(progressTask);
                progressTask = null;
            }
        }
    }

    /* ======================= تحديث التطبيق من داخله ======================= */

    /** تنزيل النسخة الجديدة مع إبلاغ الواجهة بالتقدّم */
    private void downloadUpdate(String url) {
        final String target = url == null ? "" : url.trim();
        if (target.isEmpty()) {
            notifyJs("error", "{\"message\":\"لا يوجد رابط تنزيل\"}");
            return;
        }
        try {
            File dir = apkDir();
            // تنظيف أي ملفات تحديث قديمة
            File[] old = dir.listFiles();
            if (old != null) {
                for (File f : old) {
                    if (f.isFile() && f.getName().endsWith(".apk")) {
                        // نُبقي الملف المكتمل المعلّق إن وُجد
                        if (!f.getName().equals(store.getString(K_PENDING_APK, ""))) {
                            f.delete();
                        }
                    }
                }
            }
            String name = "trix-update-" + System.currentTimeMillis() + ".apk";
            DownloadManager dm = (DownloadManager) getSystemService(Context.DOWNLOAD_SERVICE);
            if (dm == null) {
                notifyJs("error", "{\"message\":\"خدمة التنزيل غير متاحة\"}");
                return;
            }
            DownloadManager.Request req = new DownloadManager.Request(Uri.parse(target));
            req.setTitle("تحديث طرنيب وتركس");
            req.setDescription("جارٍ تنزيل النسخة الجديدة…");
            req.setMimeType("application/vnd.android.package-archive");
            req.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE);
            req.setAllowedOverMetered(true);
            req.setAllowedOverRoaming(true);
            File out = new File(dir, name);
            req.setDestinationUri(Uri.fromFile(out));
            try {
                downloadId = dm.enqueue(req);
            } catch (Exception e) {
                // بعض الأجهزة ترفض setDestinationUri لمسار ملف — نجرّب مسار التخزين الخارجي القياسي
                req.setDestinationInExternalFilesDir(MainActivity.this, Environment.DIRECTORY_DOWNLOADS, name);
                downloadId = dm.enqueue(req);
            }
            store.edit().putLong(K_DOWNLOAD_ID, downloadId).apply();
            notifyJs("start", "{\"id\":" + downloadId + "}");
            watchDownload();
        } catch (Exception e) {
            notifyJs("error", "{\"message\":\"" + jsEscape(String.valueOf(e.getMessage())) + "\"}");
        }
    }

    /** مراقبة تقدّم التنزيل وإبلاغ الواجهة بالنسبة المئوية */
    private void watchDownload() {
        if (progressTask != null) {
            ui.removeCallbacks(progressTask);
        }
        final long id = downloadId;
        if (id <= 0) {
            return;
        }
        progressTask = new Runnable() {
            @Override
            public void run() {
                DownloadManager dm = (DownloadManager) getSystemService(Context.DOWNLOAD_SERVICE);
                if (dm == null) {
                    return;
                }
                DownloadManager.Query q = new DownloadManager.Query();
                q.setFilterById(id);
                Cursor c = null;
                try {
                    c = dm.query(q);
                    if (c != null && c.moveToFirst()) {
                        int status = c.getInt(c.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS));
                        long done = c.getLong(c.getColumnIndexOrThrow(DownloadManager.COLUMN_BYTES_DOWNLOADED_SO_FAR));
                        long total = c.getLong(c.getColumnIndexOrThrow(DownloadManager.COLUMN_TOTAL_SIZE_BYTES));
                        String reason = "";
                        int reasonIdx = c.getColumnIndex(DownloadManager.COLUMN_REASON);
                        if (reasonIdx >= 0) {
                            reason = String.valueOf(c.getInt(reasonIdx));
                        }
                        int percent = total > 0 ? (int) Math.min(100, done * 100 / total) : 0;
                        notifyJs("progress", "{\"percent\":" + percent + ",\"bytes\":" + done + ",\"total\":" + total
                                + ",\"status\":" + status + "}");

                        if (status == DownloadManager.STATUS_SUCCESSFUL) {
                            progressTask = null;
                            store.edit().remove(K_DOWNLOAD_ID).apply();
                            String path = null;
                            try {
                                Uri uri = dm.getUriForDownloadedFile(id);
                                if (uri != null && "file".equals(uri.getScheme())) {
                                    path = uri.getPath();
                                }
                            } catch (Exception ignored) {
                            }
                            if (path == null) {
                                File dir2 = apkDir();
                                File[] files = dir2 == null ? null : dir2.listFiles();
                                long best = -1L;
                                if (files != null) {
                                    for (File f : files) {
                                        if (f.isFile() && f.getName().endsWith(".apk") && f.lastModified() > best) {
                                            best = f.lastModified();
                                            path = f.getAbsolutePath();
                                        }
                                    }
                                }
                            }
                            if (path == null) {
                                notifyJs("error", "{\"message\":\"لم يُعثر على الملف بعد التنزيل\"}");
                                return;
                            }
                            store.edit().putString(K_PENDING_APK, new File(path).getName()).apply();
                            notifyJs("done", "{\"path\":\"" + jsEscape(path) + "\"}");
                            // ننتقل مباشرة لشاشة التثبيت
                            installPending();
                            return;
                        }
                        if (status == DownloadManager.STATUS_FAILED) {
                            progressTask = null;
                            store.edit().remove(K_DOWNLOAD_ID).apply();
                            notifyJs("error", "{\"message\":\"فشل التنزيل (السبب " + reason + ")\",\"reason\":" + reason + "}");
                            return;
                        }
                    }
                } catch (Exception ignored) {
                } finally {
                    if (c != null) {
                        c.close();
                    }
                }
                ui.postDelayed(this, 400L);
            }
        };
        ui.postDelayed(progressTask, 400L);
    }

    /** تثبيت ملف التحديث المُنزَّل (يطلب الإذن أولاً إن لزم) */
    private boolean installPending() {
        String name = store.getString(K_PENDING_APK, "");
        if (name == null || name.isEmpty()) {
            return false;
        }
        File dir = apkDir();
        File apk = new File(dir, name);
        if (!apk.exists()) {
            notifyJs("error", "{\"message\":\"ملف التحديث غير موجود\"}");
            return false;
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                && !getPackageManager().canRequestPackageInstalls()) {
            // المستخدم لم يسمح للتطبيق بتثبيت التحديثات بعد
            notifyJs("permission", "{}");
            try {
                Intent i = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES);
                i.setData(Uri.parse("package:" + getPackageName()));
                startActivityForResult(i, REQ_INSTALL_PERMISSION);
            } catch (Exception e) {
                try {
                    startActivity(new Intent(Settings.ACTION_SECURITY_SETTINGS));
                } catch (Exception ignored) {
                }
            }
            return false;
        }
        try {
            Intent intent = new Intent(Intent.ACTION_VIEW);
            intent.setDataAndType(ApkProvider.uriFor(apk), "application/vnd.android.package-archive");
            intent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_GRANT_READ_URI_PERMISSION);
            startActivity(intent);
            notifyJs("install", "{\"name\":\"" + jsEscape(apk.getName()) + "\"}");
            return true;
        } catch (Exception e) {
            notifyJs("error", "{\"message\":\"" + jsEscape(String.valueOf(e.getMessage())) + "\"}");
            return false;
        }
    }

    /** إبلاغ واجهة الويب (window.__trixUpdate) بأحداث التحديث */
    private void notifyJs(final String event, final String json) {
        if (web == null) {
            return;
        }
        runOnUiThread(new Runnable() {
            @Override
            public void run() {
                try {
                    web.evaluateJavascript(
                            "window.__trixUpdate && window.__trixUpdate('" + jsEscape(event) + "', '" + jsEscape(json) + "')",
                            null);
                } catch (Exception ignored) {
                }
            }
        });
    }

    private static String jsEscape(String s) {
        if (s == null) {
            return "";
        }
        return s.replace("\\", "\\\\").replace("'", "\\'").replace("\n", " ").replace("\r", " ");
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode != REQ_MIC) {
            return;
        }
        PermissionRequest request = pendingPermission;
        pendingPermission = null;
        if (request == null) {
            return;
        }
        boolean granted = grantResults.length > 0 && grantResults[0] == PackageManager.PERMISSION_GRANTED;
        if (granted) {
            request.grant(new String[]{PermissionRequest.RESOURCE_AUDIO_CAPTURE});
        } else {
            request.deny();
            Toast.makeText(this, "يجب السماح بالميكروفون لإرسال رسالة صوتية", Toast.LENGTH_LONG).show();
        }
    }

    @Override
    public boolean onKeyDown(int keyCode, KeyEvent event) {
        if (keyCode == KeyEvent.KEYCODE_BACK && web != null) {
            // نعطي الواجهة فرصة للتعامل مع الزر (إغلاق النوافذ، الخروج من الغرفة...)
            web.evaluateJavascript(
                    "(function(){ try { return window.__trixBack ? String(window.__trixBack()) : 'false'; } catch(e) { return 'false'; } })()",
                    new android.webkit.ValueCallback<String>() {
                        @Override
                        public void onReceiveValue(String value) {
                            boolean handled = value != null && value.contains("true");
                            if (handled) {
                                return;
                            }
                            long now = System.currentTimeMillis();
                            if (now - lastBackPress < 2000) {
                                finish();
                            } else {
                                lastBackPress = now;
                                Toast.makeText(MainActivity.this, "اضغط رجوع مرة أخرى للخروج", Toast.LENGTH_SHORT).show();
                            }
                        }
                    });
            return true;
        }
        return super.onKeyDown(keyCode, event);
    }

    /** رقم نسخة التطبيق من مدير الحزم */
    private int versionCode() {
        try {
            PackageInfo info = getPackageManager().getPackageInfo(getPackageName(), 0);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                return (int) info.getLongVersionCode();
            }
            return info.versionCode;
        } catch (Exception e) {
            return 0;
        }
    }

    private String versionName() {
        try {
            PackageInfo info = getPackageManager().getPackageInfo(getPackageName(), 0);
            String v = info.versionName;
            return v == null ? "1.0.0" : String.format(Locale.US, "%s", v);
        } catch (Exception e) {
            return "1.0.0";
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == REQ_INSTALL_PERMISSION) {
            // عاد المستخدم من إعدادات السماح: نُكمل التثبيت تلقائياً
            if (store.getString(K_PENDING_APK, "") != null && !store.getString(K_PENDING_APK, "").isEmpty()) {
                ui.postDelayed(new Runnable() {
                    @Override
                    public void run() {
                        installPending();
                    }
                }, 600L);
            }
        }
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (web != null) {
            web.onResume();
            web.setVisibility(View.VISIBLE);
        }
        // إن كان التنزيل جارياً نتابعه، وإن كان الملف جاهزاً نُكمل التثبيت
        long id = store.getLong(K_DOWNLOAD_ID, -1L);
        if (id > 0 && downloadId != id) {
            downloadId = id;
            watchDownload();
        } else if (id > 0 && progressTask == null) {
            watchDownload();
        } else if (id <= 0 && !store.getString(K_PENDING_APK, "").isEmpty()) {
            ui.postDelayed(new Runnable() {
                @Override
                public void run() {
                    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O || getPackageManager().canRequestPackageInstalls()) {
                        installPending();
                    }
                }
            }, 900L);
        }
    }

    @Override
    protected void onPause() {
        if (web != null) {
            web.onPause();
        }
        super.onPause();
    }

    @Override
    protected void onDestroy() {
        if (web != null) {
            web.destroy();
            web = null;
        }
        super.onDestroy();
    }
}
