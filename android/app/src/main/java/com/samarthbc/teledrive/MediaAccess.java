package com.samarthbc.teledrive;

import android.Manifest;
import android.content.ContentResolver;
import android.content.ContentUris;
import android.content.Context;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.graphics.Bitmap;
import android.net.Uri;
import android.os.Build;
import android.os.ParcelFileDescriptor;
import android.provider.MediaStore;
import android.util.Base64;
import android.util.Size;

import androidx.core.content.ContextCompat;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.FileInputStream;
import java.io.IOException;
import java.nio.ByteBuffer;
import java.nio.channels.FileChannel;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Photos and videos on the phone (MediaStore): listing, folders, reading in pieces, thumbnails.
 * Used by the Capacitor plugin (app open) and by the background backup runner (app closed).
 */
public class MediaAccess {

    private static final int MAX_OPEN_READERS = 8;

    private final Context context;
    /** Open files being read, most recently used last. */
    private final LinkedHashMap<String, ParcelFileDescriptor> readers = new LinkedHashMap<>(16, 0.75f, true);

    public MediaAccess(Context context) {
        this.context = context.getApplicationContext();
    }

    private ContentResolver resolver() {
        return context.getContentResolver();
    }

    /** Whether the app may read photos and videos. */
    public static boolean granted(Context context) {
        String[] perms = Build.VERSION.SDK_INT >= 33
            ? new String[] { Manifest.permission.READ_MEDIA_IMAGES, Manifest.permission.READ_MEDIA_VIDEO }
            : new String[] { Manifest.permission.READ_EXTERNAL_STORAGE };
        for (String p : perms) {
            if (ContextCompat.checkSelfPermission(context, p) != PackageManager.PERMISSION_GRANTED) return false;
        }
        return true;
    }

    private static final String MEDIA_ONLY = "(" + MediaStore.Files.FileColumns.MEDIA_TYPE + "=? OR "
        + MediaStore.Files.FileColumns.MEDIA_TYPE + "=?) AND " + MediaStore.Files.FileColumns.SIZE + ">0";

    private static List<String> mediaArgs() {
        List<String> args = new ArrayList<>();
        args.add(String.valueOf(MediaStore.Files.FileColumns.MEDIA_TYPE_IMAGE));
        args.add(String.valueOf(MediaStore.Files.FileColumns.MEDIA_TYPE_VIDEO));
        return args;
    }

    /**
     * Photos and videos in the given folders (MediaStore relative paths like "DCIM/Camera/"),
     * added at or after `since` (unix seconds), oldest first, at most `limit`.
     */
    public JSONArray listMedia(List<String> paths, long since, int limit) throws JSONException {
        JSONArray items = new JSONArray();
        if (paths.isEmpty()) return items;
        Uri collection = MediaStore.Files.getContentUri(MediaStore.VOLUME_EXTERNAL);
        String[] projection = {
            MediaStore.Files.FileColumns._ID,
            MediaStore.Files.FileColumns.DISPLAY_NAME,
            MediaStore.Files.FileColumns.SIZE,
            MediaStore.Files.FileColumns.MIME_TYPE,
            MediaStore.Files.FileColumns.DATE_ADDED,
            MediaStore.Files.FileColumns.DATE_MODIFIED,
            MediaStore.Files.FileColumns.MEDIA_TYPE,
            MediaStore.Files.FileColumns.RELATIVE_PATH,
            MediaStore.MediaColumns.DATE_TAKEN,
            MediaStore.MediaColumns.WIDTH,
            MediaStore.MediaColumns.HEIGHT,
            MediaStore.MediaColumns.ORIENTATION,
        };
        StringBuilder where = new StringBuilder(MEDIA_ONLY + " AND " + MediaStore.Files.FileColumns.DATE_ADDED + ">=? AND (");
        List<String> args = mediaArgs();
        args.add(String.valueOf(since));
        for (int i = 0; i < paths.size(); i++) {
            if (i > 0) where.append(" OR ");
            where.append(MediaStore.Files.FileColumns.RELATIVE_PATH).append("=?");
            args.add(paths.get(i));
        }
        where.append(")");
        try (Cursor c = resolver().query(collection, projection, where.toString(), args.toArray(new String[0]),
            MediaStore.Files.FileColumns.DATE_ADDED + " ASC")) {
            while (c != null && c.moveToNext() && items.length() < limit) {
                long id = c.getLong(0);
                boolean video = c.getInt(6) == MediaStore.Files.FileColumns.MEDIA_TYPE_VIDEO;
                Uri base = video ? MediaStore.Video.Media.EXTERNAL_CONTENT_URI : MediaStore.Images.Media.EXTERNAL_CONTENT_URI;
                JSONObject o = new JSONObject();
                o.put("id", String.valueOf(id));
                o.put("uri", ContentUris.withAppendedId(base, id).toString());
                o.put("name", c.getString(1));
                o.put("size", c.getLong(2));
                o.put("mime", c.getString(3) != null ? c.getString(3) : (video ? "video/mp4" : "image/jpeg"));
                o.put("dateAdded", c.getLong(4));
                o.put("lastModified", c.getLong(5) * 1000);
                o.put("path", c.getString(7));
                // For TelePhotos' timeline (missing on some files)
                if (!c.isNull(8) && c.getLong(8) > 0) o.put("dateTaken", c.getLong(8));
                if (!c.isNull(9) && !c.isNull(10) && c.getInt(9) > 0 && c.getInt(10) > 0) {
                    o.put("width", c.getInt(9));
                    o.put("height", c.getInt(10));
                    o.put("orientation", c.isNull(11) ? 0 : c.getInt(11));
                }
                items.put(o);
            }
        }
        return items;
    }

