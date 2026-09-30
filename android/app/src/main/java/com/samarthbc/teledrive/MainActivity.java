package com.samarthbc.teledrive;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    /** True while the app is on screen (background backup then leaves the work to the app). */
    static volatile boolean inForeground = false;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // The app and a background backup must never use the Telegram session at the same time
        HeadlessRunner.stop();
        registerPlugin(TeleDriveNativePlugin.class);
        super.onCreate(savedInstanceState);
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
