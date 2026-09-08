import { useCallback, useEffect, useRef, useState } from 'react';
import { positionAt, type Screening, type ScreeningState } from '@/lib/screening';
import { cn } from '@/lib/utils';

/* ══════════════════════════════════════════════════════════════════════════
   One player, obeying the room.

   ── the echo problem, and why there is no timer in here ───────────────────
   Applying the room's state fires the player's own events: `.play()` fires
   `play`, setting `currentTime` fires `seeked`. If those handlers report back,
   every command becomes a new command and four browsers spend the evening
   shouting the same instruction at each other.

   The usual patch is a flag raised before the mutation and lowered on a
   timeout, and it is a race: too short reports an echo, too long swallows a
   real press. There is no need to guess — the room's state already says what
   the player ought to be doing, so a local event is asked whether the player
   now AGREES with the room. If it does, the event is the room's own doing.
   Every event is judged fresh against the current truth.

   ── the drift problem ─────────────────────────────────────────────────────
   Two players told to play at the same instant do not stay together: they
   buffer differently, their clocks tick differently, and a background tab is
   throttled. Correcting with a seek every time would be a stutter every few
   seconds, so the size of the error picks the instrument: a big gap is a seek,
   a small one a five percent nudge to the playback rate — inaudible, and it
   erases half a second of drift in ten.
   ══════════════════════════════════════════════════════════════════════════ */

/** Beyond this, only a seek will do. */
const TOLERANCE_HARD = 2;
/** Below this, leave it alone — chasing perfection is its own kind of jitter. */
const TOLERANCE_SOFT = 0.35;
/** Five percent. Enough to close a gap, too little for a voice to change. */
const NUDGE = 0.05;
const DRIFT_INTERVAL_MS = 2000;
/* Buffering for less than this is the network breathing; past it, the club is
   waiting for you. Era 1,2s, e 1,2s cobra caro: um soluço parava quatro pessoas,
   e voltar custa a todas elas os quatro segundos de almofada da retomada. */
const STALL_AFTER_MS = 3000;

/* How far apart two lines of one subtitle sit, as a multiple of their size.
   Tighter than body copy wants, because a subtitle is two lines read as one
   utterance in the second they are on screen — loose leading makes the eye
   travel, and travelling reads as the two halves belonging to different
   thoughts.

   The floor is not taste, it is the alphabet: Poppins puts an accented capital
   0.78em above the baseline and a descender 0.21em below, so two lines of
   Portuguese have roughly 0.99em of ink between them. Below about 1.05 they
   touch. */
const SUB_LEADING = 1.12;

/* ── being ready, measured instead of guessed ─────────────────────────────
   Recovery used to be the `canplay` event, and that was the start-stop loop:
   `canplay` means "there are a couple of frames", which on a stream still
   filling is true again a second after it stopped being true. The room resumes
   when everybody is ready, so each flicker restarted the film, which ran out of
   picture and stalled again.

   So stop asking a yes/no question and measure what decides it: how many
   seconds are buffered ahead. Ready means there is a cushion, not that a frame
   exists.

   And the cushion GROWS: a stall that comes back quickly means the last cushion
   was too small for this connection, so the next is doubled. A stretch of
   healthy playback puts it back to the bottom. */
const PROBE_MS = 500;
const BUFFER_BASE_S = 4;
const BUFFER_CEIL_S = 24;
/** A stall sooner than this after being ready means the cushion was too small. */
const RESTALL_MS = 8000;
/** And this long without one means the connection is fine now. */
const HEALTHY_MS = 30_000;
/* Nothing may hold the club indefinitely. Past this a player reports ready
   regardless and takes the consequence itself: it is behind, the drift
   corrector seeks it forward, and the club carries on. Being left behind is
   recoverable; holding four people hostage to one buffer is not. */
const GIVE_UP_MS = 25_000;
/* A picture that has not moved while the room believes it is playing is a
   stall the browser never announced — a codec it cannot decode, a stream that
   dried up. Whatever the cause, the club is watching without this member. */
const FROZEN_MS = 1600;

