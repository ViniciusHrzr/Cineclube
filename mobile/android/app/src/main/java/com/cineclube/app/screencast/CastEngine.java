package com.cineclube.app.screencast;

import android.content.Context;
import android.content.Intent;
import android.media.projection.MediaProjection;
import android.util.Log;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;
import org.webrtc.AudioSource;
import org.webrtc.AudioTrack;
import org.webrtc.DefaultVideoDecoderFactory;
import org.webrtc.DefaultVideoEncoderFactory;
import org.webrtc.EglBase;
import org.webrtc.IceCandidate;
import org.webrtc.MediaConstraints;
import org.webrtc.PeerConnection;
import org.webrtc.PeerConnectionFactory;
import org.webrtc.RtpSender;
import org.webrtc.ScreenCapturerAndroid;
import org.webrtc.SdpObserver;
import org.webrtc.SessionDescription;
import org.webrtc.SurfaceTextureHelper;
import org.webrtc.VideoSource;
import org.webrtc.VideoTrack;

import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * A TELA DESTE APARELHO, INDO PARA A SALA.
 *
 * <p>O porquê de isto existir em Java: uma página não captura a tela de um
 * telefone. {@code getDisplayMedia} não existe no WebView do Android e não vai
 * existir — capturar a tela é permissão de sistema, concedida a um aplicativo e
 * não a um site. E a ponte entre o nativo e a página não serve para vídeo:
 * mandar quadro a quadro por ali daria cinco por segundo e comeria a bateria.
 *
 * <p>Então o WebRTC inteiro do lado de quem transmite mora aqui. Pela ponte
 * passa só TEXTO — a oferta, a resposta e os caminhos de rede —, que é o mesmo
 * aperto de mão que o navegador já faz em client/src/lib/liveshare.ts. Quem
 * assiste continua sendo uma aba comum: para ela, esta transmissão é
 * indistinguível de uma que saiu de um computador.
 *
 * <p>O vídeo sai codificado pelo hardware do aparelho, em H.264 ou VP8 conforme
 * o que o outro lado aceitar, a 720p — que é a medida honesta para uma
 * transmissão por rede móvel.
 *
 * <p><b>O que esta primeira versão não leva é o SOM DO SISTEMA.</b> Capturá-lo
 * pede um módulo de áudio próprio dentro do WebRTC, e o clube conversa pelo
 * Discord enquanto assiste. O microfone é opcional e nasce desligado.
 */
class CastEngine {
  private static final String TAG = "cineclube.cast";

  /** A medida da transmissão. Ver a nota da classe. */
  private static final int LARGURA = 1280;
  private static final int ALTURA = 720;
  private static final int QUADROS = 30;

  interface Sink {
    /** Um sinal para alguém da sala, que a página entrega pelo caminho de sempre. */
    void signal(String to, String kind, JSONObject data);

    /** Quantas pessoas estão recebendo agora. */
    void peers(int count);
  }

  private final Context context;
  private final Sink sink;

  private EglBase egl;
  private PeerConnectionFactory factory;
  private ScreenCapturerAndroid capturer;
  private SurfaceTextureHelper helper;
  private VideoSource videoSource;
  private VideoTrack videoTrack;
  private AudioSource audioSource;
  private AudioTrack audioTrack;

  private final Map<String, PeerConnection> peers = new HashMap<>();
  /* Candidatos que chegaram antes de a conexão daquela pessoa existir. A mesma
     armadilha do lado do navegador: o "ice" pode chegar antes do "want". */
  private final Map<String, List<IceCandidate>> early = new HashMap<>();
  private List<PeerConnection.IceServer> iceServers = new ArrayList<>();

  CastEngine(Context context, Sink sink) {
    this.context = context.getApplicationContext();
    this.sink = sink;
  }

  boolean running() {
    return capturer != null;
  }

  /**
   * Liga a captura. O {@code permissao} é o Intent que o sistema devolveu ao
   * usuário ter autorizado a projeção — sem ele não há tela nenhuma.
   */
  void start(Intent permissao, JSONArray ice, boolean comMicrofone) {
    if (running()) return;

    iceServers = parseIce(ice);

    egl = EglBase.create();
    PeerConnectionFactory.initialize(
        PeerConnectionFactory.InitializationOptions.builder(context)
            .createInitializationOptions());

    factory =
        PeerConnectionFactory.builder()
            /* Hardware nos dois: é o que faz 720p a trinta quadros caber no
               processador de um telefone sem torrá-lo. */
            .setVideoEncoderFactory(new DefaultVideoEncoderFactory(egl.getEglBaseContext(), true, true))
            .setVideoDecoderFactory(new DefaultVideoDecoderFactory(egl.getEglBaseContext()))
            .createPeerConnectionFactory();

    capturer =
        new ScreenCapturerAndroid(
            permissao,
            new MediaProjection.Callback() {
              @Override
              public void onStop() {
                /* O sistema derrubou a projeção — a pessoa apertou "parar" na
                   notificação, ou outro app pediu a tela. A sala precisa saber
                   antes de ficar olhando um quadro congelado. */
                Log.i(TAG, "a projeção foi encerrada pelo sistema");
                stop();
              }
            });

    helper = SurfaceTextureHelper.create("cineclube-captura", egl.getEglBaseContext());
    /* `true` diz ao WebRTC que isto é TELA e não câmera: ele para de cortar
       para caber numa proporção e passa a preferir qualidade a fluidez quando
       a rede aperta — que é o certo quando o que se transmite tem legenda. */
    videoSource = factory.createVideoSource(true);
    capturer.initialize(helper, context, videoSource.getCapturerObserver());
    capturer.startCapture(LARGURA, ALTURA, QUADROS);
    videoTrack = factory.createVideoTrack("cineclube-video", videoSource);

    if (comMicrofone) {
      audioSource = factory.createAudioSource(new MediaConstraints());
      audioTrack = factory.createAudioTrack("cineclube-audio", audioSource);
    }
  }

