const test = require('node:test');
const assert = require('node:assert/strict');

const {
  BASE, BASE_SWAP, GENRES, GENRE_CRIT, TMDB_GENRE_MAP, GENRE_TO_TMDB,
  genreFromTmdbIds, genresFromTmdbIds, baseFor, critsFor, finalOf, GENRE_PRIORITY
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

test('every genre has 8 base criteria (x1) and 2 genre criteria (x2)', () => {
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

test('genreFromTmdbIds ignores ids it does not know', () => {
  assert.equal(genreFromTmdbIds([10402, 27]), 'Terror');
});

/* This is the fault the priority list exists for. Frewaka arrives from TMDB as
   [18, 14, 27] — drama, fantasy, horror — and reading that left to right filed
   an Irish folk horror as a drama, which decides which two criteria the club
   is asked for. TMDB's order is not a ranking; ours is. */
test('a film carrying several genres is rated as the most specific one', () => {
  assert.equal(genreFromTmdbIds([18, 14, 27]), 'Terror'); // Frewaka
  assert.equal(genreFromTmdbIds([18, 99]), 'Documentário');
  assert.equal(genreFromTmdbIds([16, 35]), 'Animação');
  assert.equal(genreFromTmdbIds([28, 878]), 'Ficção científica');
  assert.equal(genreFromTmdbIds([18, 10749]), 'Romance');
  // Drama still answers when it is the only thing the film is.
  assert.equal(genreFromTmdbIds([18]), 'Drama');
});

/* The order of the ids must not change the answer: two films tagged with the
   same genres in different orders are the same kind of film. */
test('genreFromTmdbIds does not depend on the order TMDB sent', () => {
  assert.equal(genreFromTmdbIds([27, 14, 18]), genreFromTmdbIds([18, 14, 27]));
  assert.equal(genreFromTmdbIds([35, 16]), genreFromTmdbIds([16, 35]));
});

/* The single genre is a default now, not a verdict: what the rating screen
   offers is every genre the film carries, and the person watching decides. */
test('genresFromTmdbIds returns every genre the film carries', () => {
  assert.deepEqual(genresFromTmdbIds([18, 14, 27]), ['Terror', 'Drama']); // Frewaka
  assert.deepEqual(genresFromTmdbIds([16, 35]), ['Animação', 'Comédia']);
  assert.deepEqual(genresFromTmdbIds([27]), ['Terror']);
});

test('genresFromTmdbIds sorts by the club priority, whatever TMDB sent', () => {
  assert.deepEqual(genresFromTmdbIds([18, 27]), genresFromTmdbIds([27, 18]));
  assert.deepEqual(genresFromTmdbIds([35, 99, 18]), ['Documentário', 'Comédia', 'Drama']);
});

test('genresFromTmdbIds never answers with an empty list', () => {
  // A film has to be rateable even when nothing it carries is in the taxonomy.
  assert.deepEqual(genresFromTmdbIds([10402]), ['Drama']); // Music
  assert.deepEqual(genresFromTmdbIds([]), ['Drama']);
  assert.deepEqual(genresFromTmdbIds(undefined), ['Drama']);
});

test('the single genre is the first of the list', () => {
  for (const ids of [[18, 14, 27], [16, 35], [10402], [], [99, 18]]) {
    assert.equal(genreFromTmdbIds(ids), genresFromTmdbIds(ids)[0]);
  }
});

/* ── the base, and the genres allowed to move it ──────────────────────────
   A genre may replace a slot of the eight when the default question has no
   referent — "Atuações" on an animation, "Direção de Arte" on a documentary.
   What it may not do is add one, drop one, or reorder them: the count is what
   holds the /12 divisor up and the order is what makes two cards comparable
   side by side. So the swap is checked against the declaration rather than
   forbidden outright. */
const baseKeys = g => critsFor(g).filter(c => c.w === 1).map(c => c.key);

test('a genre that declares no swap is asked the default eight', () => {
  const fallback = BASE.map(t => t[0]);
  for (const genre of GENRES) {
    if (BASE_SWAP[genre]) continue;
    assert.deepEqual(baseKeys(genre), fallback, `${genre} mexeu na base sem declarar`);
  }
});

test('a swap replaces a slot in place, never adds or reorders one', () => {
  for (const [genre, swap] of Object.entries(BASE_SWAP)) {
    const slots = BASE.map(t => t[0]);
    for (const slot of Object.keys(swap)) {
      assert.ok(slots.includes(slot), `${genre} troca "${slot}", que não está na base`);
    }
    const expected = BASE.map(t => (swap[t[0]] ? swap[t[0]][0] : t[0]));
    assert.deepEqual(baseKeys(genre), expected, `${genre}: a base saiu de ordem`);
    assert.equal(baseKeys(genre).length, 8, `${genre}: a base deixou de ter oito`);
  }
});

/* The whole point of the swap. A criterion nobody can answer does not come back
   empty — it comes back as whatever number was easiest to leave the slider on,
   at full weight, indistinguishable from a measurement afterwards. */
test('the genres with nothing to act in are not asked about acting', () => {
  assert.ok(!baseKeys('Animação').includes('atuacoes'), 'animação ainda pede atuações');
  assert.ok(baseKeys('Animação').includes('vozes'), 'animação precisa perguntar por vozes');
  assert.ok(!baseKeys('Documentário').includes('atuacoes'), 'documentário ainda pede atuações');
  assert.ok(!baseKeys('Documentário').includes('arte'), 'documentário ainda pede direção de arte');
});

/* Every genre still has to ask about the four systems a film is made of, plus
   how it was directed and written. Those are not negotiable by genre — only
   what fills the two slots that can be. */
test('the craft every film has is asked of every genre', () => {
  for (const genre of GENRES) {
    for (const key of ['direcao', 'roteiro', 'fotografia', 'montagem', 'som', 'originalidade']) {
      assert.ok(baseKeys(genre).includes(key), `${genre} não pergunta por ${key}`);
    }
  }
});

test('baseFor falls back to the default eight for an unknown genre', () => {
  assert.deepEqual(baseFor('Faroeste'), BASE);
  assert.deepEqual(baseFor(undefined), BASE);
});

/* A genre added to the taxonomy without a place in the priority list would be
   unreachable — every film carrying it would fall through to Drama. */
test('every genre has a place in the priority order', () => {
  for (const genre of GENRES) {
    assert.ok(GENRE_PRIORITY.includes(genre), `${genre} não está na ordem de prioridade`);
  }
  assert.equal(GENRE_PRIORITY.length, GENRES.length);
  assert.equal(GENRE_PRIORITY[GENRE_PRIORITY.length - 1], 'Drama', 'Drama precisa ser o último');
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

test('BASE is eight slots and every slot is named and described', () => {
  assert.equal(BASE.length, 8);
  for (const [key, name, hint] of BASE) {
    assert.ok(key && name && hint, `slot "${key}" incompleto`);
  }
});

/* A rename inside a genre is free; a new key is not — it drops that criterion
   out of every take already recorded unless the archive is migrated with it.
   This is the list scripts/migrate-criteria-keys.js has to agree with, and it
   is written down here so that adding a swap without a migration is a decision
   somebody makes on purpose. */
test('the keys a genre introduces are the ones the migration knows about', () => {
  const introduced = new Set();
  for (const [genre, swap] of Object.entries(BASE_SWAP)) {
    for (const [slot, replacement] of Object.entries(swap)) {
      if (replacement[0] !== slot) introduced.add(`${genre}:${slot}→${replacement[0]}`);
    }
  }
  assert.deepEqual([...introduced].sort(), [
    'Animação:atuacoes→vozes',
    'Documentário:arte→material',
    'Documentário:atuacoes→acesso'
  ]);
});