    /** Every folder with photos or videos: { path, count, sampleUri } (the sample is the newest item). */
    public JSONArray listFolders() throws JSONException {
        Uri collection = MediaStore.Files.getContentUri(MediaStore.VOLUME_EXTERNAL);
        String[] projection = {
            MediaStore.Files.FileColumns._ID,
            MediaStore.Files.FileColumns.RELATIVE_PATH,
            MediaStore.Files.FileColumns.MEDIA_TYPE,
        };
        Map<String, JSONObject> folders = new LinkedHashMap<>();
        try (Cursor c = resolver().query(collection, projection, MEDIA_ONLY, mediaArgs().toArray(new String[0]),
            MediaStore.Files.FileColumns.DATE_ADDED + " DESC")) {
            while (c != null && c.moveToNext()) {
                String path = c.getString(1);
                if (path == null) continue;
                JSONObject f = folders.get(path);
                if (f == null) {
                    boolean video = c.getInt(2) == MediaStore.Files.FileColumns.MEDIA_TYPE_VIDEO;
                    Uri base = video ? MediaStore.Video.Media.EXTERNAL_CONTENT_URI : MediaStore.Images.Media.EXTERNAL_CONTENT_URI;
                    f = new JSONObject();
                    f.put("path", path);
                    f.put("count", 0);
                    f.put("sampleUri", ContentUris.withAppendedId(base, c.getLong(0)).toString());
                    folders.put(path, f);
                }
                f.put("count", f.getInt("count") + 1);
            }
        }
        JSONArray out = new JSONArray();
        for (JSONObject f : folders.values()) out.put(f);
        return out;
    }

    /** Up to `length` bytes at `offset`, base64. */
    public String read(String uri, long offset, int length) throws IOException {
        ParcelFileDescriptor pfd = reader(uri);
        FileChannel channel = new FileInputStream(pfd.getFileDescriptor()).getChannel();
        ByteBuffer buf = ByteBuffer.allocate(length);
        int total = 0;
        while (total < length) {
            int n = channel.read(buf, offset + total);
            if (n <= 0) break;
            total += n;
        }
        return Base64.encodeToString(buf.array(), 0, total, Base64.NO_WRAP);
    }

    public void close(String uri) {
        synchronized (readers) {
            closeQuietly(readers.remove(uri));
        }
    }

    public void closeAll() {
        synchronized (readers) {
            for (ParcelFileDescriptor pfd : readers.values()) closeQuietly(pfd);
            readers.clear();
        }
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

    /** Small JPEG preview of a photo/video (base64), or null if Android can't make one. */
    public String thumbnail(String uri) {
        try {
            Bitmap bmp = resolver().loadThumbnail(Uri.parse(uri), new Size(320, 320), null);
            ByteArrayOutputStream bytes = new ByteArrayOutputStream();
            bmp.compress(Bitmap.CompressFormat.JPEG, 80, bytes);
            return Base64.encodeToString(bytes.toByteArray(), Base64.NO_WRAP);
        } catch (Exception ignored) {
            return null;
        }
    }
}