  /** Derruba tudo: as conexões, a captura e a fábrica. */
  void stop() {
    for (PeerConnection pc : peers.values()) pc.close();
    peers.clear();
    early.clear();
    sink.peers(0);

    if (capturer != null) {
      try {
        capturer.stopCapture();
      } catch (InterruptedException e) {
        Thread.currentThread().interrupt();
      }
      capturer.dispose();
      capturer = null;
    }
    if (videoTrack != null) {
      videoTrack.dispose();
      videoTrack = null;
    }
    if (videoSource != null) {
      videoSource.dispose();
      videoSource = null;
    }
    if (audioTrack != null) {
      audioTrack.dispose();
      audioTrack = null;
    }
    if (audioSource != null) {
      audioSource.dispose();
      audioSource = null;
    }
    if (helper != null) {
      helper.dispose();
      helper = null;
    }
    if (factory != null) {
      factory.dispose();
      factory = null;
    }
    if (egl != null) {
      egl.release();
      egl = null;
    }
  }

  /* ── o aperto de mão, vindo da página ───────────────────────────────────
     São os mesmos quatro nomes do lado do navegador: "want" é alguém pedindo a
     transmissão, "answer" é a resposta dela à nossa oferta, e "ice" são os
     caminhos de rede. "offer" não chega aqui: quem transmite é sempre quem
     oferece. */
  void onSignal(String from, String kind, JSONObject data) {
    if (!running()) return;

    switch (kind) {
      case "want":
        offerTo(from);
        break;
      case "answer": {
        PeerConnection pc = peers.get(from);
        if (pc == null) return;
        pc.setRemoteDescription(
            new Observer("setRemote(" + from + ")") {
              @Override
              public void onSetSuccess() {
                flush(from);
              }
            },
            new SessionDescription(SessionDescription.Type.ANSWER, data.optString("sdp")));
        break;
      }
      case "ice": {
        IceCandidate candidate =
            new IceCandidate(
                data.optString("sdpMid"),
                data.optInt("sdpMLineIndex"),
                data.optString("candidate"));
        PeerConnection pc = peers.get(from);
        if (pc == null) {
          List<IceCandidate> fila = early.get(from);
          if (fila == null) {
            fila = new ArrayList<>();
            early.put(from, fila);
          }
          fila.add(candidate);
          return;
        }
        pc.addIceCandidate(candidate);
        break;
      }
      default:
        // "offer" e o que mais chegar: não é conversa desta ponta.
        break;
    }
  }

  /** Fecha a conexão com alguém que saiu da sala. */
  void forget(String who) {
    PeerConnection pc = peers.remove(who);
    if (pc != null) pc.close();
    early.remove(who);
    sink.peers(peers.size());
  }

  private void offerTo(final String to) {
    forget(to);

    PeerConnection.RTCConfiguration config = new PeerConnection.RTCConfiguration(iceServers);
    config.sdpSemantics = PeerConnection.SdpSemantics.UNIFIED_PLAN;
    /* Um bundle só: uma porta para vídeo e áudio, que é menos caminho de rede
       para atravessar e menos coisa para falhar. */
    config.bundlePolicy = PeerConnection.BundlePolicy.MAXBUNDLE;

    final PeerConnection pc =
        factory.createPeerConnection(
            config,
            new PeerObserver() {
              @Override
              public void onIceCandidate(IceCandidate candidate) {
                JSONObject data = new JSONObject();
                try {
                  data.put("candidate", candidate.sdp);
                  data.put("sdpMid", candidate.sdpMid);
                  data.put("sdpMLineIndex", candidate.sdpMLineIndex);
                } catch (JSONException e) {
                  return;
                }
                sink.signal(to, "ice", data);
              }

              @Override
              public void onConnectionChange(PeerConnection.PeerConnectionState novo) {
                if (novo == PeerConnection.PeerConnectionState.FAILED
                    || novo == PeerConnection.PeerConnectionState.CLOSED) {
                  forget(to);
                }
              }
            });

    if (pc == null) return;
    peers.put(to, pc);
    sink.peers(peers.size());

    List<String> streamIds = Collections.singletonList("cineclube");
    RtpSender video = pc.addTrack(videoTrack, streamIds);
    if (audioTrack != null) pc.addTrack(audioTrack, streamIds);
    limit(video);

    pc.createOffer(
        new Observer("createOffer(" + to + ")") {
          @Override
          public void onCreateSuccess(final SessionDescription sdp) {
            pc.setLocalDescription(new Observer("setLocal(" + to + ")"), sdp);
            JSONObject data = new JSONObject();
            try {
              data.put("type", "offer");
              data.put("sdp", sdp.description);
            } catch (JSONException e) {
              return;
            }
            sink.signal(to, "offer", data);
          }
        },
        new MediaConstraints());
  }

