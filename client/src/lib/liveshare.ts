import { useCallback, useEffect, useRef, useState } from 'react';
import type { Screening, SignalKind } from '@/lib/screening';
import { inShell, plugin } from '@/lib/shell';

const TICK_MS = 2000;
const HANDSHAKE_MS = 12_000;

const FIRST_FRAME_MS = 10_000;

const HINT = 'motion';

const QUALITY_MS = 3000;

const VIDEO_BITRATE = 8_000_000;

const UPLINK_START = 12_000_000;
const UPLINK_CEIL = 60_000_000;
const UPLINK_FLOOR = 3_000_000;
const VIDEO_FLOOR = 1_500_000;
const GROW = 1.15;
const BACKOFF = 0.85;
const RAMP_MS = 15_000;

const shareOf = (peers: number, budget: number) =>
  Math.max(VIDEO_FLOOR, Math.min(VIDEO_BITRATE, Math.round(budget / Math.max(1, peers))));
const AUDIO_BITRATE = 192_000;

const FPS_FAST = 60;
const FPS_BASE = 30;
const FPS_FAST_MIN = 5_000_000;

export type LiveQuality = {
  width: number;
  height: number;
  fps: number;
  kbps: number;
  limit: 'cpu' | 'bandwidth' | 'other' | null;
};

export type LivePhase =
  | 'off'
  | 'waiting'
  | 'live'
  | 'alone'
  | 'failed';

export type LiveShare = {
  thumb?: string | null;
  role: 'off' | 'host' | 'viewer';
  phase: LivePhase;
  stream: MediaStream | null;
  peers: number;
  relayed: boolean;
  error: string | null;
  detail: string | null;
  hasAudio: boolean;
  surface: string | null;
  quality: LiveQuality | null;
  audioSources: MediaDeviceInfo[];
  audioSourceId: string | null;
  listAudio: () => Promise<void>;
  pickAudio: (deviceId: string | null) => Promise<void>;
  start: () => Promise<void>;
  stop: () => void;
};

type Peer = {
  pc: RTCPeerConnection;
  queued: RTCIceCandidateInit[];
  since: number;
  epoch: number;
  up?: number;
  frames?: boolean;
};

const epochOf = (data: unknown) => Number((data as { epoch?: number })?.epoch ?? 0) || 0;

const DEAD = new Set(['failed', 'closed']);

async function tune(sender: RTCRtpSender, ceiling = VIDEO_BITRATE) {
  const kind = sender.track?.kind;
  try {
    const params = sender.getParameters();
    if (!params.encodings?.length) params.encodings = [{}];
    if (kind === 'video') {
      params.degradationPreference = 'balanced';
      params.encodings[0].maxBitrate = ceiling;
      params.encodings[0].maxFramerate = ceiling >= FPS_FAST_MIN ? FPS_FAST : FPS_BASE;
      params.encodings[0].scaleResolutionDownBy = 1;
    } else {
      params.encodings[0].maxBitrate = AUDIO_BITRATE;
    }
    await sender.setParameters(params);
  } catch {
  }
}

const START_BITRATE_KBPS = 3000;

function withStartBitrate(sdp: string) {
  const codecs = [...sdp.matchAll(/a=rtpmap:(\d+) (?:VP8|VP9|H264|AV1)\/90000/gi)];
  let out = sdp;
  for (const achado of codecs) {
    const pt = achado[1];
    const param = `x-google-start-bitrate=${START_BITRATE_KBPS}`;
    const fmtp = new RegExp(`a=fmtp:${pt} ([^\\r\\n]*)`);
    if (fmtp.test(out)) {
      out = out.replace(fmtp, (_all, params: string) =>
        params.includes('x-google-start-bitrate') ? `a=fmtp:${pt} ${params}` : `a=fmtp:${pt} ${params};${param}`
      );
    } else {
      out = out.replace(achado[0], `${achado[0]}\r\na=fmtp:${pt} ${param}`);
    }
  }
  return out;
}

