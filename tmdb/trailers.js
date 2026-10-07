const db = require('../lib/db');

const HIT_TTL = 180;
const MISS_TTL = 7;
const VERSION = 1;
const LANES = 6;

async function inLanes(items, lanes, job) {
  const queue = [...items];
  const workers = Array.from({ length: Math.min(lanes, queue.length) }, async () => {
    while (queue.length) await job(queue.shift());
  });
  await Promise.all(workers);
}

const days = iso => (Date.now() - Date.parse(iso.replace(' ', 'T') + 'Z')) / 86400000;

function trailerCache({ table, fetch }) {
  const held = count => db.prepare(`
    SELECT tmdb_id, trailer, trailer_at FROM ${table}
    WHERE tmdb_id IN (${Array.from({ length: count }, () => '?').join(',')})
      AND trailer IS NOT NULL
  `);
  const save = db.prepare(
    `UPDATE ${table} SET trailer = ?, trailer_at = datetime('now') WHERE tmdb_id = ?`
  );

  return async function fill(results) {
    if (!results.length) return results;

    const known = new Map();
    try {
      const ids = results.map(r => r.id);
      for (const row of await held(ids.length).all(...ids)) {
        const saved = JSON.parse(row.trailer);
        if (saved?.v !== VERSION) continue;
        const age = row.trailer_at ? days(row.trailer_at) : Infinity;
        if (age > (saved.key ? HIT_TTL : MISS_TTL)) continue;
        known.set(Number(row.tmdb_id), saved.key ?? null);
      }
    } catch (e) {
      console.warn(`[trailers] cache ilegível em ${table}:`, e.message);
    }

    const missing = results.filter(r => !known.has(r.id));
    await inLanes(missing, LANES, async r => {
      try {
        const key = await fetch(r.id);
        known.set(r.id, key);
        await save.run(JSON.stringify({ v: VERSION, key }), r.id);
      } catch {
      }
    });

    for (const r of results) r.trailerKey = known.get(r.id) ?? null;
    return results;
  };
}

module.exports = { trailerCache };
