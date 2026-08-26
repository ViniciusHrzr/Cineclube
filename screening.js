/* ══════════════════════════════════════════════════════════════════════════
   The screening room.

   The club watches together on Discord, each member in their own browser, and
   until now the synchronising was a person counting "3, 2, 1, play" in the
   chat — which holds until the first pause. This module is the thing that
   replaces that count.

   One room, because the club is one club. It lives in memory and not in the
   database: a screening is the two hours it is happening, and a restart of the
   server ends it. That is honest rather than lossy — on the free instance a
   cold start would end it anyway, and a table would only record that a
   screening which no longer has any viewers once existed.

   ── the one idea in here ──────────────────────────────────────────────────
   The position is never stored ticking. What is stored is a position and the
   instant it was true, and the current position is derived from those two on
   demand. A room that stored a counter would need a timer to advance it, every
   tick would be a chance to drift, and a client that reconnected between ticks
   would get a stale number. Derived, there is nothing to drift: every reader
   computes the same answer from the same two fields, and a client that has
   been away for an hour computes it just as correctly as one that never left.

   Everything a client sends is validated here rather than on the screen. This
   state is shared and it is broadcast: one bad request does not break one
   browser, it breaks everybody's. A NaN written into `position` would poison
   the derivation for the whole club at once.
   ══════════════════════════════════════════════════════════════════════════ */

/* ── ceilings ─────────────────────────────────────────────────────────────
   Every one of these exists because the room fans out: a single request is
   re-emitted to every open connection, so anything unbounded on the way in is
   an amplifier on the way out. The instance this runs on has 512 MB. */

/** Magnets, URLs and source tags. Long enough for a magnet with trackers. */
const MAX_TEXT = 1024;
/** Per member. Enough for a second tab and a stale one that has not closed. */
const MAX_STREAMS_PER_VIEWER = 3;
/** The club is four people. Twenty is already generous. */
const MAX_STREAMS_TOTAL = 20;
const RATE_WINDOW_MS = 5000;
const RATE_MAX = 10;
/** Keeps the proxy from closing a connection it thinks has gone quiet. */
const PING_MS = 20_000;
/** The unprompted correction: late and drifting clients converge on this. */
const SYNC_MS = 5000;

/* ── damping ──────────────────────────────────────────────────────────────
   Auto-pause and auto-resume are a control loop with four browsers, a swarm
   and a film inside it, and an undamped control loop oscillates: the room
   resumes, the thinnest copy is still thin, it stalls, the room pauses, a
   little arrives, the room resumes. Two seconds a cycle, all evening. The
   club watched exactly that.

   The player's cushion is the first damper and the honest one — it resumes on
   a measurement rather than on a flicker. These two are the second, and they
   exist because they are the only ones a wrong client cannot defeat: having
   just let go of a stall the room will not seize on another for a while, and
   a film that has stopped itself this many times has proved the mechanism is
   not earning its keep tonight.

   Both leave the struggling member behind rather than holding the room. That
   is the right way round: they are still on the board, still marked buffering,
   and the club can see it and decide — which is a thing four people can act
   on, unlike a picture that will not stay still. */
const STALL_COOLDOWN_MS = 15_000;
const MAX_AUTO_PAUSES = 6;
/* A file usually runs longer than the runtime TMDB reports — different cuts,
   credits, an extra frame of black. The clamp is a guard against nonsense, not
   a statement about the film, so it leaves room. */
const RUNTIME_SLACK_SECONDS = 900;

const COMMANDS = new Set(['play', 'pause', 'seek']);

/* Anything that ends up in a `src`, or beside one. `javascript:` and `data:`
   are the two that turn a shared string into somebody else's code, and the
   room hands every string it accepts to every other member's browser. */
const URL_SCHEMES = new Set(['http:', 'https:', 'blob:', 'magnet:']);

/* The link the room hands to whoever arrives. Narrower than the set above:
   `blob:` is a reference into one browser's memory, so sharing one would be
   handing everybody else a URL that resolves to nothing in their tab. */
const LINK_SCHEMES = new Set(['http:', 'https:', 'magnet:']);
/* A magnet with a full tracker list runs past a kilobyte — the one the club
   pasted was 1.3 kB — and a truncated magnet is not a shorter magnet, it is a
   broken one. So links get their own ceiling and are refused rather than cut. */
const MAX_LINK = 4096;

