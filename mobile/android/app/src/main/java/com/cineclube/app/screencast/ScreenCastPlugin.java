package com.cineclube.app.screencast;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.media.projection.MediaProjectionManager;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONArray;
import org.json.JSONObject;

/**
 * A PONTE ENTRE A SALA E A TELA DESTE APARELHO.
 *
 * <p>Pela ponte passa só texto: o pedido de transmitir, e os sinais do aperto
 * de mão do WebRTC. O vídeo nunca passa por aqui — ele sai codificado do
 * aparelho direto para quem assiste, e é isso que faz a imagem ser de verdade
 * em vez de uma sequência de fotografias. Ver CastEngine.
 *
 * <p>A ordem importa e é cobrada pelo Android 14: a permissão de projeção vem
 * ANTES do serviço em primeiro plano. Invertido, o sistema mata o aplicativo.
 *
 * <p>O que a página faz com isto está em client/src/lib/liveshare.ts: ela
 * continua dona da sala, de quem está nela e do caminho por onde os sinais
 * viajam. O que ela delega é a mídia.
 */
@CapacitorPlugin(name = "ScreenCast")
public class ScreenCastPlugin extends Plugin {
  private CastEngine engine;
  private JSONArray iceGuardado;
  private boolean microfone;

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
            });
  }

  /** Este aparelho sabe transmitir a própria tela? A tela pergunta antes de oferecer. */
  @PluginMethod
  public void available(PluginCall call) {
    JSObject saida = new JSObject();
    saida.put("available", getContext().getSystemService(Context.MEDIA_PROJECTION_SERVICE) != null);
    call.resolve(saida);
  }

  /**
   * Abre o pedido de permissão do sistema. A resposta chega em
   * {@link #projectionResult}, e é ela que liga a captura de verdade.
   */
  @PluginMethod
  public void start(PluginCall call) {
    if (engine.running()) {
      call.resolve();
      return;
    }

    /* `JSArray` e não `JSONArray`: é o tipo que a ponte entrega, e ele já É um
       JSONArray — o motor recebe o mesmo objeto sem conversão. */
    iceGuardado = call.getArray("iceServers", new JSArray());
    microfone = Boolean.TRUE.equals(call.getBoolean("microphone", false));

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
      /* Fechar o diálogo é um "não" legítimo, e não um erro do produto: a tela
         só precisa saber que a transmissão não começou. */
      call.reject("cancelado");
      return;
    }

    /* O serviço SOBE AGORA, com a permissão já na mão — é a ordem que o Android
       14 exige, e invertê-la mata o aplicativo com uma SecurityException. */
    ScreenCastService.start(getContext());

    try {
      engine.start(resultado.getData(), iceGuardado, microfone);
    } catch (RuntimeException e) {
      ScreenCastService.stop(getContext());
      call.reject("A captura não começou: " + e.getMessage());
      return;
    }
    call.resolve();
  }

  @PluginMethod
  public void stop(PluginCall call) {
    engine.stop();
    ScreenCastService.stop(getContext());
    call.resolve();
  }

  /** Um sinal que chegou da sala, indo para a conexão daquela pessoa. */
  @PluginMethod
  public void signal(PluginCall call) {
    String from = call.getString("from");
    String kind = call.getString("kind");
    if (from == null || kind == null) {
      call.reject("sinal sem remetente");
      return;
    }
    JSObject data = call.getObject("data", new JSObject());
    engine.onSignal(from, kind, data);
    call.resolve();
  }

  /** Alguém saiu da sala: a conexão com essa pessoa não tem mais dono. */
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
