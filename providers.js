const db = require('./db');
const justwatch = require('./justwatch');

const TTL = '-7 days';

const VERSION = 2;
const LANES = 6;

async function inLanes(items, lanes, job) {
  const queue = [...items];
  const workers = Array.from({ length: Math.min(lanes, queue.length) }, async () => {
    while (queue.length) await job(queue.shift());
  });
  await Promise.all(workers);
}

async function withDeepLinks(watch, { id, title, original, kind }) {
  if (!watch?.streaming?.length) return watch;
  const links = await justwatch.deepLinks({ tmdbId: id, title, original, kind });
  return {
    ...watch,
    streaming: watch.streaming.map(p => ({ ...p, url: justwatch.urlFor(links, p.name) })),
  };
}

function providerCache({ table, fetch, kind }) {
  const fresh = count => db.prepare(`
    SELECT tmdb_id, providers FROM ${table}
    WHERE tmdb_id IN (${Array.from({ length: count }, () => '?').join(',')})
      AND providers IS NOT NULL
      AND providers_at > datetime('now', '${TTL}')
  `);
  const save = db.prepare(
    `UPDATE ${table} SET providers = ?, providers_at = datetime('now') WHERE tmdb_id = ?`
  );

  return async function fill(results) {
    if (!results.length) return results;

    const known = new Map();
    try {
      const ids = results.map(r => r.id);
      for (const row of await fresh(ids.length).all(...ids)) {
        const held = JSON.parse(row.providers);
        if (held?.v !== VERSION) continue;
        known.set(Number(row.tmdb_id), held.watch ?? null);
      }
    } catch (e) {
      console.warn(`[providers] cache ilegível em ${table}:`, e.message);
    }

    const missing = results.filter(r => !known.has(r.id));
    await inLanes(missing, LANES, async r => {
      try {
        const watch = await withDeepLinks(await fetch(r.id), { ...r, kind });
        known.set(r.id, watch);
        await save.run(JSON.stringify({ v: VERSION, watch }), r.id);
      } catch {
      }
    });

    for (const r of results) r.watch = known.get(r.id) ?? null;
    return results;
  };
}

module.exports = { providerCache };