function inStereo(sdp: string) {
  const rtpmap = sdp.match(/a=rtpmap:(\d+) opus\/48000\/2/i);
  if (!rtpmap) return sdp;
  const pt = rtpmap[1];
  const extra = `stereo=1;sprop-stereo=1;maxaveragebitrate=${AUDIO_BITRATE}`;
  const fmtp = new RegExp(`a=fmtp:${pt} ([^\\r\\n]*)`);
  if (fmtp.test(sdp)) {
    return sdp.replace(fmtp, (_all, params: string) =>
      params.includes('stereo=') ? `a=fmtp:${pt} ${params}` : `a=fmtp:${pt} ${params};${extra}`
    );
  }
  return sdp.replace(rtpmap[0], `${rtpmap[0]}\r\na=fmtp:${pt} ${extra}`);
}

export function useLiveShare(screening: Screening, meId: string): LiveShare {
  const { state, sendSignal, onSignal, startLive, stopLive, fetchIce } = screening;
  const live = state.live;
  const hostId = live?.hostId ?? null;
  const host = hostId === meId;

  const [stream, setStream] = useState<MediaStream | null>(null);
  const [peers, setPeers] = useState(0);
  const [relayed, setRelayed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<string | null>(null);
  const [hasAudio, setHasAudio] = useState(false);
  const [surface, setSurface] = useState<string | null>(null);
  const [thumb, setThumb] = useState<string | null>(null);
  const [quality, setQuality] = useState<LiveQuality | null>(null);
  const [audioSources, setAudioSources] = useState<MediaDeviceInfo[]>([]);
  const [audioSourceId, setAudioSourceId] = useState<string | null>(null);
  const captureAudio = useRef<MediaStreamTrack | null>(null);
  const pickedAudio = useRef<MediaStreamTrack | null>(null);

  const peerMap = useRef(new Map<string, Peer>());
  const early = useRef(new Map<string, RTCIceCandidateInit[]>());
  const localRef = useRef<MediaStream | null>(null);
  const nativo = useRef(false);
  const attempt = useRef(Date.now());
  const nativeAsked = useRef(new Map<string, { epoch: number; at: number }>());
  const nativeSignals = useRef<{ remove?: () => void } | null>(null);
  const nativePeers = useRef<{ remove?: () => void } | null>(null);
  const nativeThumb = useRef<{ remove?: () => void } | null>(null);
  const nativeAudio = useRef<{ remove?: () => void } | null>(null);
  const iceRef = useRef<RTCConfiguration | null>(null);

  const cast = () => (inShell() ? plugin('ScreenCast') : null);

  const ice = useCallback(async () => {
    if (iceRef.current) return iceRef.current;
    try {
      const got = await fetchIce();
      setRelayed(got.relayed);
      iceRef.current = { iceServers: got.iceServers };
    } catch {
      iceRef.current = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };
    }
    return iceRef.current;
  }, [fetchIce]);

  useEffect(() => {
    void ice();
  }, [ice]);

  const budget = useRef(UPLINK_START);
  const ceiling = useCallback(() => shareOf(peerMap.current.size, budget.current), []);

  const retune = useCallback(() => {
    const teto = ceiling();
    for (const { pc } of peerMap.current.values()) {
      for (const sender of pc.getSenders()) {
        if (sender.track?.kind === 'video') void tune(sender, teto);
      }
    }
  }, [ceiling]);

  const forget = useCallback(
    (withId: string) => {
      const held = peerMap.current.get(withId);
      if (!held) return;
      held.pc.close();
      peerMap.current.delete(withId);
      early.current.delete(withId);
      setPeers(peerMap.current.size);
      retune();
    },
    [retune]
  );

  const drop = useCallback(() => {
    if (nativo.current) {
      nativo.current = false;
      void cast()?.stop();
      for (const held of [nativeSignals, nativePeers, nativeThumb, nativeAudio]) {
        void Promise.resolve(held.current).then(h => h?.remove?.());
        held.current = null;
      }
      nativeAsked.current.clear();
      setThumb(null);
    }

    for (const { pc } of peerMap.current.values()) pc.close();
    peerMap.current.clear();
    early.current.clear();
    setPeers(0);
    budget.current = UPLINK_START;
    for (const track of localRef.current?.getTracks() ?? []) track.stop();
    localRef.current = null;
    pickedAudio.current?.stop();
    pickedAudio.current = null;
    captureAudio.current = null;
    setStream(null);
    setDetail(null);
    setHasAudio(false);
    setSurface(null);
    setAudioSourceId(null);
  }, []);

  const connect = useCallback(
    async (withId: string, epoch = 0) => {
      forget(withId);

      const pc = new RTCPeerConnection(await ice());
      const peer: Peer = { pc, queued: early.current.get(withId) ?? [], since: Date.now(), epoch };
      early.current.delete(withId);
      peerMap.current.set(withId, peer);

      pc.onicecandidate = e => {
        if (e.candidate) void sendSignal(withId, 'ice', e.candidate.toJSON());
      };

      pc.onconnectionstatechange = () => {
        const st = pc.connectionState;
        if (peerMap.current.get(withId)?.pc !== pc) return;

        if (st === 'connected') {
          if (!peer.up) peer.up = Date.now();
          setError(null);
          setDetail('conectado');
        } else if (st === 'connecting') {
          setDetail('procurando um caminho pela rede…');
        } else if (st === 'disconnected') {
          setDetail('a rede oscilou; tentando manter');
        } else if (DEAD.has(st)) {
          setDetail(st === 'failed' ? 'não achei caminho até essa máquina' : null);
          forget(withId);
        }
        setPeers(peerMap.current.size);
      };

      return peer;
    },
    [ice, sendSignal, forget]
  );

  const flush = useCallback(async (peer: Peer) => {
    const held = peer.queued.splice(0);
    for (const candidate of held) {
      try {
        await peer.pc.addIceCandidate(candidate);
      } catch {
      }
    }
  }, []);

  const heard = useCallback(
    async (from: string, kind: SignalKind, data: unknown) => {
      try {
        if (nativo.current && kind !== 'offer') {
          if (kind === 'want') {
            const epoch = epochOf(data);
            const held = nativeAsked.current.get(from);
            if (held && epoch <= held.epoch && Date.now() - held.at < HANDSHAKE_MS) return;
            nativeAsked.current.set(from, { epoch, at: Date.now() });
          }
          await cast()?.signal({ from, kind, data: data ?? {} });
          return;
        }

        if (kind === 'want') {
          const local = localRef.current;
          if (!local) return;

          const epoch = epochOf(data);
          const held = peerMap.current.get(from);
          if (held && !DEAD.has(held.pc.connectionState) && epoch <= held.epoch) return;

          const peer = await connect(from, epoch);
          for (const track of local.getTracks()) {
            await tune(peer.pc.addTrack(track, local), ceiling());
          }
          const offer = await peer.pc.createOffer();
          const dito = { type: offer.type, sdp: withStartBitrate(inStereo(offer.sdp ?? '')) };
          await peer.pc.setLocalDescription(dito);
          void sendSignal(from, 'offer', dito);
          setPeers(peerMap.current.size);
          retune();
          return;
        }

        if (kind === 'answer') {
          const peer = peerMap.current.get(from);
          if (!peer) return;
          if (peer.pc.signalingState !== 'have-local-offer') return;
          await peer.pc.setRemoteDescription(data as RTCSessionDescriptionInit);
          await flush(peer);
          return;
        }

        if (kind === 'offer') {
          if (from !== hostId || host) return;

          const vivo = peerMap.current.get(from);
          const reaproveita = vivo && !DEAD.has(vivo.pc.connectionState);
          if (reaproveita && vivo.pc.signalingState !== 'stable') {
            return;
          }

          const peer = reaproveita ? vivo : await connect(from);
          peer.pc.ontrack = e => {
            const [incoming] = e.streams;
            if (incoming) {
              setStream(incoming);
              setDetail('recebendo');
            }
          };
          await peer.pc.setRemoteDescription(data as RTCSessionDescriptionInit);
          await flush(peer);
          const answer = await peer.pc.createAnswer();
          const dito = { type: answer.type, sdp: inStereo(answer.sdp ?? '') };
          await peer.pc.setLocalDescription(dito);
          void sendSignal(from, 'answer', dito);
          return;
        }

        if (kind === 'ice') {
          const candidate = data as RTCIceCandidateInit;
          const peer = peerMap.current.get(from);
          if (!peer) {
            const fila = early.current.get(from) ?? [];
            fila.push(candidate);
            early.current.set(from, fila);
            return;
          }
          if (!peer.pc.remoteDescription) peer.queued.push(candidate);
          else await peer.pc.addIceCandidate(candidate).catch(() => {});
        }
      } catch (e) {
        setError((e as Error).message);
      }
    },
    [ceiling, connect, flush, host, hostId, retune, sendSignal]
  );

  useEffect(() => onSignal((from, kind, data) => void heard(from, kind, data)), [onSignal, heard]);

  const startNative = useCallback(async () => {
    const plug = cast();
    if (!plug) return false;

    const conf = await ice();
    try {
      await plug.start({
        iceServers: (conf.iceServers ?? []).map(s => ({ ...s })),
        audio: true,
      });
    } catch (e) {
      const dito = (e as Error)?.message ?? '';
      if (!/cancel/i.test(dito)) setError('A transmissão não começou: ' + dito);
      return false;
    }

    nativo.current = true;
    setSurface('aparelho');
    setHasAudio(false);

    nativeSignals.current = (await plug.addListener('signal', (e: unknown) => {
      const { to, kind, data } = (e ?? {}) as { to: string; kind: SignalKind; data: unknown };
      if (to && kind) void sendSignal(to, kind, data);
    })) as { remove?: () => void };
    nativePeers.current = (await plug.addListener('peers', (e: unknown) => {
      setPeers(Number((e as { peers?: number })?.peers ?? 0));
    })) as { remove?: () => void };

    nativeThumb.current = (await plug.addListener('preview', (e: unknown) => {
      const jpeg = (e as { jpeg?: string })?.jpeg;
      if (jpeg) setThumb(`data:image/jpeg;base64,${jpeg}`);
    })) as { remove?: () => void };

    nativeAudio.current = (await plug.addListener('audio', (e: unknown) => {
      setHasAudio(!!(e as { audio?: boolean })?.audio);
    })) as { remove?: () => void };

    if (!(await startLive())) {
      drop();
      return false;
    }
    return true;
  }, [drop, ice, sendSignal, startLive]);

  const start = useCallback(async () => {
    setError(null);

    if (inShell()) {
      await startNative();
      return;
    }

    if (!navigator.mediaDevices?.getDisplayMedia) {
      setError('Este navegador não sabe compartilhar tela. Chrome ou Edge, no computador.');
      return;
    }
    let capture: MediaStream;
    try {
      capture = await navigator.mediaDevices.getDisplayMedia({
        video: {
          width: { max: 1920 },
          height: { max: 1080 },
          frameRate: { ideal: 60, max: 60 },
          displaySurface: 'monitor',
        },
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
          channelCount: 2,
          sampleRate: 48_000,
        },
        ...({
          systemAudio: 'include',
          monitorTypeSurfaces: 'include',
          selfBrowserSurface: 'exclude',
          surfaceSwitching: 'include',
        } as object),
      } as DisplayMediaStreamOptions);
    } catch (e) {
      const name = (e as Error).name;
      if (name !== 'NotAllowedError' && name !== 'AbortError') {
        setError('Não foi possível capturar a tela: ' + (e as Error).message);
      }
      return;
    }

    for (const track of capture.getVideoTracks()) track.contentHint = HINT;
    localRef.current = capture;
    setStream(capture);
    setHasAudio(capture.getAudioTracks().length > 0);
    captureAudio.current = capture.getAudioTracks()[0] ?? null;
    setAudioSourceId(null);
    setSurface(
      (capture.getVideoTracks()[0]?.getSettings() as { displaySurface?: string })?.displaySurface ??
        null
    );

    for (const track of capture.getVideoTracks()) {
      track.addEventListener('ended', () => {
        drop();
        void stopLive();
      });
    }

    if (!(await startLive())) {
      drop();
    }
  }, [drop, startLive, stopLive]);

  const stop = useCallback(() => {
    drop();
    void stopLive();
  }, [drop, stopLive]);

  const listAudio = useCallback(async () => {
    try {
      const permissao = await navigator.mediaDevices.getUserMedia({ audio: true });
      for (const t of permissao.getTracks()) t.stop();
      const todos = await navigator.mediaDevices.enumerateDevices();
      setAudioSources(
        todos.filter(
          d =>
            d.kind === 'audioinput' &&
            d.deviceId &&
            d.deviceId !== 'default' &&
            d.deviceId !== 'communications'
        )
      );
    } catch (e) {
      setError('Não consegui listar as entradas de áudio: ' + (e as Error).message);
    }
  }, []);

  const pickAudio = useCallback(
    async (deviceId: string | null) => {
      setError(null);
      let faixa: MediaStreamTrack | null = null;

      if (deviceId === null) {
        faixa = captureAudio.current;
      } else {
        try {
          const som = await navigator.mediaDevices.getUserMedia({
            audio: {
              deviceId: { exact: deviceId },
              echoCancellation: false,
              noiseSuppression: false,
              autoGainControl: false,
              channelCount: 2,
              sampleRate: 48_000,
            },
          });
          faixa = som.getAudioTracks()[0] ?? null;
        } catch (e) {
          setError('Não consegui abrir essa entrada: ' + (e as Error).message);
          return;
        }
      }

      if (pickedAudio.current && pickedAudio.current !== faixa) {
        pickedAudio.current.stop();
        pickedAudio.current = null;
      }
      if (deviceId !== null && faixa) {
        faixa.contentHint = 'music';
        pickedAudio.current = faixa;
      }

      setAudioSourceId(deviceId);
      setHasAudio(Boolean(faixa));

      for (const [withId, peer] of peerMap.current) {
        const sender = peer.pc.getSenders().find(s => s.track?.kind === 'audio');
        if (sender) {
          await sender.replaceTrack(faixa).catch(() => {});
          if (faixa) await tune(sender);
          continue;
        }
        if (!faixa || !localRef.current) continue;
        await tune(peer.pc.addTrack(faixa, localRef.current), ceiling());
        try {
          const offer = await peer.pc.createOffer();
          const dito = { type: offer.type, sdp: withStartBitrate(inStereo(offer.sdp ?? '')) };
          await peer.pc.setLocalDescription(dito);
          void sendSignal(withId, 'offer', dito);
        } catch {
        }
      }
    },
    [sendSignal]
  );

  const lastBytes = useRef(new Map<string, { bytes: number; at: number }>());
  useEffect(() => {
    if (!hostId) {
      setQuality(null);
      return;
    }
    let alive = true;

    const medir = async () => {
      if (nativo.current) return;
      const pares = [...peerMap.current.entries()];
      if (!pares.length) {
        setQuality(null);
        return;
      }

      const lidos = await Promise.all(
        pares.map(async ([withId, peer]) => {
          const relatorio = await peer.pc.getStats().catch(() => null);
          if (!relatorio) return null;
          let achado: Record<string, unknown> | null = null;
          relatorio.forEach((stat: Record<string, unknown>) => {
            const tipo = host ? 'outbound-rtp' : 'inbound-rtp';
            if (stat.type === tipo && stat.kind === 'video') achado = stat;
          });
          return achado ? { withId, stat: achado as Record<string, unknown> } : null;
        })
      );
      if (!alive) return;

      const tudo = lidos.filter(Boolean) as { withId: string; stat: Record<string, unknown> }[];
      if (!tudo.length) {
        setQuality(null);
        return;
      }

      const agora = Date.now();
      let kbps = 0;
      for (const { withId, stat } of tudo) {
        const bytes = Number(host ? stat.bytesSent : stat.bytesReceived) || 0;
        const antes = lastBytes.current.get(withId);
        lastBytes.current.set(withId, { bytes, at: agora });
        if (antes && agora > antes.at) kbps += ((bytes - antes.bytes) * 8) / (agora - antes.at);
      }

      const pior = tudo.reduce((a, b) =>
        (Number(a.stat.frameHeight) || 0) <= (Number(b.stat.frameHeight) || 0) ? a : b
      );
      const razoes = tudo
        .map(t => String(t.stat.qualityLimitationReason ?? 'none'))
        .filter(r => r !== 'none');

      const maduras = tudo
        .filter(t => {
          const held = peerMap.current.get(t.withId);
          return !!held?.up && agora - held.up > RAMP_MS;
        })
        .map(t => String(t.stat.qualityLimitationReason ?? 'none'));

      if (host) {
        const saindo = kbps * 1000;
        const permitido = shareOf(tudo.length, budget.current) * tudo.length;
        const antes = budget.current;

        if (maduras.includes('bandwidth')) {
          budget.current = Math.max(UPLINK_FLOOR, Math.round(saindo * BACKOFF));
        } else if (saindo >= permitido * 0.85) {
          budget.current = Math.min(UPLINK_CEIL, Math.max(budget.current, Math.round(saindo * GROW)));
        }

        if (Math.abs(budget.current - antes) > antes * 0.1) retune();
      }

      setQuality({
        width: Number(pior.stat.frameWidth) || 0,
        height: Number(pior.stat.frameHeight) || 0,
        fps: Math.round(Number(pior.stat.framesPerSecond) || 0),
        kbps: Math.max(0, Math.round(kbps)),
        limit: razoes.includes('cpu')
          ? 'cpu'
          : razoes.includes('bandwidth')
            ? 'bandwidth'
            : razoes.length
              ? 'other'
              : null,
      });
    };

    const id = window.setInterval(() => void medir(), QUALITY_MS);
    return () => {
      alive = false;
      window.clearInterval(id);
      lastBytes.current.clear();
    };
  }, [hostId, host, retune]);

  useEffect(() => {
    if (!hostId || host) return;
    let alive = true;

    let pedindoDesde = Date.now();
    const recomecar = (agora: number) => {
      attempt.current += 1;
      pedindoDesde = agora;
    };

    const tick = () => {
      if (!alive) return;
      const peer = peerMap.current.get(hostId);
      const agora = Date.now();

      if (peer) {
        const st = peer.pc.connectionState;

        const faixa = peer.pc.getReceivers().find(r => r.track?.kind === 'video')?.track;
        if (st === 'connected' && faixa && !faixa.muted) {
          peer.frames = true;
          setDetail('recebendo');
          return;
        }

        if (peer.frames && !DEAD.has(st)) return;

        const prazo = st === 'connected' ? FIRST_FRAME_MS : HANDSHAKE_MS;
        const desde = st === 'connected' ? (peer.up ?? peer.since) : peer.since;
        if (!DEAD.has(st) && agora - desde < prazo) {
          if (st === 'connected') setDetail('conectado; esperando o primeiro quadro…');
          return;
        }

        forget(hostId);
        setStream(null);
        recomecar(agora);
      } else if (agora - pedindoDesde >= HANDSHAKE_MS) {
        recomecar(agora);
      }

      setDetail('pedindo a imagem…');
      void sendSignal(hostId, 'want', { epoch: attempt.current });
    };

    tick();
    const id = window.setInterval(tick, TICK_MS);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, [hostId, host, sendSignal, forget]);

  const lastHost = useRef<string | null>(null);
  useEffect(() => {
    if (lastHost.current === hostId) return;
    lastHost.current = hostId;
    if (host) return;
    drop();
  }, [hostId, host, drop]);

  useEffect(() => () => drop(), [drop]);

  const role = !hostId ? 'off' : host ? 'host' : 'viewer';
  const phase: LivePhase = !hostId
    ? 'off'
    : error
      ? 'failed'
      : host
        ? peers > 0
          ? 'live'
          : 'alone'
        : stream
          ? 'live'
          : 'waiting';

  return {
    role,
    phase,
    stream,
    peers,
    relayed,
    error,
    detail,
    hasAudio,
    surface,
    quality,
    thumb,
    audioSources,
    audioSourceId,
    listAudio,
    pickAudio,
    start,
    stop,
  };
}
