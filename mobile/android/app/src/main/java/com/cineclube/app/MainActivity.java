package com.cineclube.app;

import android.os.Bundle;

import com.cineclube.app.screencast.ScreenCastPlugin;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
  @Override
  public void onCreate(Bundle savedInstanceState) {
    registerPlugin(ScreenCastPlugin.class);
    super.onCreate(savedInstanceState);
  }
}