/* A feature film's subtitles are 40 to 120 kB of WebVTT. This leaves room for a
   long one with heavy formatting and still refuses anything that is plainly not
   a subtitle file — someone's .mkv renamed, a log, a mistake. Refused whole,
   like a link: half a subtitle file is not a shorter subtitle file. Note the
   body parser in front of this accepts 1 MB, so the ceiling that actually
   matters is this one. */
const MAX_SUBTITLE = 512 * 1024;

const room = {
  open: false,
  movie: null,
  status: 'paused',
  /** Seconds. True as of `updatedAt`, not as of now — see the header. */
  position: 0,
  updatedAt: Date.now(),
  /** Bumped by every mutation, so a client can drop a frame that overtook it. */
  revision: 0,
  /* What the club is watching from, when that is a thing that can be handed
     over: a magnet or a URL. Null while nobody has one, and null forever for a
     file on somebody's disk — those bytes cannot be shared by naming them. */
  link: null,
  /* The club's subtitle: `{ id, name, vtt }`, or null while there is none.
     Unlike the link this is the content and not a pointer to it, because there
     is nowhere else for it to live — the file came off somebody's disk. What
     the snapshot carries is still only a pointer; see `snapshot`. */
  subtitle: null,
  /* Whether the current pause was the buffering wheel rather than a person.
     Only a pause the room caused itself may be undone by the room itself. */
  pausedByStall: false,
  /** When the room last released itself from a stall. Zero: it never has. */
  resumedAt: 0,
  /** How many times it has stopped itself for this film. See the damping. */
  autoPauses: 0,
  viewers: new Map(),
};

/* ── derivation ───────────────────────────────────────────────────────────── */

function durationSeconds() {
  const minutes = room.movie?.runtime;
  return Number.isFinite(minutes) && minutes > 0 ? minutes * 60 : null;
}

/** Where the film is, right now. The whole point of the module. */
function positionAt(now = Date.now()) {
  if (room.status !== 'playing') return room.position;
  const elapsed = (now - room.updatedAt) / 1000;
  return clampPosition(room.position + elapsed);
}

/** Refuses NaN and Infinity, and keeps the number inside the film. */
function clampPosition(seconds) {
  const n = Number(seconds);
  if (!Number.isFinite(n) || n < 0) return 0;
  const duration = durationSeconds();
  const ceiling = duration == null ? Number.MAX_SAFE_INTEGER : duration + RUNTIME_SLACK_SECONDS;
  return Math.min(n, ceiling);
}

/** Trims and caps a string a member sent. Null for anything else. */
function text(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, MAX_TEXT);
}

/** A source string is only allowed if its scheme is one we chose to allow. */
function isAllowedSource(value) {
  const t = text(value);
  if (!t) return false;
  try {
    return URL_SCHEMES.has(new URL(t).protocol);
  } catch {
    // Not a URL at all. A bare source tag (an infohash, a size:duration pair)
    // is legitimate and carries no scheme, so it is judged by shape instead.
    return /^[\w:.\-]{1,128}$/.test(t);
  }
}

/** A link worth handing to somebody else's browser. Refused, never trimmed. */
function isShareableLink(value) {
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > MAX_LINK) return false;
  try {
    return LINK_SCHEMES.has(new URL(trimmed).protocol);
  } catch {
    return false;
  }
}

/* ── mutation ─────────────────────────────────────────────────────────────
   Every one of these fixes the position as it stands before changing anything,
   which is what makes "pause" mean "pause here" rather than "pause at whatever
   the last command said". */

function stamp(now) {
  room.updatedAt = now;
  room.revision += 1;
}

function open(movie, now = Date.now()) {
  room.open = true;
  room.movie = movie;
  room.status = 'paused';
  room.position = 0;
  room.pausedByStall = false;
  // Both budgets are per film: a new evening starts with the room trusting
  // the wheel again, however badly the last one went.
  room.resumedAt = 0;
  room.autoPauses = 0;
  // A link belongs to the film it was opened for, never to the next one. So
  // does a subtitle, and rather more obviously.
  room.link = null;
  room.subtitle = null;
  stamp(now);
  broadcastState();
}

/* ── the source, once it can be handed over ───────────────────────────────
   The room synchronises control, not video — but a member who arrives after
   everyone has settled in used to face an empty picker and a question ("what
   are you all watching?") that the room already knew the answer to. So the
   first person to point at something shareable leaves the pointer here, and
   everybody who arrives afterwards loads it without being told.

   Passing `null` clears it, which is what happens when the source turns out to
   be a file on one person's disk: there is nothing to hand over, and a stale
   pointer is worse than none. */