  /* O teto de banda. Sem ele o WebRTC sobe até onde a rede deixar, e numa rede
     móvel "até onde deixar" é um pico que derruba a conexão inteira dois
     segundos depois. Dois megabits seguram 720p de uma tela com texto. */
  private void limit(RtpSender sender) {
    if (sender == null) return;
    org.webrtc.RtpParameters params = sender.getParameters();
    if (params == null || params.encodings.isEmpty()) return;
    for (org.webrtc.RtpParameters.Encoding encoding : params.encodings) {
      encoding.maxBitrateBps = 2_000_000;
      encoding.maxFramerate = QUADROS;
    }
    sender.setParameters(params);
  }

  /** Os candidatos que chegaram cedo demais, aplicados agora que há conexão. */
  private void flush(String from) {
    List<IceCandidate> fila = early.remove(from);
    PeerConnection pc = peers.get(from);
    if (fila == null || pc == null) return;
    for (IceCandidate candidate : fila) pc.addIceCandidate(candidate);
  }

  private static List<PeerConnection.IceServer> parseIce(JSONArray lista) {
    List<PeerConnection.IceServer> saida = new ArrayList<>();
    if (lista == null) return saida;
    for (int i = 0; i < lista.length(); i++) {
      JSONObject item = lista.optJSONObject(i);
      if (item == null) continue;

      List<String> urls = new ArrayList<>();
      Object cru = item.opt("urls");
      if (cru instanceof JSONArray) {
        JSONArray arr = (JSONArray) cru;
        for (int u = 0; u < arr.length(); u++) urls.add(arr.optString(u));
      } else if (cru != null) {
        urls.add(String.valueOf(cru));
      }
      if (urls.isEmpty()) continue;

      PeerConnection.IceServer.Builder b = PeerConnection.IceServer.builder(urls);
      String user = item.optString("username", "");
      String cred = item.optString("credential", "");
      if (!user.isEmpty()) b.setUsername(user);
      if (!cred.isEmpty()) b.setPassword(cred);
      saida.add(b.createIceServer());
    }
    return saida;
  }

  /** Um observador de SDP que só registra o que deu errado. */
  private static class Observer implements SdpObserver {
    private final String what;

    Observer(String what) {
      this.what = what;
    }

    @Override
    public void onCreateSuccess(SessionDescription sdp) {}

    @Override
    public void onSetSuccess() {}

    @Override
    public void onCreateFailure(String erro) {
      Log.w(TAG, what + " falhou: " + erro);
    }

    @Override
    public void onSetFailure(String erro) {
      Log.w(TAG, what + " falhou: " + erro);
    }
  }

  /** O resto da interface de PeerConnection, que esta ponta não usa. */
  private abstract static class PeerObserver implements PeerConnection.Observer {
    @Override
    public void onSignalingChange(PeerConnection.SignalingState novo) {}

    @Override
    public void onIceConnectionChange(PeerConnection.IceConnectionState novo) {}

    @Override
    public void onIceConnectionReceivingChange(boolean receiving) {}

    @Override
    public void onIceGatheringChange(PeerConnection.IceGatheringState novo) {}

    @Override
    public void onIceCandidatesRemoved(IceCandidate[] candidates) {}

    @Override
    public void onAddStream(org.webrtc.MediaStream stream) {}

    @Override
    public void onRemoveStream(org.webrtc.MediaStream stream) {}

    @Override
    public void onDataChannel(org.webrtc.DataChannel channel) {}

    @Override
    public void onRenegotiationNeeded() {}

    @Override
    public void onAddTrack(org.webrtc.RtpReceiver receiver, org.webrtc.MediaStream[] streams) {}

    @Override
    public void onTrack(org.webrtc.RtpTransceiver transceiver) {}

    @Override
    public void onSelectedCandidatePairChanged(org.webrtc.CandidatePairChangeEvent event) {}

    @Override
    public void onRemoveTrack(org.webrtc.RtpReceiver receiver) {}

    @Override
    public void onStandardizedIceConnectionChange(PeerConnection.IceConnectionState novo) {}

    @Override
    public void onConnectionChange(PeerConnection.PeerConnectionState novo) {}
  }
}
