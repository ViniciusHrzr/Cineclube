const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const dbPath = path.join(os.tmpdir(), `cineclube-feed-${crypto.randomUUID()}.db`);
process.env.CINECLUBE_DB = dbPath;

const app = require('../server');
const db = require('../db');
const { critsFor } = require('../criteria');

/* ══════════════════════════════════════════════════════════════════════════
   O mural.

   Derivado, como o sino: o que estes testes mais protegem é que ele não pode
   discordar da realidade. Um mural é lido pelo clube inteiro, então uma linha
   sobre um comentário apagado é o produto mentindo para todo mundo ao mesmo
   tempo — pior do que no sino, que é privado.

   E a linha rica: onze critérios são o que este produto tem de próprio, e a
   ficha no mural carrega o mais alto e o mais baixo da pessoa. A regra de
   quando NÃO carregar é tão importante quanto: uma ficha de notas iguais não
   tem entusiasmo nem decepção, e apontar dois critérios ali inventaria uma
   opinião que ninguém teve.
   ══════════════════════════════════════════════════════════════════════════ */

let baseUrl;
let server;

test.before(async () => {
  await app.ready;
  server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  await new Promise(resolve => server.close(resolve));
  db.close();
  for (const suffix of ['', '-shm', '-wal']) {
    try { fs.rmSync(dbPath + suffix, { force: true }); } catch { /* it is a temp file */ }
  }
});

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
  return { status: res.status, body: text ? JSON.parse(text) : null, setCookie: res.headers.get('set-cookie') };
}

const cookieOf = s => (s ? s.split(';')[0] : null);
let seq = 0;
const PIN = '4321';

async function newReviewer(name) {
  const res = await req('POST', '/api/reviewers', { name: name || `Sócio ${++seq}`, pin: PIN });
  const login = await req('POST', '/api/auth/login', { reviewerId: res.body.id, pin: PIN });
  return { ...res.body, cookie: cookieOf(login.setCookie) };
}

const movie = () => ({ id: 900000 + ++seq, title: `Filme ${seq}`, year: 2024, genre: 'Terror' });

function scoresFor(genre, value) {
  const o = {};
  critsFor(genre).forEach(c => { o[c.key] = value; });
  return o;
}

async function newTake(who, scores, m) {
  const film = m || movie();
  const res = await req('POST', '/api/reviews', {
    movie: film, scores: scores || scoresFor('Terror', 7)
  }, who.cookie);
  assert.equal(res.status, 201);
  return { ...res.body, movie: film };
}

const feed = () => req('GET', '/api/feed');
const kindsOf = items => items.map(i => i.kind);

/* ── as quatro coisas que viram linha ────────────────────────────────── */

test('uma avaliação vira linha, com o filme e a nota', async () => {
  const who = await newReviewer('Beren Costa');
  const take = await newTake(who);

  const { body } = await feed();
  const mine = body.items.find(i => i.reviewId === take.id);
  assert.ok(mine, 'a avaliação não apareceu no mural');
  assert.equal(mine.kind, 'review');
  assert.equal(mine.actor.name, 'Beren Costa');
  assert.equal(mine.movieTitle, take.movie.title);
  assert.equal(mine.final, 7);
});

test('um comentário vira linha, e diz de quem é a ficha', async () => {
  const author = await newReviewer('Dono');
  const reader = await newReviewer('Leitor');
  const take = await newTake(author);
  await req('POST', `/api/social/reviews/${take.id}/comments`, { body: 'discordo' }, reader.cookie);

  const { body } = await feed();
  const line = body.items.find(i => i.kind === 'comment' && i.reviewId === take.id);
  assert.ok(line);
  assert.equal(line.actor.name, 'Leitor');
  assert.equal(line.owner.name, 'Dono');
  assert.equal(line.excerpt, 'discordo');
});

test('um voto vira linha, com o critério pelo nome do gênero da ficha', async () => {
  const author = await newReviewer();
  const reader = await newReviewer();
  const m = { ...movie(), genre: 'Animação' };
  const take = (await req('POST', '/api/reviews', {
    movie: m, scores: scoresFor('Animação', 8)
  }, author.cookie)).body;
  await req('PUT', `/api/social/reviews/${take.id}/criteria/vozes/vote`, { value: -1 }, reader.cookie);

  const { body } = await feed();
  const line = body.items.find(i => i.kind === 'vote' && i.reviewId === take.id);
  assert.ok(line);
  assert.equal(line.criterion, 'Vozes');
  assert.equal(line.value, -1);
});

