package com.samarthbc.teledrive;

import android.Manifest;
import android.content.ContentResolver;
import android.content.ContentUris;
import android.content.ContentValues;
import android.content.Intent;
import android.database.Cursor;
import android.graphics.Bitmap;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.os.ParcelFileDescriptor;
import android.provider.MediaStore;
import android.provider.OpenableColumns;
import android.util.Base64;
import android.util.Size;

import androidx.core.content.ContextCompat;
import androidx.core.content.FileProvider;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.OutputStream;
import java.nio.ByteBuffer;
import java.nio.channels.FileChannel;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * Android-only features for TeleDrive:
 * - writing downloads into Downloads/TeleDrive (or the cache, for "open with")
 * - opening files in other apps
 * - reading files shared to the app ("Share → TeleDrive") and camera media, in pieces
 * - listing new camera photos/videos for camera backup
 * - a foreground service that keeps transfers running while the app is in the background
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

    private static final int MAX_OPEN_READERS = 8;

    /** Files being written: id → output. */
    private final Map<String, Output> outputs = new HashMap<>();
    /** Open files being read, most recently used last. */
    private final LinkedHashMap<String, ParcelFileDescriptor> readers = new LinkedHashMap<>(16, 0.75f, true);
    /** Files shared to the app that JavaScript hasn't picked up yet. */
    private final List<JSObject> pendingShares = new ArrayList<>();

    private static class Output {
        Uri uri;
        File file;
        OutputStream stream;
        String mime;
    }

    @Override
    public void load() {
        collectShares(getActivity().getIntent());
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
        String uriString = call.getString("uri", "");
        long offset = longArg(call, "offset", 0L);
        int length = (int) longArg(call, "length", 512 * 1024);
        try {
            ParcelFileDescriptor pfd = reader(uriString);
            FileChannel channel = new FileInputStream(pfd.getFileDescriptor()).getChannel();
            ByteBuffer buf = ByteBuffer.allocate(length);
            int total = 0;
            while (total < length) {
                int n = channel.read(buf, offset + total);
                if (n <= 0) break;
                total += n;
            }
            JSObject ret = new JSObject();
            ret.put("data", Base64.encodeToString(buf.array(), 0, total, Base64.NO_WRAP));
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("Could not read the file: " + e.getMessage(), e);
        }
    }

    @PluginMethod
    public void closeFile(PluginCall call) {
        synchronized (readers) {
            ParcelFileDescriptor pfd = readers.remove(call.getString("uri", ""));
            closeQuietly(pfd);
        }
        call.resolve();
    }

    private ParcelFileDescriptor reader(String uri) throws IOException {
        synchronized (readers) {
            ParcelFileDescriptor pfd = readers.get(uri);
            if (pfd != null) return pfd;
            pfd = resolver().openFileDescriptor(Uri.parse(uri), "r");
            if (pfd == null) throw new IOException("File not found");
            readers.put(uri, pfd);
            while (readers.size() > MAX_OPEN_READERS) {
                String eldest = readers.keySet().iterator().next();
                closeQuietly(readers.remove(eldest));
            }
            return pfd;
        }
    }

    private static void closeQuietly(ParcelFileDescriptor pfd) {
        if (pfd == null) return;
        try {
            pfd.close();
        } catch (IOException ignored) {
        }
    }

    /** Small JPEG preview of a photo/video (base64), or no data if Android can't make one. */
    @PluginMethod
    public void thumbnail(PluginCall call) {
        JSObject ret = new JSObject();
        try {
            Bitmap bmp = resolver().loadThumbnail(Uri.parse(call.getString("uri", "")), new Size(320, 320), null);
            ByteArrayOutputStream bytes = new ByteArrayOutputStream();
            bmp.compress(Bitmap.CompressFormat.JPEG, 80, bytes);
            ret.put("data", Base64.encodeToString(bytes.toByteArray(), Base64.NO_WRAP));
        } catch (Exception ignored) {
            // No thumbnail; the upload continues without one
        }
        call.resolve(ret);
    }

    /** Camera photos and videos added at or after `since` (unix seconds), oldest first. */
    @PluginMethod
    public void listCameraMedia(PluginCall call) {
        if (!mediaGranted()) {
            call.reject("Permission to read photos and videos was not granted");
            return;
        }
        long since = longArg(call, "since", 0L);
        int limit = (int) longArg(call, "limit", 500);
        Uri collection = MediaStore.Files.getContentUri(MediaStore.VOLUME_EXTERNAL);
        String[] projection = {
            MediaStore.Files.FileColumns._ID,
            MediaStore.Files.FileColumns.DISPLAY_NAME,
            MediaStore.Files.FileColumns.SIZE,
            MediaStore.Files.FileColumns.MIME_TYPE,
            MediaStore.Files.FileColumns.DATE_ADDED,
            MediaStore.Files.FileColumns.DATE_MODIFIED,
            MediaStore.Files.FileColumns.MEDIA_TYPE,
        };
        String selection = "(" + MediaStore.Files.FileColumns.MEDIA_TYPE + "=? OR " + MediaStore.Files.FileColumns.MEDIA_TYPE + "=?)"
            + " AND " + MediaStore.Files.FileColumns.DATE_ADDED + ">=?"
            + " AND " + MediaStore.Files.FileColumns.RELATIVE_PATH + " LIKE ?"
            + " AND " + MediaStore.Files.FileColumns.SIZE + ">0";
        String[] args = {
            String.valueOf(MediaStore.Files.FileColumns.MEDIA_TYPE_IMAGE),
            String.valueOf(MediaStore.Files.FileColumns.MEDIA_TYPE_VIDEO),
            String.valueOf(since),
            "DCIM/Camera%",
        };
        JSArray items = new JSArray();
        try (Cursor c = resolver().query(collection, projection, selection, args, MediaStore.Files.FileColumns.DATE_ADDED + " ASC")) {
            while (c != null && c.moveToNext() && items.length() < limit) {
                long id = c.getLong(0);
                boolean video = c.getInt(6) == MediaStore.Files.FileColumns.MEDIA_TYPE_VIDEO;
                Uri base = video ? MediaStore.Video.Media.EXTERNAL_CONTENT_URI : MediaStore.Images.Media.EXTERNAL_CONTENT_URI;
                JSObject o = new JSObject();
                o.put("id", String.valueOf(id));
                o.put("uri", ContentUris.withAppendedId(base, id).toString());
                o.put("name", c.getString(1));
                o.put("size", c.getLong(2));
                o.put("mime", c.getString(3) != null ? c.getString(3) : (video ? "video/mp4" : "image/jpeg"));
                o.put("dateAdded", c.getLong(4));
                o.put("lastModified", c.getLong(5) * 1000);
                items.put(o);
            }
            JSObject ret = new JSObject();
            ret.put("items", items);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject(e.getMessage(), e);
        }
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
        synchronized (readers) {
            for (ParcelFileDescriptor pfd : readers.values()) closeQuietly(pfd);
            readers.clear();
        }
        for (Output out : outputs.values()) {
            try {
                out.stream.close();
            } catch (IOException ignored) {
            }
        }
        outputs.clear();
    }
}
