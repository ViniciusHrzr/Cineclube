/* ══════════════════════════════════════════════════════════════════════════
   Fills in how long each film runs, for the archive that was written before
   the app recorded it.

   The number reaches a take two ways: it is stored with the take when it is
   rated, and it is read from the film cache when the take has none. Both are
   filled the moment somebody opens a film, so the archive would heal on its
   own — one film at a time, as the club happens to look at it. This does the
   same thing in one pass, so the record reads complete from the first visit.

   Run it from the app directory:

       npm run backfill:runtimes

   Nothing here overwrites a runtime that is already recorded: every film
   already carrying one is skipped without a request, and the writes only touch
   rows where the column is null. It is safe to run twice, and safe to stop
   halfway — the films it got to stay done.
   ══════════════════════════════════════════════════════════════════════════ */

try { require('node:process').loadEnvFile('.env'); } catch (e) { /* env may come from elsewhere */ }

const db = require('../db');
const tmdb = require('../tmdb');

/* TMDB is generous but not unlimited, and this is a background chore rather
   than something anybody is waiting on. A quarter of a second between films
   keeps a club-sized archive well under any ceiling. */
const PAUSE_MS = 250;
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* Every film in the record that nobody knows the length of — rated, queued, or
   merely cached — with the cache consulted before TMDB is. */
const pendingStmt = db.prepare(`
  SELECT DISTINCT rv.movie_id AS id, rv.movie_title AS title
  FROM reviews rv
  LEFT JOIN movies_cache mc ON mc.tmdb_id = rv.movie_id
  WHERE rv.movie_runtime IS NULL AND mc.runtime IS NULL
  ORDER BY rv.movie_id
`);
const setReviewStmt = db.prepare(
  'UPDATE reviews SET movie_runtime = ? WHERE movie_id = ? AND movie_runtime IS NULL'
);
const setCacheStmt = db.prepare(
  'UPDATE movies_cache SET runtime = ? WHERE tmdb_id = ? AND runtime IS NULL'
);
/* A take whose film the cache already knows needs no request at all. */
const fromCacheStmt = db.prepare(`
  UPDATE reviews SET movie_runtime = (
    SELECT mc.runtime FROM movies_cache mc WHERE mc.tmdb_id = reviews.movie_id
  )
  WHERE movie_runtime IS NULL
    AND EXISTS (SELECT 1 FROM movies_cache mc WHERE mc.tmdb_id = reviews.movie_id AND mc.runtime IS NOT NULL)
`);

async function main() {
  await db.ready;

  const local = await fromCacheStmt.run();
  const fromCache = local.rowsAffected ?? 0;
  if (fromCache) console.log(`[runtimes] ${fromCache} avaliação(ões) preenchida(s) pelo cache, sem consultar o TMDB`);

  const films = await pendingStmt.all();
  if (!films.length) {
    console.log('[runtimes] nada pendente — todo filme do acervo já tem duração');
    return;
  }
  console.log(`[runtimes] ${films.length} filme(s) sem duração; consultando o TMDB`);

  let filled = 0;
  let missing = 0;
  let failed = 0;

  for (const film of films) {
    try {
      const details = await tmdb.movieDetails(film.id);
      if (!details.runtime) {
        missing++;
        console.log(`[runtimes] ${film.title}: o TMDB não informa duração`);
      } else {
        await setCacheStmt.run(details.runtime, film.id);
        await setReviewStmt.run(details.runtime, film.id);
        filled++;
        console.log(`[runtimes] ${film.title}: ${details.runtime} min`);
      }
    } catch (e) {
      /* One unreachable film is not a reason to abandon the rest; the next run
         picks it up, because nothing was written for it. */
      failed++;
      console.warn(`[runtimes] ${film.title} (${film.id}) falhou: ${e.message}`);
    }
    await sleep(PAUSE_MS);
  }

  console.log(`[runtimes] pronto — ${filled} preenchido(s), ${missing} sem duração no TMDB, ${failed} com falha`);
}

main()
  .then(() => db.close())
  .catch(e => {
    console.error('[runtimes] ' + e.message);
    db.close();
    process.exitCode = 1;
  });
