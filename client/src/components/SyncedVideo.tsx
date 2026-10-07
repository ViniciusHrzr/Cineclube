import { useCallback, useEffect, useRef, useState } from 'react';
import { positionAt, type Screening, type ScreeningState } from '@/lib/screening';
import { cn } from '@/lib/utils';

const TOLERANCE_HARD = 2;
const TOLERANCE_SOFT = 0.35;
const NUDGE = 0.05;
const DRIFT_INTERVAL_MS = 2000;
const STALL_AFTER_MS = 3000;

const SUB_LEADING = 1.12;

const PROBE_MS = 500;
const BUFFER_BASE_S = 4;
const BUFFER_CEIL_S = 24;
const RESTALL_MS = 8000;
const HEALTHY_MS = 30_000;
const GIVE_UP_MS = 25_000;
const FROZEN_MS = 1600;

const RESEEK_MS = 10_000;

const DEBUG = (() => {
  try {
    return localStorage.getItem('cineclube.debug') === '1';
  } catch {
    return false;
  }
})();

const log: (what: string, detail: Record<string, unknown>) => void = DEBUG
  ? (what, detail) => {
      const said = Object.entries(detail)
        .map(([k, v]) => `${k}=${typeof v === 'number' ? v.toFixed(2) : v}`)
        .join(' ');
      console.log(`[sync] ${what} ${said}`);
    }
  : () => {};

function cushionAt(v: HTMLVideoElement, at: number) {
  for (let i = 0; i < v.buffered.length; i++) {
    if (v.buffered.start(i) <= at && at <= v.buffered.end(i)) return v.buffered.end(i) - at;
  }
  return 0;
}

