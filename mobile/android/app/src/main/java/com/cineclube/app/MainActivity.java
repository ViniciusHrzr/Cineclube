package com.cineclube.app;

import android.os.Bundle;

import com.cineclube.app.screencast.ScreenCastPlugin;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
  /* Um plugin que mora NESTE projeto não é descoberto sozinho: os que o
     Capacitor encontra são os que vêm de pacotes npm. Este é da casa — ele
     transmite a tela do aparelho para a Sessão —, então é registrado à mão, e
     antes do super: depois dele a ponte já foi montada e não aceita mais
     nenhum. Ver screencast/ScreenCastPlugin.java. */
  @Override
  public void onCreate(Bundle savedInstanceState) {
    registerPlugin(ScreenCastPlugin.class);
    super.onCreate(savedInstanceState);
  }
}
