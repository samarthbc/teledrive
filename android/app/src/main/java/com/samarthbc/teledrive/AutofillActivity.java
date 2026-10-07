package com.samarthbc.teledrive;

import android.annotation.SuppressLint;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.service.autofill.Dataset;
import android.util.Log;
import android.view.WindowManager;
import android.view.autofill.AutofillId;
import android.view.autofill.AutofillManager;
import android.view.autofill.AutofillValue;
import android.webkit.JavascriptInterface;
import android.webkit.ServiceWorkerClient;
import android.webkit.ServiceWorkerController;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;

import androidx.activity.OnBackPressedCallback;
import androidx.annotation.NonNull;
import androidx.appcompat.app.AppCompatActivity;
import androidx.webkit.WebViewAssetLoader;
import androidx.webkit.WebViewClientCompat;

import org.json.JSONObject;

import java.util.ArrayList;
import java.util.Iterator;
import java.util.UUID;

/**
 * The window that opens from TeleWarden's autofill suggestion: the autofill page (autofill.html, built from
 * src/autofill) in a WebView from the app's own origin, so it shares the app's IndexedDB (the remembered TeleDrive
 * password, TeleWarden's messages as last synced). There the vault is unlocked and an item picked; its values come
 * back through window.TeleDriveHeadless and go to Android as the dataset. Kept out of screenshots (FLAG_SECURE).
 */
public class AutofillActivity extends AppCompatActivity {

    private static final String TAG = "TeleWardenAutofill";
    private static final String ORIGIN = "https://localhost";

