package com.samarthbc.teledrive;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(TeleDriveNativePlugin.class);
        super.onCreate(savedInstanceState);
    }
}
