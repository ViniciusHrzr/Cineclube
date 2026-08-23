import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { post } from '@/lib/api';

/* ══════════════════════════════════════════════════════════════════════════
   The client half of the screening room.

   The server owns where the film is; this file's only job is to know that
   number as accurately as a browser can, and to hand it to whatever is
   playing. Two things make that harder than it sounds.

   The first is that a message takes time to arrive, so a frame saying "we are
   at 00:42" is already wrong when it is read. Every frame therefore carries the
   instant it was true, and the position is derived from that instant rather
   than taken at face value — the same trick the server uses, for the same
   reason.

   The second is that the browser's clock is not the server's. A machine set a
   minute fast would derive every position a minute ahead and spend the whole
   film convinced everyone else had drifted. So the offset between the two
   clocks is measured before anything else happens, and every derivation goes
   through it.
   ══════════════════════════════════════════════════════════════════════════ */

export type ScreeningMovie = {
  id: number;
  title: string;
  year: number | null;
  genre: string;
  poster: string | null;
  /** Minutes. Null when the club's cache never learned it. */
  runtime: number | null;
};

export type ScreeningViewer = {
  id: string;
  name: string;
  dot: string;
  /** False while their player is buffering — which pauses everybody. */
  ready: boolean;
  /** What they are playing. Infohash, URL, or size:duration for a local file. */
  sourceTag: string | null;
};

export type ScreeningState = {
  open: boolean;
  movie: ScreeningMovie | null;
  status: 'playing' | 'paused';
  /** Seconds, true as of `serverTime` — never read this without deriving. */
  position: number;
  revision: number;
  /** Whether the buffering wheel paused us, rather than a person. */
  pausedByStall: boolean;
  /** The magnet or URL the club is on, for whoever arrives next. Null: none. */
  link: string | null;
  serverTime: number;
  viewers: ScreeningViewer[];
};

export type CommandType = 'play' | 'pause' | 'seek';

const IDLE: ScreeningState = {
  open: false,
  movie: null,
  status: 'paused',
  position: 0,
  revision: 0,
  pausedByStall: false,
  link: null,
  serverTime: 0,
  viewers: [],
};

/** Where the film is now, according to a state and a server clock reading. */
export function positionAt(state: ScreeningState, serverNow: number) {
  if (state.status !== 'playing') return state.position;
  return state.position + Math.max(0, serverNow - state.serverTime) / 1000;
}

/* ── the two clocks ───────────────────────────────────────────────────────
   The classic round-trip estimate: the server's instant, minus the midpoint of
   when we asked and when we heard back. Each sample is wrong by half the
   difference between the two legs of its round trip, so several are taken and
   the median kept — a median throws away the one sample that queued behind a
   garbage collection, which an average would smear across the result. */
async function measureOffset(samples = 5): Promise<number> {
  const offsets: number[] = [];
  for (let i = 0; i < samples; i++) {
    try {
      const t0 = Date.now();
      const res = await fetch('/api/screening/time');
      if (!res.ok) continue;
      const { t } = (await res.json()) as { t: number };
      const t2 = Date.now();
      offsets.push(t - (t0 + t2) / 2);
    } catch {
      /* one lost sample is not a reason to give up on the estimate */
    }
  }
  if (!offsets.length) return 0;
  offsets.sort((a, b) => a - b);
  return offsets[Math.floor(offsets.length / 2)];
}

/* A `sync` frame is the room restating where it is, unprompted. It is not a
   change, so it carries no new revision — it exists so a client that drifted,
   joined late, or came back from a locked phone converges without asking. */
type Frame =
  | ({ type: 'state' } & ScreeningState)
  | { type: 'sync'; status: 'playing' | 'paused'; position: number; revision: number; serverTime: number };

export function useScreening(onError?: (msg: string) => void) {
  const [state, setState] = useState<ScreeningState>(IDLE);
  const [connected, setConnected] = useState(false);
  const [offset, setOffset] = useState(0);

  /* The engine reads the state on a timer and inside DOM event handlers, both
     of which outlive the render that created them. A ref is the copy that is
     never stale. */
  const stateRef = useRef(state);
  stateRef.current = state;
  const offsetRef = useRef(0);
  offsetRef.current = offset;

  const serverNow = useCallback(() => Date.now() + offsetRef.current, []);

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
    const source = new EventSource('/api/screening/stream');
    /* EventSource retries on its own, forever, with no way to ask it to stop
       politely. That is right for a dropped connection and wrong for a refusal
       — too many tabs open, or a signed-out session — where retrying is a loop
       that never resolves. Counting consecutive failures separates the two. */
    let failures = 0;

    source.onopen = () => {
      failures = 0;
      setConnected(true);
    };

    source.onmessage = e => {
      let frame: Frame;
      try {
        frame = JSON.parse(e.data);
      } catch {
        return;
      }
      setState(prev => {
        if (frame.type === 'state') {
          const { type: _drop, ...next } = frame;
          return next;
        }
        /* A sync frame only moves the clock. Dropping one that is older than
           what we hold keeps a frame that overtook another from rewinding the
           film under somebody's hands. */
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

    source.onerror = () => {
      setConnected(false);
      failures += 1;
      if (failures >= 5) {
        source.close();
        onError?.('A sessão perdeu a conexão com o servidor. Recarregue a página.');
      }
    };

    return () => source.close();
  }, [onError]);

  const send = useCallback(
    async (type: CommandType, position: number) => {
      try {
        /* The reply carries the new snapshot and is deliberately thrown away:
           the stream is the one place state arrives from, so there is exactly
           one order of events and no way for the two paths to disagree. */
        await post('/api/screening/command', { type, position });
      } catch (e) {
        onError?.((e as Error).message);
      }
    },
    [onError]
  );

  const openFilm = useCallback(
    async (movieId: number) => {
      try {
        await post('/api/screening/open', { movieId });
      } catch (e) {
        onError?.('Não foi possível abrir a sessão: ' + (e as Error).message);
      }
    },
    [onError]
  );

  const closeFilm = useCallback(async () => {
    try {
      await post('/api/screening/close', {});
    } catch (e) {
      onError?.('Não foi possível encerrar a sessão: ' + (e as Error).message);
    }
  }, [onError]);

  /* Leaving the club a pointer to what you are watching. Failing is not worth a
     toast — the room simply keeps the pointer it had, and the next person to
     choose a source publishes again. */
  const publishLink = useCallback(async (link: string | null) => {
    try {
      await post('/api/screening/link', { link });
    } catch {
      /* the room keeps whatever it had */
    }
  }, []);

  /* Reporting readiness is chatter, not an action: it fires on every stall and
     every recovery, and a failed one is corrected by the next. Errors are
     swallowed on purpose — surfacing them would put a toast on screen for
     something the club can neither see nor act on. */
  const setReady = useCallback(async (ready: boolean, sourceTag?: string | null) => {
    try {
      await post('/api/screening/ready', { ready, sourceTag });
    } catch {
      /* the next report corrects it */
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
      closeFilm,
      setReady,
      publishLink,
    }),
    [state, connected, offset, serverNow, expected, send, openFilm, closeFilm, setReady, publishLink]
  );
}

export type Screening = ReturnType<typeof useScreening>;
