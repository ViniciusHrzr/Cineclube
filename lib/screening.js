const MAX_TEXT = 1024;
const MAX_STREAMS_PER_VIEWER = 3;
const MAX_STREAMS_TOTAL = 20;
const RATE_WINDOW_MS = 5000;
const RATE_MAX = 10;
const PING_MS = 20_000;
const SYNC_MS = 5000;

const LIVE_GRACE_MS = 60_000;

const RUNTIME_SLACK_SECONDS = 900;

const COMMANDS = new Set(['play', 'pause', 'seek']);

const SIGNALS = new Set(['want', 'offer', 'answer', 'ice']);
const MAX_SIGNAL = 16 * 1024;
const SIGNAL_WINDOW_MS = 10_000;
const SIGNAL_MAX = 400;

const URL_SCHEMES = new Set(['http:', 'https:', 'blob:', 'magnet:']);

const LINK_SCHEMES = new Set(['http:', 'https:', 'magnet:']);
const MAX_LINK = 4096;

const MAX_SUBTITLE = 512 * 1024;

function blankRoom(clubId) {
  return {
    clubId,
    open: false,
    movie: null,
    status: 'paused',
    position: 0,
    updatedAt: Date.now(),
    revision: 0,
    host: null,
    link: null,
    subtitle: null,
    live: null,
    viewers: new Map(),
    streams: new Map(),
  };
}

const rooms = new Map();

function roomFor(clubId) {
  let held = rooms.get(clubId);
  if (!held) {
    held = blankRoom(clubId);
    rooms.set(clubId, held);
  }
  return held;
}

function sweep(room) {
  if (room.open || room.streams.size || room.viewers.size) return;
  rooms.delete(room.clubId);
}

function durationSeconds(room) {
  const minutes = room.movie?.runtime;
  return Number.isFinite(minutes) && minutes > 0 ? minutes * 60 : null;
}

function positionAt(room, now = Date.now()) {
  if (room.status !== 'playing') return room.position;
  const elapsed = (now - room.updatedAt) / 1000;
  return clampPosition(room, room.position + elapsed);
}

function clampPosition(room, seconds) {
  const n = Number(seconds);
  if (!Number.isFinite(n) || n < 0) return 0;
  const duration = durationSeconds(room);
  const ceiling = duration == null ? Number.MAX_SAFE_INTEGER : duration + RUNTIME_SLACK_SECONDS;
  return Math.min(n, ceiling);
}

function text(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, MAX_TEXT);
}

function isAllowedSource(value) {
  const t = text(value);
  if (!t) return false;
  try {
    return URL_SCHEMES.has(new URL(t).protocol);
  } catch {
    return /^[\w:.\-]{1,128}$/.test(t);
  }
}

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

function stamp(room, now) {
  room.updatedAt = now;
  room.revision += 1;
}

function open(room, movie, host = null, now = Date.now()) {
  room.open = true;
  room.movie = movie;
  room.host = host;
  room.status = 'paused';
  room.position = 0;
  room.link = null;
  room.subtitle = null;
  room.live = null;
  stamp(room, now);
  broadcastState(room);
}

function setLink(room, link, now = Date.now()) {
  if (link !== null && !isShareableLink(link)) return false;
  room.link = link === null ? null : link.trim();
  stamp(room, now);
  broadcastState(room);
  return true;
}

function setSubtitle(room, subtitle, now = Date.now()) {
  if (subtitle === null) {
    room.subtitle = null;
    stamp(room, now);
    broadcastState(room);
    return true;
  }
  const name = text(subtitle?.name);
  const vtt = typeof subtitle?.vtt === 'string' ? subtitle.vtt : null;
  if (!name || !vtt || !vtt.trim() || vtt.length > MAX_SUBTITLE) return false;

  stamp(room, now);
  room.subtitle = { id: room.revision, name, vtt };
  broadcastState(room);
  return true;
}

function startLive(room, session, now = Date.now()) {
  if (room.live && room.live.hostId !== session.reviewer_id) return false;
  room.liveAwol = null;
  room.live = {
    hostId: session.reviewer_id,
    hostName: session.name,
    hostDot: session.dot,
    since: now,
  };
  stamp(room, now);
  broadcastState(room);
  return true;
}

function stopLive(room, reviewerId, now = Date.now()) {
  if (!room.live || room.live.hostId !== reviewerId) return false;
  room.live = null;
  stamp(room, now);
  broadcastState(room);
  return true;
}

function signal(room, fromId, toId, kind, data) {
  if (!SIGNALS.has(kind)) return false;
  if (!room.viewers.has(fromId) || !room.viewers.has(toId)) return false;
  const payload = JSON.stringify(data ?? null);
  if (payload.length > MAX_SIGNAL) return false;
  return sendTo(room, toId, { type: 'signal', from: fromId, kind, data }) > 0;
}

function close(room, now = Date.now()) {
  room.open = false;
  room.movie = null;
  room.host = null;
  room.status = 'paused';
  room.position = 0;
  room.link = null;
  room.subtitle = null;
  room.live = null;
  for (const viewer of room.viewers.values()) {
    viewer.ready = true;
    viewer.sourceTag = null;
  }
  stamp(room, now);
  broadcastState(room);
}

function play(room, at, now = Date.now()) {
  room.position = at == null ? positionAt(room, now) : clampPosition(room, at);
  room.status = 'playing';
  stamp(room, now);
  broadcastState(room);
}

function pause(room, at, now = Date.now()) {
  room.position = at == null ? positionAt(room, now) : clampPosition(room, at);
  room.status = 'paused';
  stamp(room, now);
  broadcastState(room);
}

