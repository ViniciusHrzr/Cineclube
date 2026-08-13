const test = require('node:test');
const assert = require('node:assert/strict');

const {
  TECH, GENRES, GENRE_CRIT, TMDB_GENRE_MAP, GENRE_TO_TMDB,
  genreFromTmdbIds, critsFor, finalOf
} = require('../criteria');

/* ── the /12 invariant ───────────────────────────────────────────────────
   Both finalOf() here and the copy in public/app.js divide by a hard-coded
   12. That only produces a 0–10 score while every genre keeps 8 criteria at
   weight 1 plus 2 at weight 2. Adding a criterion without touching the
   divisor would silently deflate every score, so guard it per genre. */

test('every genre weighs exactly 12', () => {
  for (const genre of GENRES) {
    const cs = critsFor(genre);
    const total = cs.reduce((sum, c) => sum + c.w, 0);
    assert.equal(total, 12, `${genre} soma ${total} pesos, esperado 12`);
  }
});

test('every genre has 8 technical criteria (x1) and 2 genre criteria (x2)', () => {
  for (const genre of GENRES) {
    const cs = critsFor(genre);
    assert.equal(cs.filter(c => c.w === 1).length, 8, `${genre}: critérios x1`);
    assert.equal(cs.filter(c => c.w === 2).length, 2, `${genre}: critérios x2`);
  }
});

test('criteria keys are unique within a genre', () => {
  // A genre criterion reusing a TECH key would collapse both onto one slider
  // and drop a score on the way to the database.
  for (const genre of GENRES) {
    const keys = critsFor(genre).map(c => c.key);
    assert.equal(new Set(keys).size, keys.length, `${genre} tem chaves repetidas: ${keys}`);
  }
});

test('every criterion carries a name and a hint', () => {
  for (const genre of GENRES) {
    for (const c of critsFor(genre)) {
      assert.ok(c.name && c.name.length, `${genre}/${c.key} sem nome`);
      assert.ok(c.hint && c.hint.length, `${genre}/${c.key} sem descrição`);
    }
  }
});

test('critsFor falls back to Drama for an unknown genre', () => {
  assert.deepEqual(critsFor('Faroeste'), critsFor('Drama'));
  assert.deepEqual(critsFor(undefined), critsFor('Drama'));
  assert.deepEqual(critsFor(null), critsFor('Drama'));
});

/* ── finalOf ─────────────────────────────────────────────────────────── */

function allScores(genre, value) {
  const o = {};
  critsFor(genre).forEach(c => { o[c.key] = value; });
  return o;
}

test('finalOf maps a full card of 10s to 10 and a full card of 0s to 0', () => {
  for (const genre of GENRES) {
    assert.equal(finalOf(genre, allScores(genre, 10)), 10, `${genre} com tudo 10`);
    assert.equal(finalOf(genre, allScores(genre, 0)), 0, `${genre} com tudo 0`);
  }
});

test('finalOf stays inside 0-10 for every genre at the midpoint', () => {
  for (const genre of GENRES) {
    assert.equal(finalOf(genre, allScores(genre, 5)), 5, `${genre} com tudo 5`);
  }
});

test('finalOf weighs genre criteria twice as heavily as technical ones', () => {
  const zeroed = allScores('Terror', 0);

  // 'direcao' is technical (x1): 10 points -> 10/12.
  const tech = finalOf('Terror', { ...zeroed, direcao: 10 });
  assert.equal(tech, 10 / 12);

  // 'atmosfera' is a Terror criterion (x2): 10 points -> 20/12.
  const genreCrit = finalOf('Terror', { ...zeroed, atmosfera: 10 });
  assert.equal(genreCrit, 20 / 12);
  assert.equal(genreCrit, tech * 2);
});

test('finalOf treats a missing criterion as zero rather than NaN', () => {
  const partial = { direcao: 10, roteiro: 10 };
  const final = finalOf('Drama', partial);
  assert.ok(Number.isFinite(final), 'nota final virou NaN');
  assert.equal(final, 20 / 12);
});

/* ── genre mapping ───────────────────────────────────────────────────── */

test('genreFromTmdbIds resolves known TMDB ids', () => {
  assert.equal(genreFromTmdbIds([27]), 'Terror');
  assert.equal(genreFromTmdbIds([9648]), 'Suspense');
  assert.equal(genreFromTmdbIds([16]), 'Animação');
});

test('genreFromTmdbIds falls back to Drama for unknown or empty input', () => {
  assert.equal(genreFromTmdbIds([10402]), 'Drama'); // Music: not in our taxonomy
  assert.equal(genreFromTmdbIds([]), 'Drama');
  assert.equal(genreFromTmdbIds(undefined), 'Drama');
  assert.equal(genreFromTmdbIds(null), 'Drama');
});

test('genreFromTmdbIds takes the first id it recognizes', () => {
  // TMDB returns ids roughly by relevance; unknown ones must not shadow the
  // known one that follows them.
  assert.equal(genreFromTmdbIds([10402, 27]), 'Terror');
});

test('every genre resolves to something TMDB /discover accepts', () => {
  for (const genre of GENRES) {
    const ids = GENRE_TO_TMDB[genre];
    assert.ok(ids, `${genre} não tem ids TMDB para o /discover`);
    for (const id of ids.split('|')) {
      assert.match(id, /^\d+$/, `${genre}: id "${id}" não é numérico`);
    }
  }
});

test('GENRE_TO_TMDB and TMDB_GENRE_MAP agree in both directions', () => {
  for (const [genre, ids] of Object.entries(GENRE_TO_TMDB)) {
    for (const id of ids.split('|')) {
      assert.equal(
        TMDB_GENRE_MAP[Number(id)], genre,
        `id ${id} volta como ${TMDB_GENRE_MAP[Number(id)]}, esperado ${genre}`
      );
    }
  }
});

test('GENRES covers exactly the genres that define criteria', () => {
  assert.deepEqual(GENRES.slice().sort(), Object.keys(GENRE_CRIT).sort());
  assert.ok(GENRES.includes('Drama'), 'Drama é o fallback e precisa existir');
});

test('TECH is the shared base of every genre card', () => {
  const techKeys = TECH.map(t => t[0]);
  assert.equal(techKeys.length, 8);
  for (const genre of GENRES) {
    const keys = critsFor(genre).filter(c => c.w === 1).map(c => c.key);
    assert.deepEqual(keys, techKeys, `${genre} não usa a base técnica padrão`);
  }
});