function setLink(link, now = Date.now()) {
  if (link !== null && !isShareableLink(link)) return false;
  room.link = link === null ? null : link.trim();
  stamp(now);
  broadcastState();
  return true;
}

/* ── the subtitle the club shares ─────────────────────────────────────────
   The one thing on this screen that is small enough to travel. The film cannot
   — it is gigabytes and it stays on the disk it came from — but the subtitles
   are a hundred kilobytes of text, and asking four people to each go and find
   the same .srt is the same friction as asking them to each paste the same
   magnet.

   What is shared is the file, not the timing. The offset stays with each
   member because it is a fact about *their* copy of the film: two people
   watching different rips of the same title need different shifts, and one
   person's correction applied to everybody would break the three it was not
   measured against.

   Passing `null` clears it for everyone, which is what "Remover" now means —
   the subtitle belongs to the room, so leaving one member's screen is not a
   thing it can do. */
function setSubtitle(subtitle, now = Date.now()) {
  if (subtitle === null) {
    room.subtitle = null;
    stamp(now);
    broadcastState();
    return true;
  }
  const name = text(subtitle?.name);
  const vtt = typeof subtitle?.vtt === 'string' ? subtitle.vtt : null;
  if (!name || !vtt || !vtt.trim() || vtt.length > MAX_SUBTITLE) return false;

  stamp(now);
  /* Identified by the revision it arrived on, which is already monotonic. A
     client compares it against the one it holds and fetches only on a
     difference — including the difference between "no subtitle" and "one it
     has never seen", which is how somebody arriving mid-film gets it. */
  room.subtitle = { id: room.revision, name, vtt };
  broadcastState();
  return true;
}

function close(now = Date.now()) {
  room.open = false;
  room.movie = null;
  room.status = 'paused';
  room.position = 0;
  room.pausedByStall = false;
  room.resumedAt = 0;
  room.autoPauses = 0;
  room.link = null;
  room.subtitle = null;
  // The viewers survive: they are the people with a connection open, and
  // closing the film does not disconnect anybody.
  for (const viewer of room.viewers.values()) {
    viewer.ready = true;
    viewer.sourceTag = null;
  }
  stamp(now);
  broadcastState();
}

function play(at, now = Date.now()) {
  room.position = at == null ? positionAt(now) : clampPosition(at);
  room.status = 'playing';
  // A person pressing play answers the stall, whatever the wheel is doing.
  room.pausedByStall = false;
  stamp(now);
  broadcastState();
}

function pause(at, now = Date.now()) {
  room.position = at == null ? positionAt(now) : clampPosition(at);
  room.status = 'paused';
  room.pausedByStall = false;
  stamp(now);
  broadcastState();
}

function seek(to, now = Date.now()) {
  room.position = clampPosition(to);
  // Status is deliberately untouched: dragging the bar while the film runs
  // should land you somewhere else in a film that is still running.
  stamp(now);
  broadcastState();
}

/** Applies a command a member sent. Returns false if it was not a real one. */
function command(type, position, now = Date.now()) {
  if (!COMMANDS.has(type)) return false;
  if (!room.open) return false;
  if (type === 'play') play(position, now);
  else if (type === 'pause') pause(position, now);
  else seek(position, now);
  return true;
}

/* ── the buffering wheel ──────────────────────────────────────────────────
   One member's connection stalling is the whole club's problem: carrying on
   without them is exactly the desynchronisation this module exists to stop. So
   a stall pauses everybody, and — because it was the room that paused, not a
   person — the room may start again by itself once everyone can play.

   Mas isto só vale para quem está VENDO. A sala parava sozinha o tempo todo, e
   o motivo era este mecanismo disparando por gente que ainda nem tinha imagem:
   quem abria a aba no meio do filme parava os outros três antes de ter
   carregado o primeiro quadro. Chegar não é travar, e um filme que não foi
   aberto não trava — ver `watching` abaixo e `joinedIn` no SyncedVideo.

   The flag is what keeps that from being presumptuous. A person pausing at any
   point clears it, and from then on nothing resumes without somebody saying so. */
