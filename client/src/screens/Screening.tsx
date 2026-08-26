import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Blank, Fault, Key, Poster, Reel, SearchField } from '@/components/bits';
import { SyncedVideo } from '@/components/SyncedVideo';
import { useClub } from '@/App';
import { initialsOf, reelColor, runtimeOf, type WatchItem } from '@/lib/api';
import { useScreening } from '@/lib/screening';
import { bytes, isMagnet, useTorrent, type TorrentStatus } from '@/lib/torrent';
import { cn, named, norm, plural } from '@/lib/utils';

/* ══════════════════════════════════════════════════════════════════════════
   The screening room, as a screen.

   Three things share this page and they are deliberately kept apart:

   - `useScreening` is the room — who is here, what is playing, where the film
     is. It is the club's shared state and the server owns it.
   - `useTorrent` is a receiver. It plays a link somebody hands it and knows
     nothing about the room; the room, in turn, never learns what it is.
   - This file is the seam. It chooses a source, hands the resulting stream to
     one `<video>`, and lets the room drive that element.

   The consequence worth stating: the sync engine works with any source. There
   are two — the film itself, dropped here and handed to the club, and a direct
   URL for the occasions when the club already has one — and the torrent path is
   the only one with failure modes of its own, which is why most of the words on
   this page belong to it.
   ══════════════════════════════════════════════════════════════════════════ */

/** What this member is playing. Everyone chooses their own; the room only syncs. */
type Source =
  | { kind: 'none' }
  /** The receiver owns the element; there is no URL to hand anybody. */
  | { kind: 'torrent' }
  /* Nothing on this screen can choose this any more — the field that did is
     gone. It survives for one path: adopting a room whose link is not a magnet,
     which the server still accepts and an older tab could still have published.
     A member arriving into that session gets a picture instead of a dead end. */
  | { kind: 'url'; url: string };

/** Shown once, on the first torrent of this browser. It is a fact, not a scare. */
const P2P_NOTICE = 'cineclube.p2p-avisado';

/* ── how big the words are ────────────────────────────────────────────────
   Kept in this browser and remembered between films, because it is not a fact
   about the subtitle — it is a fact about the screen it is being read on, and
   somebody watching on a laptop two feet away wants a different answer from
   somebody with a television across the room. Same reason the offset is
   per-person, one step further out: the offset belongs to the copy, this
   belongs to the seat.

   A percentage of whatever the browser was already going to use. The UA sizes
   cues from the size of the video, so 100 is "leave it alone" and the range is
   somebody saying it is wrong for them. */
const SUB_SIZE = 'cineclube.legenda-tamanho';
const SUB_SIZE_MIN = 40;
const SUB_SIZE_MAX = 200;
const SUB_SIZE_STEP = 10;

/* How long the film waits for the rest of the club to load the source before
   starting anyway. Long enough for a magnet to resolve on a swarm of one
   seeder, short enough that a tab left open on somebody's second monitor —
   which will never choose anything — does not hold up the evening. */
const START_GRACE_MS = 20_000;

/* ── the width of the room ────────────────────────────────────────────────
   Narrower than the page, and the picture is the reason. The rest of the
   product is a shelf of posters and wants the full 1240; a film does not. At
   the column's full width the video is edge to edge with nothing around it —
   no dark to sit the frame against — and every control underneath is stranded
   at the far ends of a line the eye has to travel to read as one row.

   So the whole screen moves in together, not just the video: a player at 900
   with a status bar at 1240 under it is not a smaller player, it is a player
   that lost an argument with the layout. */
const ROOM = 'mx-auto w-full max-w-[900px]';

/* ── subtitles ────────────────────────────────────────────────────────────
   A `<track>` only speaks WebVTT, and what people have on disk is almost always
   SubRip. The two are close enough that converting is a header and a punctuation
   change — which is worth doing here rather than asking somebody to go find a
   converter in the middle of a film.

   The offset is not a nicety either: a subtitle file found separately from the
   video is routinely a second or two out, and without a way to shift it the
   file is simply wrong. It is applied by rewriting the timestamps rather than
   by moving live cues, because a rebuilt file is a state the player can be
   handed cleanly, and a mutated cue list is one it half-notices. */

/** SubRip is UTF-8 as often as it is Windows-1252, and neither says which. */
async function readSubtitle(file: File) {
  const buffer = await file.arrayBuffer();
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch {
    // Not valid UTF-8, so it is the other one — the encoding Brazilian subtitle
    // files have been written in for twenty years.
    return new TextDecoder('windows-1252').decode(buffer);
  }
}

const STAMP = /(?:(\d+):)?(\d{1,2}):(\d{2})[.,](\d{3})/g;

function vttStamp(seconds: number) {
  const total = Math.max(0, Math.round(seconds * 1000));
  const pad = (n: number, size = 2) => String(n).padStart(size, '0');
  return `${pad(Math.floor(total / 3600000))}:${pad(Math.floor(total / 60000) % 60)}:${pad(
    Math.floor(total / 1000) % 60
  )}.${pad(total % 1000, 3)}`;
}

