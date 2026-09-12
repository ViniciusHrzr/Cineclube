package com.cineclube.app.screencast;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.graphics.ImageFormat;
import android.graphics.Rect;
import android.graphics.YuvImage;
import android.hardware.display.DisplayManager;
import android.hardware.display.VirtualDisplay;
import android.media.AudioAttributes;
import android.media.AudioFormat;
import android.media.AudioPlaybackCaptureConfiguration;
import android.media.AudioRecord;
import android.media.MediaRecorder;
import android.media.projection.MediaProjection;
import android.media.projection.MediaProjectionManager;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.util.Base64;
import android.util.DisplayMetrics;
import android.util.Log;
import android.view.Surface;
import android.view.WindowManager;

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
import org.webrtc.SdpObserver;
import org.webrtc.SessionDescription;
import org.webrtc.SurfaceTextureHelper;
import org.webrtc.VideoFrame;
import org.webrtc.VideoSource;
import org.webrtc.VideoTrack;
import org.webrtc.YuvHelper;
import org.webrtc.audio.JavaAudioDeviceModule;

import java.io.ByteArrayOutputStream;
import java.nio.ByteBuffer;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ArrayBlockingQueue;

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
 * passa só TEXTO — a oferta, a resposta, os caminhos de rede — e uma miniatura
 * por segundo, que é a prévia. Para quem assiste, esta transmissão é
 * indistinguível de uma que saiu de um computador.
 *
 * <p><b>UMA PROJEÇÃO SÓ, e é por isso que o capturador é escrito aqui.</b> O
 * {@code ScreenCapturerAndroid} que vem na biblioteca cria a projeção dele por
 * dentro, a partir da autorização — e do Android 14 em diante essa autorização
 * vale UMA vez. Com ele, o áudio do sistema ficaria sem projeção para pedir.
 * Aqui a projeção é criada uma vez e serve às três coisas: o vídeo por um
 * display virtual, o som pela captura de reprodução, e a prévia por um desvio
 * do mesmo quadro que já está indo para o codificador.
 */
class CastEngine {
  private static final String TAG = "cineclube.cast";

  /** A medida da transmissão: o teto, mantida a proporção da tela. */
  private static final int LADO_MAIOR = 1280;
  private static final int QUADROS = 30;
  private static final int BITS = 2_000_000;

  /** A prévia é uma miniatura por segundo, e não um vídeo. Ver `preview`. */
  private static final long PREVIA_MS = 1000;
  private static final int PREVIA_LARGURA = 480;

  /* O formato que o WebRTC pede da entrada de áudio, e o que a captura de
     reprodução vai entregar: 48 kHz, 16 bits, dois canais. Igualar os três é o
     que permite trocar um buffer pelo outro sem reamostrar nada. */
  private static final int TAXA = 48_000;
  private static final int CANAIS = 2;
  /* Quantos blocos de dez milissegundos a fila do som segura. Curta de
     propósito: som atrasado é pior do que som faltando. */
  private static final int BLOCOS = 8;

  interface Sink {
    /** Um sinal para alguém da sala, que a página entrega pelo caminho de sempre. */
    void signal(String to, String kind, JSONObject data);

    /** Quantas pessoas estão recebendo agora. */
    void peers(int count);

    /** Uma miniatura do que está sendo transmitido, em JPEG base64. */
    void preview(String jpegBase64);

    /** O som do sistema está mesmo chegando? A tela diz isso a quem transmite. */
    void audio(boolean capturando);
  }

  private final Context context;
  private final Sink sink;
  private final Handler main = new Handler(Looper.getMainLooper());

  private EglBase egl;
  private PeerConnectionFactory factory;
  private MediaProjection projection;
  private VirtualDisplay display;
  private SurfaceTextureHelper helper;
  private VideoSource videoSource;
  private VideoTrack videoTrack;
  private AudioSource audioSource;
  private AudioTrack audioTrack;
  private PlaybackAudio playback;

