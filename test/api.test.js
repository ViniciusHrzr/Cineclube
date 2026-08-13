const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

// Point the app at a throwaway database *before* requiring it — db.js opens
// the file the moment it is loaded.
const dbPath = path.join(os.tmpdir(), `cineclube-test-${crypto.randomUUID()}.db`);
process.env.CINECLUBE_DB = dbPath;

const app = require('../server');

let baseUrl;
let server;

test.before(async () => {
  server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  await new Promise(resolve => server.close(resolve));
  // Windows keeps the file locked while the connection is open.
  require('../db').close();
  // WAL mode leaves -shm/-wal siblings behind.
  for (const suffix of ['', '-shm', '-wal']) {
    fs.rmSync(dbPath + suffix, { force: true });
  }
});

async function req(method, pathname, body) {
  const res = await fetch(baseUrl + pathname, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

let seq = 0;
async function newReviewer(name) {
  const res = await req('POST', '/api/reviewers', { name: name || `Avaliador ${++seq}` });
  assert.equal(res.status, 201);
  return res.body;
}

function movie(overrides) {
  return { id: 100000 + ++seq, title: 'Filme de Teste', year: 2024, genre: 'Terror', ...overrides };
}

function scoresFor(genre, value) {
  const { critsFor } = require('../criteria');
  const o = {};
  critsFor(genre).forEach(c => { o[c.key] = value; });
  return o;
}

/* ── reviewers ───────────────────────────────────────────────────────── */

test('seeds three reviewers on an empty database', async () => {
  const { status, body } = await req('GET', '/api/reviewers');
  assert.equal(status, 200);
  const names = body.reviewers.map(r => r.name);
  assert.deepEqual(names.slice(0, 3), ['Ana Reis', 'Bruno Sá', 'Clara Lima']);
});

test('creates a reviewer with a colour and a zeroed review count', async () => {
  const reviewer = await newReviewer('Marina Duarte');
  assert.equal(reviewer.name, 'Marina Duarte');
  assert.match(reviewer.dot, /^#[0-9a-f]{6}$/i);
  assert.equal(reviewer.review_count, 0);

  const list = await req('GET', '/api/reviewers');
  assert.ok(list.body.reviewers.some(r => r.id === reviewer.id));
});

test('rejects a reviewer with a blank name', async () => {
  for (const name of ['', '   ', undefined]) {
    const { status } = await req('POST', '/api/reviewers', { name });
    assert.equal(status, 400, `nome ${JSON.stringify(name)} deveria ser rejeitado`);
  }
});

test('trims whitespace around a reviewer name', async () => {
  const reviewer = await newReviewer('  Joana  ');
  assert.equal(reviewer.name, 'Joana');
});

test('deleting an unknown reviewer is a 404', async () => {
  const { status } = await req('DELETE', '/api/reviewers/nao-existe');
  assert.equal(status, 404);
});

test('deleting a reviewer cascades to their reviews', async () => {
  // Guards PRAGMA foreign_keys = ON, which SQLite applies per connection and
  // silently ignores if it is ever dropped from db.js.
  const reviewer = await newReviewer();
  const m = movie();
  await req('POST', '/api/reviews', { reviewerId: reviewer.id, movie: m, scores: scoresFor('Terror', 7) });

  const del = await req('DELETE', `/api/reviewers/${reviewer.id}`);
  assert.equal(del.status, 204);

  const reviews = await req('GET', '/api/reviews');
  assert.equal(reviews.body.reviews.filter(r => r.reviewerId === reviewer.id).length, 0);
});

test('review_count reflects saved reviews', async () => {
  const reviewer = await newReviewer();
  await req('POST', '/api/reviews', { reviewerId: reviewer.id, movie: movie(), scores: scoresFor('Terror', 6) });
  await req('POST', '/api/reviews', { reviewerId: reviewer.id, movie: movie(), scores: scoresFor('Terror', 8) });

  const list = await req('GET', '/api/reviewers');
  const found = list.body.reviewers.find(r => r.id === reviewer.id);
  assert.equal(found.review_count, 2);
});

/* ── reviews ─────────────────────────────────────────────────────────── */

test('saves a review and computes the final score server-side', async () => {
  const reviewer = await newReviewer();
  const m = movie();
  const { status, body } = await req('POST', '/api/reviews', {
    reviewerId: reviewer.id, movie: m, scores: scoresFor('Terror', 10), comment: 'Excelente.'
  });

  assert.equal(status, 201);
  assert.equal(body.final, 10);
  assert.equal(body.movieId, m.id);
  assert.equal(body.movieGenre, 'Terror');
  assert.equal(body.reviewerName, reviewer.name);
  assert.equal(body.comment, 'Excelente.');
  assert.equal(body.breakdown.length, 10);
});

test('ignores a client-sent final score and recomputes from the criteria', async () => {
  const reviewer = await newReviewer();
  const { body } = await req('POST', '/api/reviews', {
    reviewerId: reviewer.id, movie: movie(), scores: scoresFor('Terror', 5), final: 10
  });
  assert.equal(body.final, 5);
});

test('clamps out-of-range and non-numeric scores', async () => {
  const reviewer = await newReviewer();
  const scores = { ...scoresFor('Terror', 5), direcao: 99, roteiro: -20, fotografia: 'dez' };
  const { body } = await req('POST', '/api/reviews', { reviewerId: reviewer.id, movie: movie(), scores });

  assert.equal(body.scores.direcao, 10);
  assert.equal(body.scores.roteiro, 0);
  assert.equal(body.scores.fotografia, 0);
  assert.ok(Number.isFinite(body.final));
});

test('drops criteria that do not belong to the genre', async () => {
  const reviewer = await newReviewer();
  const scores = { ...scoresFor('Terror', 5), naoExiste: 10 };
  const { body } = await req('POST', '/api/reviews', { reviewerId: reviewer.id, movie: movie(), scores });

  assert.equal(body.scores.naoExiste, undefined);
  assert.equal(body.final, 5);
});

test('falls back to Drama for an unknown movie genre', async () => {
  const reviewer = await newReviewer();
  const { body } = await req('POST', '/api/reviews', {
    reviewerId: reviewer.id, movie: movie({ genre: 'Faroeste' }), scores: scoresFor('Drama', 7)
  });
  assert.equal(body.movieGenre, 'Drama');
  assert.equal(body.final, 7);
});

test('re-rating the same movie updates the review instead of duplicating it', async () => {
  const reviewer = await newReviewer();
  const m = movie();

  const first = await req('POST', '/api/reviews', { reviewerId: reviewer.id, movie: m, scores: scoresFor('Terror', 4) });
  const second = await req('POST', '/api/reviews', { reviewerId: reviewer.id, movie: m, scores: scoresFor('Terror', 9) });

  assert.equal(first.body.id, second.body.id, 'o upsert deveria manter o mesmo id');
  assert.equal(second.body.final, 9);

  const all = await req('GET', '/api/reviews');
  const mine = all.body.reviews.filter(r => r.reviewerId === reviewer.id && r.movieId === m.id);
  assert.equal(mine.length, 1);
  assert.equal(mine[0].final, 9);
});

test('two reviewers can rate the same movie independently', async () => {
  const a = await newReviewer();
  const b = await newReviewer();
  const m = movie();

  await req('POST', '/api/reviews', { reviewerId: a.id, movie: m, scores: scoresFor('Terror', 6) });
  await req('POST', '/api/reviews', { reviewerId: b.id, movie: m, scores: scoresFor('Terror', 8) });

  const averages = await req('GET', '/api/reviews/averages');
  assert.equal(averages.body.averages[m.id].count, 2);
  assert.equal(averages.body.averages[m.id].avg, 7);
});

test('rejects a review from an unknown reviewer', async () => {
  const { status } = await req('POST', '/api/reviews', {
    reviewerId: 'nao-existe', movie: movie(), scores: scoresFor('Terror', 5)
  });
  assert.equal(status, 400);
});

test('rejects a review with a malformed movie or missing scores', async () => {
  const reviewer = await newReviewer();
  const cases = [
    { reviewerId: reviewer.id, movie: null, scores: scoresFor('Terror', 5) },
    { reviewerId: reviewer.id, movie: { title: 'Sem id' }, scores: scoresFor('Terror', 5) },
    { reviewerId: reviewer.id, movie: { id: 1 }, scores: scoresFor('Terror', 5) },
    { reviewerId: reviewer.id, movie: movie(), scores: null },
    { reviewerId: reviewer.id, movie: movie(), scores: 'dez' }
  ];
  for (const payload of cases) {
    const { status } = await req('POST', '/api/reviews', payload);
    assert.equal(status, 400, `payload aceito indevidamente: ${JSON.stringify(payload)}`);
  }
});

test('truncates an overlong comment instead of failing', async () => {
  const reviewer = await newReviewer();
  const { status, body } = await req('POST', '/api/reviews', {
    reviewerId: reviewer.id, movie: movie(), scores: scoresFor('Terror', 5), comment: 'a'.repeat(5000)
  });
  assert.equal(status, 201);
  assert.equal(body.comment.length, 2000);
});

test('deletes a review and reports 404 afterwards', async () => {
  const reviewer = await newReviewer();
  const { body } = await req('POST', '/api/reviews', {
    reviewerId: reviewer.id, movie: movie(), scores: scoresFor('Terror', 5)
  });

  assert.equal((await req('DELETE', `/api/reviews/${body.id}`)).status, 204);
  assert.equal((await req('DELETE', `/api/reviews/${body.id}`)).status, 404);

  const all = await req('GET', '/api/reviews');
  assert.ok(!all.body.reviews.some(r => r.id === body.id));
});

/* ── watchlist ───────────────────────────────────────────────────────── */

test('adds a movie to the watchlist and lists it back', async () => {
  const m = movie({ title: 'Para Assistir' });
  assert.equal((await req('POST', '/api/watchlist', { movie: m })).status, 201);

  const { body } = await req('GET', '/api/watchlist');
  const found = body.watchlist.find(w => w.id === m.id);
  assert.ok(found, 'filme não apareceu na watchlist');
  assert.equal(found.title, 'Para Assistir');
  assert.equal(found.genre, 'Terror');
});

test('adding the same movie twice keeps a single entry', async () => {
  const m = movie();
  await req('POST', '/api/watchlist', { movie: m });
  await req('POST', '/api/watchlist', { movie: m });

  const { body } = await req('GET', '/api/watchlist');
  assert.equal(body.watchlist.filter(w => w.id === m.id).length, 1);
});

test('rejects a malformed movie on the watchlist', async () => {
  for (const payload of [{}, { movie: null }, { movie: { title: 'Sem id' } }, { movie: { id: 5 } }]) {
    const { status } = await req('POST', '/api/watchlist', payload);
    assert.equal(status, 400, `payload aceito indevidamente: ${JSON.stringify(payload)}`);
  }
});

test('rating a movie removes it from the watchlist', async () => {
  const reviewer = await newReviewer();
  const m = movie();
  await req('POST', '/api/watchlist', { movie: m });

  await req('POST', '/api/reviews', { reviewerId: reviewer.id, movie: m, scores: scoresFor('Terror', 7) });

  const { body } = await req('GET', '/api/watchlist');
  assert.ok(!body.watchlist.some(w => w.id === m.id), 'filme avaliado continuou na watchlist');
});

test('removes a movie from the watchlist', async () => {
  const m = movie();
  await req('POST', '/api/watchlist', { movie: m });

  assert.equal((await req('DELETE', `/api/watchlist/${m.id}`)).status, 204);

  const { body } = await req('GET', '/api/watchlist');
  assert.ok(!body.watchlist.some(w => w.id === m.id));
});

/* ── catalog (the routes that do not call TMDB) ──────────────────────── */

test('exposes the genre list', async () => {
  const { status, body } = await req('GET', '/api/catalog/genres');
  assert.equal(status, 200);
  assert.ok(body.genres.includes('Terror'));
  assert.ok(body.genres.includes('Drama'));
});

test('serves the criteria for a genre and falls back to Drama', async () => {
  const terror = await req('GET', '/api/catalog/criteria?genre=Terror');
  assert.equal(terror.body.genre, 'Terror');
  assert.equal(terror.body.criteria.length, 10);
  assert.ok(terror.body.criteria.some(c => c.key === 'atmosfera'));

  const unknown = await req('GET', '/api/catalog/criteria?genre=Faroeste');
  assert.equal(unknown.body.genre, 'Drama');
  assert.ok(unknown.body.criteria.some(c => c.key === 'densidade'));
});

test('criteria-all covers every genre the front-end can render', async () => {
  const { body } = await req('GET', '/api/catalog/criteria-all');
  for (const genre of body.genres) {
    assert.ok(body.criteria[genre], `${genre} veio sem critérios`);
    assert.equal(body.criteria[genre].reduce((s, c) => s + c.w, 0), 12);
  }
});

test('an empty search short-circuits without calling TMDB', async () => {
  const { status, body } = await req('GET', '/api/catalog/search?q=');
  assert.equal(status, 200);
  assert.deepEqual(body.results, []);
});

test('discover rejects an unknown genre before calling TMDB', async () => {
  const { status } = await req('GET', '/api/catalog/discover?genre=Faroeste');
  assert.equal(status, 400);
});