/* ── the seek that must not repeat ────────────────────────────────────────
   A hard seek is the only instrument that closes a big gap, and on a stream it
   is also the most destructive thing in this file: it throws away the download
   window the engine had been filling and opens a new one where the swarm has
   sent nothing yet.

   Paid once by a player merely in the wrong place, that is fair. Paid by a
   player that is behind *because it cannot download as fast as the film plays*,
   it is a trap that closes on itself: it is seeked, the seek empties its
   buffer, it starves, falls behind, and is seeked again. It never accumulates a
   single second of film.

   That is the start-stop that outlived every fix aimed at the room, and this is
   why: the loop never involves the room. So a seek that lands somewhere already
   buffered stays free, and one that lands anywhere else is rationed to one per
   `RESEEK_MS`. Somebody whose connection cannot keep up is left running behind
   the club instead — a worse seat, and an actual seat. */
const RESEEK_MS = 10_000;

/* ── seeing it happen ─────────────────────────────────────────────────────
   Os consertos que erraram este start-stop erraram pela mesma razão: a
   evidência era uma descrição do sintoma, e os mecanismos que o produzem são
   vários e independentes — a sala se parando, um player reportando travada, um
   corretor serrando a imagem. Da poltrona são idênticos.

   Então as decisões se imprimem. Desligado a menos que se peça:

     localStorage.setItem('cineclube.debug', '1')   // then reload            */
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

