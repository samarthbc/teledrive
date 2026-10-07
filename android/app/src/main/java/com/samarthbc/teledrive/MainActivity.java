package com.samarthbc.teledrive;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    /** True while the app is on screen (background backup then leaves the work to the app). */
    static volatile boolean inForeground = false;
    /** The app (and its WebView bridge) is running, even in the background (TeleWarden's autofill window checks). */
    static volatile boolean alive = false;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // The app and a background backup must never use the Telegram session at the same time
        HeadlessRunner.stop();
        registerPlugin(TeleDriveNativePlugin.class);
        super.onCreate(savedInstanceState);
        alive = true;
    }

    @Override
    public void onDestroy() {
        alive = false;
        super.onDestroy();
    }

    @Override
    public void onResume() {
        super.onResume();
        inForeground = true;
        HeadlessRunner.stop();
    }

    @Override
    public void onPause() {
        inForeground = false;
        super.onPause();
    }
}