/** SubRip in, WebVTT out, shifted by `offset` seconds on the way through. */
function toVtt(raw: string, offset: number) {
  const body = raw.replace(/^﻿/, '').replace(/\r/g, '');
  const shifted = body.replace(STAMP, (_all, h, m, s, ms) => {
    const at = Number(h ?? 0) * 3600 + Number(m) * 60 + Number(s) + Number(ms) / 1000;
    return vttStamp(at + offset);
  });
  return /^WEBVTT/.test(shifted) ? shifted : `WEBVTT\n\n${shifted}`;
}

/** What `MediaError.code` means, said to somebody who just saw a black screen. */
function playbackFailure(code: number) {
  if (code === 2) return 'A fonte caiu no meio da reprodução.';
  if (code === 3 || code === 4) {
    return 'Seu navegador não consegue decodificar este arquivo. Costuma ser áudio AC3/DTS ou vídeo HEVC dentro do .mkv.';
  }
  return null;
}

export function ScreeningScreen() {
  const club = useClub();
  const screening = useScreening(club.fault);
  const torrent = useTorrent();
  const { state, connected, setReady } = screening;

  const [source, setSource] = useState<Source>({ kind: 'none' });
  /** Of the local file, once the player has read it. Half of the file's identity. */
  const [duration, setDuration] = useState<number | null>(null);
  const [ended, setEnded] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  /** The room's file as WebVTT at offset zero; the shifted copy derives from it. */
  const [subFile, setSubFile] = useState<{ name: string; raw: string } | null>(null);
  const [subOffset, setSubOffset] = useState(0);
  const [subsOn, setSubsOn] = useState(true);
  const [subtitle, setSubtitle] = useState<{ url: string; label: string } | null>(null);
  const [subSize, setSubSize] = useState(() => {
    try {
      const saved = Number(localStorage.getItem(SUB_SIZE));
      return saved >= SUB_SIZE_MIN && saved <= SUB_SIZE_MAX ? saved : 100;
    } catch {
      return 100; // storage refused: the default is not worth an exception
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(SUB_SIZE, String(subSize));
    } catch {
      /* it simply starts at the default next time */
    }
  }, [subSize]);

  const movieId = state.movie?.id ?? null;
  const { stop: stopTorrent } = torrent;
  const { publishLink } = screening;
  /** The last link this browser told the room about. See `share` below. */
  const shared = useRef<string | null>(null);
  /* The same value, but set only when this browser is the one that *published*
     it rather than one that adopted it. Which member put the film on the board
     is the only fact that separates the one browser that should press play
     from the three that should follow. */
  const published = useRef<string | null>(null);
  /** A link this member turned down, so adoption does not force it back. */
  const declined = useRef<string | null>(null);
  /** Whether the film has been started. See "the film starting by itself". */
  const started = useRef(false);
  /** The subtitle text this browser holds, and the room's id it came from. */
  const heldSub = useRef<string | null>(null);
  const tookSub = useRef<number | null>(null);
  /** When this member's own picture became available; the grace runs from it. */
  const feedingSince = useRef<number | null>(null);

  /* A different film is a different evening: the source, the receiver, the
     subtitles and the credits all belong to the last one. */
  useEffect(() => {
    setSource({ kind: 'none' });
    setDuration(null);
    setEnded(false);
    setFailure(null);
    setSubFile(null);
    setSubOffset(0);
    shared.current = null;
    published.current = null;
    declined.current = null;
    started.current = false;
    feedingSince.current = null;
    heldSub.current = null;
    tookSub.current = null;
    stopTorrent();
  }, [movieId, stopTorrent]);

  /* ── what this member is playing, said in one string ─────────────────────
     The infohash is exact: two people on the same hash have the same bytes, so
     the club can tell a shared copy from somebody's own rip without comparing
     anything but this. A URL is exact for the same reason. */
  const tag = useMemo(() => {
    if (source.kind === 'torrent') return torrent.status.infoHash;
    if (source.kind === 'url') return source.url;
    return null;
  }, [source, torrent.status.infoHash]);

  /* The player reports readiness only when it changes, and a member whose film
     never stalls would therefore never say what they are watching. This is what
     puts the source on the board. */
  useEffect(() => {
    if (tag) void setReady(true, tag);
  }, [tag, setReady]);

  /* The element is shared: the receiver streams into it, and a local file wants
     its duration read off it. */
  const elemRef = useRef<HTMLVideoElement | null>(null);
  const { attach } = torrent;
  const holdElement = useCallback(
    (el: HTMLVideoElement | null) => {
      const previous = elemRef.current;
      if (previous) previous.onloadedmetadata = null;
      elemRef.current = el;
      if (el) {
        el.onloadedmetadata = () => {
          setDuration(Number.isFinite(el.duration) ? Math.round(el.duration) : null);
        };
      }
      attach(el);
    },
    [attach]
  );

  /* Peers seen at the best moment, which is what turns "nobody is here" into
     the two different sentences it can mean: never arrived, or left. */
  const peak = useRef(0);
  useEffect(() => {
    if (torrent.status.peers > peak.current) peak.current = torrent.status.peers;
  }, [torrent.status.peers]);
  useEffect(() => {
    peak.current = 0;
  }, [torrent.status.infoHash]);

  /* The file the `<track>` actually loads: the imported one, rebuilt at the
     current offset. The cleanup is what keeps a shifted copy from leaking on
     every press of the nudge. */
  useEffect(() => {
    if (!subFile) {
      setSubtitle(null);
      return;
    }
    const url = URL.createObjectURL(new Blob([toVtt(subFile.raw, subOffset)], { type: 'text/vtt' }));
    setSubtitle({ url, label: subFile.name });
    return () => URL.revokeObjectURL(url);
  }, [subFile, subOffset]);

  /* Showing or hiding is a property of the track, not of the markup, so it is
     set on the element. `addtrack` is here because the track is parsed
     asynchronously: setting the mode before it exists is a silent no-op, and
     the subtitles never appear. */
  useEffect(() => {
    const el = elemRef.current;
    if (!el) return;
    const apply = () => {
      for (const track of Array.from(el.textTracks)) track.mode = subsOn ? 'showing' : 'hidden';
    };
    apply();
    el.textTracks.addEventListener('addtrack', apply);
    return () => el.textTracks.removeEventListener('addtrack', apply);
  }, [subsOn, subtitle]);

  /* ── the subtitle, which does travel ─────────────────────────────────────
     The film cannot be handed over — it is gigabytes and it lives on one disk
     — but the subtitles are a hundred kilobytes of text, and four people each
     hunting down the same .srt is the same errand the room exists to abolish.
     So this one goes to the club, and everybody's player picks it up.

     Converted to WebVTT here rather than in each browser that receives it: the
     conversion belongs where the file was opened, and the room then stores one
     format instead of two. At offset zero, always — the shift is the one part
     that stays personal, because it is a fact about your copy of the film. */
  const { publishSubtitle, fetchSubtitle } = screening;

  const importSubtitle = useCallback(
    async (file: File) => {
      const vtt = toVtt(await readSubtitle(file), 0);
      setSubOffset(0);
      setSubsOn(true);
      heldSub.current = vtt;
      setSubFile({ name: file.name, raw: vtt });
      tookSub.current = await publishSubtitle({ name: file.name, vtt });
    },
    [publishSubtitle]
  );

  /* The other direction: the room announces a subtitle and whoever does not
     have it collects it. Only the id is compared, because the announcement is
     all the stream carries — the text is a separate request, made once. This is
     also how a member arriving in the second act gets the subtitles without
     asking, which is the whole point of putting it in the room. */
  const announcedSub = state.subtitle?.id ?? null;
  useEffect(() => {
    if (announcedSub === null) {
      // Somebody removed it. It was the room's, so it goes from every screen.
      if (tookSub.current === null) return;
      tookSub.current = null;
      heldSub.current = null;
      setSubFile(null);
      setSubOffset(0);
      return;
    }
    if (announcedSub === tookSub.current) return;
    tookSub.current = announcedSub;

    let alive = true;
    void fetchSubtitle().then(
      got => {
        /* Already holding this exact text: our own upload coming back round the
           stream, because the frame can beat the reply to the POST. Rebuilding
           the blob would replace a live `<track>` for no reason, and a browser
           shows that as the subtitles blinking out mid-line. */
        if (!alive || got.vtt === heldSub.current) return;
        heldSub.current = got.vtt;
        setSubFile({ name: got.name, raw: got.vtt });
        // A different file is a different timing; the old shift means nothing.
        setSubOffset(0);
      },
      () => {
        /* One failed fetch is not worth a toast: the next announcement, or the
           next film, tries again, and the player is perfectly usable without. */
      }
    );
    return () => {
      alive = false;
    };
  }, [announcedSub, fetchSubtitle]);

  /* ── the pointer the club shares ─────────────────────────────────────────
     Published once per link and never in a loop: two members who each chose a
     different magnet would otherwise overwrite each other for as long as both
     tabs were open. The last one to choose wins, which is the same thing that
     happens in the chat. */
  const share = useCallback(
    (link: string | null) => {
      if (!link || shared.current === link) return;
      shared.current = link;
      published.current = link;
      void publishLink(link);
    },
    [publishLink]
  );

  const { receive, seed } = torrent;
  const chooseTorrent = useCallback(
    (input: string | File, mode: 'receive' | 'seed') => {
      setSource({ kind: 'torrent' });
      setEnded(false);
      setFailure(null);
      if (mode === 'seed') {
        void seed(input as File);
      } else {
        // Published straight away rather than after the engine resolves it: a
        // magnet with no peers never resolves, and the club would never learn
        // what to try.
        if (typeof input === 'string') share(input);
        void receive(input);
      }
    },
    [receive, seed, share]
  );

  /* Seeding produces a link that did not exist a moment ago, so it can only be
     shared once the engine has built it. */
  const seedMagnet = torrent.status.phase === 'seeding' ? torrent.status.magnet : null;
  useEffect(() => {
    if (seedMagnet) share(seedMagnet);
  }, [seedMagnet, share]);

  /* ── the film starting by itself ─────────────────────────────────────────
     Somebody drops the file and the evening should begin. Asking the person
     who just handed the club the film to then go and find the play button is
     a step that exists only because the code needed it to; nobody watching
     ever wanted it.

     Three conditions, and each one is a way this could be wrong:

     - Only the member who *published* the source presses it. Everybody else
       follows the room, which is the whole design — four browsers each
       sending the same play is four commands for one press, and whichever
       arrives last decides where the film starts.
     - Only at the top of a film that nobody has started. A room already
       running, or paused somewhere in the second act, is somewhere a person
       put it, and restarting that is the app overruling them.
     - Only once the club has loaded the same source — or once the grace has
       run out, because a tab open on a second monitor will never load
       anything and must not be able to hold up the film.

     `duration` is the honest signal that this browser has a film rather than
     a promise of one: it is read off the element, so it exists only after the
     player has actually opened what it was given. */
  const { send } = screening;

  const feeding =
    duration != null &&
    (source.kind === 'url' ||
      (source.kind === 'torrent' &&
        (torrent.status.phase === 'streaming' || torrent.status.phase === 'seeding')));

  useEffect(() => {
    if (!feeding) feedingSince.current = null;
    else feedingSince.current ??= Date.now();
  }, [feeding]);

  /* A room that is running was started by somebody — this one, or a person.
     Either way the question is settled and must not be asked again. */
  useEffect(() => {
    if (state.status === 'playing') started.current = true;
  }, [state.status]);

  const { viewers, link: roomSource, open: roomOpen, status, position } = state;
  useEffect(() => {
    if (started.current || !roomOpen || !feeding) return;
    if (status !== 'paused' || position > 1) return;
    if (roomSource && published.current !== roomSource) return;

    const go = () => {
      if (started.current) return;
      started.current = true;
      void send('play', 0);
    };

    if (viewers.length > 0 && viewers.every(v => v.sourceTag)) return go();

    // The deadline is absolute rather than a fresh countdown, so the state
    // frames arriving every few seconds cannot keep pushing it away.
    const left = START_GRACE_MS - (Date.now() - (feedingSince.current ?? Date.now()));
    const id = window.setTimeout(go, Math.max(0, left));
    return () => window.clearTimeout(id);
  }, [roomOpen, status, position, roomSource, viewers, feeding, send]);

  /* ── arriving into a session already under way ───────────────────────────
     The room knows what everyone else is watching, so a member who opens the
     tab in the middle of a film should not be shown an empty picker and left to
     ask in the chat. Only when nothing has been chosen here: adopting over
     somebody's own choice would be the app overruling them. */
  const roomLink = state.link;
  useEffect(() => {
    if (!state.open || !roomLink || source.kind !== 'none') return;
    if (roomLink === declined.current) return;
    // Adopted, not chosen — so it must not be published back as news.
    shared.current = roomLink;
    if (isMagnet(roomLink)) {
      setSource({ kind: 'torrent' });
      void receive(roomLink);
    } else {
      setSource({ kind: 'url', url: roomLink });
    }
  }, [state.open, roomLink, source.kind, receive]);

  /* ── the drop that must never navigate ───────────────────────────────────
     A page that does not cancel `drop` hands the file to the browser, and the
     browser opens it — replacing the document. The app does not crash, it is
     *gone*: no React tree left to catch anything, no error to print, nothing
     but the reload.

     Cancelling on the drop area alone was not enough, because a drop that
     lands a few pixels outside it is not a drop on the area — it is a drop on
     the page, and the page had no opinion. Releasing near a target is what
     dragging *is*, so the whole window says no, and the target says yes. */
  useEffect(() => {
    const swallow = (e: DragEvent) => e.preventDefault();
    window.addEventListener('dragover', swallow);
    window.addEventListener('drop', swallow);
    return () => {
      window.removeEventListener('dragover', swallow);
      window.removeEventListener('drop', swallow);
    };
  }, []);

  const openFilm = screening.openFilm;
  const closeFilm = screening.closeFilm;

  if (!state.open) {
    return (
      <section className={ROOM}>
        <Head connected={connected} viewers={state.viewers.length} />
        <FilmPicker watchlist={club.watchlist} onPick={id => void openFilm(id)} />
      </section>
    );
  }

  const movie = state.movie!;
  const mine = tag;
  const different = state.viewers.filter(v => v.id !== club.me.id && v.sourceTag && mine && v.sourceTag !== mine);
  const waiting = state.viewers.filter(v => !v.ready);

  return (
    <section className={ROOM}>
      <Head connected={connected} viewers={state.viewers.length} />

      <div className="mt-6 flex flex-wrap items-start gap-4">
        <Poster src={movie.poster} alt={movie.title} className="h-[86px] w-[58px] flex-none" />
        <div className="min-w-[16ch] flex-1">
          <h1 className="font-display text-[26px] leading-none tracking-[0.04em] text-beam">{movie.title}</h1>
          <p className="q mt-2 text-[12.5px] text-ink-dim">
            {[movie.year, movie.genre, runtimeOf(movie.runtime)].filter(Boolean).join(' · ')}
          </p>
        </div>
        <Key tone="danger" onClick={() => void closeFilm()}>
          Encerrar sessão
        </Key>
      </div>

      {source.kind === 'none' ? (
        <SourcePanel
          onMagnet={value => chooseTorrent(value, 'receive')}
          onTorrentFile={file => chooseTorrent(file, 'receive')}
          onSeed={file => chooseTorrent(file, 'seed')}
        />
      ) : (
        <div className="mt-6">
          <SyncedVideo
            screening={screening}
            src={source.kind === 'url' ? source.url : null}
            sourceTag={tag}
            onElement={holdElement}
            onEnded={() => setEnded(true)}
            onPlaybackError={code => setFailure(playbackFailure(code))}
            subtitle={subtitle}
            subtitleSize={subSize}
            poster={movie.poster}
          />

          {failure ? (
            <div className="mt-3">
              <Fault detail="ffmpeg -i filme.mkv -c:v copy -c:a aac -movflags +faststart filme.mp4">
                {failure}
              </Fault>
            </div>
          ) : null}

          {/* ── the booth ─────────────────────────────────────────────────────
              Everything here used to sit straight on the room: four rows of
              loose text and unlit buttons under the picture, each one floating
              at its own distance from the last, with nothing saying they were
              one thing. They are one thing — the controls of the machine
              showing the film — so they get one surface, and the rule that runs
              across it separates what belongs to the subtitle from what belongs
              to the source. */}
          <div className="plate mt-3 px-4 py-3.5">
            <SubtitleBar
              subtitle={subtitle}
              on={subsOn}
              offset={subOffset}
              size={subSize}
              onImport={file => void importSubtitle(file)}
              onToggle={() => setSubsOn(v => !v)}
              onNudge={by => setSubOffset(o => Math.round((o + by) * 10) / 10)}
              onResize={by =>
                setSubSize(v => Math.min(SUB_SIZE_MAX, Math.max(SUB_SIZE_MIN, v + by)))
              }
              onClear={() => {
                heldSub.current = null;
                setSubFile(null);
                setSubOffset(0);
                // The subtitle is the room's, so removing it removes it for all.
                void publishSubtitle(null);
              }}
            />

            <div className="mt-3.5 flex flex-wrap items-center justify-between gap-3 border-t border-house-rail pt-3.5">
              <SourceLine source={source} torrent={torrent.status} peaked={peak.current > 0} />
              <button
                type="button"
                onClick={() => {
                  stopTorrent();
                  setSource({ kind: 'none' });
                  setDuration(null);
                  setFailure(null);
                  /* The room's pointer stays where it is — this is one person
                     changing their own screen, not the club changing films. But
                     without this the adoption below would put the same link
                     straight back, and the button would do nothing at all. */
                  declined.current = state.link;
                }}
                className="font-display text-[12px] uppercase tracking-[0.12em] text-ink-dim transition-colors hover:text-beam"
              >
                Trocar fonte
              </button>
            </div>

            {/* What used to be a field with the magnet in it, to be copied into
                the chat by hand. The room publishes that link by itself the
                moment the engine builds it, so the field was a leftover errand
                — but the sentence under it was not, and it is the one thing the
                seeder genuinely needs to know. */}
            {torrent.status.phase === 'seeding' ? (
              <p className="q mt-2.5 max-w-[60ch] text-[11.5px] text-ink-dim">
                Enquanto esta aba estiver aberta, o filme está no ar para o clube. Fechar aqui derruba
                a fonte.
              </p>
            ) : null}
          </div>

          {ended ? (
            <div className="plate mt-3 flex flex-wrap items-center gap-3 px-4 py-3.5">
              <span className="legend">Fim de sessão</span>
              <Key tone="commit" onClick={() => club.rateMovie(movie.id)}>
                Avaliar agora
              </Key>
            </div>
          ) : null}
        </div>
      )}

      {/* ── the club, and what it is waiting for ────────────────────────────
          A plate for the same reason the booth is one: this is a list, and a
          list of people floating on the wall under a caption is not read as a
          list. The seats go a shade darker than the plate they sit on — they
          were house-seat on the room, and house-seat on house-seat is nothing
          at all. */}
      <div className="plate mt-6 px-4 py-4">
        <span className="legend">Na sessão</span>
        <div className="mt-3 flex flex-wrap gap-2">
          {state.viewers.map(v => (
            <span
              key={v.id}
              title={v.sourceTag ?? 'ainda escolhendo a fonte'}
              className={cn(
                'flex items-center gap-2 rounded-cell bg-house-deep/80 px-2.5 py-1.5 ring-1',
                v.ready ? 'ring-house-rail' : 'ring-dye-red-lit/60'
              )}
            >
              <Reel color={reelColor(v.dot, v.id)} src={club.avatarOf(v.id)} size="sm">
                {initialsOf(v.name)}
              </Reel>
              <span className="text-[12.5px] text-ink">{v.name}</span>
              {!v.ready ? <span className="q text-[11px] text-dye-red-lit">buffer</span> : null}
            </span>
          ))}
        </div>

        {state.pausedByStall ? (
          <p className="q mt-3 text-[12px] text-ink-dim">
            A sala pausou sozinha esperando {waiting.map(v => v.name).join(', ') || 'alguém'} — e volta sozinha
            quando o buffer encher.
          </p>
        ) : null}

        {different.length ? (
          <div className="mt-3">
            <Fault detail={different.map(v => `${v.name}: ${v.sourceTag}`).join(' · ')}>
              {plural(different.length, 'pessoa está', 'pessoas estão')} com uma cópia diferente da sua. A
              sincronia continua valendo, mas o mesmo segundo pode ser outra cena.
            </Fault>
          </div>
        ) : null}
      </div>
    </section>
  );
}