function setReady(reviewerId, ready, sourceTag, now = Date.now()) {
  const viewer = room.viewers.get(reviewerId);
  if (!viewer) return;

  viewer.ready = ready !== false;
  if (sourceTag !== undefined) {
    viewer.sourceTag = isAllowedSource(sourceTag) ? text(sourceTag) : null;
  }

  /* ── quem conta para a roda ─────────────────────────────────────────────
     Só quem tem um filme aberto. Não se trava num filme que não se abriu, e
     estar na sala com o seletor de fonte na tela — escolhendo o arquivo,
     esperando um magnet resolver, ou só de bobeira com a aba aberta — não é
     estar vendo.

     Vale nos dois sentidos, e o segundo importa tanto quanto o primeiro: quem
     não conta para pausar também não conta para impedir a sala de voltar. Sem
     isso, uma pessoa sem fonte marcada como não-pronta seguraria o filme parado
     para todo mundo sem ter nem como destravar.

     A outra metade desta regra mora no cliente, onde há informação que aqui não
     chega: chegar não é travar — ver `joinedIn` em SyncedVideo. */
  const watching = v => !!v.sourceTag;
  const everyoneReady = [...room.viewers.values()].filter(watching).every(v => v.ready);

  if (!viewer.ready && watching(viewer) && room.status === 'playing') {
    if (mayAutoPause(now)) {
      room.position = positionAt(now);
      room.status = 'paused';
      room.pausedByStall = true;
      room.autoPauses += 1;
      stamp(now);
    }
    /* Refused: the room keeps running and this member is left behind, marked
       buffering on the board. Their own player closes the gap by seeking. */
  } else if (everyoneReady && room.pausedByStall && room.status === 'paused') {
    room.status = 'playing';
    room.pausedByStall = false;
    room.resumedAt = now;
    stamp(now);
  }

  broadcastState();
}

/** Whether the room is still allowed to stop itself. See the damping above. */
function mayAutoPause(now) {
  if (room.autoPauses >= MAX_AUTO_PAUSES) return false;
  return now - room.resumedAt >= STALL_COOLDOWN_MS;
}

/* ── who is in the room ───────────────────────────────────────────────────
   Counted by connection and not by person, because one member with the app
   open in two tabs is one member: removing them when the first tab closes
   would empty the room out from under somebody who is still watching. */

function attach(session) {
  const existing = room.viewers.get(session.reviewer_id);
  if (existing) {
    // A second tab is not a second person, and nothing about the room changed.
    existing.streams += 1;
    return existing;
  }
  const viewer = {
    id: session.reviewer_id,
    name: session.name,
    dot: session.dot,
    /* Ready until they say otherwise. The alternative — arriving unready —
       would mean a member opening the tab mid-film pauses everyone else before
       they have even chosen a source. */
    ready: true,
    sourceTag: null,
    streams: 1,
    since: Date.now(),
  };
  room.viewers.set(session.reviewer_id, viewer);
  /* Somebody arriving is news for the people already here. Without this the
     room only redraws on the next change, so a member who joined during a quiet
     stretch stayed invisible until somebody pressed something — and the sync
     frames carry no viewers, so the wait could be the whole film. Leaving
     already announces itself in `detach`; arriving has to as well. */
  broadcastState();
  return viewer;
}

function detach(reviewerId, now = Date.now()) {
  const viewer = room.viewers.get(reviewerId);
  if (!viewer) return;
  viewer.streams -= 1;
  if (viewer.streams > 0) return;
  room.viewers.delete(reviewerId);
  /* Somebody leaving can be what unblocks the room: if the club was held on
     their buffering wheel, the wheel left with them. */
  /* A sala tem de continuar tendo gente — não se retoma uma sessão vazia — mas
     quem julga a retomada é só quem tem filme aberto, a mesma regra do
     `setReady`. Ninguém segurando é ninguém segurando. */
  const holding = [...room.viewers.values()].filter(v => !!v.sourceTag);
  if (room.pausedByStall && room.viewers.size && holding.every(v => v.ready)) {
    room.status = 'playing';
    room.pausedByStall = false;
    room.resumedAt = now;
    stamp(now);
  }
  broadcastState();
}

/* ── what a client is told ────────────────────────────────────────────────── */

function snapshot(now = Date.now()) {
  return {
    type: 'state',
    open: room.open,
    movie: room.movie,
    status: room.status,
    position: positionAt(now),
    revision: room.revision,
    pausedByStall: room.pausedByStall,
    link: room.link,
    /* The announcement, not the file. This snapshot is re-emitted on every
       mutation the room has — every play, every seek, every buffer report from
       every member — and a hundred kilobytes of subtitle riding on each of
       those, multiplied by everyone connected, is precisely the fan-out the
       ceilings at the top of this file exist to prevent. So the room says
       *that* there is a subtitle and which one; whoever does not have it
       fetches it once, over HTTP, from `GET /api/screening/subtitle`. */
    subtitle: room.subtitle ? { id: room.subtitle.id, name: room.subtitle.name } : null,
    // The client measures its own offset against this; without it, one member
    // with a crooked clock drifts permanently and nothing can tell why.
    serverTime: now,
    viewers: [...room.viewers.values()].map(v => ({
      id: v.id,
      name: v.name,
      dot: v.dot,
      ready: v.ready,
      sourceTag: v.sourceTag,
    })),
  };
}

