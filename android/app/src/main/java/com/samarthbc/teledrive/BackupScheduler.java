package com.samarthbc.teledrive;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.provider.MediaStore;

import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.work.Constraints;
import androidx.work.Data;
import androidx.work.ExistingPeriodicWorkPolicy;
import androidx.work.ExistingWorkPolicy;
import androidx.work.NetworkType;
import androidx.work.OneTimeWorkRequest;
import androidx.work.PeriodicWorkRequest;
import androidx.work.WorkManager;

import org.json.JSONObject;

import java.time.Duration;
import java.util.concurrent.TimeUnit;

/**
 * Schedules camera backup while the app is closed (Phase 5.1):
 * - a one-time job that fires when photos/videos are added (MediaStore content trigger), re-armed after each run
 * - an hourly job as a fallback
 * Both run BackupWorker, only on the allowed network and when the battery isn't low.
 */
public final class BackupScheduler {

    private static final String PREFS = "teledrive_backup";
    static final String TRIGGER = "td-backup-trigger";
    static final String PERIODIC = "td-backup-periodic";
    static final String KEY_TRIGGER = "trigger";
    private static final String CHANNEL = "backup";
    private static final int NOTIFICATION_ID = 43;

    private BackupScheduler() {}

    private static SharedPreferences prefs(Context ctx) {
        return ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    static boolean enabled(Context ctx) {
        return prefs(ctx).getBoolean("enabled", false);
    }

    /** Called from JavaScript whenever the backup settings change (and when the app starts). */
    static void configure(Context ctx, boolean enabled, boolean wifiOnly) {
        prefs(ctx).edit().putBoolean("enabled", enabled).putBoolean("wifiOnly", wifiOnly).apply();
        WorkManager wm = WorkManager.getInstance(ctx);
        if (!enabled) {
            wm.cancelUniqueWork(TRIGGER);
            wm.cancelUniqueWork(PERIODIC);
            return;
        }
        scheduleTrigger(ctx, ExistingWorkPolicy.REPLACE);
        PeriodicWorkRequest periodic = new PeriodicWorkRequest.Builder(BackupWorker.class, 1, TimeUnit.HOURS)
            .setConstraints(baseConstraints(ctx).build())
            .build();
        wm.enqueueUniquePeriodicWork(PERIODIC, ExistingPeriodicWorkPolicy.UPDATE, periodic);
    }

    /** Wait for new photos/videos. After a run the job re-arms itself (APPEND_OR_REPLACE). */
    static void scheduleTrigger(Context ctx, ExistingWorkPolicy policy) {
        if (!enabled(ctx)) return;
        Constraints constraints = baseConstraints(ctx)
            .addContentUriTrigger(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, true)
            .addContentUriTrigger(MediaStore.Video.Media.EXTERNAL_CONTENT_URI, true)
            // Wait until the camera has finished writing (and batch bursts of photos)
            .setTriggerContentUpdateDelay(Duration.ofSeconds(20))
            .setTriggerContentMaxDelay(Duration.ofMinutes(2))
            .build();
        OneTimeWorkRequest request = new OneTimeWorkRequest.Builder(BackupWorker.class)
            .setConstraints(constraints)
            .setInputData(new Data.Builder().putBoolean(KEY_TRIGGER, true).build())
            .build();
        WorkManager.getInstance(ctx).enqueueUniqueWork(TRIGGER, policy, request);
    }

    private static Constraints.Builder baseConstraints(Context ctx) {
        boolean wifiOnly = prefs(ctx).getBoolean("wifiOnly", true);
        return new Constraints.Builder()
            .setRequiredNetworkType(wifiOnly ? NetworkType.UNMETERED : NetworkType.CONNECTED)
            .setRequiresBatteryNotLow(true);
    }

    static long lastRun(Context ctx) {
        return prefs(ctx).getLong("lastRun", 0);
    }

    static String lastResult(Context ctx) {
        return prefs(ctx).getString("lastResult", "");
    }

    /** Remember what the last run did; tell the user if photos were backed up. */
    static void record(Context ctx, String resultJson) {
        prefs(ctx).edit().putLong("lastRun", System.currentTimeMillis()).putString("lastResult", resultJson).apply();
        int uploaded = 0;
        try {
            uploaded = new JSONObject(resultJson).optInt("uploaded", 0);
        } catch (Exception ignored) {
        }
        if (uploaded > 0) notifyBackedUp(ctx, uploaded);
    }

    private static void notifyBackedUp(Context ctx, int count) {
        NotificationManager nm = ctx.getSystemService(NotificationManager.class);
        nm.createNotificationChannel(new NotificationChannel(CHANNEL, "Camera backup", NotificationManager.IMPORTANCE_LOW));
        Intent open = new Intent(ctx, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        PendingIntent pi = PendingIntent.getActivity(ctx, 0, open, PendingIntent.FLAG_IMMUTABLE);
        NotificationCompat.Builder n = new NotificationCompat.Builder(ctx, CHANNEL)
            .setSmallIcon(android.R.drawable.stat_sys_upload_done)
            .setContentTitle("Camera backup")
            .setContentText(count == 1 ? "Backed up 1 photo or video" : "Backed up " + count + " photos and videos")
            .setContentIntent(pi)
            .setAutoCancel(true)
            .setOnlyAlertOnce(true);
        try {
            NotificationManagerCompat.from(ctx).notify(NOTIFICATION_ID, n.build());
        } catch (SecurityException ignored) {
            // Notifications not allowed
        }
    }
}