    private WebView webView;
    private ArrayList<AutofillId> ids;
    private ArrayList<String> idKinds;
    private boolean done = false;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_SECURE);
        Intent in = getIntent();
        ids = in.getParcelableArrayListExtra(TeleWardenAutofillService.EXTRA_IDS);
        idKinds = in.getStringArrayListExtra(TeleWardenAutofillService.EXTRA_ID_KINDS);
        if (ids == null || idKinds == null) {
            cancel();
            return;
        }

        WebViewAssetLoader assets = new WebViewAssetLoader.Builder()
            .setDomain("localhost")
            .addPathHandler("/", new HeadlessRunner.PublicAssets(this))
            .build();
        // With TeleDrive closed, nothing serves the app's service worker its files: serve them here (the app's own
        // bridge does it while the app is running)
        if (!MainActivity.alive) {
            ServiceWorkerController.getInstance().setServiceWorkerClient(new ServiceWorkerClient() {
                @Override
                public WebResourceResponse shouldInterceptRequest(WebResourceRequest request) {
                    return assets.shouldInterceptRequest(request.getUrl());
                }
            });
        }

        WebView wv = new WebView(this);
        wv.getSettings().setJavaScriptEnabled(true);
        wv.getSettings().setDomStorageEnabled(true);
        wv.setWebViewClient(new WebViewClientCompat() {
            @Override
            public WebResourceResponse shouldInterceptRequest(@NonNull WebView view, @NonNull WebResourceRequest request) {
                return assets.shouldInterceptRequest(request.getUrl());
            }

            @Override
            public boolean shouldOverrideUrlLoading(@NonNull WebView view, @NonNull WebResourceRequest request) {
                // Nothing leaves this window
                return !request.getUrl().toString().startsWith(ORIGIN);
            }
        });
        wv.addJavascriptInterface(new Bridge(), "TeleDriveHeadless");
        setContentView(wv);
        webView = wv;

        Uri url = Uri.parse(ORIGIN + "/autofill.html").buildUpon()
            .appendQueryParameter("kind", in.getStringExtra(TeleWardenAutofillService.EXTRA_KIND))
            .appendQueryParameter("target", in.getStringExtra(TeleWardenAutofillService.EXTRA_TARGET))
            .appendQueryParameter("label", in.getStringExtra(TeleWardenAutofillService.EXTRA_LABEL))
            .appendQueryParameter("fields", in.getStringExtra(TeleWardenAutofillService.EXTRA_FIELDS))
            .build();
        wv.loadUrl(url.toString());

        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                cancel();
            }
        });
    }

    @Override
    protected void onDestroy() {
        if (webView != null) {
            webView.stopLoading();
            webView.destroy();
            webView = null;
        }
        super.onDestroy();
    }

    private void cancel() {
        if (done) return;
        done = true;
        setResult(RESULT_CANCELED);
        finish();
    }

    /** Hand Android the values (by field kind) for the fields found on the screen, and close. */
    private void fill(JSONObject values) {
        if (done) return;
        Dataset.Builder dataset = new Dataset.Builder(TeleWardenAutofillService.presentation(this, "TeleWarden", "Filled"));
        int set = 0;
        for (int i = 0; i < ids.size(); i++) {
            String v = values.optString(idKinds.get(i), "");
            if (v.isEmpty()) continue;
            dataset.setValue(ids.get(i), AutofillValue.forText(v));
            set++;
        }
        if (set == 0) {
            cancel();
            return;
        }
        done = true;
        Intent result = new Intent();
        result.putExtra(AutofillManager.EXTRA_AUTHENTICATION_RESULT, dataset.build());
        setResult(RESULT_OK, result);
        finish();
    }

    /** Answer a call that took a while (the fingerprint) through window.__nativeResult. */
    private void answer(String id, String json) {
        runOnUiThread(() -> {
            if (webView != null) webView.evaluateJavascript("window.__nativeResult(" + JSONObject.quote(id) + "," + JSONObject.quote(json) + ")", null);
        });
    }

    /** window.TeleDriveHeadless.call(method, argsJson) → resultJson, {pending: id}, or {error}. */
    private class Bridge {
        @JavascriptInterface
        public String call(String method, String argsJson) {
            try {
                JSONObject a = new JSONObject(argsJson == null || argsJson.isEmpty() ? "{}" : argsJson);
                JSONObject out = new JSONObject();
                switch (method) {
                    case "biometricAvailable": {
                        boolean[] r = VaultSecrets.biometricAvailable(AutofillActivity.this);
                        out.put("available", r[0]);
                        out.put("enrolled", r[1]);
                        break;
                    }
                    case "biometricUnlock": {
                        String id = UUID.randomUUID().toString();
                        VaultSecrets.biometricUnlock(AutofillActivity.this, new VaultSecrets.Done() {
                            @Override
                            public void ok(String data) {
                                answer(id, "{\"data\":" + JSONObject.quote(data) + "}");
                            }

                            @Override
                            public void cancelled() {
                                answer(id, "{\"cancelled\":true}");
                            }

                            @Override
                            public void failed(String message, String code) {
                                answer(id, "{\"error\":" + JSONObject.quote(String.valueOf(message)) + (code != null ? ",\"code\":" + JSONObject.quote(code) : "") + "}");
                            }
                        });
                        out.put("pending", id);
                        break;
                    }
                    case "biometricDisable":
                        VaultSecrets.biometricDisable(AutofillActivity.this);
                        break;
                    case "copySecret":
                        VaultSecrets.copySecret(AutofillActivity.this, a.optString("text"), a.optLong("clearAfter", 0));
                        break;
                    case "autofillFill": {
                        JSONObject values = a.optJSONObject("values");
                        runOnUiThread(() -> fill(values != null ? values : new JSONObject()));
                        break;
                    }
                    case "autofillCancel":
                        runOnUiThread(AutofillActivity.this::cancel);
                        break;
                    case "log":
                        Log.i(TAG, a.optString("message"));
                        break;
                    default:
                        // Nothing else is needed here (no Telegram, no files)
                        break;
                }
                return out.toString();
            } catch (Exception e) {
                return "{\"error\":" + JSONObject.quote(String.valueOf(e.getMessage())) + "}";
            }
        }
    }
}
