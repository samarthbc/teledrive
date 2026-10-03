package com.samarthbc.teledrive;

import android.annotation.SuppressLint;
import android.content.Context;
import android.net.ConnectivityManager;
import android.net.NetworkCapabilities;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;
import android.webkit.JavascriptInterface;
import android.webkit.ServiceWorkerClient;
import android.webkit.ServiceWorkerController;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;

import androidx.annotation.NonNull;
import androidx.webkit.WebViewAssetLoader;
import androidx.webkit.WebViewClientCompat;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.IOException;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;

/**
 * Runs camera backup while the app is closed: loads the backup page (backup.html, built from
 * src/backup/headless.ts) in a WebView that is never shown.
 *
 * The page is served from https://localhost, the same origin as the app, so it shares the app's
 * IndexedDB: the Telegram login, the file index, the backup settings and the list of backed-up photos.
 * It reaches photos through a small JavaScript bridge (window.TeleDriveHeadless), since Capacitor
 * plugins need an Activity.
 */
public final class HeadlessRunner {

    private static final String TAG = "TeleDriveBackup";
    private static final String ORIGIN = "https://localhost";
    private static final Handler main = new Handler(Looper.getMainLooper());
    private static final Object lock = new Object();

    private static CountDownLatch latch;
    private static String result;
    private static WebView webView;
    private static MediaAccess media;

    private HeadlessRunner() {}

    /** Run the backup page until it reports done (or the time limit). Returns its result (JSON). */
    static String run(Context context, long timeoutMs, String scope) throws InterruptedException {
        Context ctx = context.getApplicationContext();
        CountDownLatch done = new CountDownLatch(1);
        synchronized (lock) {
            latch = done;
            result = "{\"status\":\"Timed out\"}";
        }
        main.post(() -> start(ctx, scope));
        done.await(timeoutMs, TimeUnit.MILLISECONDS);
        main.post(HeadlessRunner::destroy);
        synchronized (lock) {
            latch = null;
            return result;
        }
    }

    /** Stop now (the app was opened, or Android stopped the job). */
    static void stop() {
        finish("{\"status\":\"Stopped\"}");
        main.post(HeadlessRunner::destroy);
    }

    private static void finish(String json) {
        synchronized (lock) {
            if (latch == null) return;
            result = json;
            latch.countDown();
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    private static void start(Context ctx, String scope) {
        destroy();
        synchronized (lock) {
            if (latch == null || latch.getCount() == 0) return; // stopped before it started
        }
        media = new MediaAccess(ctx);
        WebViewAssetLoader assets = new WebViewAssetLoader.Builder()
            .setDomain("localhost")
            .addPathHandler("/", new PublicAssets(ctx))
            .build();

        // Requests made through the app's service worker also have to be served from the app's files
        ServiceWorkerController.getInstance().setServiceWorkerClient(new ServiceWorkerClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebResourceRequest request) {
                return assets.shouldInterceptRequest(request.getUrl());
            }
        });

        WebView wv = new WebView(ctx);
        wv.getSettings().setJavaScriptEnabled(true);
        wv.getSettings().setDomStorageEnabled(true);
        wv.setWebViewClient(new WebViewClientCompat() {
            @Override
            public WebResourceResponse shouldInterceptRequest(@NonNull WebView view, @NonNull WebResourceRequest request) {
                return assets.shouldInterceptRequest(request.getUrl());
            }
        });
        wv.addJavascriptInterface(new Bridge(ctx), "TeleDriveHeadless");
        // Not attached to a window: make sure its timers run anyway
        wv.onResume();
        wv.resumeTimers();
        wv.loadUrl(ORIGIN + "/backup.html?scope=" + scope);
        webView = wv;
    }

    private static void destroy() {
        if (webView != null) {
            webView.stopLoading();
            webView.destroy();
            webView = null;
        }
        if (media != null) {
            media.closeAll();
            media = null;
        }
    }

    /** Serves the web app's files (assets/public) at https://localhost/. */
    private static class PublicAssets implements WebViewAssetLoader.PathHandler {
        private final Context ctx;

        PublicAssets(Context ctx) {
            this.ctx = ctx;
        }

        @Override
        public WebResourceResponse handle(@NonNull String path) {
            try {
                InputStream in = ctx.getAssets().open("public/" + (path.isEmpty() ? "index.html" : path));
                return new WebResourceResponse(mimeType(path), null, in);
            } catch (IOException e) {
                return null;
            }
        }

        private static String mimeType(String path) {
            String p = path.toLowerCase();
            if (p.endsWith(".html")) return "text/html";
            if (p.endsWith(".js") || p.endsWith(".mjs")) return "text/javascript";
            if (p.endsWith(".css")) return "text/css";
            if (p.endsWith(".json") || p.endsWith(".webmanifest")) return "application/json";
            if (p.endsWith(".wasm")) return "application/wasm";
            if (p.endsWith(".svg")) return "image/svg+xml";
            if (p.endsWith(".png")) return "image/png";
            return "application/octet-stream";
        }
    }

    /** window.TeleDriveHeadless.call(method, argsJson) → resultJson (or {"error": ...}). */
    private static class Bridge {
        private final Context ctx;

        Bridge(Context ctx) {
            this.ctx = ctx;
        }

        @JavascriptInterface
        public String call(String method, String argsJson) {
            try {
                JSONObject a = new JSONObject(argsJson == null || argsJson.isEmpty() ? "{}" : argsJson);
                JSONObject out = new JSONObject();
                MediaAccess m = media;
                switch (method) {
                    case "mediaPermission":
                        out.put("granted", MediaAccess.granted(ctx));
                        break;
                    case "listMedia": {
                        if (m == null) throw new IllegalStateException("Stopped");
                        List<String> paths = new ArrayList<>();
                        JSONArray arr = a.optJSONArray("paths");
                        for (int i = 0; arr != null && i < arr.length(); i++) paths.add(arr.getString(i));
                        out.put("items", m.listMedia(paths, a.optLong("since", 0), a.optInt("limit", 500)));
                        break;
                    }
                    case "readFile":
                        if (m == null) throw new IllegalStateException("Stopped");
                        out.put("data", m.read(a.getString("uri"), a.getLong("offset"), a.getInt("length")));
                        break;
                    case "closeFile":
                        if (m != null) m.close(a.optString("uri"));
                        break;
                    case "thumbnail": {
                        String data = m != null ? m.thumbnail(a.optString("uri")) : null;
                        if (data != null) out.put("data", data);
                        break;
                    }
                    case "network":
                        network(out);
                        break;
                    case "done":
                        finish(a.optString("result", "{}"));
                        break;
                    case "log":
                        Log.i(TAG, a.optString("message"));
                        break;
                    default:
                        // Android-app-only features (notifications, saving files…) do nothing here
                        break;
                }
                return out.toString();
            } catch (Exception e) {
                return "{\"error\":" + JSONObject.quote(String.valueOf(e.getMessage())) + "}";
            }
        }

        private void network(JSONObject out) throws Exception {
            ConnectivityManager cm = ctx.getSystemService(ConnectivityManager.class);
            NetworkCapabilities caps = cm.getNetworkCapabilities(cm.getActiveNetwork());
            boolean connected = caps != null && caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET);
            out.put("connected", connected);
            out.put("wifi", connected && caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_NOT_METERED));
        }
    }
}