function seek(room, to, now = Date.now()) {
  room.position = clampPosition(room, to);
  stamp(room, now);
  broadcastState(room);
}

function isHost(room, reviewerId) {
  return !room.host || room.host.id === reviewerId;
}

function command(room, type, position, now = Date.now()) {
  if (!COMMANDS.has(type)) return false;
  if (!room.open) return false;
  if (type === 'play') play(room, position, now);
  else if (type === 'pause') pause(room, position, now);
  else seek(room, position, now);
  return true;
}

function setReady(room, reviewerId, ready, sourceTag) {
  const viewer = room.viewers.get(reviewerId);
  if (!viewer) return;

  viewer.ready = ready !== false;
  if (sourceTag !== undefined) {
    viewer.sourceTag = isAllowedSource(sourceTag) ? text(sourceTag) : null;
  }

  broadcastState(room);
}

function attach(room, session) {
  const existing = room.viewers.get(session.reviewer_id);
  if (existing) {
    existing.streams += 1;
    return existing;
  }
  const viewer = {
    id: session.reviewer_id,
    name: session.name,
    dot: session.dot,
    ready: true,
    sourceTag: null,
    streams: 1,
    since: Date.now(),
  };
  room.viewers.set(session.reviewer_id, viewer);
  if (room.live?.hostId === session.reviewer_id) room.liveAwol = null;
  broadcastState(room);
  return viewer;
}

function detach(room, reviewerId, now = Date.now()) {
  const viewer = room.viewers.get(reviewerId);
  if (!viewer) return;
  viewer.streams -= 1;
  if (viewer.streams > 0) return;
  room.viewers.delete(reviewerId);
  if (room.live?.hostId === reviewerId) room.liveAwol = now;
  if (room.host?.id === reviewerId) {
    const next = room.viewers.values().next().value;
    room.host = next ? { id: next.id, name: next.name, dot: next.dot } : null;
  }
  broadcastState(room);
  sweep(room);
}

function snapshot(room, now = Date.now()) {
  return {
    type: 'state',
    open: room.open,
    movie: room.movie,
    host: room.host,
    status: room.status,
    position: positionAt(room, now),
    revision: room.revision,
    link: room.link,
    subtitle: room.subtitle ? { id: room.subtitle.id, name: room.subtitle.name } : null,
    live: room.live,
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

function write(res, payload) {
  try {
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  } catch {
  }
}

function broadcastState(room) {
  if (!room.streams.size) return;
  const frame = snapshot(room);
  for (const res of room.streams.keys()) write(res, frame);
}

function sendTo(room, reviewerId, payload) {
  let delivered = 0;
  for (const [res, id] of room.streams) {
    if (id !== reviewerId) continue;
    write(res, payload);
    delivered += 1;
  }
  return delivered;
}

function totalStreams() {
  let n = 0;
  for (const r of rooms.values()) n += r.streams.size;
  return n;
}

function canSubscribe(room, reviewerId) {
  if (totalStreams() >= MAX_STREAMS_TOTAL) return false;
  const viewer = room.viewers.get(reviewerId);
  return !viewer || viewer.streams < MAX_STREAMS_PER_VIEWER;
}

function subscribe(room, res, reviewerId) {
  room.streams.set(res, reviewerId);
  write(res, snapshot(room));
}

function unsubscribe(room, res) {
  room.streams.delete(res);
}

let timers = null;

function startTimers() {
  if (timers) return;
  timers = [
    setInterval(() => {
      for (const room of rooms.values()) {
        for (const res of room.streams) {
          try { res.write(': ping\n\n'); } catch { }
        }
      }
    }, PING_MS),
    setInterval(() => {
      const now = Date.now();
      expireAwol(now);
      for (const room of rooms.values()) {
        if (!room.streams.size || !room.open) continue;
        const frame = {
          type: 'sync',
          status: room.status,
          position: positionAt(room, now),
          revision: room.revision,
          serverTime: now,
        };
        for (const res of room.streams) write(res, frame);
      }
    }, SYNC_MS),
  ];
  timers.forEach(t => t.unref?.());
}

function expireAwol(now = Date.now()) {
  for (const room of rooms.values()) {
    if (!room.live || !room.liveAwol) continue;
    if (now - room.liveAwol <= LIVE_GRACE_MS) continue;
    room.live = null;
    room.liveAwol = null;
    stamp(room, now);
    broadcastState(room);
    sweep(room);
  }
}

function stopTimers() {
  timers?.forEach(clearInterval);
  timers = null;
}

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

const signalBuckets = new Map();

function withinSignalRate(reviewerId, now = Date.now()) {
  const bucket = signalBuckets.get(reviewerId);
  if (!bucket || now - bucket.since > SIGNAL_WINDOW_MS) {
    signalBuckets.set(reviewerId, { count: 1, since: now });
    return true;
  }
  bucket.count += 1;
  return bucket.count <= SIGNAL_MAX;
}

function reset() {
  rooms.clear();
  buckets.clear();
  signalBuckets.clear();
}

module.exports = {
  MAX_TEXT,
  MAX_LINK,
  MAX_SUBTITLE,
  MAX_STREAMS_PER_VIEWER,
  MAX_STREAMS_TOTAL,
  COMMANDS,
  roomFor,
  positionAt,
  clampPosition,
  text,
  isAllowedSource,
  isShareableLink,
  setLink,
  setSubtitle,
  startLive,
  stopLive,
  expireAwol,
  LIVE_GRACE_MS,
  signal,
  sendTo,
  open,
  close,
  play,
  pause,
  seek,
  command,
  isHost,
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
  withinSignalRate,
  MAX_SIGNAL,
  reset,
};
