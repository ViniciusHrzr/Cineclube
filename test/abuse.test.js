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

/* ══════════════════════════════════════════════════════════════════════════
   O que o produto faz com quem não está usando o produto.

   As outras suítes verificam que as coisas funcionam, e `clubs.test.js` que as
   paredes entre salas seguram. Esta verifica o terceiro caso: um cliente que faz
   exatamente o que a API permite, muitas vezes por segundo.

   Dois assuntos, e eles falham de jeitos diferentes:

   1. **O tamanho do que entra.** Um título de novecentos mil caracteres não é um
      ataque esperto: é o corpo de 1 MB usado como foi permitido. Como o `id` do
      filme é escolhido por quem escreve, a unicidade não segura nada — e o plano
      do banco tem 500 MB, cuja punição por estourar é a suspensão.

   2. **Quantas vezes.** Cadastro, clube, ficha, fila e comentário. O cadastro é o
      que mais importa, porque toda outra trava conta por conta e uma conta nova
      custa uma requisição.
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
  live.stopTimers();
  screening.stopTimers();
  throttle.stopTimers();
  const closed = new Promise(resolve => server.close(resolve));
  server.closeAllConnections?.();
  await closed;
  db.close();
  for (const suffix of ['', '-shm', '-wal']) {
    try { fs.rmSync(dbPath + suffix, { force: true }); } catch { /* it is a temp file */ }
  }
});

/* Cada teste começa com todas as janelas limpas. Sem isto a ordem dos testes
   passaria a importar: o teto de trás (300/min por endereço) é compartilhado, e
   todos eles falam com 127.0.0.1. */
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

/* ══════════════════════════════════════════════════════════════════════════
   1. O TAMANHO
   ══════════════════════════════════════════════════════════════════════════ */

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

/* ══════════════════════════════════════════════════════════════════════════
   2. QUANTAS VEZES
   ══════════════════════════════════════════════════════════════════════════ */

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
  /* A mensagem tem de dizer quando passa: um "agora não" sem prazo é uma porta
     sem maçaneta, e quem está do outro lado costuma ser gente. */
  assert.match(travadas[0].body.error, /Tente de novo em/);
  assert.ok(Number(travadas[0].retryAfter) > 0, 'e o cabeçalho, para quem não é navegador');
});

test('fundar clube em rajada também', async () => {
  const dono = await kit.signIn();
  const feitos = [];
  for (let i = 0; i < 7; i++) {
    feitos.push(await req('POST', '/api/clubs', { name: `Sala ${crypto.randomUUID().slice(0, 8)}` }, dono.cookie));
  }
  assert.equal(feitos.filter(r => r.status === 201).length, 5);
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

/* ══════════════════════════════════════════════════════════════════════════
   A trava tem de ter fim.

   Uma requisição recusada não conta. Se contasse, quem esbarrasse no limite e
   continuasse tentando empurraria a própria janela para sempre — e uma trava
   sem fim é um banimento que ninguém decidiu aplicar.
   ══════════════════════════════════════════════════════════════════════════ */

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

/* Duas pessoas não dividem a mesma cota. Se dividissem, uma noite de clube em
   que alguém escreve muito calaria todo mundo — e o limite deixaria de ser
   sobre abuso para ser sobre quem chegou primeiro. */
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