/* ── the header ───────────────────────────────────────────────────────────
   The connection is the one piece of status that has to be visible before
   anything else: every control on this page is a message to a server, and a
   page that quietly stopped listening looks exactly like a page where nobody
   pressed play. */
function Head({ connected, viewers }: { connected: boolean; viewers: number }) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
      <span className="legend">Sessão</span>
      <span className={cn('q text-[12px]', connected ? 'text-ink-dim' : 'text-dye-red-lit')}>
        {connected ? plural(viewers, 'pessoa na sala', 'pessoas na sala') : 'sem conexão com a sala'}
      </span>
    </div>
  );
}

/* ── choosing the film ──────────────────────────────────────────────────── */
function FilmPicker({ watchlist, onPick }: { watchlist: WatchItem[]; onPick: (id: number) => void }) {
  const [query, setQuery] = useState('');
  const filtering = query.trim().length > 0;
  const shown = filtering
    ? watchlist.filter(w => named(norm(query.trim()), w.title, w.original, w.english))
    : watchlist;

  /* Before the field, not after: an empty queue has nothing to filter, and a
     search box over a "the queue is empty" notice is a control for a list that
     does not exist. */
  if (!watchlist.length) {
    return (
      <Blank title="A fila está vazia">
        A sessão começa por um filme da fila. Marque alguma coisa em <span className="q">Quero ver</span> e
        volte aqui.
      </Blank>
    );
  }

  return (
    <div className="mt-6">
      {/* The same field the queue has, for the same reason: a club that has
          been marking films for a few months is choosing tonight's out of
          eighty posters, and scrolling a wall of them to find the one already
          agreed on in the chat is the errand. Local, because this list is
          already here — nothing to ask the server for. */}
      <div className="mb-5 max-w-[440px]">
        <SearchField
          value={query}
          onChange={setQuery}
          placeholder="Filtrar a fila…"
          hint={filtering ? `${plural(shown.length, 'filme', 'filmes')} na fila` : undefined}
        />
      </div>

      {!shown.length ? (
        <Blank title="Nenhum filme na fila com esse título">Limpe o filtro para ver a fila inteira.</Blank>
      ) : (
      /* No paragraph explaining what pressing a poster does. It opens the
         session, which is the only thing this screen is for, and three lines
         of prose above the posters were the app talking about itself. */
      <div className="grid grid-cols-[repeat(auto-fill,minmax(110px,1fr))] gap-3">
        {shown.map(w => (
          <button
            key={w.id}
            type="button"
            onClick={() => onPick(w.id)}
            className="group text-left"
            title={`Abrir sessão de ${w.title}`}
          >
            <Poster
              src={w.poster}
              alt={w.title}
              className="aspect-[2/3] w-full transition-[box-shadow] duration-150 group-hover:ring-beam/70"
            />
            <span className="mt-2 block text-[12.5px] leading-tight text-ink-dim transition-colors group-hover:text-beam">
              {w.title}
            </span>
          </button>
        ))}
      </div>
      )}
    </div>
  );
}

