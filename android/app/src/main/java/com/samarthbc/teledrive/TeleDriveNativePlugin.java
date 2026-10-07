package com.samarthbc.teledrive;

import android.Manifest;
import android.app.Activity;
import android.app.PendingIntent;
import android.content.ClipData;
import android.content.ClipDescription;
import android.content.ClipboardManager;
import android.content.ContentResolver;
import android.content.ContentUris;
import android.content.ContentValues;
import android.content.Context;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.os.Handler;
import android.os.Looper;
import android.os.PersistableBundle;
import android.os.ParcelFileDescriptor;
import android.provider.MediaStore;
import android.provider.OpenableColumns;
import android.provider.Settings;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyPermanentlyInvalidatedException;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import android.view.Window;
import android.view.WindowManager;

import androidx.activity.result.ActivityResultLauncher;
import androidx.biometric.BiometricManager;
import androidx.biometric.BiometricPrompt;
import androidx.fragment.app.FragmentActivity;
import androidx.activity.result.IntentSenderRequest;
import androidx.activity.result.contract.ActivityResultContracts;
import androidx.core.content.ContextCompat;
import androidx.core.content.FileProvider;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsControllerCompat;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import com.google.mlkit.vision.barcode.common.Barcode;
import com.google.mlkit.vision.codescanner.GmsBarcodeScannerOptions;
import com.google.mlkit.vision.codescanner.GmsBarcodeScanning;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.security.KeyStore;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.function.Consumer;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/**
 * Android-only features for TeleDrive:
 * - writing downloads into Downloads/TeleDrive (or the cache, for "open with")
 * - opening files in other apps
 * - reading files shared to the app ("Share → TeleDrive") and camera media, in pieces
 * - listing new camera photos/videos for camera backup
 * - a foreground service that keeps transfers running while the app is in the background
 * - downloading and installing app updates from GitHub Releases
 */
@CapacitorPlugin(
    name = "TeleDriveNative",
    permissions = {
        // Android 13+
        @Permission(alias = "media", strings = { Manifest.permission.READ_MEDIA_IMAGES, Manifest.permission.READ_MEDIA_VIDEO }),
        // Android 10-12
        @Permission(alias = "mediaLegacy", strings = { Manifest.permission.READ_EXTERNAL_STORAGE }),
        @Permission(alias = "notifications", strings = { Manifest.permission.POST_NOTIFICATIONS })
    }
)
public class TeleDriveNativePlugin extends Plugin {

    /** Files being written: id → output. */
    private final Map<String, Output> outputs = new HashMap<>();
    /** Reading photos/videos and shared files. */
    private MediaAccess media;

    /** The plugin of the running app (null when the app isn't running). Used by BackupWorker. */
    static volatile TeleDriveNativePlugin instance;
    private CountDownLatch appBackup;
    private volatile String appBackupResult;
    /** Files shared to the app that JavaScript hasn't picked up yet. */
    private final List<JSObject> pendingShares = new ArrayList<>();
    /** Android's "move to trash?" prompt for Free up space, and the call waiting for its answer. */
    private ActivityResultLauncher<IntentSenderRequest> trashPrompt;
    private PluginCall trashCall;

    private static class Output {
        Uri uri;
        File file;
        OutputStream stream;
        String mime;
    }

    @Override
    public void load() {
        media = new MediaAccess(getContext());
        instance = this;
        collectShares(getActivity().getIntent());
        trashPrompt = getActivity().registerForActivityResult(new ActivityResultContracts.StartIntentSenderForResult(), result -> {
            PluginCall call = trashCall;
            trashCall = null;
            if (call == null) return;
            JSObject ret = new JSObject();
            ret.put("done", result.getResultCode() == Activity.RESULT_OK);
            call.resolve(ret);
        });
    }