/* ── the fan-out ──────────────────────────────────────────────────────────
   Server-sent events rather than a socket: this needs the server to speak and
   the client to occasionally answer, which is exactly the shape SSE has, and
   it costs no dependency, no change to how the app is started, and nothing in
   the tests that import it. EventSource also reconnects on its own, which
   matters on an instance that sleeps.

   A pleasant side effect: an open stream is an open request, so the free
   instance does not idle out in the middle of a film. */

const streams = new Set();

function write(res, payload) {
  try {
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  } catch {
    // A connection that died between the check and the write is not an error
    // worth failing a broadcast over; the close handler will collect it.
  }
}

function broadcastState() {
  if (!streams.size) return;
  const frame = snapshot();
  for (const res of streams) write(res, frame);
}

/** True when there is room for one more connection. */
function canSubscribe(reviewerId) {
  if (streams.size >= MAX_STREAMS_TOTAL) return false;
  const viewer = room.viewers.get(reviewerId);
  return !viewer || viewer.streams < MAX_STREAMS_PER_VIEWER;
}

function subscribe(res) {
  streams.add(res);
  write(res, snapshot());
}

function unsubscribe(res) {
  streams.delete(res);
}

/* Two heartbeats with two different jobs. The comment ping is for the proxy in
   front of the app, which closes a connection it believes has gone silent. The
   sync frame is for the players: it is the room stating where the film is, so
   a client that drifted, or joined late, or came back from a locked phone,
   converges without having to ask. */
let timers = null;

function startTimers() {
  if (timers) return;
  timers = [
    setInterval(() => {
      for (const res of streams) {
        try { res.write(': ping\n\n'); } catch { /* collected on close */ }
      }
    }, PING_MS),
    setInterval(() => {
      if (!streams.size || !room.open) return;
      const now = Date.now();
      const frame = {
        type: 'sync',
        status: room.status,
        position: positionAt(now),
        revision: room.revision,
        serverTime: now,
      };
      for (const res of streams) write(res, frame);
    }, SYNC_MS),
  ];
  // Timers must not be the reason the process refuses to exit — the tests
  // import this module and then expect `node --test` to finish.
  timers.forEach(t => t.unref?.());
}

function stopTimers() {
  timers?.forEach(clearInterval);
  timers = null;
}

/* ── rate limiting ────────────────────────────────────────────────────────
   A member holding the seek bar generates a command per frame, and every one
   of them is re-emitted to everyone. The bucket is per person and deliberately
   crude: it exists to stop a runaway loop, not to police ordinary use. */

const buckets = new Map();

function withinRate(reviewerId, now = Date.now()) {
  const bucket = buckets.get(reviewerId);
  if (!bucket || now - bucket.since > RATE_WINDOW_MS) {
    buckets.set(reviewerId, { count: 1, since: now });
    return true;
  }
  bucket.count += 1;
  return bucket.count <= RATE_MAX;
}

/** Tests only: puts the room back to how it boots. */
function reset() {
  room.open = false;
  room.movie = null;
  room.status = 'paused';
  room.position = 0;
  room.updatedAt = Date.now();
  room.revision = 0;
  room.pausedByStall = false;
  room.resumedAt = 0;
  room.autoPauses = 0;
  room.link = null;
  room.subtitle = null;
  room.viewers.clear();
  streams.clear();
  buckets.clear();
}

module.exports = {
  MAX_TEXT,
  MAX_LINK,
  MAX_SUBTITLE,
  MAX_STREAMS_PER_VIEWER,
  MAX_STREAMS_TOTAL,
  COMMANDS,
  room,
  positionAt,
  clampPosition,
  text,
  isAllowedSource,
  isShareableLink,
  setLink,
  setSubtitle,
  open,
  close,
  play,
  pause,
  seek,
  command,
  setReady,
  attach,
  detach,
  snapshot,
  canSubscribe,
  subscribe,
  unsubscribe,
  startTimers,
  stopTimers,
  withinRate,
  reset,
};
