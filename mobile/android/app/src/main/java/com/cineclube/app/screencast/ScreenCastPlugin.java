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
/* A permissão de gravar é do MICROFONE, e o microfone é aberto e descartado: o
   módulo de áudio do WebRTC só sabe abrir as entradas do sistema, e o som que a
   sala ouve é escrito por cima daquele buffer. Sem esta permissão não há por
   onde o som do sistema entrar — ver a nota de PlaybackAudio em CastEngine. */
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
    comSom = !Boolean.FALSE.equals(call.getBoolean("audio", true));

    /* A permissão de gravar vem ANTES do diálogo de projeção, e não depois:
       dois pedidos de sistema empilhados é a pessoa recusando o segundo sem ler
       o que ele diz. Quem recusa este ainda transmite — sem som. */
    if (comSom && getPermissionState(SOM) != PermissionState.GRANTED) {
      requestPermissionForAlias(SOM, call, "somPedido");
      return;
    }

    projetar(call);
  }

  @PermissionCallback
  private void somPedido(PluginCall call) {
    /* Recusar o microfone não derruba a transmissão: ela segue muda, e a tela
       já sabe dizer isso. */
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
      /* Fechar o diálogo é um "não" legítimo, e não um erro do produto: a tela
         só precisa saber que a transmissão não começou. */
      call.reject("cancelado");
      return;
    }

    /* O serviço SOBE AGORA, com a permissão já na mão — é a ordem que o Android
       14 exige, e invertê-la mata o aplicativo com uma SecurityException. */
    ScreenCastService.start(getContext());

    try {
      engine.start(resultado.getData(), iceGuardado, comSom);
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