/* ── choosing the source ──────────────────────────────────────────────────
   One way in: the film itself, dropped or chosen. Everything else this panel
   ever offered was a link, and a link is the thing this product exists not to
   need — somebody hunting one down, pasting it into the chat, and four people
   finding out together that it does not play.

   The field for a direct video URL is gone with the rest. It was the last of
   them and it was the worst: it worked in principle, it worked almost never in
   practice — a public mp4 the whole club can reach is not a thing anybody has —
   and it sat under the drop box implying that the honest path was optional. A
   magnet or a .torrent released here is still understood, because that costs a
   line in `take` and rescues somebody who has one; it is simply never offered. */
function SourcePanel({
  onMagnet,
  onTorrentFile,
  onSeed,
}: {
  onMagnet: (value: string) => void;
  onTorrentFile: (file: File) => void;
  onSeed: (file: File) => void;
}) {
  const [over, setOver] = useState(false);
  /* A file chosen here is the same file dropped on the box: it is seeded to the
     club and the session starts by itself. The dashed box is a target for the
     mouse, not a different feature — clicking and dragging must not be two
     routes with two outcomes. */
  const browse = useRef<HTMLInputElement | null>(null);
  const [refused, setRefused] = useState<string | null>(null);

  const take = useCallback(
    (text: string, file: File | null) => {
      setRefused(null);
      const dropped = text.trim();
      if (dropped && isMagnet(dropped)) return onMagnet(dropped);

      if (!file) {
        return setRefused('Isso não é um magnet nem um arquivo que eu saiba abrir.');
      }
      if (/\.torrent$/i.test(file.name)) return onTorrentFile(file);
      if (file.type.startsWith('video/') || /\.(mp4|m4v|webm|mkv|avi|mov)$/i.test(file.name)) {
        return onSeed(file);
      }
      setRefused(`"${file.name}" não é um vídeo nem um .torrent.`);
    },
    [onMagnet, onSeed, onTorrentFile]
  );

  /* The listener sits on the whole panel and not on the dashed box, so the
     generous release — near the target, in the general direction of it — lands
     where the hand meant it to. The box is what the eye aims at; the panel is
     what actually catches. */
  const catches = {
    onDragOver: (e: React.DragEvent) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      setOver(true);
    },
    onDragLeave: (e: React.DragEvent) => {
      // Only when the pointer left the panel itself, not when it crossed onto
      // a child — which fires `dragleave` and would flicker the whole state.
      if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(false);
    },
    onDrop: (e: React.DragEvent) => {
      e.preventDefault();
      setOver(false);
      take(
        e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text'),
        e.dataTransfer.files?.[0] ?? null
      );
    },
  };

  return (
    <div className="mt-6 max-w-[68ch]" {...catches}>
      <div
        className={cn(
          'rounded-cell border border-dashed px-5 py-8 text-center transition-colors duration-150',
          over ? 'border-dye-brass bg-dye-brass/[0.06]' : 'border-house-rail bg-house-deep/60'
        )}
      >
        {/* Leads with the file because that is the path that works, and it is
            now the only one this box advertises. A magnet or a .torrent
            released here is still understood — that costs a line in `take` and
            saves somebody who has one — but it is no longer offered, because
            offering it sold a promise the browser cannot keep: a magnet from a
            torrent site announces on UDP trackers and DHT, and a tab reaches
            neither. */}
        <p className="font-display text-[15px] uppercase tracking-[0.14em] text-beam">
          Solte o arquivo do filme
        </p>
        <p className="mx-auto mt-2 max-w-[46ch] text-[13px] leading-relaxed text-ink-dim">
          O clube inteiro recebe direto do seu navegador e a sessão começa sozinha. Ninguém precisa colar
          link nenhum.
        </p>

        <div className="mt-4 flex flex-wrap items-center justify-center gap-3">
          <Key onClick={() => browse.current?.click()}>Escolher do computador</Key>
          <span className="q text-[11.5px] text-ink-dim">ou arraste até aqui</span>
        </div>
        <input
          ref={browse}
          type="file"
          accept="video/*,.mkv,.avi,.torrent"
          hidden
          onChange={e => {
            const file = e.target.files?.[0];
            // Cleared so choosing the same file twice still fires a change.
            e.target.value = '';
            if (file) take('', file);
          }}
        />

        {refused ? <p className="q mt-3 text-[11.5px] text-dye-red-lit">{refused}</p> : null}
      </div>
    </div>
  );
}