    /**
     * Free up space: move photos/videos (content URIs) to the phone's trash, where Android deletes them for good after
     * 30 days. Android asks the user first; resolves { done } with whether they allowed it. Needs Android 11+.
     */
    @PluginMethod
    public void trashMedia(PluginCall call) {
        if (Build.VERSION.SDK_INT < 30) {
            call.reject("Free up space needs Android 11 or newer");
            return;
        }
        if (trashCall != null) {
            call.reject("Already waiting for an answer");
            return;
        }
        try {
            List<Uri> uris = new ArrayList<>();
            JSArray arr = call.getArray("uris", new JSArray());
            for (int i = 0; i < arr.length(); i++) uris.add(Uri.parse(arr.getString(i)));
            if (uris.isEmpty()) {
                JSObject ret = new JSObject();
                ret.put("done", true);
                call.resolve(ret);
                return;
            }
            PendingIntent pi = MediaStore.createTrashRequest(getContext().getContentResolver(), uris, true);
            trashCall = call;
            getActivity().runOnUiThread(() -> trashPrompt.launch(new IntentSenderRequest.Builder(pi.getIntentSender()).build()));
        } catch (Exception e) {
            trashCall = null;
            call.reject(e.getMessage(), e);
        }
    }

    @Override
    protected void handleOnNewIntent(Intent intent) {
        super.handleOnNewIntent(intent);
        if (collectShares(intent)) notifyListeners("shared", new JSObject());
    }

    // ---- Permissions ----

    private String mediaAlias() {
        return Build.VERSION.SDK_INT >= 33 ? "media" : "mediaLegacy";
    }

    private boolean mediaGranted() {
        return getPermissionState(mediaAlias()) == PermissionState.GRANTED;
    }

    /** { granted } for reading photos/videos; asks the user if `request` is true. */
    @PluginMethod
    public void mediaPermission(PluginCall call) {
        if (mediaGranted() || !call.getBoolean("request", false)) {
            resolveGranted(call, mediaGranted());
            return;
        }
        requestPermissionForAlias(mediaAlias(), call, "mediaPermissionResult");
    }

    @PermissionCallback
    private void mediaPermissionResult(PluginCall call) {
        resolveGranted(call, mediaGranted());
    }

    /** Android 13+ needs permission to show the transfer notification. */
    @PluginMethod
    public void notificationPermission(PluginCall call) {
        if (Build.VERSION.SDK_INT < 33 || getPermissionState("notifications") == PermissionState.GRANTED) {
            resolveGranted(call, true);
            return;
        }
        requestPermissionForAlias("notifications", call, "notificationPermissionResult");
    }

    @PermissionCallback
    private void notificationPermissionResult(PluginCall call) {
        resolveGranted(call, getPermissionState("notifications") == PermissionState.GRANTED);
    }

    private void resolveGranted(PluginCall call, boolean ok) {
        JSObject ret = new JSObject();
        ret.put("granted", ok);
        call.resolve(ret);
    }

    // ---- Writing files ----

