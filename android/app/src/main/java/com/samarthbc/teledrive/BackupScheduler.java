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
import androidx.work.BackoffPolicy;
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
import java.time.LocalDateTime;
import java.time.LocalTime;
import java.util.concurrent.TimeUnit;

/**
 * Schedules camera backup in the background (Phase 5.1, per-folder timing in Phase 15):
 * - folders backed up "as taken": a one-time job that fires when photos/videos are added (MediaStore content
 *   trigger), re-armed after each run, and an hourly job as a fallback
 * - folders backed up "overnight": a daily job from about 1 AM (optionally only while charging); if it can't run then
 *   (no Wi-Fi, low battery, not charging) it runs as soon as it can
 * All run BackupWorker, only on the allowed network and when the battery isn't low. The run's scope ("instant" or
 * "all") tells the backup which folders to look at.
 */
public final class BackupScheduler {

    private static final String PREFS = "teledrive_backup";
    static final String TRIGGER = "td-backup-trigger";
    static final String PERIODIC = "td-backup-periodic";
    static final String NIGHTLY = "td-backup-nightly";
    static final String KEY_TRIGGER = "trigger";
    static final String KEY_SCOPE = "scope";
    /** Around when the overnight run starts. */
    private static final LocalTime NIGHT = LocalTime.of(1, 0);
    private static final String CHANNEL = "backup";
    private static final int NOTIFICATION_ID = 43;

    private BackupScheduler() {}

    private static SharedPreferences prefs(Context ctx) {
        return ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    static boolean enabled(Context ctx) {
        return prefs(ctx).getBoolean("enabled", false);
    }

    /**
     * Called from JavaScript whenever the backup settings change (and when the app starts). `instant`: some folder is
     * backed up as photos are taken; `overnight`: some folder is backed up overnight (`charging`: only while charging).
     */
    static void configure(Context ctx, boolean enabled, boolean wifiOnly, boolean instant, boolean overnight, boolean charging) {
        SharedPreferences p = prefs(ctx);
        p.edit().putBoolean("enabled", enabled).putBoolean("wifiOnly", wifiOnly).putBoolean("instant", instant).apply();
        WorkManager wm = WorkManager.getInstance(ctx);
        if (!enabled || !instant) {
            wm.cancelUniqueWork(TRIGGER);
            wm.cancelUniqueWork(PERIODIC);
        } else {
            scheduleTrigger(ctx, ExistingWorkPolicy.REPLACE);
            PeriodicWorkRequest periodic = new PeriodicWorkRequest.Builder(BackupWorker.class, 1, TimeUnit.HOURS)
                .setConstraints(baseConstraints(ctx).build())
                .setInputData(scope("instant"))
                .build();
            wm.enqueueUniquePeriodicWork(PERIODIC, ExistingPeriodicWorkPolicy.UPDATE, periodic);
        }
        if (!enabled || !overnight) {
            wm.cancelUniqueWork(NIGHTLY);
            p.edit().remove("nightly").apply();
        } else {
            // Rescheduling moves the next run, so only when its conditions changed
            String sig = "w" + wifiOnly + "c" + charging;
            if (sig.equals(p.getString("nightly", null))) return;
            Constraints.Builder c = baseConstraints(ctx);
            if (charging) c.setRequiresCharging(true);
            PeriodicWorkRequest nightly = new PeriodicWorkRequest.Builder(BackupWorker.class, 24, TimeUnit.HOURS)
                .setConstraints(c.build())
                .setInitialDelay(untilNight(), TimeUnit.MILLISECONDS)
                .setBackoffCriteria(BackoffPolicy.LINEAR, 15, TimeUnit.MINUTES)
                .setInputData(scope("all"))
                .build();
            wm.enqueueUniquePeriodicWork(NIGHTLY, ExistingPeriodicWorkPolicy.CANCEL_AND_REENQUEUE, nightly);
            p.edit().putString("nightly", sig).apply();
        }
    }

    private static Data scope(String scope) {
        return new Data.Builder().putString(KEY_SCOPE, scope).build();
    }

    /** Milliseconds until the next ~1 AM. */
    private static long untilNight() {
        LocalDateTime now = LocalDateTime.now();
        LocalDateTime next = now.toLocalDate().atTime(NIGHT);
        if (!next.isAfter(now)) next = next.plusDays(1);
        return Duration.between(now, next).toMillis();
    }

    /** Wait for new photos/videos. After a run the job re-arms itself (APPEND_OR_REPLACE). */
    static void scheduleTrigger(Context ctx, ExistingWorkPolicy policy) {
        if (!enabled(ctx) || !prefs(ctx).getBoolean("instant", true)) return;
        Constraints constraints = baseConstraints(ctx)
            .addContentUriTrigger(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, true)
            .addContentUriTrigger(MediaStore.Video.Media.EXTERNAL_CONTENT_URI, true)
            // Wait until the camera has finished writing (and batch bursts of photos)
            .setTriggerContentUpdateDelay(Duration.ofSeconds(20))
            .setTriggerContentMaxDelay(Duration.ofMinutes(2))
            .build();
        OneTimeWorkRequest request = new OneTimeWorkRequest.Builder(BackupWorker.class)
            .setConstraints(constraints)
            .setInputData(new Data.Builder().putBoolean(KEY_TRIGGER, true).putString(KEY_SCOPE, "instant").build())
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
