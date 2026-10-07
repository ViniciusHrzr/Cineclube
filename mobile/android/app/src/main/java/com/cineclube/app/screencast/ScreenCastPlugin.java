package com.cineclube.app.screencast;

import android.Manifest;
import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.media.projection.MediaProjectionManager;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PermissionState;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONArray;
import org.json.JSONObject;

@CapacitorPlugin(
    name = "ScreenCast",
    permissions = {
      @Permission(alias = ScreenCastPlugin.SOM, strings = {Manifest.permission.RECORD_AUDIO})
    })
public class ScreenCastPlugin extends Plugin {
  static final String SOM = "som";

  private CastEngine engine;
  private JSONArray iceGuardado;
  private boolean comSom;

  @Override
  public void load() {
    engine =
        new CastEngine(
            getContext(),
            new CastEngine.Sink() {
              @Override
              public void signal(String to, String kind, JSONObject data) {
                JSObject evento = new JSObject();
                evento.put("to", to);
                evento.put("kind", kind);
                evento.put("data", data);
                notifyListeners("signal", evento);
              }

              @Override
              public void peers(int count) {
                JSObject evento = new JSObject();
                evento.put("peers", count);
                notifyListeners("peers", evento);
              }

              @Override
              public void preview(String jpegBase64) {
                JSObject evento = new JSObject();
                evento.put("jpeg", jpegBase64);
                notifyListeners("preview", evento);
              }

              @Override
              public void audio(boolean capturando) {
                JSObject evento = new JSObject();
                evento.put("audio", capturando);
                notifyListeners("audio", evento);
              }
            });
  }

  @PluginMethod
  public void available(PluginCall call) {
    JSObject saida = new JSObject();
    saida.put("available", getContext().getSystemService(Context.MEDIA_PROJECTION_SERVICE) != null);
    call.resolve(saida);
  }

  @PluginMethod
  public void start(PluginCall call) {
    if (engine.running()) {
      call.resolve();
      return;
    }

    iceGuardado = call.getArray("iceServers", new JSArray());
    comSom = !Boolean.FALSE.equals(call.getBoolean("audio", true));

    if (comSom && getPermissionState(SOM) != PermissionState.GRANTED) {
      requestPermissionForAlias(SOM, call, "somPedido");
      return;
    }

    projetar(call);
  }

  @PermissionCallback
  private void somPedido(PluginCall call) {
    comSom = getPermissionState(SOM) == PermissionState.GRANTED;
    projetar(call);
  }

  private void projetar(PluginCall call) {
    MediaProjectionManager manager =
        (MediaProjectionManager) getContext().getSystemService(Context.MEDIA_PROJECTION_SERVICE);
    if (manager == null) {
      call.reject("Este aparelho não sabe transmitir a própria tela.");
      return;
    }

    startActivityForResult(call, manager.createScreenCaptureIntent(), "projectionResult");
  }

  @ActivityCallback
  private void projectionResult(PluginCall call, androidx.activity.result.ActivityResult resultado) {
    if (call == null) return;

    if (resultado.getResultCode() != Activity.RESULT_OK || resultado.getData() == null) {
      call.reject("cancelado");
      return;
    }

    final Intent permissao = resultado.getData();
    ScreenCastService.start(
        getContext(),
        () -> {
          try {
            engine.start(permissao, iceGuardado, comSom);
            call.resolve();
          } catch (Throwable e) {
            engine.stop();
            ScreenCastService.stop(getContext());
            call.reject("A transmissão não começou: " + e);
          }
        });
  }

  @PluginMethod
  public void stop(PluginCall call) {
    try {
      engine.stop();
    } catch (Throwable e) {
      android.util.Log.w("cineclube.cast", "parada suja: " + e);
    }
    ScreenCastService.stop(getContext());
    call.resolve();
  }

  @PluginMethod
  public void signal(PluginCall call) {
    String from = call.getString("from");
    String kind = call.getString("kind");
    if (from == null || kind == null) {
      call.reject("sinal sem remetente");
      return;
    }
    JSObject data = call.getObject("data", new JSObject());
    try {
      engine.onSignal(from, kind, data);
      call.resolve();
    } catch (Throwable e) {
      call.reject("sinal recusado: " + e);
    }
  }

  @PluginMethod
  public void forget(PluginCall call) {
    String who = call.getString("who");
    if (who != null) engine.forget(who);
    call.resolve();
  }

  @Override
  protected void handleOnDestroy() {
    engine.stop();
    ScreenCastService.stop(getContext());
    super.handleOnDestroy();
  }
}