    /** Start a file in Downloads/TeleDrive ("downloads") or the app cache ("cache"). */
    @PluginMethod
    public void createFile(PluginCall call) {
        String name = call.getString("name", "file");
        String mime = call.getString("mime", "application/octet-stream");
        String location = call.getString("location", "downloads");
        try {
            Output out = new Output();
            out.mime = mime;
            if ("cache".equals(location)) {
                File dir = new File(getContext().getCacheDir(), "open");
                if (!dir.exists() && !dir.mkdirs()) throw new IOException("Could not create cache folder");
                out.file = new File(dir, safeName(name));
                out.stream = new FileOutputStream(out.file);
            } else {
                ContentValues v = new ContentValues();
                v.put(MediaStore.Downloads.DISPLAY_NAME, name);
                v.put(MediaStore.Downloads.MIME_TYPE, mime);
                v.put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/TeleDrive");
                v.put(MediaStore.Downloads.IS_PENDING, 1);
                out.uri = resolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, v);
                if (out.uri == null) throw new IOException("Could not create the file in Downloads");
                out.stream = resolver().openOutputStream(out.uri, "w");
                if (out.stream == null) throw new IOException("Could not open the file for writing");
            }
            String id = UUID.randomUUID().toString();
            outputs.put(id, out);
            JSObject ret = new JSObject();
            ret.put("id", id);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject(e.getMessage(), e);
        }
    }

    @PluginMethod
    public void appendFile(PluginCall call) {
        Output out = outputs.get(call.getString("id", ""));
        if (out == null) {
            call.reject("Unknown file");
            return;
        }
        try {
            out.stream.write(Base64.decode(call.getString("data", ""), Base64.DEFAULT));
            call.resolve();
        } catch (Exception e) {
            call.reject(e.getMessage(), e);
        }
    }

    /** Finish writing; returns a content:// URI other apps can open. */
    @PluginMethod
    public void finishFile(PluginCall call) {
        Output out = outputs.remove(call.getString("id", ""));
        if (out == null) {
            call.reject("Unknown file");
            return;
        }
        try {
            out.stream.close();
            Uri uri;
            if (out.file != null) {
                uri = FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", out.file);
            } else {
                ContentValues v = new ContentValues();
                v.put(MediaStore.Downloads.IS_PENDING, 0);
                resolver().update(out.uri, v, null, null);
                uri = out.uri;
            }
            JSObject ret = new JSObject();
            ret.put("uri", uri.toString());
            call.resolve(ret);
        } catch (Exception e) {
            call.reject(e.getMessage(), e);
        }
    }

    @PluginMethod
    public void abortFile(PluginCall call) {
        Output out = outputs.remove(call.getString("id", ""));
        if (out != null) {
            try {
                out.stream.close();
            } catch (IOException ignored) {
            }
            if (out.file != null) //noinspection ResultOfMethodCallIgnored
                out.file.delete();
            if (out.uri != null) resolver().delete(out.uri, null, null);
        }
        call.resolve();
    }

    /** Open a file with another app ("Open with…"). */
    @PluginMethod
    public void openFile(PluginCall call) {
        try {
            Uri uri = Uri.parse(call.getString("uri", ""));
            Intent intent = new Intent(Intent.ACTION_VIEW);
            intent.setDataAndType(uri, call.getString("mime", "*/*"));
            intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            getActivity().startActivity(Intent.createChooser(intent, "Open with"));
            call.resolve();
        } catch (Exception e) {
            call.reject("No app on this phone can open this file", e);
        }
    }

    // ---- Reading shared files / camera media ----

    private boolean collectShares(Intent intent) {
        if (intent == null) return false;
        String action = intent.getAction();
        List<Uri> uris = new ArrayList<>();
        if (Intent.ACTION_SEND.equals(action)) {
            Uri uri = intent.getParcelableExtra(Intent.EXTRA_STREAM);
            if (uri != null) uris.add(uri);
        } else if (Intent.ACTION_SEND_MULTIPLE.equals(action)) {
            ArrayList<Uri> list = intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM);
            if (list != null) uris.addAll(list);
        }
        if (uris.isEmpty()) return false;
        // Handle each share only once, even if the activity is recreated
        intent.setAction(null);
        synchronized (pendingShares) {
            for (Uri uri : uris) {
                JSObject info = describe(uri);
                if (info != null) pendingShares.add(info);
            }
        }
        return true;
    }

    /** Files shared to the app since the last call. */
    @PluginMethod
    public void takeSharedFiles(PluginCall call) {
        JSArray arr = new JSArray();
        synchronized (pendingShares) {
            for (JSObject o : pendingShares) arr.put(o);
            pendingShares.clear();
        }
        JSObject ret = new JSObject();
        ret.put("files", arr);
        call.resolve(ret);
    }

    private JSObject describe(Uri uri) {
        String name = null;
        long size = -1;
        try (Cursor c = resolver().query(uri, new String[] { OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE }, null, null, null)) {
            if (c != null && c.moveToFirst()) {
                name = c.getString(0);
                if (!c.isNull(1)) size = c.getLong(1);
            }
        } catch (Exception ignored) {
        }
        if (size < 0) {
            try (ParcelFileDescriptor pfd = resolver().openFileDescriptor(uri, "r")) {
                if (pfd != null) size = pfd.getStatSize();
            } catch (Exception ignored) {
            }
        }
        if (size < 0) return null;
        JSObject o = new JSObject();
        o.put("uri", uri.toString());
        o.put("name", name != null ? name : "shared-file");
        o.put("size", size);
        String mime = resolver().getType(uri);
        o.put("mime", mime != null ? mime : "application/octet-stream");
        o.put("lastModified", System.currentTimeMillis());
        return o;
    }

    /** Read up to `length` bytes at `offset` (base64). */
    @PluginMethod
    public void readFile(PluginCall call) {
        try {
            JSObject ret = new JSObject();
            ret.put("data", media.read(call.getString("uri", ""), longArg(call, "offset", 0L), (int) longArg(call, "length", 512 * 1024)));
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("Could not read the file: " + e.getMessage(), e);
        }
    }

    @PluginMethod
    public void closeFile(PluginCall call) {
        media.close(call.getString("uri", ""));
        call.resolve();
    }

    /** Small JPEG preview of a photo/video (base64), or no data if Android can't make one. */
    @PluginMethod
    public void thumbnail(PluginCall call) {
        JSObject ret = new JSObject();
        String data = media.thumbnail(call.getString("uri", ""));
        if (data != null) ret.put("data", data);
        call.resolve(ret);
    }

    /** Photos and videos in the given folders added at or after `since` (unix seconds), oldest first. */
    @PluginMethod
    public void listMedia(PluginCall call) {
        if (!mediaGranted()) {
            call.reject("Permission to read photos and videos was not granted");
            return;
        }
        try {
            List<String> paths = new ArrayList<>();
            JSArray arr = call.getArray("paths", new JSArray());
            for (int i = 0; i < arr.length(); i++) paths.add(arr.getString(i));
            JSObject ret = new JSObject();
            ret.put("items", media.listMedia(paths, longArg(call, "since", 0L), (int) longArg(call, "limit", 500)));
            call.resolve(ret);
        } catch (Exception e) {
            call.reject(e.getMessage(), e);
        }
    }

    /** Folders that contain photos or videos. */
    @PluginMethod
    public void listMediaFolders(PluginCall call) {
        if (!mediaGranted()) {
            call.reject("Permission to read photos and videos was not granted");
            return;
        }
        try {
            JSObject ret = new JSObject();
            ret.put("folders", media.listFolders());
            call.resolve(ret);
        } catch (Exception e) {
            call.reject(e.getMessage(), e);
        }
    }

    // ---- Backup while the app is closed ----

    /** Save the settings the background backup needs and (re)schedule it. */
    @PluginMethod
    public void scheduleBackgroundBackup(PluginCall call) {
        BackupScheduler.configure(
            getContext(), call.getBoolean("enabled", false), call.getBoolean("wifiOnly", true),
            call.getBoolean("instant", true), call.getBoolean("overnight", false), call.getBoolean("charging", false)
        );
        call.resolve();
    }

    /**
     * The app is running in the background: ask its JavaScript to back up, and wait until it says
     * it's done (JS calls backgroundBackupDone). Called from BackupWorker's thread.
     */
    String runBackupInApp(long timeoutMs, String scope) throws InterruptedException {
        CountDownLatch done = new CountDownLatch(1);
        appBackup = done;
        appBackupResult = "{\"status\":\"Timed out\"}";
        JSObject data = new JSObject();
        data.put("scope", scope);
        notifyListeners("backgroundBackup", data, true);
        done.await(timeoutMs, TimeUnit.MILLISECONDS);
        appBackup = null;
        return appBackupResult;
    }

    /** Stop waiting for the app (Android stopped the job). */
    void cancelAppBackup() {
        CountDownLatch done = appBackup;
        if (done != null) done.countDown();
    }

    @PluginMethod
    public void backgroundBackupDone(PluginCall call) {
        appBackupResult = call.getString("result", "{}");
        CountDownLatch done = appBackup;
        if (done != null) done.countDown();
        call.resolve();
    }

    /** When the background backup last ran and what it did. */
    @PluginMethod
    public void backgroundBackupStatus(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("lastRun", BackupScheduler.lastRun(getContext()));
        ret.put("lastResult", BackupScheduler.lastResult(getContext()));
        call.resolve(ret);
    }

    /** Opens the phone's settings for this app (autostart / battery on some phones). */
    @PluginMethod
    public void openAppSettings(PluginCall call) {
        Intent intent = new Intent(android.provider.Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + getContext().getPackageName()));
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        getContext().startActivity(intent);
        call.resolve();
    }

    /** Status and navigation bars follow the theme picked in the app (it can differ from the phone's). */
    @PluginMethod
    public void systemBars(PluginCall call) {
        boolean dark = call.getBoolean("dark", false);
        getActivity().runOnUiThread(() -> {
            Window window = getActivity().getWindow();
            int color = dark ? 0xFF1F2023 : 0xFFE6E6E3;
            window.setStatusBarColor(color);
            window.setNavigationBarColor(color);
            WindowInsetsControllerCompat bars = WindowCompat.getInsetsController(window, window.getDecorView());
            bars.setAppearanceLightStatusBars(!dark);
            bars.setAppearanceLightNavigationBars(!dark);
        });
        call.resolve();
    }

    // ---- TeleWarden ----

    /** Which copy is the latest (a newer copy cancels the older one's clearing). */
    private int clipSerial = 0;

    /**
     * Copy a secret: marked sensitive, so the keyboard's clipboard strip and Android's preview don't show it, and
     * cleared after `clearAfter` seconds (0 = never) if it's still what's on the clipboard.
     */
    @PluginMethod
    public void copySecret(PluginCall call) {
        String text = call.getString("text", "");
        long clearAfter = longArg(call, "clearAfter", 0);
        getActivity().runOnUiThread(() -> {
            ClipboardManager cm = (ClipboardManager) getContext().getSystemService(Context.CLIPBOARD_SERVICE);
            ClipData clip = ClipData.newPlainText("TeleWarden", text);
            PersistableBundle extras = new PersistableBundle();
            // ClipDescription.EXTRA_IS_SENSITIVE from Android 13; keyboards read the same key on older versions
            extras.putBoolean(Build.VERSION.SDK_INT >= 33 ? ClipDescription.EXTRA_IS_SENSITIVE : "android.content.extra.IS_SENSITIVE", true);
            clip.getDescription().setExtras(extras);
            cm.setPrimaryClip(clip);
            int mine = ++clipSerial;
            if (clearAfter > 0) {
                new Handler(Looper.getMainLooper()).postDelayed(() -> {
                    if (mine != clipSerial) return;
                    // In the background Android may not let the app read the clipboard: then it's cleared anyway
                    ClipData now = cm.getPrimaryClip();
                    CharSequence current = now != null && now.getItemCount() > 0 ? now.getItemAt(0).getText() : null;
                    if (now != null && (current == null || !current.toString().equals(text))) return;
                    if (Build.VERSION.SDK_INT >= 28) cm.clearPrimaryClip();
                    else cm.setPrimaryClip(ClipData.newPlainText("", ""));
                }, clearAfter * 1000);
            }
            call.resolve();
        });
    }

    /** Keep TeleWarden out of screenshots, screen recordings and the app switcher (FLAG_SECURE). */
    @PluginMethod
    public void setSecure(PluginCall call) {
        boolean on = call.getBoolean("on", false);
        getActivity().runOnUiThread(() -> {
            if (on) getActivity().getWindow().addFlags(WindowManager.LayoutParams.FLAG_SECURE);
            else getActivity().getWindow().clearFlags(WindowManager.LayoutParams.FLAG_SECURE);
        });
        call.resolve();
    }

    // Fingerprint unlock: the vault key is encrypted with a Keystore key that only works right after a fingerprint
    // (BiometricPrompt with a CryptoObject). Adding a fingerprint to the phone makes that key unusable.

    private static final String BIO_ALIAS = "telewarden_bio";
    private static final String BIO_PREFS = "telewarden_bio";

    @PluginMethod
    public void biometricAvailable(PluginCall call) {
        int r = BiometricManager.from(getContext()).canAuthenticate(BiometricManager.Authenticators.BIOMETRIC_STRONG);
        JSObject res = new JSObject();
        res.put("available", r == BiometricManager.BIOMETRIC_SUCCESS);
        res.put("enrolled", r != BiometricManager.BIOMETRIC_ERROR_NONE_ENROLLED);
        call.resolve(res);
    }

    private SecretKey bioKey(boolean fresh) throws Exception {
        KeyStore ks = KeyStore.getInstance("AndroidKeyStore");
        ks.load(null);
        if (!fresh && ks.containsAlias(BIO_ALIAS)) return (SecretKey) ks.getKey(BIO_ALIAS, null);
        KeyGenerator kg = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
        KeyGenParameterSpec.Builder spec = new KeyGenParameterSpec.Builder(BIO_ALIAS, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setKeySize(256)
            .setUserAuthenticationRequired(true)
            .setInvalidatedByBiometricEnrollment(true);
        if (Build.VERSION.SDK_INT >= 30) spec.setUserAuthenticationParameters(0, KeyProperties.AUTH_BIOMETRIC_STRONG);
        kg.init(spec.build());
        return kg.generateKey();
    }

    private void bioPrompt(String title, Cipher cipher, PluginCall call, Consumer<Cipher> done) {
        getActivity().runOnUiThread(() -> {
            BiometricPrompt.PromptInfo info = new BiometricPrompt.PromptInfo.Builder()
                .setTitle(title)
                .setSubtitle("TeleWarden")
                .setNegativeButtonText("Use master password")
                .setAllowedAuthenticators(BiometricManager.Authenticators.BIOMETRIC_STRONG)
                .build();
            BiometricPrompt prompt = new BiometricPrompt((FragmentActivity) getActivity(), ContextCompat.getMainExecutor(getContext()),
                new BiometricPrompt.AuthenticationCallback() {
                    @Override
                    public void onAuthenticationSucceeded(BiometricPrompt.AuthenticationResult result) {
                        BiometricPrompt.CryptoObject crypto = result.getCryptoObject();
                        if (crypto == null || crypto.getCipher() == null) call.reject("Fingerprint unlock failed");
                        else done.accept(crypto.getCipher());
                    }

                    @Override
                    public void onAuthenticationError(int code, CharSequence message) {
                        if (code == BiometricPrompt.ERROR_NEGATIVE_BUTTON || code == BiometricPrompt.ERROR_USER_CANCELED || code == BiometricPrompt.ERROR_CANCELED) {
                            JSObject res = new JSObject();
                            res.put("cancelled", true);
                            call.resolve(res);
                        } else call.reject(message.toString());
                    }
                });
            prompt.authenticate(info, new BiometricPrompt.CryptoObject(cipher));
        });
    }

    private void clearBio() {
        try {
            KeyStore ks = KeyStore.getInstance("AndroidKeyStore");
            ks.load(null);
            ks.deleteEntry(BIO_ALIAS);
        } catch (Exception ignored) {
        }
        getContext().getSharedPreferences(BIO_PREFS, Context.MODE_PRIVATE).edit().clear().apply();
    }

    /** Turn on fingerprint unlock: encrypt `data` (the vault key, base64) after a fingerprint. */
    @PluginMethod
    public void biometricEnable(PluginCall call) {
        byte[] data = Base64.decode(call.getString("data", ""), Base64.NO_WRAP);
        try {
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.ENCRYPT_MODE, bioKey(true));
            bioPrompt("Turn on fingerprint unlock", cipher, call, c -> {
                try {
                    byte[] ct = c.doFinal(data);
                    getContext().getSharedPreferences(BIO_PREFS, Context.MODE_PRIVATE).edit()
                        .putString("iv", Base64.encodeToString(c.getIV(), Base64.NO_WRAP))
                        .putString("ct", Base64.encodeToString(ct, Base64.NO_WRAP))
                        .apply();
                    call.resolve();
                } catch (Exception e) {
                    call.reject(e.getMessage());
                } finally {
                    java.util.Arrays.fill(data, (byte) 0);
                }
            });
        } catch (Exception e) {
            java.util.Arrays.fill(data, (byte) 0);
            call.reject(e.getMessage());
        }
    }

    /** The vault key (base64) after a fingerprint; `cancelled` if the person chose the master password instead. */
    @PluginMethod
    public void biometricUnlock(PluginCall call) {
        android.content.SharedPreferences prefs = getContext().getSharedPreferences(BIO_PREFS, Context.MODE_PRIVATE);
        String iv = prefs.getString("iv", null);
        String ct = prefs.getString("ct", null);
        if (iv == null || ct == null) {
            call.reject("Fingerprint unlock isn't set up", "NOT_SET");
            return;
        }
        try {
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.DECRYPT_MODE, bioKey(false), new GCMParameterSpec(128, Base64.decode(iv, Base64.NO_WRAP)));
            bioPrompt("Unlock TeleWarden", cipher, call, c -> {
                try {
                    JSObject res = new JSObject();
                    res.put("data", Base64.encodeToString(c.doFinal(Base64.decode(ct, Base64.NO_WRAP)), Base64.NO_WRAP));
                    call.resolve(res);
                } catch (Exception e) {
                    call.reject(e.getMessage());
                }
            });
        } catch (KeyPermanentlyInvalidatedException e) {
            // A fingerprint was added or removed: set it up again with the master password
            clearBio();
            call.reject("Fingerprints changed on this phone. Unlock with your master password and turn fingerprint unlock on again.", "INVALIDATED");
        } catch (Exception e) {
            call.reject(e.getMessage());
        }
    }

    @PluginMethod
    public void biometricDisable(PluginCall call) {
        clearBio();
        call.resolve();
    }

    /** Scan a QR code with Google's scanner screen (2FA setup codes, Google Authenticator exports). */
    @PluginMethod
    public void scanQr(PluginCall call) {
        GmsBarcodeScannerOptions options = new GmsBarcodeScannerOptions.Builder()
            .setBarcodeFormats(Barcode.FORMAT_QR_CODE)
            .enableAutoZoom()
            .build();
        GmsBarcodeScanning.getClient(getActivity(), options).startScan()
            .addOnSuccessListener(code -> {
                JSObject res = new JSObject();
                res.put("text", code.getRawValue());
                call.resolve(res);
            })
            .addOnCanceledListener(() -> {
                JSObject res = new JSObject();
                res.put("cancelled", true);
                call.resolve(res);
            })
            .addOnFailureListener(e -> call.reject("The QR scanner isn't available: " + e.getMessage()));
    }

    // ---- Keeping transfers alive ----

    /** Show/update the "transferring" notification (starts the foreground service). */
    @PluginMethod
    public void keepAlive(PluginCall call) {
        Intent intent = new Intent(getContext(), TransferService.class);
        intent.putExtra("title", call.getString("title", "TeleDrive"));
        intent.putExtra("text", call.getString("text", ""));
        intent.putExtra("progress", (int) longArg(call, "progress", -1));
        try {
            ContextCompat.startForegroundService(getContext(), intent);
            call.resolve();
        } catch (Exception e) {
            // e.g. Android refuses to start it while the app is in the background
            call.reject(e.getMessage(), e);
        }
    }

    @PluginMethod
    public void stopKeepAlive(PluginCall call) {
        getContext().stopService(new Intent(getContext(), TransferService.class));
        call.resolve();
    }

    // ---- App updates (IMPLEMENTATION.md Phase 9) ----

    /** Releases are only ever downloaded from the project's own GitHub releases. */
    private static final String UPDATE_URL = "https://github.com/samarthbc/teledrive/releases/download/v%s/TeleDrive.apk";

    private File updateFile() {
        return new File(new File(getContext().getCacheDir(), "updates"), "TeleDrive.apk");
    }

    /**
     * Download a release's APK into the app's cache, checking its size and SHA-256 (from GitHub's release
     * info). Reports "updateProgress" events (0-100). Android itself refuses the APK unless it's signed with
     * the same key as this app.
     */
    @PluginMethod
    public void downloadUpdate(PluginCall call) {
        String version = call.getString("version", "");
        long size = longArg(call, "size", 0L);
        String sha256 = call.getString("sha256", "");
        if (!version.matches("\\d+\\.\\d+\\.\\d+")) {
            call.reject("Not a version: " + version);
            return;
        }
        new Thread(() -> {
            File apk = updateFile();
            File part = new File(apk.getParentFile(), "TeleDrive.apk.part");
            //noinspection ResultOfMethodCallIgnored
            apk.getParentFile().mkdirs();
            HttpURLConnection c = null;
            try {
                c = (HttpURLConnection) new URL(String.format(UPDATE_URL, version)).openConnection();
                c.setInstanceFollowRedirects(true);
                c.setConnectTimeout(20_000);
                c.setReadTimeout(30_000);
                if (c.getResponseCode() != 200) throw new IOException("Download failed (HTTP " + c.getResponseCode() + ")");
                MessageDigest digest = MessageDigest.getInstance("SHA-256");
                long done = 0;
                int shown = -1;
                try (InputStream in = c.getInputStream(); OutputStream out = new FileOutputStream(part)) {
                    byte[] buf = new byte[64 * 1024];
                    int n;
                    while ((n = in.read(buf)) > 0) {
                        out.write(buf, 0, n);
                        digest.update(buf, 0, n);
                        done += n;
                        int pct = size > 0 ? (int) Math.min(100, done * 100 / size) : -1;
                        if (pct != shown) {
                            shown = pct;
                            JSObject p = new JSObject();
                            p.put("progress", pct);
                            notifyListeners("updateProgress", p);
                        }
                    }
                }
                if (size > 0 && done != size) throw new IOException("The download was incomplete");
                StringBuilder hex = new StringBuilder();
                for (byte b : digest.digest()) hex.append(String.format("%02x", b));
                if (!sha256.isEmpty() && !sha256.equalsIgnoreCase(hex.toString())) throw new IOException("The download was damaged");
                //noinspection ResultOfMethodCallIgnored
                apk.delete();
                if (!part.renameTo(apk)) throw new IOException("Couldn't save the update");
                call.resolve();
            } catch (Exception e) {
                //noinspection ResultOfMethodCallIgnored
                part.delete();
                call.reject(e.getMessage() != null ? e.getMessage() : "Download failed", e);
            } finally {
                if (c != null) c.disconnect();
            }
        }).start();
    }

    /**
     * Open Android's installer for the downloaded update. The first time, Android needs "Install unknown apps"
     * allowed for TeleDrive: this opens that setting instead and returns needsPermission.
     */
    @PluginMethod
    public void installUpdate(PluginCall call) {
        File apk = updateFile();
        if (!apk.exists()) {
            call.reject("No update has been downloaded");
            return;
        }
        JSObject ret = new JSObject();
        if (!getContext().getPackageManager().canRequestPackageInstalls()) {
            Intent settings = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + getContext().getPackageName()));
            getActivity().startActivity(settings);
            ret.put("needsPermission", true);
            call.resolve(ret);
            return;
        }
        Uri uri = FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", apk);
        Intent intent = new Intent(Intent.ACTION_VIEW);
        intent.setDataAndType(uri, "application/vnd.android.package-archive");
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
        getActivity().startActivity(intent);
        ret.put("needsPermission", false);
        call.resolve(ret);
    }

    /** Remove a downloaded update (after it's installed, or when it's outdated). */
    @PluginMethod
    public void clearUpdate(PluginCall call) {
        //noinspection ResultOfMethodCallIgnored
        updateFile().delete();
        call.resolve();
    }

    // ---- Helpers ----

    /**
     * Numeric argument. Don't use PluginCall.getLong/getInt: JSON numbers arrive as Integer or Long
     * depending on their size, and those methods silently return the default for the other type.
     */
    private static long longArg(PluginCall call, String name, long fallback) {
        Object v = call.getData().opt(name);
        return v instanceof Number ? ((Number) v).longValue() : fallback;
    }

    private ContentResolver resolver() {
        return getContext().getContentResolver();
    }

    private static String safeName(String name) {
        String n = name.replaceAll("[\\\\/:*?\"<>|]", "_");
        return n.isEmpty() ? "file" : n;
    }

    @Override
    protected void handleOnDestroy() {
        media.closeAll();
        if (instance == this) instance = null;
        CountDownLatch done = appBackup;
        if (done != null) done.countDown();
        for (Output out : outputs.values()) {
            try {
                out.stream.close();
            } catch (IOException ignored) {
            }
        }
        outputs.clear();
    }
}