/* ── what the source is doing ─────────────────────────────────────────────
   In torrent mode this is the only place the difference between "still
   arriving" and "never will" is visible, so it says which one it is in words
   rather than leaving a spinner to imply it. */
function SourceLine({
  source,
  torrent,
  peaked,
}: {
  source: Source;
  torrent: TorrentStatus;
  peaked: boolean;
}) {
  const [warned, setWarned] = useState(() => {
    try {
      return localStorage.getItem(P2P_NOTICE) === '1';
    } catch {
      return true; // storage refused: the notice is not worth an exception
    }
  });

  if (source.kind === 'url') {
    return <span className="q text-[12px] text-ink-dim">URL direta</span>;
  }
  if (source.kind === 'none') return null;

  const gone = peaked && torrent.peers === 0 && torrent.progress < 1 && torrent.phase === 'streaming';

  return (
    <div className="min-w-0 flex-1">
      {torrent.phase === 'error' ? (
        <Fault>{torrent.error}</Fault>
      ) : (
        <span className="q text-[12px] text-ink-dim">
          {torrent.phase === 'booting' && 'Ligando o motor…'}
          {torrent.phase === 'searching' && 'Lendo o link e procurando quem tem o arquivo…'}
          {(torrent.phase === 'streaming' || torrent.phase === 'seeding') &&
            [
              torrent.phase === 'seeding' ? 'semeando' : `${Math.round(torrent.progress * 100)}%`,
              plural(torrent.peers, 'peer', 'peers'),
              torrent.down > 0 ? `↓ ${bytes(torrent.down)}/s` : null,
              torrent.up > 0 ? `↑ ${bytes(torrent.up)}/s` : null,
              torrent.name,
            ]
              .filter(Boolean)
              .join(' · ')}
        </span>
      )}

      {gone ? (
        <p className="q mt-1 text-[11.5px] text-dye-red-lit">
          A fonte saiu do ar — quem estava semeando fechou a aba.
        </p>
      ) : torrent.lonely && torrent.phase !== 'seeding' ? (
        <p className="q mt-1 text-[11.5px] text-dye-red-lit">
          Ninguém está semeando isto. Peça para quem tem o arquivo abrir esta aba e soltar o vídeo aqui.
        </p>
      ) : null}

      {!warned ? (
        <p className="q mt-1 text-[11.5px] text-ink-dim">
          Conexão direta entre navegadores expõe seu IP para os outros peers — é assim em qualquer P2P.{' '}
          <button
            type="button"
            onClick={() => {
              setWarned(true);
              try {
                localStorage.setItem(P2P_NOTICE, '1');
              } catch {
                /* the notice simply returns next time */
              }
            }}
            className="underline underline-offset-2 transition-colors hover:text-beam"
          >
            Entendi
          </button>
        </p>
      ) : null}
    </div>
  );
}