test('um filme posto na fila vira linha, com quem pôs', async () => {
  const who = await newReviewer('Gipico');
  const m = movie();
  assert.equal((await req('POST', '/api/watchlist', { movie: m }, who.cookie)).status, 201);

  const { body } = await feed();
  const line = body.items.find(i => i.kind === 'queued' && i.movieId === m.id);
  assert.ok(line, 'a fila não virou linha');
  assert.equal(line.actor.name, 'Gipico');
});

test('curtida em comentário não entra — é reação a uma reação', async () => {
  const author = await newReviewer();
  const writer = await newReviewer();
  const liker = await newReviewer();
  const take = await newTake(author);
  const c = (await req('POST', `/api/social/reviews/${take.id}/comments`, { body: 'x' }, writer.cookie)).body;
  await req('PUT', `/api/social/comments/${c.id}/like`, { liked: true }, liker.cookie);

  const { body } = await feed();
  assert.ok(!kindsOf(body.items).includes('like'), 'a curtida virou linha');
});

/* ── o alto e o baixo, que é o que só este produto sabe dizer ─────────── */

test('a ficha carrega onde a pessoa se entusiasmou e onde se decepcionou', async () => {
  const who = await newReviewer();
  const scores = { ...scoresFor('Terror', 6), fotografia: 10, roteiro: 3 };
  const take = await newTake(who, scores);

  const { body } = await feed();
  const line = body.items.find(i => i.reviewId === take.id);
  assert.ok(line.ends, 'a ficha veio sem alto e baixo');
  assert.equal(line.ends.high.name, 'Fotografia');
  assert.equal(line.ends.high.value, 10);
  assert.equal(line.ends.low.name, 'Roteiro');
  assert.equal(line.ends.low.value, 3);
});

test('uma ficha sem distância não inventa um alto e um baixo', async () => {
  const who = await newReviewer();
  const take = await newTake(who, scoresFor('Terror', 7));

  const { body } = await feed();
  const line = body.items.find(i => i.reviewId === take.id);
  assert.equal(line.ends, null, 'onze notas iguais produziram uma preferência');
});

test('meio ponto de diferença também não conta como preferência', async () => {
  const who = await newReviewer();
  const take = await newTake(who, { ...scoresFor('Terror', 7), som: 7.5 });

  const { body } = await feed();
  assert.equal(body.items.find(i => i.reviewId === take.id).ends, null);
});

/* ── ordem e verdade ─────────────────────────────────────────────────── */

test('o mural vem do mais novo para o mais velho', async () => {
  const who = await newReviewer();
  await newTake(who);
  await new Promise(r => setTimeout(r, 1100));
  const second = await newTake(who);

  const { body } = await feed();
  assert.equal(body.items[0].reviewId, second.id, 'o mais novo não está no topo');
  const stamps = body.items.map(i => String(i.at));
  assert.deepEqual(stamps, [...stamps].sort().reverse(), 'o mural saiu de ordem');
});

test('regravar traz a ficha de volta para o topo', async () => {
  const a = await newReviewer();
  const b = await newReviewer();
  const take = await newTake(a);
  await new Promise(r => setTimeout(r, 1100));
  await newTake(b);

  await new Promise(r => setTimeout(r, 1100));
  await req('POST', '/api/reviews', {
    movie: take.movie, scores: { ...scoresFor('Terror', 7), direcao: 2 }
  }, a.cookie);

  const { body } = await feed();
  assert.equal(body.items[0].reviewId, take.id, 'a regravação não subiu');
});

test('um comentário apagado some do mural', async () => {
  const author = await newReviewer();
  const reader = await newReviewer();
  const take = await newTake(author);
  const c = (await req('POST', `/api/social/reviews/${take.id}/comments`, { body: 'some' }, reader.cookie)).body;
  assert.ok((await feed()).body.items.some(i => i.id === `c:${c.id}`));

  await req('DELETE', `/api/social/comments/${c.id}`, null, reader.cookie);
  assert.ok(!(await feed()).body.items.some(i => i.id === `c:${c.id}`), 'a linha sobreviveu ao comentário');
});

test('uma avaliação apagada leva as linhas dela junto', async () => {
  const author = await newReviewer();
  const reader = await newReviewer();
  const take = await newTake(author);
  await req('POST', `/api/social/reviews/${take.id}/comments`, { body: 'oi' }, reader.cookie);
  await req('PUT', `/api/social/reviews/${take.id}/criteria/som/vote`, { value: 1 }, reader.cookie);

  await req('DELETE', `/api/reviews/${take.id}`, null, author.cookie);
  const { body } = await feed();
  assert.equal(body.items.filter(i => i.reviewId === take.id).length, 0);
});

test('o mural é leitura aberta, como o resto do acervo', async () => {
  assert.equal((await feed()).status, 200);
});
