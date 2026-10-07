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

class CastEngine {
  private static final String TAG = "cineclube.cast";

  private static final int LADO_MAIOR = 1280;

  private static final int ORCAMENTO = 9_000_000;
  private static final int TETO = 4_500_000;
  private static final int PISO = 1_200_000;
  private static final int QUADROS = 60;
  private static final int QUADROS_BASE = 30;
  private static final int QUADROS_MIN = 2_500_000;

  private static final long PREVIA_MS = 1000;
  private static final int PREVIA_LARGURA = 480;

  private static final int TAXA = 48_000;
  private static final int CANAIS = 2;
  private static final int BLOCOS = 8;

  interface Sink {
    void signal(String to, String kind, JSONObject data);

    void peers(int count);

    void preview(String jpegBase64);

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
  private final Map<String, List<IceCandidate>> early = new HashMap<>();
  private final Map<String, RtpSender> videos = new HashMap<>();
  private List<PeerConnection.IceServer> iceServers = new ArrayList<>();

  CastEngine(Context context, Sink sink) {
    this.context = context.getApplicationContext();
    this.sink = sink;
  }

  boolean running() {
    return projection != null;
  }

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
    projection.registerCallback(
        new MediaProjection.Callback() {
          @Override
          public void onStop() {
            Log.i(TAG, "a projeção foi encerrada pelo sistema");
            main.post(CastEngine.this::stop);
          }
        },
        main);

    JavaAudioDeviceModule adm = null;
    if (comSom && Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      playback = new PlaybackAudio(projection);
      adm =
          JavaAudioDeviceModule.builder(context)
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
            .setVideoEncoderFactory(new DefaultVideoEncoderFactory(egl.getEglBaseContext(), true, true))
            .setVideoDecoderFactory(new DefaultVideoDecoderFactory(egl.getEglBaseContext()));
    if (adm != null) builder.setAudioDeviceModule(adm);
    factory = builder.createPeerConnectionFactory();

    videoSource = factory.createVideoSource(true);
    videoTrack = factory.createVideoTrack("cineclube-video", videoSource);
    startDisplay();

    if (adm != null) {
      audioSource = factory.createAudioSource(new MediaConstraints());
      audioTrack = factory.createAudioTrack("cineclube-audio", audioSource);
    }
  }

  private void startDisplay() {
    DisplayMetrics metrics = new DisplayMetrics();
    WindowManager wm = (WindowManager) context.getSystemService(Context.WINDOW_SERVICE);
    wm.getDefaultDisplay().getRealMetrics(metrics);

    int largura = metrics.widthPixels;
    int altura = metrics.heightPixels;
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
      Log.w(TAG, "prévia falhou: " + e.getMessage());
    } finally {
      i420.release();
    }
  }

  void stop() {
    for (PeerConnection pc : peers.values()) pc.close();
    peers.clear();
    videos.clear();
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
        break;
    }
  }

  void forget(String who) {
    PeerConnection pc = peers.remove(who);
    if (pc != null) pc.close();
    early.remove(who);
    videos.remove(who);
    sink.peers(peers.size());
    limitAll();
  }

  private void offerTo(final String to) {
    forget(to);

    PeerConnection.RTCConfiguration config = new PeerConnection.RTCConfiguration(iceServers);
    config.sdpSemantics = PeerConnection.SdpSemantics.UNIFIED_PLAN;
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
    videos.put(to, video);
    limitAll();

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

  private int share() {
    int quantos = Math.max(1, peers.size());
    return Math.max(PISO, Math.min(TETO, ORCAMENTO / quantos));
  }

  private void limitAll() {
    int fatia = share();
    for (RtpSender sender : videos.values()) {
      if (sender == null) continue;
      org.webrtc.RtpParameters params = sender.getParameters();
      if (params == null || params.encodings.isEmpty()) continue;
      for (org.webrtc.RtpParameters.Encoding encoding : params.encodings) {
        encoding.maxBitrateBps = fatia;
        encoding.maxFramerate = fatia >= QUADROS_MIN ? QUADROS : QUADROS_BASE;
      }
      sender.setParameters(params);
    }
  }

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
                  if (!fila.offer(copia)) {
                    fila.poll();
                    fila.offer(copia);
                  }
                }
              },
              "cineclube-som");
      thread.start();
    }

    void fill(ByteBuffer buffer) {
      byte[] bloco = fila.poll();
      int posicao = buffer.position();
      int tamanho = buffer.remaining();

      if (bloco == null) {
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
        }
        record.release();
        record = null;
      }
      fila.clear();
      sink.audio(false);
    }
  }

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
