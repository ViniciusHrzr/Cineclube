const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const dbPath = path.join(os.tmpdir(), `cineclube-abuse-${crypto.randomUUID()}.db`);
process.env.CINECLUBE_DB = dbPath;

const app = require('../server');
const db = require('../db');
const live = require('../live');
const screening = require('../screening');
const throttle = require('../throttle');
const { cleanMovie, MAX_TITLE, MAX_POSTER } = require('../movie');
const kit = require('../testkit');
const { critsFor } = require('../criteria');

let baseUrl;
let server;

test.before(async () => {
  await app.ready;
  server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  live.stopTimers();
  screening.stopTimers();
  throttle.stopTimers();
  const closed = new Promise(resolve => server.close(resolve));
  server.closeAllConnections?.();
  await closed;
  db.close();
  for (const suffix of ['', '-shm', '-wal']) {
    try { fs.rmSync(dbPath + suffix, { force: true }); } catch { }
  }
});

test.beforeEach(() => throttle.reset());

async function req(method, pathname, body, cookie) {
  const headers = {};
  if (body) headers['Content-Type'] = 'application/json';
  if (cookie) headers.Cookie = cookie;
  const res = await fetch(baseUrl + pathname, {
    method,
    headers: Object.keys(headers).length ? headers : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let parsed = null;
  try { parsed = text ? JSON.parse(text) : null; } catch { parsed = null; }
  return { status: res.status, body: parsed, retryAfter: res.headers.get('retry-after') };
}

let seq = 0;
const at = (club, p) => `/api/c/${club.slug}${p}`;
const movie = extra => ({
  id: 700000 + ++seq, title: `Filme ${seq}`, year: 2024, genre: 'Terror', poster: null, ...extra,
});

function scoresFor(genre, value) {
  const o = {};
  critsFor(genre).forEach(c => { o[c.key] = value; });
  return o;
}

test('o filme é saneado antes de virar linha', () => {
  const gigante = cleanMovie({
    id: 42,
    title: 'x'.repeat(50_000),
    poster: 'p'.repeat(50_000),
    director: 'd'.repeat(50_000),
    genre: 'Gênero Inventado',
    year: 99999,
    runtime: -3,
  });
  assert.equal(gigante.movie.title.length, MAX_TITLE);
  assert.equal(gigante.movie.poster.length, MAX_POSTER);
  assert.ok(gigante.movie.director.length <= 200);
  assert.equal(gigante.movie.genre, 'Drama', 'um gênero de fora da lista cai em Drama');
  assert.equal(gigante.movie.year, null, 'um ano impossível vira ausência, não erro');
  assert.equal(gigante.movie.runtime, null);
});

test('um filme sem id ou sem título não entra', () => {
  assert.ok(cleanMovie(null).error);
  assert.ok(cleanMovie({ title: 'Sem id' }).error);
  assert.ok(cleanMovie({ id: 1, title: '   ' }).error, 'um título de espaços é um título vazio');
  assert.ok(cleanMovie({ id: 'muitos', title: 'x' }).error, 'o id precisa ser um número');
  assert.ok(cleanMovie({ id: 1e15, title: 'x' }).error, 'e um número de verdade do TMDB');
});

test('uma avaliação não consegue gravar um título gigante', async () => {
  const dono = await kit.signIn();
  const sala = await kit.makeClub({ owner: dono.id, visibility: 'private' });
  const m = movie({ title: 'A'.repeat(40_000) });

  const posted = await req(
    'POST', at(sala, '/reviews'), { movie: m, scores: scoresFor('Terror', 8) }, dono.cookie
  );
  assert.equal(posted.status, 201);

  const row = await db
    .prepare('SELECT movie_title FROM reviews WHERE club_id = ? AND movie_id = ?')
    .get(sala.id, m.id);
  assert.equal(row.movie_title.length, MAX_TITLE, 'o que foi gravado tem o tamanho do teto');
});

test('a fila também corta', async () => {
  const dono = await kit.signIn();
  const sala = await kit.makeClub({ owner: dono.id, visibility: 'private' });
  const m = movie({ title: 'B'.repeat(40_000) });

  assert.equal((await req('POST', at(sala, '/watchlist'), { movie: m }, dono.cookie)).status, 201);
  const row = await db
    .prepare('SELECT movie_title FROM watchlist WHERE club_id = ? AND movie_id = ?')
    .get(sala.id, m.id);
  assert.equal(row.movie_title.length, MAX_TITLE);
});

const CARGAS = [
  `'');SELECT * FROM review_comments;`,
  `'; DROP TABLE reviews; --`,
  `" OR 1=1 --`,
  `\\'; DELETE FROM reviewers WHERE ''='`,
  `%27%20OR%20%271%27%3D%271`,
];

test('injeção no comentário de uma ficha é gravada como texto', async () => {
  const dono = await kit.signIn();
  const sala = await kit.makeClub({ owner: dono.id, visibility: 'private' });

  for (const carga of CARGAS) {
    const m = movie();
    const posted = await req(
      'POST', at(sala, '/reviews'),
      { movie: m, scores: scoresFor('Terror', 8), comment: carga },
      dono.cookie
    );
    assert.equal(posted.status, 201);
    assert.equal(posted.body.comment, carga, 'volta letra por letra');
  }

  for (const tabela of ['reviews', 'review_comments', 'reviewers']) {
    const row = await db.prepare(`SELECT COUNT(*) AS n FROM ${tabela}`).get();
    assert.ok(Number.isFinite(Number(row.n)), `${tabela} deixou de existir`);
  }
});

test('injeção na conversa, no nome do clube e no título do filme, idem', async () => {
  const dono = await kit.signIn();
  const carga = CARGAS[0];

  const feito = await req('POST', '/api/clubs', { name: `Sala ${carga}`.slice(0, 40) }, dono.cookie);
  assert.equal(feito.status, 201);
  const sala = feito.body.club;
  assert.equal(sala.name, `Sala ${carga}`.slice(0, 40));

  const ficha = await req(
    'POST', `/api/c/${sala.slug}/reviews`,
    { movie: movie({ title: carga }), scores: scoresFor('Terror', 6) },
    dono.cookie
  );
  assert.equal(ficha.status, 201);
  assert.equal(ficha.body.movieTitle, carga, 'o título volta inteiro');

  const dito = await req(
    'POST', `/api/c/${sala.slug}/social/reviews/${ficha.body.id}/comments`,
    { body: carga }, dono.cookie
  );
  assert.equal(dito.status, 201);
  assert.equal(dito.body.body, carga);

  assert.equal((await req('GET', `/api/c/${sala.slug}`, null, dono.cookie)).status, 200);
});

test('JSON torto é 400 do cliente, e não 500 do servidor', async () => {
  const res = await fetch(baseUrl + '/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{"email":"x@y.z","password":"nao-fecha-a-chave"',
  });
  assert.equal(res.status, 400, 'um corpo ilegível é erro de quem mandou');
  const corpo = await res.json();
  assert.ok(corpo.error);
  assert.ok(
    !JSON.stringify(corpo).includes('nao-fecha-a-chave'),
    'e a resposta não devolve o corpo que não conseguiu ler'
  );
});

test('cadastrar em rajada bate na porta', async () => {
  const conta = n => ({
    name: `Bot ${n}`,
    email: `bot-${crypto.randomUUID().slice(0, 8)}@exemplo.com`,
    password: 'senha-comprida-o-bastante',
  });

  const feitas = [];
  for (let i = 0; i < 7; i++) feitas.push(await req('POST', '/api/auth/register', conta(i)));

  const criadas = feitas.filter(r => r.status === 201).length;
  const travadas = feitas.filter(r => r.status === 429);
  assert.equal(criadas, 5, 'cinco entram');
  assert.equal(travadas.length, 2, 'e o resto bate no 429');
  assert.match(travadas[0].body.error, /Tente de novo em/);
  assert.ok(Number(travadas[0].retryAfter) > 0, 'e o cabeçalho, para quem não é navegador');
});

test('fundar clube em rajada também', async () => {
  const dono = await kit.signIn();
  const feitos = [];
  for (let i = 0; i < 7; i++) {
    feitos.push(await req('POST', '/api/clubs', { name: `Sala ${crypto.randomUUID().slice(0, 8)}` }, dono.cookie));
  }
  assert.equal(feitos.filter(r => r.status === 201).length, 1, 'cada pessoa funda um clube');
  assert.equal(feitos[1].status, 403);
  assert.equal(feitos.filter(r => r.status === 429).length, 2);
});

test('comentar em rajada bate na porta', async () => {
  const dono = await kit.signIn();
  const sala = await kit.makeClub({ owner: dono.id, visibility: 'private' });
  const ficha = await req(
    'POST', at(sala, '/reviews'), { movie: movie(), scores: scoresFor('Terror', 7) }, dono.cookie
  );

  const ditos = [];
  for (let i = 0; i < 23; i++) {
    ditos.push(await req(
      'POST', at(sala, `/social/reviews/${ficha.body.id}/comments`), { body: `linha ${i}` }, dono.cookie
    ));
  }
  assert.equal(ditos.filter(r => r.status === 201).length, 20);
  assert.equal(ditos.filter(r => r.status === 429).length, 3);
});

test('bater na porta trancada não estende a tranca', async () => {
  const dono = await kit.signIn();
  const nome = () => ({ name: `Sala ${crypto.randomUUID().slice(0, 8)}` });
  for (let i = 0; i < 5; i++) await req('POST', '/api/clubs', nome(), dono.cookie);

  const primeira = await req('POST', '/api/clubs', nome(), dono.cookie);
  assert.equal(primeira.status, 429);
  for (let i = 0; i < 10; i++) await req('POST', '/api/clubs', nome(), dono.cookie);
  const depois = await req('POST', '/api/clubs', nome(), dono.cookie);

  assert.equal(depois.status, 429);
  assert.ok(
    Number(depois.retryAfter) <= Number(primeira.retryAfter),
    'a espera anda para frente no tempo, e não para trás a cada tentativa'
  );
});

test('o limite é de cada conta, não do clube', async () => {
  const um = await kit.signIn();
  const outro = await kit.signIn();
  const sala = await kit.makeClub({ owner: um.id, visibility: 'private' });
  await kit.join(sala.id, outro.id);
  const ficha = await req(
    'POST', at(sala, '/reviews'), { movie: movie(), scores: scoresFor('Terror', 7) }, um.cookie
  );
  const rota = at(sala, `/social/reviews/${ficha.body.id}/comments`);

  for (let i = 0; i < 20; i++) await req('POST', rota, { body: `x${i}` }, um.cookie);
  assert.equal((await req('POST', rota, { body: 'mais uma' }, um.cookie)).status, 429);
  assert.equal(
    (await req('POST', rota, { body: 'e eu?' }, outro.cookie)).status,
    201,
    'a cota de quem falou muito não cala quem não falou nada'
  );
});