/* ── a knob with a reading on it ──────────────────────────────────────────
   Four pieces of one control, in one shell, divided by hairlines: what it
   adjusts, less, where it stands, more.

   They were four loose things in a row before — a caption in one face, two
   outlined buttons in another, a number floating between them with nothing
   around it — and every group on the line was assembled differently from the
   last, so the eye had to work out which caption owned which buttons. The
   symbols are the same on both knobs for the same reason: `A−`/`A+` next to
   `−0,5s`/`+0,5s` reads as two different kinds of control, and they are not. */
function Stepper({
  label,
  value,
  onLess,
  onMore,
  less,
  more,
}: {
  label: string;
  /** Already formatted: this draws it, it does not know what it means. */
  value: string;
  onLess: () => void;
  onMore: () => void;
  /** What each key does, for anybody who cannot see which way it points. */
  less: string;
  more: string;
}) {
  const key =
    'flex w-8 items-center justify-center border-l border-house-rail font-display text-[15px] leading-none text-ink-dim transition-colors hover:bg-house-seat hover:text-beam';
  return (
    <div className="flex h-[30px] items-stretch overflow-hidden rounded-cell bg-house-deep/70 ring-1 ring-house-rail">
      <span className="flex items-center pl-3 pr-2.5 font-display text-[11px] uppercase leading-none tracking-[0.14em] text-ink-dim">
        {label}
      </span>
      <button type="button" onClick={onLess} aria-label={less} className={key}>
        −
      </button>
      {/* One width for both knobs, wide enough for the longest reading either
          of them can show, so a press moves the number and nothing else. */}
      <span className="q flex min-w-[6ch] items-center justify-center border-l border-house-rail px-1.5 text-[12px] leading-none text-ink">
        {value}
      </span>
      <button type="button" onClick={onMore} aria-label={more} className={key}>
        +
      </button>
    </div>
  );
}