  private long ultimaPrevia;

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
    return projection != null;
  }

  /**
   * Liga a captura. O {@code permissao} é o Intent que o sistema devolveu ao a
   * pessoa ter autorizado a projeção — sem ele não há tela nenhuma, e ele vale
   * uma vez só.
   */
  void start(Intent permissao, JSONArray ice, boolean comSom) {
    if (running()) return;

    iceServers = parseIce(ice);
    egl = EglBase.create();

    PeerConnectionFactory.initialize(
        PeerConnectionFactory.InitializationOptions.builder(context)
            .createInitializationOptions());

    MediaProjectionManager manager =
        (MediaProjectionManager) context.getSystemService(Context.MEDIA_PROJECTION_SERVICE);
    projection = manager.getMediaProjection(Activity.RESULT_OK, permissao);
    /* Registrado ANTES de o display virtual existir: o Android 14 recusa uma
       projeção sem callback, e é por aqui que se sabe que a pessoa apertou
       "parar" na notificação do sistema. */
    projection.registerCallback(
        new MediaProjection.Callback() {
          @Override
          public void onStop() {
            Log.i(TAG, "a projeção foi encerrada pelo sistema");
            main.post(CastEngine.this::stop);
          }
        },
        main);

    /* ── o som do sistema ────────────────────────────────────────────────
       Montado ANTES da fábrica: o módulo de áudio entra nela, e trocá-lo
       depois não é possível. Sem som pedido, nem módulo nem faixa existem. */
    JavaAudioDeviceModule adm = null;
    if (comSom && Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      playback = new PlaybackAudio(projection);
      adm =
          JavaAudioDeviceModule.builder(context)
              /* A entrada nominal é o microfone, e o que sai dela é DESCARTADO:
                 o buffer é sobrescrito pelo som do sistema no callback abaixo.
                 O WebRTC não tem por onde receber outra fonte de entrada — a
                 fábrica só aceita este módulo —, e esta é a emenda que a
                 biblioteca oferece para o caso. */
              .setAudioSource(MediaRecorder.AudioSource.MIC)
              .setSampleRate(TAXA)
              .setUseStereoInput(true)
              .setUseHardwareAcousticEchoCanceler(false)
              .setUseHardwareNoiseSuppressor(false)
              .setAudioRecordDataCallback(
                  (audioFormat, channelCount, sampleRate, audioBuffer) ->
                      playback.fill(audioBuffer))
              .createAudioDeviceModule();
      playback.start();
    }

    PeerConnectionFactory.Builder builder =
        PeerConnectionFactory.builder()
            /* Hardware nos dois: é o que faz 720p a trinta quadros caber no
               processador de um telefone sem torrá-lo. */
            .setVideoEncoderFactory(new DefaultVideoEncoderFactory(egl.getEglBaseContext(), true, true))
            .setVideoDecoderFactory(new DefaultVideoDecoderFactory(egl.getEglBaseContext()));
    if (adm != null) builder.setAudioDeviceModule(adm);
    factory = builder.createPeerConnectionFactory();

    /* `true` diz ao WebRTC que isto é TELA e não câmera: ele para de cortar
       para caber numa proporção e passa a preferir qualidade a fluidez quando a
       rede aperta — o certo quando o que se transmite tem legenda. */
    videoSource = factory.createVideoSource(true);
    videoTrack = factory.createVideoTrack("cineclube-video", videoSource);
    startDisplay();

    if (adm != null) {
      audioSource = factory.createAudioSource(new MediaConstraints());
      audioTrack = factory.createAudioTrack("cineclube-audio", audioSource);
    }
  }

  /* ── o vídeo ─────────────────────────────────────────────────────────────
     Um display virtual desenhando na textura que o WebRTC lê. É o que o
     capturador da biblioteca faz por dentro; escrito aqui porque a projeção
     precisa ser a MESMA do áudio — ver a nota da classe. */
  private void startDisplay() {
    DisplayMetrics metrics = new DisplayMetrics();
    WindowManager wm = (WindowManager) context.getSystemService(Context.WINDOW_SERVICE);
    wm.getDefaultDisplay().getRealMetrics(metrics);

    int largura = metrics.widthPixels;
    int altura = metrics.heightPixels;
    /* Proporção mantida, lado maior no teto: uma tela de telefone é alta, e
       forçá-la a 1280×720 entregaria o filme deitado e esticado. Par nos dois
       lados porque um codificador de vídeo não aceita ímpar. */
    float escala = Math.min(1f, (float) LADO_MAIOR / Math.max(largura, altura));
    largura = par(Math.round(largura * escala));
    altura = par(Math.round(altura * escala));

    helper = SurfaceTextureHelper.create("cineclube-captura", egl.getEglBaseContext());
    helper.setTextureSize(largura, altura);
    videoSource.getCapturerObserver().onCapturerStarted(true);
    helper.startListening(
        frame -> {
          videoSource.getCapturerObserver().onFrameCaptured(frame);
          preview(frame);
        });

    display =
        projection.createVirtualDisplay(
            "cineclube",
            largura,
            altura,
            metrics.densityDpi,
            DisplayManager.VIRTUAL_DISPLAY_FLAG_PUBLIC,
            new Surface(helper.getSurfaceTexture()),
            null,
            null);
  }

  private static int par(int n) {
    return n % 2 == 0 ? n : n - 1;
  }

  /* ── a prévia ────────────────────────────────────────────────────────────
     Uma miniatura por segundo, e não um espelho do vídeo: quem transmite não
     precisa ver o próprio filme de novo, precisa saber que a sala está vendo o
     que ele acha que está. Um quadro por segundo atravessa a ponte sem
     disputar nada com o codificador; trinta não atravessariam.

     O quadro já está aqui — é o mesmo que vai para o encoder —, então o custo é
     a conversão de textura para memória, uma vez por segundo. */
  private void preview(VideoFrame frame) {
    long agora = System.currentTimeMillis();
    if (agora - ultimaPrevia < PREVIA_MS) return;
    ultimaPrevia = agora;

    VideoFrame.Buffer buffer = frame.getBuffer();
    int largura = PREVIA_LARGURA;
    int altura = par(Math.max(2, buffer.getHeight() * PREVIA_LARGURA / Math.max(1, buffer.getWidth())));

    VideoFrame.Buffer menor =
        buffer.cropAndScale(0, 0, buffer.getWidth(), buffer.getHeight(), largura, altura);
    VideoFrame.I420Buffer i420 = menor.toI420();
    menor.release();
    if (i420 == null) return;

    try {
      ByteBuffer nv21 = ByteBuffer.allocateDirect(largura * altura * 3 / 2);
      /* O ajudante só escreve NV12, e o JPEG do Android só lê NV21 — os dois
         diferem na ORDEM dos dois planos de cor. Trocar U por V na chamada é o
         que transforma um no outro; sem isso a prévia sai com azul no lugar de
         vermelho. */
      YuvHelper.I420ToNV12(
          i420.getDataY(), i420.getStrideY(),
          i420.getDataV(), i420.getStrideV(),
          i420.getDataU(), i420.getStrideU(),
          nv21, largura, altura);

      byte[] bytes = new byte[nv21.capacity()];
      nv21.position(0);
      nv21.get(bytes);

      YuvImage imagem = new YuvImage(bytes, ImageFormat.NV21, largura, altura, null);
      ByteArrayOutputStream saida = new ByteArrayOutputStream();
      imagem.compressToJpeg(new Rect(0, 0, largura, altura), 55, saida);
      sink.preview(Base64.encodeToString(saida.toByteArray(), Base64.NO_WRAP));
    } catch (RuntimeException e) {
      // Uma prévia que falhou não é motivo para derrubar a transmissão.
      Log.w(TAG, "prévia falhou: " + e.getMessage());
    } finally {
      i420.release();
    }
  }

  /** Derruba tudo: as conexões, a captura, o som e a fábrica. */
  void stop() {
    for (PeerConnection pc : peers.values()) pc.close();
    peers.clear();
    early.clear();
    sink.peers(0);

    if (playback != null) {
      playback.stop();
      playback = null;
    }
    if (display != null) {
      display.release();
      display = null;
    }
    if (helper != null) {
      helper.stopListening();
      helper.dispose();
      helper = null;
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
    if (projection != null) {
      projection.stop();
      projection = null;
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
     São os mesmos nomes do lado do navegador: "want" é alguém pedindo a
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
                  main.post(() -> forget(to));
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
      encoding.maxBitrateBps = BITS;
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

  /* ══════════════════════════════════════════════════════════════════════
     O SOM DOS OUTROS APLICATIVOS.

     Do Android 10 em diante a mesma projeção que entrega a tela entrega
     também o que está TOCANDO nela — é a captura de reprodução. O que ela não
     entrega é o que o dono do som recusou: um aplicativo pode se declarar
     não-capturável, e tudo que passa por DRM é mudo por construção. Netflix e
     companhia entregam silêncio aqui pelo mesmo motivo que entregam tela
     preta lá.

     ── e por que ela é copiada num buffer alheio ──────────────────────────
     O WebRTC do Android grava o som por um módulo de áudio que só sabe abrir
     as entradas do sistema — microfone, chamada, câmera. Não há como lhe
     entregar OUTRA fonte: a fábrica aceita um módulo, e o módulo abre o que
     ele sabe abrir.

     O que a biblioteca oferece é um gancho no caminho: um callback que recebe
     cada bloco recém-gravado ANTES de ele seguir para o codificador, e que
     pode reescrevê-lo. Então o microfone é aberto e imediatamente descartado —
     o que a sala ouve é o que este bloco escreve por cima.

     A fila existe porque as duas pontas têm relógios diferentes: o WebRTC pede
     blocos de dez milissegundos no ritmo dele, e a captura entrega no ritmo
     dela. Curta de propósito — som atrasado é pior que som faltando, e uma
     fila grande vira atraso permanente.
     ══════════════════════════════════════════════════════════════════════ */
  private class PlaybackAudio {
    private final MediaProjection projection;
    private final ArrayBlockingQueue<byte[]> fila = new ArrayBlockingQueue<>(BLOCOS);
    private AudioRecord record;
    private Thread thread;
    private volatile boolean vivo;
    private volatile boolean avisado;

    PlaybackAudio(MediaProjection projection) {
      this.projection = projection;
    }

    @SuppressLint("MissingPermission")
    void start() {
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return;

      AudioPlaybackCaptureConfiguration config =
          new AudioPlaybackCaptureConfiguration.Builder(projection)
              /* Só o que é mídia e jogo. Notificação e toque de chamada ficam
                 de fora: eles não são o filme, e iriam para a sala inteira. */
              .addMatchingUsage(AudioAttributes.USAGE_MEDIA)
              .addMatchingUsage(AudioAttributes.USAGE_GAME)
              .addMatchingUsage(AudioAttributes.USAGE_UNKNOWN)
              .build();

      AudioFormat formato =
          new AudioFormat.Builder()
              .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
              .setSampleRate(TAXA)
              .setChannelMask(AudioFormat.CHANNEL_IN_STEREO)
              .build();

      int minimo =
          AudioRecord.getMinBufferSize(TAXA, AudioFormat.CHANNEL_IN_STEREO, AudioFormat.ENCODING_PCM_16BIT);

      record =
          new AudioRecord.Builder()
              .setAudioFormat(formato)
              .setBufferSizeInBytes(Math.max(minimo, TAXA * CANAIS * 2 / 5))
              .setAudioPlaybackCaptureConfig(config)
              .build();

      record.startRecording();
      vivo = true;
      thread =
          new Thread(
              () -> {
                /* Dez milissegundos, que é o tamanho do bloco que o WebRTC pede.
                   Ler no mesmo tamanho evita ter de remontar blocos aqui. */
                byte[] bloco = new byte[TAXA / 100 * CANAIS * 2];
                while (vivo) {
                  int lido = record.read(bloco, 0, bloco.length);
                  if (lido <= 0) continue;
                  if (!avisado) {
                    avisado = true;
                    sink.audio(true);
                  }
                  byte[] copia = new byte[lido];
                  System.arraycopy(bloco, 0, copia, 0, lido);
                  /* Quando a fila enche, o mais VELHO sai: som atrasado não
                     interessa a ninguém, e o que vale é o que está tocando
                     agora. */
                  if (!fila.offer(copia)) {
                    fila.poll();
                    fila.offer(copia);
                  }
                }
              },
              "cineclube-som");
      thread.start();
    }

    /** Escreve o som do sistema por cima do bloco que veio do microfone. */
    void fill(ByteBuffer buffer) {
      byte[] bloco = fila.poll();
      int posicao = buffer.position();
      int tamanho = buffer.remaining();

      if (bloco == null) {
        /* Nada capturado neste instante — nada tocando, ou um aplicativo que
           recusa captura. SILÊNCIO, e não o microfone: a sala ouviria a sala
           de quem transmite. */
        for (int i = 0; i < tamanho; i++) buffer.put(posicao + i, (byte) 0);
        return;
      }

      int quanto = Math.min(tamanho, bloco.length);
      for (int i = 0; i < quanto; i++) buffer.put(posicao + i, bloco[i]);
      for (int i = quanto; i < tamanho; i++) buffer.put(posicao + i, (byte) 0);
    }

    void stop() {
      vivo = false;
      if (thread != null) {
        thread.interrupt();
        thread = null;
      }
      if (record != null) {
        try {
          record.stop();
        } catch (IllegalStateException ignored) {
          // Já estava parado.
        }
        record.release();
        record = null;
      }
      fila.clear();
      sink.audio(false);
    }
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