export function SyncedVideo({
  screening,
  src,
  sourceTag,
  canControl,
  onElement,
  onEnded,
  onPlaybackError,
  subtitle,
  subtitleSize = 100,
  poster,
  className,
}: {
  screening: Screening;
  src?: string | null;
  sourceTag: string | null;
  canControl: boolean;
  onElement?: (el: HTMLVideoElement | null) => void;
  onEnded?: () => void;
  onPlaybackError?: (code: number) => void;
  subtitle?: { url: string; label: string } | null;
  subtitleSize?: number;
  poster?: string | null;
  className?: string;
}) {
  const { stateRef, serverNow, send, setReady } = screening;
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [blocked, setBlocked] = useState(false);

  const stallTimer = useRef<number | null>(null);
  const reportedReady = useRef(true);
  const readyAt = useRef<number | null>(null);
  const unreadyAt = useRef<number | null>(null);
  const needed = useRef(BUFFER_BASE_S);
  const lastTime = useRef(0);
  const frozenSince = useRef<number | null>(null);
  const lastHardSeek = useRef(0);
  const joinedIn = useRef(false);

  const holdVideo = useCallback(
    (el: HTMLVideoElement | null) => {
      videoRef.current = el;
      onElement?.(el);
    },
    [onElement]
  );

  const hardSeek = useCallback((v: HTMLVideoElement, to: number) => {
    if (v.seeking) return false;
    if (Number.isFinite(v.duration) && to > v.duration) return false;
    const cushion = cushionAt(v, to);
    if (cushion === 0 && Date.now() - lastHardSeek.current < RESEEK_MS) {
      log('seek refused — starving, not misplaced', { at: v.currentTime, to, gap: to - v.currentTime });
      return false;
    }
    log('seek', { from: v.currentTime, to, cushionThere: cushion });
    lastHardSeek.current = Date.now();
    v.currentTime = to;
    return true;
  }, []);

  const report = useCallback(
    (ready: boolean) => {
      if (reportedReady.current === ready) return;
      log(ready ? 'told the room I can play' : 'told the room I am stalled', {
        cushionWanted: needed.current,
        at: videoRef.current?.currentTime ?? -1,
      });
      reportedReady.current = ready;
      if (ready) {
        readyAt.current = Date.now();
        unreadyAt.current = null;
      } else {
        unreadyAt.current = Date.now();
      }
      void setReady(ready, sourceTag);
    },
    [setReady, sourceTag]
  );

  const reconcile = useCallback(() => {
    const v = videoRef.current;
    const s = stateRef.current;
    if (!v || !s.open) return;

    const want = positionAt(s, serverNow());

    if (Number.isFinite(v.duration) && want > v.duration) return;
    if (Math.abs(v.currentTime - want) > TOLERANCE_HARD) hardSeek(v, want);
    if (s.status === 'playing' && v.paused) {
      log('the room says play', { at: v.currentTime, want, cushion: cushionAt(v, v.currentTime) });
      v.play().then(
        () => setBlocked(false),
        (err: DOMException) => setBlocked(err?.name === 'NotAllowedError')
      );
    }
    if (s.status === 'paused' && !v.paused) {
      log('the room says pause', { at: v.currentTime });
      v.pause();
    }
  }, [stateRef, serverNow, hardSeek]);

  const { revision, serverTime, status, open } = screening.state;
  useEffect(() => {
    reconcile();
  }, [revision, serverTime, status, open, src, reconcile]);

  const onLocalChange = useCallback(
    (kind: 'play' | 'pause' | 'seek') => {
      const v = videoRef.current;
      const s = stateRef.current;
      if (!v || !s.open) return;
      if (v.ended) return;

      if (!canControl) return reconcile();

      const want = positionAt(s, serverNow());
      const statusAgrees = (s.status === 'playing') === !v.paused;
      const positionAgrees = Math.abs(v.currentTime - want) < TOLERANCE_HARD;

      if (kind === 'seek') {
        if (positionAgrees) return;
        void send('seek', v.currentTime);
        return;
      }

      if (statusAgrees) return;
      void send(kind, positionAgrees ? v.currentTime : want);
    },
    [stateRef, serverNow, send, canControl, reconcile]
  );

  useEffect(() => {
    const id = window.setInterval(() => {
      const v = videoRef.current;
      const s = stateRef.current;
      if (!v || !s.open || s.status !== 'playing' || v.paused || v.seeking) return;

      const drift = v.currentTime - positionAt(s, serverNow());
      const size = Math.abs(drift);

      if (size > TOLERANCE_HARD) {
        if (hardSeek(v, positionAt(s, serverNow()))) v.playbackRate = 1;
        else v.playbackRate = drift > 0 ? 1 - NUDGE : 1 + NUDGE;
      } else if (size > TOLERANCE_SOFT) {
        v.playbackRate = drift > 0 ? 1 - NUDGE : 1 + NUDGE;
      } else if (v.playbackRate !== 1) {
        v.playbackRate = 1;
      }
    }, DRIFT_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [stateRef, serverNow, hardSeek]);

  useEffect(
    () => () => {
      if (stallTimer.current) window.clearTimeout(stallTimer.current);
      if (!reportedReady.current) void setReady(true, null);
    },
    [setReady]
  );

  const resumeFrom = useCallback(
    (v: HTMLVideoElement, s: ScreeningState) => {
      const want = positionAt(s, serverNow());
      if (Number.isFinite(v.duration) && want > v.duration) return v.currentTime;
      return Math.abs(v.currentTime - want) > TOLERANCE_HARD ? want : v.currentTime;
    },
    [serverNow]
  );

  useEffect(() => {
    joinedIn.current = false;
    needed.current = BUFFER_BASE_S;
  }, [src, sourceTag]);

  const stalling = useCallback(() => {
    if (stallTimer.current || !reportedReady.current) return;
    if (!joinedIn.current) return;
    stallTimer.current = window.setTimeout(() => {
      stallTimer.current = null;
      if (Date.now() - (readyAt.current ?? 0) < RESTALL_MS) {
        needed.current = Math.min(needed.current * 2, BUFFER_CEIL_S);
      }
      report(false);
    }, STALL_AFTER_MS);
  }, [report]);

  useEffect(() => {
    const id = window.setInterval(() => {
      const v = videoRef.current;
      const s = stateRef.current;
      if (!v || !s.open) return;

      const running = s.status === 'playing' && !v.paused && !v.seeking && !v.ended;

      if (running && v.currentTime !== lastTime.current) joinedIn.current = true;

      if (running && v.currentTime === lastTime.current) {
        frozenSince.current ??= Date.now();
        if (Date.now() - frozenSince.current > FROZEN_MS) stalling();
      } else {
        frozenSince.current = null;
      }
      lastTime.current = v.currentTime;

      if (reportedReady.current) {
        if (running && Date.now() - (readyAt.current ?? 0) > HEALTHY_MS) needed.current = BUFFER_BASE_S;
        return;
      }

      const enough = cushionAt(v, resumeFrom(v, s)) >= needed.current;
      const waited = Date.now() - (unreadyAt.current ?? Date.now()) > GIVE_UP_MS;
      if (enough || waited) {
        if (stallTimer.current) {
          window.clearTimeout(stallTimer.current);
          stallTimer.current = null;
        }
        report(true);
      }
    }, PROBE_MS);
    return () => window.clearInterval(id);
  }, [stateRef, stalling, report, resumeFrom]);

  return (
    <div className={cn('relative overflow-hidden rounded-cell bg-black', className)}>
      {}
      <style>{`
        video[data-club-player]::-webkit-media-text-track-container,
        video[data-club-player]::-webkit-media-text-track-display {
          line-height: ${((SUB_LEADING * subtitleSize) / 100).toFixed(3)} !important;
        }
        video[data-club-player]::cue {
          font-family: Poppins, system-ui, sans-serif;
          font-size: ${subtitleSize}%;
          font-weight: 500;
          line-height: ${SUB_LEADING};
          color: #fff6e6;
          background: transparent;
          text-shadow:
            1px 1px 0 rgba(4, 5, 10, 0.92),
            -1px 1px 0 rgba(4, 5, 10, 0.92),
            1px -1px 0 rgba(4, 5, 10, 0.92),
            -1px -1px 0 rgba(4, 5, 10, 0.92),
            0 2px 4px rgba(4, 5, 10, 0.9),
            0 0 12px rgba(4, 5, 10, 0.7);
        }
      `}</style>
      <video
        data-club-player=""
        ref={holdVideo}
        src={src ?? undefined}
        poster={poster ?? undefined}
        controls
        playsInline
        preload="auto"
        className="aspect-video w-full bg-black"
        onPlay={() => {
          setBlocked(false);
          onLocalChange('play');
        }}
        onPause={() => onLocalChange('pause')}
        onSeeked={() => onLocalChange('seek')}
        onWaiting={stalling}
        onStalled={stalling}
        onEnded={() => onEnded?.()}
        onError={() => {
          const failure = videoRef.current?.error;
          if (failure) onPlaybackError?.(failure.code);
        }}
      >
        {}
        {subtitle ? (
          <track
            key={subtitle.url}
            kind="subtitles"
            srcLang="pt"
            label={subtitle.label}
            src={subtitle.url}
            default
          />
        ) : null}
      </video>

      {blocked ? (
        <button
          type="button"
          onClick={() => {
            videoRef.current?.play().then(
              () => setBlocked(false),
              () => setBlocked(true)
            );
            reconcile();
          }}
          className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-house/80 text-center"
        >
          <span className="font-display text-[15px] uppercase tracking-[0.14em] text-beam">
            Entrar na sessão
          </span>
          <span className="q max-w-[36ch] text-[11.5px] text-ink-dim">
            O navegador não deixa o vídeo começar sozinho. Um clique libera.
          </span>
        </button>
      ) : null}
    </div>
  );
}