/* ── subtitles ────────────────────────────────────────────────────────────
   The file is the club's — one person finds it and everybody's player loads
   it. The two adjustments are not, and the split is deliberate:

   - the offset belongs to your *copy of the film*. Two members watching
     different rips need different shifts, and one person's correction pushed
     onto everybody would break the three it was not measured against;
   - the size belongs to your *screen*, which the room knows nothing about.

   So one file, and two knobs that never leave the browser they are turned in. */
function SubtitleBar({
  subtitle,
  on,
  offset,
  size,
  onImport,
  onToggle,
  onNudge,
  onResize,
  onClear,
}: {
  subtitle: { url: string; label: string } | null;
  on: boolean;
  offset: number;
  size: number;
  onImport: (file: File) => void;
  onToggle: () => void;
  onNudge: (by: number) => void;
  onResize: (by: number) => void;
  onClear: () => void;
}) {
  return (
    /* No top margin of its own: it is the first row inside the booth plate,
       and the plate's padding is what stands it off the edge. */
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
      {subtitle ? (
        <>
          {/* ── the lamp ────────────────────────────────────────────────────
              The label used to be the state — "Legenda ligada" becoming
              "Legenda desligada" — which is two words longer in one position
              than the other, so pressing it shoved everything to its right
              along the row. A lamp says the same thing in a fixed width, and
              the room already has one: red, lit, the colour this product uses
              for something that is running. */}
          <button
            type="button"
            aria-pressed={on}
            onClick={onToggle}
            title={on ? 'Legenda ligada' : 'Legenda desligada'}
            className={cn(
              'flex h-[30px] items-center gap-2 rounded-cell px-3 font-display text-[11px] uppercase leading-none tracking-[0.14em] ring-1 transition-colors',
              on
                ? 'bg-dye-red/15 text-dye-red-lit ring-dye-red-lit/45'
                : 'text-ink-dim ring-house-rail hover:text-ink hover:ring-white/20'
            )}
          >
            <span
              aria-hidden
              className={cn(
                'h-1.5 w-1.5 rounded-full transition-colors',
                on ? 'bg-dye-red-lit shadow-[0_0_7px_rgba(242,86,74,0.85)]' : 'bg-ink-faint'
              )}
            />
            Legenda
          </button>

          <Stepper
            label="Sincronia"
            value={`${offset > 0 ? '+' : ''}${offset.toFixed(1).replace('.', ',')}s`}
            onLess={() => onNudge(-0.5)}
            onMore={() => onNudge(0.5)}
            less="Adiantar a legenda meio segundo"
            more="Atrasar a legenda meio segundo"
          />

          {/* The percentage is there to be read back, not to be aimed at. */}
          <Stepper
            label="Tamanho"
            value={`${size}%`}
            onLess={() => onResize(-SUB_SIZE_STEP)}
            onMore={() => onResize(SUB_SIZE_STEP)}
            less="Diminuir a legenda"
            more="Aumentar a legenda"
          />

          {/* What the file is called and how to be rid of it: the two things
              here that are about the subtitle rather than about watching it,
              so they go to the far end and stop sitting between the knobs. */}
          <div className="ml-auto flex items-center gap-3">
            <span className="q max-w-[22ch] truncate text-[11.5px] text-ink-dim" title={subtitle.label}>
              {subtitle.label}
            </span>
            <button
              type="button"
              onClick={onClear}
              className="font-display text-[11px] uppercase leading-none tracking-[0.14em] text-ink-dim transition-colors hover:text-dye-red-lit"
            >
              Remover
            </button>
          </div>
        </>
      ) : (
        <label className="flex flex-wrap items-center gap-3">
          <span className="legend">Legenda</span>
          <input
            type="file"
            accept=".srt,.vtt,text/vtt,application/x-subrip"
            onChange={e => {
              const file = e.target.files?.[0];
              if (file) onImport(file);
              // Cleared so choosing the same file twice still fires a change.
              e.target.value = '';
            }}
            className="max-w-full text-[12px] text-ink-dim file:mr-3 file:rounded-cell file:border-0 file:bg-house-seat file:px-3 file:py-2 file:font-display file:text-[12px] file:uppercase file:tracking-[0.12em] file:text-ink"
          />
          <span className="q text-[11.5px] text-ink-dim">.srt ou .vtt — vai para o clube inteiro</span>
        </label>
      )}
    </div>
  );
}

