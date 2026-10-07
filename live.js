const MAX_STREAMS_TOTAL = 24;
const MAX_STREAMS_PER_VIEWER = 3;
const PING_MS = 20_000;

const KINDS = new Set(['social', 'reviews', 'watchlist', 'reviewers', 'screening', 'club', 'shows']);

const streams = new Set();

function write(entry, payload) {
  try {
    entry.res.write(`data: ${JSON.stringify(payload)}\n\n`);
  } catch {
  }
}

function countFor(reviewerId) {
  let n = 0;
  for (const entry of streams) if (entry.reviewerId === reviewerId) n += 1;
  return n;
}

function canSubscribe(reviewerId) {
  return streams.size < MAX_STREAMS_TOTAL && countFor(reviewerId) < MAX_STREAMS_PER_VIEWER;
}

function subscribe(res, reviewerId, clubId) {
  const entry = { res, reviewerId, clubId };
  streams.add(entry);
  write(entry, { kind: 'hello', at: Date.now() });
  return entry;
}

function unsubscribe(entry) {
  streams.delete(entry);
}

function emit(kind, by = null, clubId = null) {
  if (!KINDS.has(kind) || !streams.size) return;
  if (!clubId) return;
  const frame = { kind, by: by || null, at: Date.now() };
  for (const entry of streams) if (entry.clubId === clubId) write(entry, frame);
}

let timer = null;

function startTimers() {
  if (timer) return;
  timer = setInterval(() => {
    for (const entry of streams) {
      try {
        entry.res.write(': ping\n\n');
      } catch {
      }
    }
  }, PING_MS);
  timer.unref?.();
}

function stopTimers() {
  if (timer) clearInterval(timer);
  timer = null;
}

module.exports = {
  KINDS,
  MAX_STREAMS_TOTAL,
  MAX_STREAMS_PER_VIEWER,
  canSubscribe,
  subscribe,
  unsubscribe,
  emit,
  startTimers,
  stopTimers,
  streams,
};
