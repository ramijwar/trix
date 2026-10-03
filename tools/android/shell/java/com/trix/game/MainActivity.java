package com.trix.game;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.VibrationEffect;
import android.os.Vibrator;
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
import java.io.FileNotFoundException;
import java.io.IOException;
import java.io.InputStream;
import java.util.HashMap;
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

    private WebView web;
    private SharedPreferences store;
    private long lastBackPress = 0L;
    /** طلب إذن الصفحة (الميكروفون) بانتظار موافقة المستخدم */
    private PermissionRequest pendingPermission;

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
    }

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
            return "{\"platform\":\"android\",\"version\":\"1.0.0\",\"sdk\":" + Build.VERSION.SDK_INT + "}";
        }
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

    @Override
    protected void onResume() {
        super.onResume();
        if (web != null) {
            web.onResume();
            web.setVisibility(View.VISIBLE);
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
