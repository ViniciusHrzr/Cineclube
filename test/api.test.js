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
const db = require('../db');

let baseUrl;
let server;

test.before(async () => {
  // The schema, the seeds and the admin are async now; nothing may hit the API
  // before they land.
  await app.ready;
  server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  await new Promise(resolve => server.close(resolve));
  // Windows keeps the file locked while the connection is open.
  db.close();
  // WAL mode leaves -shm/-wal siblings behind. Windows can still hold the
  // handle for a moment after close(), and a temp file we failed to delete is
  // not a reason to fail a green run.
  for (const suffix of ['', '-shm', '-wal']) {
    try { fs.rmSync(dbPath + suffix, { force: true }); } catch { /* it is a temp file */ }
  }
});

/** `cookie` carries a session; omit it to act as a signed-out visitor. */
async function req(method, pathname, body, cookie) {
  const headers = {};
  if (body) headers['Content-Type'] = 'application/json';
  if (cookie) headers.Cookie = cookie;
  const res = await fetch(baseUrl + pathname, {
    method,
    headers: Object.keys(headers).length ? headers : undefined,
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await res.text();
  return {
    status: res.status,
    body: text ? JSON.parse(text) : null,
    setCookie: res.headers.get('set-cookie')
  };
}

function sessionCookie(setCookie) {
  return setCookie ? setCookie.split(';')[0] : null;
}

let seq = 0;
const PIN = '4321';

/** Creates a reviewer, signs them in, and returns the account plus its cookie. */
async function newReviewer(name, pin = PIN) {
  const res = await req('POST', '/api/reviewers', { name: name || `Avaliador ${++seq}`, pin });
  assert.equal(res.status, 201);
  const login = await req('POST', '/api/auth/login', { reviewerId: res.body.id, pin });
  assert.equal(login.status, 200);
  return { ...res.body, pin, cookie: sessionCookie(login.setCookie) };
}

/** An account with the admin flag set, which no API grants on purpose. */
async function newAdmin(name) {
  const admin = await newReviewer(name || `Chefe ${++seq}`);
  await db.prepare('UPDATE reviewers SET is_admin = 1 WHERE id = ?').run(admin.id);
  const login = await req('POST', '/api/auth/login', { reviewerId: admin.id, pin: admin.pin });
  return { ...admin, cookie: sessionCookie(login.setCookie) };
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

test('seeded reviewers start without a PIN', async () => {
  const { body } = await req('GET', '/api/reviewers');
  const ana = body.reviewers.find(r => r.name === 'Ana Reis');
  assert.equal(ana.hasPin, false, 'um PIN conhecido num seed seria uma porta dos fundos');
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
    const { status } = await req('POST', '/api/reviewers', { name, pin: PIN });
    assert.equal(status, 400, `nome ${JSON.stringify(name)} deveria ser rejeitado`);
  }
});

test('rejects a reviewer whose PIN is not four digits', async () => {
  for (const pin of [undefined, '', '123', '12345', 'abcd', '12a4', 1234]) {
    const { status } = await req('POST', '/api/reviewers', { name: `PIN ${++seq}`, pin });
    assert.equal(status, 400, `PIN ${JSON.stringify(pin)} deveria ser rejeitado`);
  }
});

test('never exposes the PIN hash or salt', async () => {
  await newReviewer('Sigilo');
  const { body } = await req('GET', '/api/reviewers');
  const serialized = JSON.stringify(body);
  assert.ok(!serialized.includes('pin_hash'), 'a listagem vazou pin_hash');
  assert.ok(!serialized.includes('pin_salt'), 'a listagem vazou pin_salt');
  assert.ok(!serialized.includes(PIN), 'a listagem vazou o PIN em texto puro');
});

test('trims whitespace around a reviewer name', async () => {
  const reviewer = await newReviewer('  Joana  ');
  assert.equal(reviewer.name, 'Joana');
});

test('deleting an unknown reviewer is a 404', async () => {
  const admin = await newAdmin();
  const { status } = await req('DELETE', '/api/reviewers/nao-existe', null, admin.cookie);
  assert.equal(status, 404);
});

test('deleting a reviewer cascades to their reviews', async () => {
  // Guards PRAGMA foreign_keys = ON, which SQLite applies per connection and
  // silently ignores if it is ever dropped from db.js.
  const admin = await newAdmin();
  const reviewer = await newReviewer();
  const m = movie();
  await req('POST', '/api/reviews', { movie: m, scores: scoresFor('Terror', 7) }, reviewer.cookie);

  const del = await req('DELETE', `/api/reviewers/${reviewer.id}`, null, admin.cookie);
  assert.equal(del.status, 204);

  const reviews = await req('GET', '/api/reviews');
  assert.equal(reviews.body.reviews.filter(r => r.reviewerId === reviewer.id).length, 0);
});

test('only the admin removes a reviewer, and never their own account', async () => {
  const admin = await newAdmin();
  const member = await newReviewer();
  const other = await newReviewer();

  // Not the admin: no removing anyone, including yourself. Self-deletion was
  // allowed once, which is how the club could end up with no administrator.
  assert.equal((await req('DELETE', `/api/reviewers/${other.id}`, null, member.cookie)).status, 403);
  assert.equal((await req('DELETE', `/api/reviewers/${member.id}`, null, member.cookie)).status, 403);

  // The seat itself is not removable, by anyone.
  assert.equal((await req('DELETE', `/api/reviewers/${admin.id}`, null, member.cookie)).status, 403);
  assert.equal((await req('DELETE', `/api/reviewers/${admin.id}`, null, admin.cookie)).status, 403);

  // Everyone survived every one of those.
  const list = (await req('GET', '/api/reviewers')).body.reviewers.map(r => r.id);
  assert.ok(list.includes(admin.id) && list.includes(member.id) && list.includes(other.id));

  // And the admin can still remove someone else.
  assert.equal((await req('DELETE', `/api/reviewers/${member.id}`, null, admin.cookie)).status, 204);
});

test('removing a reviewer needs a session at all', async () => {
  const member = await newReviewer();
  assert.equal((await req('DELETE', `/api/reviewers/${member.id}`)).status, 401);
});

test('review_count reflects saved reviews', async () => {
  const reviewer = await newReviewer();
  await req('POST', '/api/reviews', { movie: movie(), scores: scoresFor('Terror', 6) }, reviewer.cookie);
  await req('POST', '/api/reviews', { movie: movie(), scores: scoresFor('Terror', 8) }, reviewer.cookie);

  const list = await req('GET', '/api/reviewers');
  const found = list.body.reviewers.find(r => r.id === reviewer.id);
  assert.equal(found.review_count, 2);
});

/* ── sign-in ─────────────────────────────────────────────────────────── */

test('signs in with the right PIN and reports who you are', async () => {
  const reviewer = await newReviewer('Login OK');
  const me = await req('GET', '/api/auth/me', null, reviewer.cookie);
  assert.equal(me.status, 200);
  assert.equal(me.body.reviewer.id, reviewer.id);
  assert.equal(me.body.reviewer.isAdmin, false);
});

test('a visitor with no session is nobody, not an error', async () => {
  const me = await req('GET', '/api/auth/me');
  assert.equal(me.status, 200);
  assert.equal(me.body.reviewer, null);
});

test('rejects a wrong PIN, and an unknown reviewer looks the same', async () => {
  const reviewer = await newReviewer('Login Ruim');
  const wrong = await req('POST', '/api/auth/login', { reviewerId: reviewer.id, pin: '0000' });
  assert.equal(wrong.status, 401);

  const ghost = await req('POST', '/api/auth/login', { reviewerId: 'nao-existe', pin: '0000' });
  assert.equal(ghost.status, 401, 'a resposta não pode revelar quem existe');
  assert.equal(ghost.body.error, wrong.body.error);
});

test('locks an account after repeated wrong PINs', async () => {
  const reviewer = await newReviewer('Forca Bruta');
  let last;
  for (let i = 0; i < 5; i++) {
    last = await req('POST', '/api/auth/login', { reviewerId: reviewer.id, pin: '0000' });
  }
  assert.equal(last.status, 429, 'cinco erros deveriam trancar a conta');
  // The right PIN is refused while the lock holds — that is the point.
  const good = await req('POST', '/api/auth/login', { reviewerId: reviewer.id, pin: reviewer.pin });
  assert.equal(good.status, 429);
});

test('signing out invalidates the session', async () => {
  const reviewer = await newReviewer('Sai Fora');
  assert.equal((await req('POST', '/api/auth/logout', null, reviewer.cookie)).status, 204);
  const me = await req('GET', '/api/auth/me', null, reviewer.cookie);
  assert.equal(me.body.reviewer, null);
});

test('changes your own PIN when the current one is right', async () => {
  const reviewer = await newReviewer('Troca PIN');
  const change = await req('POST', '/api/auth/pin', { currentPin: reviewer.pin, newPin: '9999' }, reviewer.cookie);
  assert.equal(change.status, 200);

  assert.equal((await req('POST', '/api/auth/login', { reviewerId: reviewer.id, pin: reviewer.pin })).status, 401);
  assert.equal((await req('POST', '/api/auth/login', { reviewerId: reviewer.id, pin: '9999' })).status, 200);
});

test('refuses a PIN change with the wrong current PIN', async () => {
  const reviewer = await newReviewer('PIN Errado');
  const change = await req('POST', '/api/auth/pin', { currentPin: '0000', newPin: '9999' }, reviewer.cookie);
  assert.equal(change.status, 401);
  assert.equal((await req('POST', '/api/auth/login', { reviewerId: reviewer.id, pin: reviewer.pin })).status, 200);
});

test('refuses a new PIN that is not four digits', async () => {
  const reviewer = await newReviewer('PIN Curto');
  for (const newPin of ['12', 'abcd', '', undefined]) {
    const { status } = await req('POST', '/api/auth/pin', { currentPin: reviewer.pin, newPin }, reviewer.cookie);
    assert.equal(status, 400, `PIN ${JSON.stringify(newPin)} deveria ser rejeitado`);
  }
});

test('changing a PIN signs out the account everywhere else', async () => {
  const reviewer = await newReviewer('Duas Abas');
  const second = await req('POST', '/api/auth/login', { reviewerId: reviewer.id, pin: reviewer.pin });
  const otherTab = sessionCookie(second.setCookie);

  await req('POST', '/api/auth/pin', { currentPin: reviewer.pin, newPin: '8888' }, reviewer.cookie);

  const me = await req('GET', '/api/auth/me', null, otherTab);
  assert.equal(me.body.reviewer, null, 'a outra aba deveria ter caído');
});

test('the admin resets someone else PIN', async () => {
  const admin = await newAdmin();
  const member = await newReviewer('Esqueci');
  const reset = await req('POST', '/api/auth/pin/reset', { reviewerId: member.id, newPin: '7777' }, admin.cookie);
  assert.equal(reset.status, 200);
  assert.equal((await req('POST', '/api/auth/login', { reviewerId: member.id, pin: '7777' })).status, 200);
});

test('a non-admin cannot reset another PIN', async () => {
  const a = await newReviewer('Comum A');
  const b = await newReviewer('Comum B');
  const reset = await req('POST', '/api/auth/pin/reset', { reviewerId: b.id, newPin: '7777' }, a.cookie);
  assert.equal(reset.status, 403);
  assert.equal((await req('POST', '/api/auth/login', { reviewerId: b.id, pin: b.pin })).status, 200);
});

test('a signed-out visitor cannot reset a PIN', async () => {
  const b = await newReviewer('Alvo');
  const reset = await req('POST', '/api/auth/pin/reset', { reviewerId: b.id, newPin: '7777' });
  assert.equal(reset.status, 401);
});

/* ── reviews ─────────────────────────────────────────────────────────── */

test('saves a review and computes the final score server-side', async () => {
  const reviewer = await newReviewer();
  const m = movie();
  const { status, body } = await req('POST', '/api/reviews', {
    movie: m, scores: scoresFor('Terror', 10), comment: 'Excelente.'
  }, reviewer.cookie);

  assert.equal(status, 201);
  assert.equal(body.final, 10);
  assert.equal(body.movieId, m.id);
  assert.equal(body.movieGenre, 'Terror');
  assert.equal(body.reviewerName, reviewer.name);
  assert.equal(body.comment, 'Excelente.');
  assert.equal(body.breakdown.length, 11);
  assert.deepEqual([...new Set(body.breakdown.map(b => b.w))], [1], 'os pesos deixaram de ser iguais');
});

test('a review is signed by the session, not by the request body', async () => {
  const a = await newReviewer('Dono');
  const b = await newReviewer('Impostor');
  const { body } = await req('POST', '/api/reviews', {
    reviewerId: a.id, movie: movie(), scores: scoresFor('Terror', 5)
  }, b.cookie);
  assert.equal(body.reviewerId, b.id, 'o corpo da requisição não pode escolher quem assina');
});

test('ignores a client-sent final score and recomputes from the criteria', async () => {
  const reviewer = await newReviewer();
  const { body } = await req('POST', '/api/reviews', {
    movie: movie(), scores: scoresFor('Terror', 5), final: 10
  }, reviewer.cookie);
  assert.equal(body.final, 5);
});

test('clamps out-of-range and non-numeric scores', async () => {
  const reviewer = await newReviewer();
  const scores = { ...scoresFor('Terror', 5), direcao: 99, roteiro: -20, fotografia: 'dez' };
  const { body } = await req('POST', '/api/reviews', { movie: movie(), scores }, reviewer.cookie);

  assert.equal(body.scores.direcao, 10);
  assert.equal(body.scores.roteiro, 0);
  assert.equal(body.scores.fotografia, 0);
  assert.ok(Number.isFinite(body.final));
});

test('drops criteria that do not belong to the genre', async () => {
  const reviewer = await newReviewer();
  const scores = { ...scoresFor('Terror', 5), naoExiste: 10 };
  const { body } = await req('POST', '/api/reviews', { movie: movie(), scores }, reviewer.cookie);

  assert.equal(body.scores.naoExiste, undefined);
  assert.equal(body.final, 5);
});

test('falls back to Drama for an unknown movie genre', async () => {
  const reviewer = await newReviewer();
  const { body } = await req('POST', '/api/reviews', {
    movie: movie({ genre: 'Faroeste' }), scores: scoresFor('Drama', 7)
  }, reviewer.cookie);
  assert.equal(body.movieGenre, 'Drama');
  assert.equal(body.final, 7);
});

test('re-rating the same movie updates the review instead of duplicating it', async () => {
  const reviewer = await newReviewer();
  const m = movie();

  const first = await req('POST', '/api/reviews', { movie: m, scores: scoresFor('Terror', 4) }, reviewer.cookie);
  const second = await req('POST', '/api/reviews', { movie: m, scores: scoresFor('Terror', 9) }, reviewer.cookie);

  assert.equal(first.body.id, second.body.id, 'o upsert deveria manter o mesmo id');
  assert.equal(second.body.final, 9);

  const all = await req('GET', '/api/reviews');
  const mine = all.body.reviews.filter(r => r.reviewerId === reviewer.id && r.movieId === m.id);
  assert.equal(mine.length, 1);
  assert.equal(mine[0].final, 9);
});

test('a take keeps how long the film runs', async () => {
  const reviewer = await newReviewer();
  const m = movie({ runtime: 112 });

  const { body } = await req('POST', '/api/reviews', { movie: m, scores: scoresFor('Terror', 7) }, reviewer.cookie);
  assert.equal(body.movieRuntime, 112);

  const all = await req('GET', '/api/reviews');
  const mine = all.body.reviews.find(r => r.reviewerId === reviewer.id && r.movieId === m.id);
  assert.equal(mine.movieRuntime, 112);
});

test('a film with no runtime on record is null, never zero', async () => {
  const reviewer = await newReviewer();
  const { body } = await req('POST', '/api/reviews', { movie: movie({ runtime: 0 }), scores: scoresFor('Terror', 5) }, reviewer.cookie);
  assert.equal(body.movieRuntime, null);
});

/* Re-rating goes through the same upsert as rating, and the client sends
   whatever the catalogue handed it — which, on a stale sheet served from a
   cache written before durations existed, is nothing. A second take must not
   erase a runtime the first one recorded. */
test('re-rating without a runtime does not erase the one already recorded', async () => {
  const reviewer = await newReviewer();
  const m = movie({ runtime: 96 });

  await req('POST', '/api/reviews', { movie: m, scores: scoresFor('Terror', 4) }, reviewer.cookie);
  const again = await req('POST', '/api/reviews', {
    movie: { ...m, runtime: undefined }, scores: scoresFor('Terror', 8)
  }, reviewer.cookie);

  assert.equal(again.body.final, 8);
  assert.equal(again.body.movieRuntime, 96);
});

test('two reviewers can rate the same movie independently', async () => {
  const a = await newReviewer();
  const b = await newReviewer();
  const m = movie();

  await req('POST', '/api/reviews', { movie: m, scores: scoresFor('Terror', 6) }, a.cookie);
  await req('POST', '/api/reviews', { movie: m, scores: scoresFor('Terror', 8) }, b.cookie);

  const averages = await req('GET', '/api/reviews/averages');
  assert.equal(averages.body.averages[m.id].count, 2);
  assert.equal(averages.body.averages[m.id].avg, 7);
});

test('rejects a review from a visitor with no session', async () => {
  const { status } = await req('POST', '/api/reviews', {
    movie: movie(), scores: scoresFor('Terror', 5)
  });
  assert.equal(status, 401);
});

test('rejects a review with a malformed movie or missing scores', async () => {
  const reviewer = await newReviewer();
  const cases = [
    { movie: null, scores: scoresFor('Terror', 5) },
    { movie: { title: 'Sem id' }, scores: scoresFor('Terror', 5) },
    { movie: { id: 1 }, scores: scoresFor('Terror', 5) },
    { movie: movie(), scores: null },
    { movie: movie(), scores: 'dez' }
  ];
  for (const payload of cases) {
    const { status } = await req('POST', '/api/reviews', payload, reviewer.cookie);
    assert.equal(status, 400, `payload aceito indevidamente: ${JSON.stringify(payload)}`);
  }
});

test('truncates an overlong comment instead of failing', async () => {
  const reviewer = await newReviewer();
  const { status, body } = await req('POST', '/api/reviews', {
    movie: movie(), scores: scoresFor('Terror', 5), comment: 'a'.repeat(5000)
  }, reviewer.cookie);
  assert.equal(status, 201);
  assert.equal(body.comment.length, 2000);
});

test('deletes a review and reports 404 afterwards', async () => {
  const reviewer = await newReviewer();
  const { body } = await req('POST', '/api/reviews', {
    movie: movie(), scores: scoresFor('Terror', 5)
  }, reviewer.cookie);

  assert.equal((await req('DELETE', `/api/reviews/${body.id}`, null, reviewer.cookie)).status, 204);
  assert.equal((await req('DELETE', `/api/reviews/${body.id}`, null, reviewer.cookie)).status, 404);

  const all = await req('GET', '/api/reviews');
  assert.ok(!all.body.reviews.some(r => r.id === body.id));
});

test('a take is only ever deleted by the person who gave it, admin included', async () => {
  const owner = await newReviewer('Dono da Nota');
  const other = await newReviewer('Xereta');
  const admin = await newAdmin();

  const { body } = await req('POST', '/api/reviews', {
    movie: movie(), scores: scoresFor('Terror', 5)
  }, owner.cookie);

  assert.equal((await req('DELETE', `/api/reviews/${body.id}`, null, other.cookie)).status, 403);
  // The admin removes accounts, not opinions.
  assert.equal((await req('DELETE', `/api/reviews/${body.id}`, null, admin.cookie)).status, 403);
  assert.ok((await req('GET', '/api/reviews')).body.reviews.some(r => r.id === body.id));

  assert.equal((await req('DELETE', `/api/reviews/${body.id}`, null, owner.cookie)).status, 204);
});

test('rating a film someone else rated adds a take, it does not touch theirs', async () => {
  const owner = await newReviewer('Primeiro');
  const other = await newReviewer('Segundo');
  const m = movie({ title: 'O Mesmo Filme' });

  const first = await req('POST', '/api/reviews', { movie: m, scores: scoresFor('Terror', 4) }, owner.cookie);
  const second = await req('POST', '/api/reviews', { movie: m, scores: scoresFor('Terror', 9) }, other.cookie);

  assert.notEqual(first.body.id, second.body.id);
  const mine = (await req('GET', '/api/reviews')).body.reviews.filter(r => r.movieId === m.id);
  assert.equal(mine.length, 2);
  assert.equal(mine.find(r => r.reviewerId === owner.id).final, first.body.final);
});

/* ── watchlist ───────────────────────────────────────────────────────── */

test('adds a movie to the watchlist and lists it back', async () => {
  const member = await newReviewer();
  const m = movie({ title: 'Para Assistir' });
  assert.equal((await req('POST', '/api/watchlist', { movie: m }, member.cookie)).status, 201);

  const { body } = await req('GET', '/api/watchlist');
  const found = body.watchlist.find(w => w.id === m.id);
  assert.ok(found, 'filme não apareceu na watchlist');
  assert.equal(found.title, 'Para Assistir');
  assert.equal(found.genre, 'Terror');
});

/* A fila mostra de quem foi a ideia, e o id é a única parte disso que sai do
   servidor: o nome, a cor e o retrato são fatos sobre a pessoa e o clube
   inteiro já está carregado no cliente. Sem este campo a tela volta a ser
   quarenta pôsteres sem autor nenhum. */
test('a fila diz quem pôs cada filme', async () => {
  const member = await newReviewer();
  const m = movie();
  await req('POST', '/api/watchlist', { movie: m }, member.cookie);

  const { body } = await req('GET', '/api/watchlist');
  assert.equal(body.watchlist.find(w => w.id === m.id).addedBy, member.id);
});

test('adding the same movie twice keeps a single entry', async () => {
  const member = await newReviewer();
  const m = movie();
  await req('POST', '/api/watchlist', { movie: m }, member.cookie);
  await req('POST', '/api/watchlist', { movie: m }, member.cookie);

  const { body } = await req('GET', '/api/watchlist');
  assert.equal(body.watchlist.filter(w => w.id === m.id).length, 1);
});

test('rejects a malformed movie on the watchlist', async () => {
  const member = await newReviewer();
  for (const payload of [{}, { movie: null }, { movie: { title: 'Sem id' } }, { movie: { id: 5 } }]) {
    const { status } = await req('POST', '/api/watchlist', payload, member.cookie);
    assert.equal(status, 400, `payload aceito indevidamente: ${JSON.stringify(payload)}`);
  }
});

test('a signed-out visitor cannot touch the watchlist', async () => {
  const m = movie();
  assert.equal((await req('POST', '/api/watchlist', { movie: m })).status, 401);
  assert.equal((await req('DELETE', `/api/watchlist/${m.id}`)).status, 401);
});

test('rating a movie removes it from the watchlist', async () => {
  const reviewer = await newReviewer();
  const m = movie();
  await req('POST', '/api/watchlist', { movie: m }, reviewer.cookie);

  await req('POST', '/api/reviews', { movie: m, scores: scoresFor('Terror', 7) }, reviewer.cookie);

  const { body } = await req('GET', '/api/watchlist');
  assert.ok(!body.watchlist.some(w => w.id === m.id), 'filme avaliado continuou na watchlist');
});

test('keeps the watchlist in the order the club arranged', async () => {
  const member = await newReviewer();
  const a = movie({ title: 'Primeiro' });
  const b = movie({ title: 'Segundo' });
  const c = movie({ title: 'Terceiro' });
  for (const m of [a, b, c]) await req('POST', '/api/watchlist', { movie: m }, member.cookie);

  const before = await req('GET', '/api/watchlist');
  const mine = before.body.watchlist.filter(w => [a.id, b.id, c.id].includes(w.id));
  assert.deepEqual(mine.map(w => w.id), [a.id, b.id, c.id], 'novos entram no fim da fila');

  const reordered = await req('PUT', '/api/watchlist/order', { ids: [c.id, a.id, b.id] }, member.cookie);
  assert.equal(reordered.status, 200);

  const after = await req('GET', '/api/watchlist');
  const now = after.body.watchlist.filter(w => [a.id, b.id, c.id].includes(w.id));
  assert.deepEqual(now.map(w => w.id), [c.id, a.id, b.id]);
});

test('a reorder that omits an entry does not lose it', async () => {
  const member = await newReviewer();
  const a = movie({ title: 'Fica' });
  const b = movie({ title: 'Tambem fica' });
  for (const m of [a, b]) await req('POST', '/api/watchlist', { movie: m }, member.cookie);

  // A stale tab reorders without knowing about `b`.
  await req('PUT', '/api/watchlist/order', { ids: [a.id] }, member.cookie);

  const { body } = await req('GET', '/api/watchlist');
  assert.ok(body.watchlist.some(w => w.id === b.id), 'a fila perdeu um filme que ninguém removeu');
});

test('rejects a reorder from a visitor with no session, or a malformed one', async () => {
  const member = await newReviewer();
  assert.equal((await req('PUT', '/api/watchlist/order', { ids: [] })).status, 401);
  assert.equal((await req('PUT', '/api/watchlist/order', { ids: 'nao' }, member.cookie)).status, 400);
});

test('removes a movie from the watchlist', async () => {
  const member = await newReviewer();
  const m = movie();
  await req('POST', '/api/watchlist', { movie: m }, member.cookie);

  assert.equal((await req('DELETE', `/api/watchlist/${m.id}`, null, member.cookie)).status, 204);

  const { body } = await req('GET', '/api/watchlist');
  assert.ok(!body.watchlist.some(w => w.id === m.id));
});
