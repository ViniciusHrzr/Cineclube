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
   1b. SQL DENTRO DO TEXTO

   Nada aqui escapa nem filtra aspas, e é de propósito: escapar é a defesa de
   quem monta SQL com texto, e este produto nunca monta. Todo valor viaja como
   parâmetro (`client.execute({ sql, args })`), então o banco recebe a consulta
   e os dados por caminhos separados e nunca lê um como o outro.

   A consequência prática é a que estes testes fixam: uma carga de injeção é
   gravada e devolvida LETRA POR LETRA, porque para o produto ela nunca foi
   código — é o que alguém escreveu sobre um filme. Um dia em que ela voltar
   modificada, ou faltando um pedaço, é o dia em que alguém começou a tratar
   texto como comando.

   As cargas abaixo são as clássicas, e a primeira é a que o dono do produto
   testou à mão em produção.
   ══════════════════════════════════════════════════════════════════════════ */

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

  /* E as tabelas que as cargas mandavam apagar continuam de pé. Se alguma
     tivesse sido executada, isto é o que teria sumido. */
  for (const tabela of ['reviews', 'review_comments', 'reviewers']) {
    const row = await db.prepare(`SELECT COUNT(*) AS n FROM ${tabela}`).get();
    assert.ok(Number.isFinite(Number(row.n)), `${tabela} deixou de existir`);
  }
});

test('injeção na conversa, no nome do clube e no título do filme, idem', async () => {
  const dono = await kit.signIn();
  const carga = CARGAS[0];

  /* Um nome de clube é o caso mais interessante dos três: ele é comparado com
     COLLATE NOCASE numa consulta de unicidade e vira um slug. */
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

  // E o clube ainda é encontrável pelo slug que saiu daquele nome.
  assert.equal((await req('GET', `/api/c/${sala.slug}`, null, dono.cookie)).status, 200);
});

/* ══════════════════════════════════════════════════════════════════════════
   1c. O QUE VAI PARA O LOG

   Um corpo com JSON torto fazia o `body-parser` levantar um erro com o corpo
   cru pendurado nele, e o tratador imprimia o erro inteiro. Duas consequências:
   qualquer um escrevia no log da instância a partir de fora, e um corpo
   quase-válido para `/api/auth/login` levava uma senha em texto puro junto.

   O que este teste fixa é a resposta; que o log ficou limpo está em server.js.
   ══════════════════════════════════════════════════════════════════════════ */

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
