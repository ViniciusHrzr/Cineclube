import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { capi, cpost, clubPath } from '@/lib/api';
import { authHeaders, credentialsMode, streamUrl, urlFor } from '@/lib/session';

export type ScreeningMovie = {
  kind?: 'movie' | 'episode';
  id: number;
  title: string;
  year: number | null;
  genre: string;
  poster: string | null;
  runtime: number | null;
  season?: number;
  episode?: number;
  episodeTitle?: string | null;
};

export function episodeTag(movie: ScreeningMovie | null) {
  if (!movie || movie.season == null || movie.episode == null) return null;
  return `T${movie.season}E${String(movie.episode).padStart(2, '0')}`;
}

export type ScreeningViewer = {
  id: string;
  name: string;
  dot: string;
  ready: boolean;
  sourceTag: string | null;
};

export type ScreeningLive = {
  hostId: string;
  hostName: string;
  hostDot: string;
  since: number;
};

export type ScreeningHost = { id: string; name: string; dot: string };

export type ScreeningState = {
  open: boolean;
  movie: ScreeningMovie | null;
  host: ScreeningHost | null;
  status: 'playing' | 'paused';
  position: number;
  revision: number;
  link: string | null;
  subtitle: { id: number; name: string } | null;
  live: ScreeningLive | null;
  serverTime: number;
  viewers: ScreeningViewer[];
};

export type SubtitleFile = { id: number; name: string; vtt: string };

export type CommandType = 'play' | 'pause' | 'seek';

const IDLE: ScreeningState = {
  open: false,
  movie: null,
  host: null,
  status: 'paused',
  position: 0,
  revision: 0,
  link: null,
  subtitle: null,
  live: null,
  serverTime: 0,
  viewers: [],
};

export type ScreeningPulse = {
  open: boolean;
  status: 'playing' | 'paused';
  title: string | null;
  viewers: number;
};

export const DARK: ScreeningPulse = { open: false, status: 'paused', title: null, viewers: 0 };

export async function readPulse(): Promise<ScreeningPulse> {
  const s = await capi<ScreeningState>('/screening');
  return {
    open: !!s.open,
    status: s.status === 'playing' ? 'playing' : 'paused',
    title: s.movie?.title ?? null,
    viewers: s.viewers?.length ?? 0,
  };
}

export function samePulse(a: ScreeningPulse, b: ScreeningPulse) {
  return (
    a.open === b.open && a.status === b.status && a.title === b.title && a.viewers === b.viewers
  );
}

export function positionAt(state: ScreeningState, serverNow: number) {
  if (state.status !== 'playing') return state.position;
  return state.position + Math.max(0, serverNow - state.serverTime) / 1000;
}

async function measureOffset(samples = 5): Promise<number> {
  const offsets: number[] = [];
  for (let i = 0; i < samples; i++) {
    try {
      const t0 = Date.now();
      const res = await fetch(urlFor(clubPath('/screening/time')), {
        credentials: credentialsMode,
        headers: authHeaders(),
      });
      if (!res.ok) continue;
      const { t } = (await res.json()) as { t: number };
      const t2 = Date.now();
      offsets.push(t - (t0 + t2) / 2);
    } catch {
    }
  }
  if (!offsets.length) return 0;
  offsets.sort((a, b) => a - b);
  return offsets[Math.floor(offsets.length / 2)];
}

type Frame =
  | ({ type: 'state' } & ScreeningState)
  | { type: 'sync'; status: 'playing' | 'paused'; position: number; revision: number; serverTime: number }
  | { type: 'signal'; from: string; kind: SignalKind; data: unknown };

export type SignalKind = 'want' | 'offer' | 'answer' | 'ice';

export type IceConfig = { iceServers: RTCIceServer[]; relayed: boolean };

