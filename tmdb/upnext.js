const db = require('../lib/db');
const series = require('./series');
const { cacheShow, cacheEpisodes } = require('./showcache');

const VERSION = 1;

const TTL_NO_AR = 1;
const TTL_ACABOU = 14;

const LANES = 4;

const DIA = 24 * 60 * 60 * 1000;

const today = () => new Date().toISOString().slice(0, 10);

function fresh(at, days) {
  if (!at) return false;
  const when = Date.parse(String(at).replace(' ', 'T') + 'Z');
  return Number.isFinite(when) && Date.now() - when < days * DIA;
}

function pendingSeason(seasons, marks) {
  for (const s of seasons) {
    for (let e = 1; e <= s.episodes; e++) {
      if (!marks.has(`${s.season}x${e}`)) return s;
    }
  }
  return null;
}

function pickIn(episodes, marks, day) {
  for (const ep of episodes) {
    if (marks.has(`${ep.season}x${ep.episode}`)) continue;
    return ep.airDate && ep.airDate > day ? { upcoming: ep } : { next: ep };
  }
  return {};
}

const atOrAfter = (a, b) => a.season > b.season || (a.season === b.season && a.episode >= b.episode);

function decide(shape, marks, episodes, day = today()) {
  if (!shape?.seasons?.length) return { next: null, upcoming: null, caughtUp: false };

  const pend = pendingSeason(shape.seasons, marks);
  if (!pend) {
    const upcoming = shape.nextAir ?? null;
    return { next: null, upcoming, caughtUp: true };
  }

  const lista = episodes.length
    ? episodes
    : Array.from({ length: pend.episodes }, (_, i) => ({
        season: pend.season, episode: i + 1, title: null, airDate: null,
      }));

  const achado = pickIn(lista, marks, day);
  let next = achado.next ?? null;
  let upcoming = achado.upcoming ?? null;

  if (next && shape.nextAir && atOrAfter(next, shape.nextAir)) {
    upcoming = shape.nextAir;
    next = null;
  }
  if (!next && !upcoming) upcoming = shape.nextAir ?? null;

  return { next, upcoming, caughtUp: !next };
}

const shapeRows = count => db.prepare(`
  SELECT tmdb_id, shape, shape_at FROM shows_cache
  WHERE tmdb_id IN (${Array.from({ length: count }, () => '?').join(',')})
`);

const saveShape = db.prepare(
  "UPDATE shows_cache SET shape = ?, shape_at = datetime('now') WHERE tmdb_id = ?"
);

const epsStmt = db.prepare(`
  SELECT season, episode, title, air_date, cached_at FROM episodes_cache
  WHERE show_id = ? AND season = ? ORDER BY episode ASC
`);

const marksStmt = db.prepare(`
  SELECT show_id, season, episode FROM episode_takes
  WHERE club_id = ? AND reviewer_id = ? AND episode <> 0
`);

async function marksOf(clubId, reviewerId) {
  const rows = await marksStmt.all(clubId, reviewerId);
  const por = new Map();
  for (const row of rows) {
    const id = Number(row.show_id);
    let held = por.get(id);
    if (!held) {
      held = new Set();
      por.set(id, held);
    }
    held.add(`${row.season}x${row.episode}`);
  }
  return por;
}

async function shapeOf(showId, held) {
  const guardado = held?.shape?.v === VERSION ? held.shape : null;
  if (guardado && fresh(held.at, guardado.inProduction ? TTL_NO_AR : TTL_ACABOU)) return guardado;

  try {
    const detail = await series.showDetails(showId);
    const shape = {
      v: VERSION,
      inProduction: !!detail.inProduction,
      seasons: (detail.seasons || []).map(s => ({ season: s.season, episodes: s.episodes || 0 })),
      nextAir: detail.nextAir ?? null,
    };
    await cacheShow(detail);
    await saveShape.run(JSON.stringify(shape), showId);
    return shape;
  } catch {
    return guardado;
  }
}

async function episodesOf(showId, season, expected, day) {
  const lido = async () => (await epsStmt.all(showId, season)).map(r => ({
    season: Number(r.season),
    episode: Number(r.episode),
    title: r.title ?? null,
    airDate: r.air_date ?? null,
    cachedAt: r.cached_at,
  }));

  const rows = await lido();
  const curta = rows.length < expected;
  const porVir = rows.some(e => e.airDate && e.airDate > day);
  if (!curta && !(porVir && !rows.every(e => fresh(e.cachedAt, TTL_NO_AR)))) return rows;

  try {
    const got = await series.seasonDetails(showId, season);
    await cacheEpisodes(showId, got.episodes);
    return got.episodes;
  } catch {
    return rows;
  }
}

const refOf = ep =>
  ep && {
    season: ep.season,
    episode: ep.episode,
    title: ep.title ?? null,
    airDate: ep.airDate ?? null,
  };

async function inLanes(items, lanes, job) {
  const queue = [...items];
  await Promise.all(
    Array.from({ length: Math.min(lanes, queue.length) }, async () => {
      while (queue.length) await job(queue.shift());
    })
  );
}

async function fill(shows, { clubId, reviewerId }) {
  if (!shows.length) return shows;

  const dia = today();
  const marks = await marksOf(clubId, reviewerId);

  const guardado = new Map();
  try {
    const ids = shows.map(s => s.id);
    for (const row of await shapeRows(ids.length).all(...ids)) {
      guardado.set(Number(row.tmdb_id), {
        shape: row.shape ? JSON.parse(row.shape) : null,
        at: row.shape_at,
      });
    }
  } catch (e) {
    console.warn('[upnext] cache ilegível:', e.message);
  }

  await inLanes(shows, LANES, async show => {
    try {
      const shape = await shapeOf(show.id, guardado.get(show.id));
      const meus = marks.get(show.id) ?? new Set();
      const pend = shape?.seasons?.length ? pendingSeason(shape.seasons, meus) : null;
      const eps = pend ? await episodesOf(show.id, pend.season, pend.episodes, dia) : [];
      const { next, upcoming, caughtUp } = decide(shape, meus, eps, dia);
      show.upNext = refOf(next);
      show.upcoming = refOf(upcoming);
      show.caughtUp = caughtUp;
    } catch (e) {
      console.warn('[upnext] série', show.id, e.message);
    }
  });

  return shows;
}

module.exports = { fill, decide, pendingSeason, pickIn };