/** Seconds of film buffered ahead of `at`. Zero if `at` itself is not held. */
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
  /** Null in torrent mode, where the stream is attached to the element. */
  src?: string | null;
  sourceTag: string | null;
  /* Se o que esta pessoa fizer no player vale para a sala. Falso em toda tela
     que não é a do dono da sessão: os controles continuam ali — volume, tela
     cheia, legenda são desta pessoa —, mas play, pause e arrastar a barra
     voltam ao lugar em vez de mover o filme dos outros. */
  canControl: boolean;
  /** Hands the element out so a torrent can be streamed into it. */
  onElement?: (el: HTMLVideoElement | null) => void;
  /** The credits rolled: the screen offers to rate the film. */
  onEnded?: () => void;
  /** The browser refused the file. The code is `MediaError.code`. */
  onPlaybackError?: (code: number) => void;
  /** The room's subtitle, converted to WebVTT and shifted by this member. */
  subtitle?: { url: string; label: string } | null;
  /** How big the cues are drawn, as a percentage of what the browser chose. */
  subtitleSize?: number;
  poster?: string | null;
  className?: string;
}) {
  const { stateRef, serverNow, send, setReady } = screening;
  const videoRef = useRef<HTMLVideoElement | null>(null);
  /* Autoplay is refused until the page has been interacted with, and the
     refusal arrives as a rejected promise rather than an error anyone would
     notice. Unhandled, the club sits looking at a still frame wondering who
     forgot to press play. */
  const [blocked, setBlocked] = useState(false);

  const stallTimer = useRef<number | null>(null);
  const reportedReady = useRef(true);
  /** When this player last said it was ready. Null before the first stall. */
  const readyAt = useRef<number | null>(null);
  /** When it last said it was not — what `GIVE_UP_MS` is measured from. */
  const unreadyAt = useRef<number | null>(null);
  /** Seconds of cushion this connection has to show. Grows on a re-stall. */
  const needed = useRef(BUFFER_BASE_S);
  /* The probe's memory: the position it saw last time, and since when the
     picture has not moved. Together they are the stall nobody announced. */
  const lastTime = useRef(0);
  const frozenSince = useRef<number | null>(null);
  /** When the last expensive seek was spent. See `RESEEK_MS`. */
  const lastHardSeek = useRef(0);
  /* ── chegar não é travar ──────────────────────────────────────────────────
     Este é o defeito que a sala inteira sentia como "pausa sozinho": quem
     entrava no meio do filme parava todo mundo.

     Um <video> que acaba de receber um arquivo dispara `waiting` na hora — ele
     não tem nem o primeiro quadro —, e `waiting` era travada. Segundos depois
     este navegador dizia à sala que estava travado, e a sala pausava para os
     outros três. Não era conexão ruim: era o preço de alguém abrir a aba.

     A distinção que faltava é entre TRAVAR e AINDA NÃO TER COMEÇADO. Travar só
     pode acontecer com quem estava junto. Então este navegador só ganha o
     direito de segurar a sala depois de a imagem dele ter andado de verdade com
     a sala rodando; antes disso carrega calado e é levado ao lugar certo pelo
     corretor de deriva. */
  const joinedIn = useRef(false);

  /* ── the ref that must not be rewritten on every render ──────────────────
     Written inline, this callback is a new function each render, and React
     answers a new ref by detaching the old and attaching the new: `null`, then
     the element, every time. That is invisible for a ref that stores a value —
     not here, because `onElement` hands the element to the torrent engine, and
     the engine attaches a stream with `el.src = …`.

     Assigning `src` is never a no-op: the media load algorithm runs whether or
     not the URL changed, so the element throws away what it had, rewinds to
     zero and pauses. This screen re-renders about once a second on its own —
     the torrent poll reports peers and progress on a timer — so the film was
     being reloaded about once a second. */
  const holdVideo = useCallback(
    (el: HTMLVideoElement | null) => {
      videoRef.current = el;
      onElement?.(el);
    },
    [onElement]
  );

  /* The single door every big correction goes through, so that the two
     independent correctors above it cannot each spend the ration. Answers
     whether it actually seeked. */
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

  /** The room's state, applied to this player. Safe to call at any time. */
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
        /* Only one kind of refusal is the one the overlay is for. A `play()`
           on a stream that has no data yet rejects too — with AbortError,
           because the browser interrupted it — and showing "click to enter"
           over a film that is merely buffering tells the club to fix something
           that is not broken, on top of a loading spinner that already says
           the true thing. */
        (err: DOMException) => setBlocked(err?.name === 'NotAllowedError')
      );
    }
    if (s.status === 'paused' && !v.paused) {
      log('the room says pause', { at: v.currentTime });
      v.pause();
    }
  }, [stateRef, serverNow, hardSeek]);

  /* Every state frame and every sync frame lands here. `serverTime` moves on
     both, so it is the dependency that catches them both. */
  const { revision, serverTime, status, open } = screening.state;
  useEffect(() => {
    reconcile();
  }, [revision, serverTime, status, open, src, reconcile]);

  /* ── the local player speaking ────────────────────────────────────────── */
  const onLocalChange = useCallback(
    (kind: 'play' | 'pause' | 'seek') => {
      const v = videoRef.current;
      const s = stateRef.current;
      if (!v || !s.open) return;
      /* Running out of film is not a person pausing. Copies differ by a few
         seconds of credits, and whoever's ends first would otherwise stop the
         film for everybody still watching them roll. */
      if (v.ended) return;

      /* Sem o controle, o gesto não vira comando — vira uma correção nesta tela
         só. Sem esta linha o servidor recusaria com 403 e o player ficaria
         pausado até o próximo quadro de sincronia, até cinco segundos depois:
         a pessoa apertou pause e o filme parou para ela, que é exatamente o que
         a regra existe para não deixar acontecer. */
      if (!canControl) return reconcile();

      const want = positionAt(s, serverNow());
      const statusAgrees = (s.status === 'playing') === !v.paused;
      const positionAgrees = Math.abs(v.currentTime - want) < TOLERANCE_HARD;

      /* ── which disagreement counts, and for which event ──────────────────
         This used to be one test for both — report unless the player agrees
         about status *and* position — and that was a feedback loop with the
         club's evening inside it: a buffering player falls behind, so every
         `play` the browser fired looked like disagreement and got reported as
         "play at 00:03", dragging the whole room back to where the slowest copy
         had stalled.

         A position that is behind is not somebody pressing something — it is
         what the drift corrector exists to close, quietly. So play and pause
         report a *status* disagreement and nothing else, and only a seek
         reports a position, because dragging the bar is the one gesture that
         means "everyone, go there". */
      if (kind === 'seek') {
        if (positionAgrees) return; // our own reconcile coming back
        void send('seek', v.currentTime);
        return;
      }

      if (statusAgrees) return; // the room's own reflection
      /* Pressing play means "run from where we are", not "run from where my
         copy happens to have got to" — so a player that is out of tolerance
         hands the room its own number back rather than moving it. */
      void send(kind, positionAgrees ? v.currentTime : want);
    },
    [stateRef, serverNow, send, canControl, reconcile]
  );

  /* ── holding the two together ─────────────────────────────────────────── */
  useEffect(() => {
    const id = window.setInterval(() => {
      const v = videoRef.current;
      const s = stateRef.current;
      if (!v || !s.open || s.status !== 'playing' || v.paused || v.seeking) return;

      const drift = v.currentTime - positionAt(s, serverNow());
      const size = Math.abs(drift);

      if (size > TOLERANCE_HARD) {
        /* Refused means the ration is spent and this player is starving, not
           misplaced. Nudging is then the only instrument left — it will not
           close a gap this size, but it closes it in the right direction and
           costs the picture nothing, which is more than the seek was doing. */
        if (hardSeek(v, positionAt(s, serverNow()))) v.playbackRate = 1;
        else v.playbackRate = drift > 0 ? 1 - NUDGE : 1 + NUDGE;
      } else if (size > TOLERANCE_SOFT) {
        // Ahead of the room slows down; behind it hurries.
        v.playbackRate = drift > 0 ? 1 - NUDGE : 1 + NUDGE;
      } else if (v.playbackRate !== 1) {
        v.playbackRate = 1;
      }
    }, DRIFT_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [stateRef, serverNow, hardSeek]);

  /* Leaving the room means leaving it playable for everyone else: a player
     that unmounts while reported unready would hold the club on a wheel that
     is no longer turning. */
  useEffect(
    () => () => {
      if (stallTimer.current) window.clearTimeout(stallTimer.current);
      if (!reportedReady.current) void setReady(true, null);
    },
    [setReady]
  );

  /* ── where resuming will actually land ────────────────────────────────────
     While this copy sat frozen the room ran on, so the moment it says "ready"
     it is seeked forward — and the seconds it had just finished buffering are
     now behind it. It reports ready on a cushion it is about to throw away.

     So the probe asks not "can I play from here" but "can I play from where the
     room will put me". */
  const resumeFrom = useCallback(
    (v: HTMLVideoElement, s: ScreeningState) => {
      const want = positionAt(s, serverNow());
      if (Number.isFinite(v.duration) && want > v.duration) return v.currentTime;
      return Math.abs(v.currentTime - want) > TOLERANCE_HARD ? want : v.currentTime;
    },
    [serverNow]
  );

  /* Trocar de fonte é começar de novo: o arquivo novo não tem imagem nenhuma, e
     o direito de segurar a sala volta a ser conquistado tocando. A almofada
     também volta ao mínimo — o que esta conexão precisou para aguentar o
     arquivo anterior não diz nada sobre o próximo. */
  useEffect(() => {
    joinedIn.current = false;
    needed.current = BUFFER_BASE_S;
  }, [src, sourceTag]);

  /** The wheel started turning. Reported only if it keeps turning. */
  const stalling = useCallback(() => {
    if (stallTimer.current || !reportedReady.current) return;
    // Ainda não começou: ver `joinedIn`. Carregar não é travar.
    if (!joinedIn.current) return;
    stallTimer.current = window.setTimeout(() => {
      stallTimer.current = null;
      /* Too soon after the last recovery: this connection needs a bigger
         cushion than the one we settled for. */
      if (Date.now() - (readyAt.current ?? 0) < RESTALL_MS) {
        needed.current = Math.min(needed.current * 2, BUFFER_CEIL_S);
      }
      report(false);
    }, STALL_AFTER_MS);
  }, [report]);

  /* The probe. It answers two questions the events cannot: whether there is
     enough film ahead to be worth resuming for, and whether the picture is
     moving at all. */
  useEffect(() => {
    const id = window.setInterval(() => {
      const v = videoRef.current;
      const s = stateRef.current;
      if (!v || !s.open) return;

      const running = s.status === 'playing' && !v.paused && !v.seeking && !v.ended;

      /* A imagem andou com a sala rodando: esta pessoa está VENDO o filme, e a
         partir daqui uma parada dela é uma travada de verdade. É a medida certa
         para isso e não o evento `playing`, que dispara com um quadro só e
         antes de o quadro seguinte existir. */
      if (running && v.currentTime !== lastTime.current) joinedIn.current = true;

      if (running && v.currentTime === lastTime.current) {
        frozenSince.current ??= Date.now();
        if (Date.now() - frozenSince.current > FROZEN_MS) stalling();
      } else {
        frozenSince.current = null;
      }
      lastTime.current = v.currentTime;

      if (reportedReady.current) {
        // A long clean run means the cushion we are using is generous enough.
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
      {/* ── how a line of dialogue is drawn ──────────────────────────────────
          A cue is drawn by the browser, inside a shadow tree no class can
          reach. `::cue` is the only handle there is, and it is a pseudo-element
          on the video — so the rule has to arrive as an actual stylesheet with
          the values written into it, scoped by an attribute so it cannot leak
          onto some other player.

          What the browser does unaided is a black slab behind every line, in a
          face nobody chose, at whatever leading that face defaults to. It reads
          as a caption file being displayed rather than a film being shown, and
          it has one failure worth naming: the slab is drawn per line and sized
          to the words in it, so a sentence that wraps becomes two staggered
          boxes with a seam between them. That seam is what looks like the lines
          drifting apart, and no amount of leading fixes it — the box has to go.

          With no plate under them the letters carry their own dark. Same trick
          the rest of the product uses over the film wall (see `body` in
          index.css), only heavier, because a subtitle sits over a moving
          picture that is allowed to be white: four hard offsets are the edge
          around the letterforms, the two blurs behind them are what separates
          the line from whatever is lit underneath.

          The size stays a percentage, because the browser already sizes cues
          from the size of the video: 100% is exactly what it would have done
          unaided, and every other value is this member saying it is wrong for
          their screen. Not a custom property — `::cue` does not resolve `var()`
          in every engine that supports the rest of it, and a rule that silently
          does nothing in one browser is worse than no rule.

          Styled here rather than drawn here: an overlay of our own would give
          full control and lose it again the moment somebody presses the native
          fullscreen button, which promotes the `<video>` alone and leaves every
          sibling behind. Cues go fullscreen with the element they belong to.

          ── and why the leading is computed and not written ──────────────────
          A `line-height` on `::cue` alone does nothing visible, and the reason
          is the oldest rule in CSS line layout: the height of a line box is the
          tallest thing in it, and one of those things is the *strut* — an
          invisible box the size of the block's own font, contributed by the
          block whether or not any text is that big.

          The block here is the browser's cue container, and its font size is
          the one the browser picked from the height of the video. Shrinking the
          words to 50% shrinks the words and leaves the strut where it was, so
          the lines keep the spacing of the size nobody chose — which is exactly
          the gap that opens up as the subtitle gets smaller.

          So the strut is scaled instead of the leading. The number below is the
          leading we want multiplied by the size we are drawing at, which lands
          the container's own line box on precisely `SUB_LEADING` times the size
          of the text inside it. The `::cue` rule keeps the plain multiple, for
          the engine that honours it there. */}
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
        /* Only the stall is an event. Recovery is not: `canplay` and `playing`
           mean "there is a frame", which on a stream still filling is true
           again a second after it stopped being true, and reporting ready on
           each of those flickers is what restarted the film every two seconds.
           The probe above decides recovery, on a measurement. */
        onWaiting={stalling}
        onStalled={stalling}
        /* Not routed through `onLocalChange`: the end of a film is not somebody
           pausing it, and telling the room the film paused itself at the last
           frame would fight the next member whose copy runs a few seconds
           longer. The room stays where it is; the screen offers what comes next. */
        onEnded={() => onEnded?.()}
        /* The browser is the only thing that knows whether it can decode this
           file, and it only says so once it has tried. Guessing from the
           extension beforehand told people their file would not work when it
           would. */
        onError={() => {
          const failure = videoRef.current?.error;
          if (failure) onPlaybackError?.(failure.code);
        }}
      >
        {/* Keyed by the URL so swapping subtitle files replaces the track
            instead of mutating a live one, which browsers handle badly. */}
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
        /* The one thing that unblocks autoplay is a real click, so the overlay
           is not a warning — it is the gesture the browser is waiting for. */
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