export function useScreening(onError?: (msg: string) => void) {
  const [state, setState] = useState<ScreeningState>(IDLE);
  const [connected, setConnected] = useState(false);
  const [offset, setOffset] = useState(0);

  const stateRef = useRef(state);
  stateRef.current = state;
  const offsetRef = useRef(0);
  offsetRef.current = offset;

  const serverNow = useCallback(() => Date.now() + offsetRef.current, []);

  const listeners = useRef(new Set<(from: string, kind: SignalKind, data: unknown) => void>());

  const onSignal = useCallback((fn: (from: string, kind: SignalKind, data: unknown) => void) => {
    listeners.current.add(fn);
    return () => {
      listeners.current.delete(fn);
    };
  }, []);

  useEffect(() => {
    let alive = true;
    void measureOffset().then(o => {
      if (alive) setOffset(o);
    });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    let vivo = true;
    let source: EventSource | null = null;
    let failures = 0;
    let timer = 0;

    const abrir = async () => {
      if (!vivo || source) return;
      const endereco = await streamUrl(clubPath('/screening/stream'));
      if (!vivo) return;

      const es = new EventSource(endereco, { withCredentials: true });
      source = es;

      es.onopen = () => {
        failures = 0;
        setConnected(true);
      };

      es.onmessage = e => {
        let frame: Frame;
        try {
          frame = JSON.parse(e.data);
        } catch {
          return;
        }
        if (frame.type === 'signal') {
          for (const fn of listeners.current) fn(frame.from, frame.kind, frame.data);
          return;
        }
        setState(prev => {
          if (frame.type === 'state') {
            const { type: _drop, ...next } = frame;
            return next;
          }
          if (frame.revision < prev.revision) return prev;
          return {
            ...prev,
            status: frame.status,
            position: frame.position,
            revision: frame.revision,
            serverTime: frame.serverTime,
          };
        });
      };

      es.onerror = () => {
        setConnected(false);
        if (source !== es) return;
        es.close();
        source = null;
        failures += 1;
        if (failures >= 5) {
          onError?.('A sessão perdeu a conexão com o servidor. Recarregue a página.');
          return;
        }
        timer = window.setTimeout(() => {
          timer = 0;
          void abrir();
        }, 1000 * failures);
      };
    };

    void abrir();

    return () => {
      vivo = false;
      if (timer) window.clearTimeout(timer);
      source?.close();
    };
  }, [onError]);

  const send = useCallback(
    async (type: CommandType, position: number) => {
      try {
        await cpost('/screening/command', { type, position });
      } catch (e) {
        onError?.((e as Error).message);
      }
    },
    [onError]
  );

  const openFilm = useCallback(
    async (movieId: number) => {
      try {
        await cpost('/screening/open', { movieId });
      } catch (e) {
        onError?.('Não foi possível abrir a sessão: ' + (e as Error).message);
      }
    },
    [onError]
  );

  const openEpisode = useCallback(
    async (showId: number, season: number, episode: number) => {
      try {
        await cpost('/screening/open', { showId, season, episode });
      } catch (e) {
        onError?.('Não foi possível abrir a sessão: ' + (e as Error).message);
      }
    },
    [onError]
  );

  const closeFilm = useCallback(async () => {
    try {
      await cpost('/screening/close', {});
    } catch (e) {
      onError?.('Não foi possível encerrar a sessão: ' + (e as Error).message);
    }
  }, [onError]);

  const publishLink = useCallback(async (link: string | null) => {
    try {
      await cpost('/screening/link', { link });
    } catch {
    }
  }, []);

  const publishSubtitle = useCallback(
    async (subtitle: { name: string; vtt: string } | null) => {
      try {
        const snap = await cpost<ScreeningState>('/screening/subtitle', { subtitle });
        return snap.subtitle?.id ?? null;
      } catch (e) {
        onError?.('Não foi possível enviar a legenda: ' + (e as Error).message);
        return null;
      }
    },
    [onError]
  );

  const fetchSubtitle = useCallback(() => capi<SubtitleFile>('/screening/subtitle'), []);

  const startLive = useCallback(async () => {
    try {
      await cpost('/screening/live', { on: true });
      return true;
    } catch (e) {
      onError?.((e as Error).message);
      return false;
    }
  }, [onError]);

  const stopLive = useCallback(async () => {
    try {
      await cpost('/screening/live', { on: false });
    } catch {
    }
  }, []);

  const sendSignal = useCallback(async (to: string, kind: SignalKind, data?: unknown) => {
    try {
      await cpost('/screening/signal', { to, kind, data: data ?? null });
      return true;
    } catch {
      return false;
    }
  }, []);

  const fetchIce = useCallback(() => capi<IceConfig>('/screening/ice'), []);

  const setReady = useCallback(async (ready: boolean, sourceTag?: string | null) => {
    try {
      await cpost('/screening/ready', { ready, sourceTag });
    } catch {
    }
  }, []);

  const expected = useCallback(() => positionAt(stateRef.current, serverNow()), [serverNow]);

  return useMemo(
    () => ({
      state,
      stateRef,
      connected,
      offset,
      serverNow,
      expected,
      send,
      openFilm,
      openEpisode,
      closeFilm,
      setReady,
      publishLink,
      publishSubtitle,
      fetchSubtitle,
      startLive,
      stopLive,
      sendSignal,
      fetchIce,
      onSignal,
    }),
    [
      state,
      connected,
      offset,
      serverNow,
      expected,
      send,
      openFilm,
      openEpisode,
      closeFilm,
      setReady,
      publishLink,
      publishSubtitle,
      fetchSubtitle,
      startLive,
      stopLive,
      sendSignal,
      fetchIce,
      onSignal,
    ]
  );
}

export type Screening = ReturnType<typeof useScreening>;
