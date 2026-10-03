package com.samarthbc.teledrive;

import android.content.Context;

import androidx.annotation.NonNull;
import androidx.work.ExistingWorkPolicy;
import androidx.work.Worker;
import androidx.work.WorkerParameters;

import java.util.concurrent.atomic.AtomicBoolean;

/**
 * One background backup run. Android gives a job up to 10 minutes; anything not finished continues
 * on the next run (uploads resume where they stopped).
 *
 * - App on screen: nothing to do (it backs up by itself).
 * - App still running in the background: ask it to back up (its WebView holds the Telegram session).
 * - App closed: run the backup page in a hidden WebView (HeadlessRunner).
 */
public class BackupWorker extends Worker {

    private static final long RUN_LIMIT_MS = 9 * 60 * 1000;
    private static final AtomicBoolean running = new AtomicBoolean(false);

    public BackupWorker(@NonNull Context context, @NonNull WorkerParameters params) {
        super(context, params);
    }

    @NonNull
    @Override
    public Result doWork() {
        Context ctx = getApplicationContext();
        try {
            if (!BackupScheduler.enabled(ctx)) return Result.success();
            String scope = getInputData().getString(BackupScheduler.KEY_SCOPE);
            boolean nightly = "all".equals(scope);
            // The app on screen backs up the "as taken" folders itself; the nightly run comes back a little later
            if (MainActivity.inForeground) return nightly ? Result.retry() : Result.success();
            if (!running.compareAndSet(false, true)) return nightly ? Result.retry() : Result.success();
            try {
                TeleDriveNativePlugin app = TeleDriveNativePlugin.instance;
                String s = nightly ? "all" : "instant";
                String result = app != null ? app.runBackupInApp(RUN_LIMIT_MS, s) : HeadlessRunner.run(ctx, RUN_LIMIT_MS, s);
                BackupScheduler.record(ctx, result);
            } finally {
                running.set(false);
            }
            return Result.success();
        } catch (InterruptedException e) {
            return Result.success();
        } finally {
            // Content-trigger jobs fire once: wait for the next new photo (queued behind this run)
            if (getInputData().getBoolean(BackupScheduler.KEY_TRIGGER, false)) {
                BackupScheduler.scheduleTrigger(ctx, ExistingWorkPolicy.APPEND_OR_REPLACE);
            }
        }
    }

    @Override
    public void onStopped() {
        HeadlessRunner.stop();
        TeleDriveNativePlugin app = TeleDriveNativePlugin.instance;
        if (app != null) app.cancelAppBackup();
    }
}
