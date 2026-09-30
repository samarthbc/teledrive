package com.samarthbc.teledrive;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;

import androidx.core.app.NotificationCompat;
import androidx.core.app.ServiceCompat;

/**
 * Foreground service shown while uploads/downloads run, so Android keeps the app (and its
 * Telegram connection) alive when you switch to another app or turn the screen off.
 */
public class TransferService extends Service {

    private static final String CHANNEL_ID = "transfers";
    private static final int NOTIFICATION_ID = 1;
    /** Safety net: never hold the CPU awake for more than this. */
    private static final long MAX_WAKE_MS = 6 * 60 * 60 * 1000L;

    private PowerManager.WakeLock wakeLock;

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        createChannel();
        String title = intent != null ? intent.getStringExtra("title") : null;
        String text = intent != null ? intent.getStringExtra("text") : null;
        int progress = intent != null ? intent.getIntExtra("progress", -1) : -1;

        Intent open = new Intent(this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent tap = PendingIntent.getActivity(this, 0, open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);

        NotificationCompat.Builder b = new NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.stat_sys_upload)
            .setContentTitle(title != null ? title : "TeleDrive")
            .setContentText(text != null ? text : "")
            .setContentIntent(tap)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setSilent(true);
        if (progress >= 0) b.setProgress(100, progress, false);
        Notification notification = b.build();

        int type = Build.VERSION.SDK_INT >= 29 ? ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC : 0;
        ServiceCompat.startForeground(this, NOTIFICATION_ID, notification, type);

        if (wakeLock == null) {
            PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
            wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "TeleDrive:transfers");
            wakeLock.setReferenceCounted(false);
            wakeLock.acquire(MAX_WAKE_MS);
        }
        return START_NOT_STICKY;
    }

    private void createChannel() {
        NotificationManager nm = getSystemService(NotificationManager.class);
        if (nm.getNotificationChannel(CHANNEL_ID) != null) return;
        NotificationChannel channel = new NotificationChannel(CHANNEL_ID, "Transfers", NotificationManager.IMPORTANCE_LOW);
        channel.setDescription("Shown while files upload or download");
        nm.createNotificationChannel(channel);
    }

    @Override
    public void onTimeout(int startId, int fgsType) {
        // Android 15 limits dataSync services to 6 hours a day
        stopSelf();
    }

    @Override
    public void onDestroy() {
        if (wakeLock != null && wakeLock.isHeld()) wakeLock.release();
        wakeLock = null;
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
