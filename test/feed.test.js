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
const kit = require('../testkit');
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

/* A sala em que este arquivo inteiro acontece, e o prefixo das rotas dela.
   Antes dos clubes toda rota era `/api/algo`; agora as que falam de um acervo
   falam de UM acervo.

   Pública, e isso é o assunto de metade destes testes: ler um clube aberto não
   exige sessão nenhuma — a versão por sala do "leitura é aberta" que este
   produto sempre teve. O que o clube fechado faz está provado noutro lugar. */
let CLUB;
const at = p => `/api/c/${CLUB.slug}${p}`;

let baseUrl;
let server;

test.before(async () => {
  await app.ready;
  server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  CLUB = await kit.makeClub({ name: 'Clube do Mural', visibility: 'public' });
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

/** Uma conta com sessão, já dentro da sala deste arquivo. */
async function newReviewer(name) {
  const who = await kit.signIn(name || `Sócio ${++seq}`);
  await kit.join(CLUB.id, who.id);
  return who;
}

const movie = () => ({ id: 900000 + ++seq, title: `Filme ${seq}`, year: 2024, genre: 'Terror' });

function scoresFor(genre, value) {
  const o = {};
  critsFor(genre).forEach(c => { o[c.key] = value; });
  return o;
}

async function newTake(who, scores, m) {
  const film = m || movie();
  const res = await req('POST', at('/reviews'), {
    movie: film, scores: scores || scoresFor('Terror', 7)
  }, who.cookie);
  assert.equal(res.status, 201);
  return { ...res.body, movie: film };
}

const feed = () => req('GET', at('/feed'));
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
  await req('POST', at(`/social/reviews/${take.id}/comments`), { body: 'discordo' }, reader.cookie);

  const { body } = await feed();
  const line = body.items.find(i => i.kind === 'comment' && i.reviewId === take.id);
  assert.ok(line);
  assert.equal(line.actor.name, 'Leitor');
  assert.equal(line.owner.name, 'Dono');
  assert.equal(line.excerpt, 'discordo');
});

/* ── e o que o mural recusa ──────────────────────────────────────────────
   O corte de 26/08/2026, e ele é de proporção: um voto acontece até onze vezes
   por ficha por pessoa, então uma noite de discussão enterrava a ficha que
   originou a discussão embaixo de quarenta linhas sobre ela. Estes três testes
   são o que impede o mural de voltar a se afogar. */

/* O voto continua fora do mural mesmo agora que é um por ficha e não onze. O
   motivo de origem era proporção, e ele encolheu; o que sobra é outro e basta:
   concordar é uma reação, e o mural é sobre o que o clube FEZ — avaliou,
   escreveu. A concordância aparece contada na própria linha da ficha. */
test('voto não vira linha do mural — é reação, e ela aparece na ficha', async () => {
  const author = await newReviewer();
  const reader = await newReviewer();
  const take = await newTake(author);
  await req('PUT', at(`/social/reviews/${take.id}/vote`), { value: 1 }, reader.cookie);

  const { body } = await feed();
  assert.ok(!kindsOf(body.items).includes('vote'), 'o voto virou linha');
});

test('filme posto na fila não vira linha — é intenção, e tem uma aba própria', async () => {
  const who = await newReviewer('Gipico');
  const m = movie();
  assert.equal((await req('POST', at('/watchlist'), { movie: m }, who.cookie)).status, 201);

  const { body } = await feed();
  assert.ok(!kindsOf(body.items).includes('queued'), 'a fila virou linha');
});

test('curtida em comentário não entra — é reação a uma reação', async () => {
  const author = await newReviewer();
  const writer = await newReviewer();
  const liker = await newReviewer();
  const take = await newTake(author);
  const c = (await req('POST', at(`/social/reviews/${take.id}/comments`), { body: 'x' }, writer.cookie)).body;
  await req('PUT', at(`/social/comments/${c.id}/like`), { liked: true }, liker.cookie);

  const { body } = await feed();
  assert.ok(!kindsOf(body.items).includes('like'), 'a curtida virou linha');
});

test('o mural carrega exatamente dois tipos de linha', async () => {
  const author = await newReviewer();
  const reader = await newReviewer();
  const take = await newTake(author);
  await req('POST', at(`/social/reviews/${take.id}/comments`), { body: 'oi' }, reader.cookie);
  await req('PUT', at(`/social/reviews/${take.id}/vote`), { value: 1 }, reader.cookie);
  await req('POST', at('/watchlist'), { movie: movie() }, reader.cookie);

  const { body } = await feed();
  assert.deepEqual([...new Set(kindsOf(body.items))].sort(), ['comment', 'review']);
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
  await req('POST', at('/reviews'), {
    movie: take.movie, scores: { ...scoresFor('Terror', 7), direcao: 2 }
  }, a.cookie);

  const { body } = await feed();
  assert.equal(body.items[0].reviewId, take.id, 'a regravação não subiu');
});

test('um comentário apagado some do mural', async () => {
  const author = await newReviewer();
  const reader = await newReviewer();
  const take = await newTake(author);
  const c = (await req('POST', at(`/social/reviews/${take.id}/comments`), { body: 'some' }, reader.cookie)).body;
  assert.ok((await feed()).body.items.some(i => i.id === `c:${c.id}`));

  await req('DELETE', at(`/social/comments/${c.id}`), null, reader.cookie);
  assert.ok(!(await feed()).body.items.some(i => i.id === `c:${c.id}`), 'a linha sobreviveu ao comentário');
});

test('uma avaliação apagada leva as linhas dela junto', async () => {
  const author = await newReviewer();
  const reader = await newReviewer();
  const take = await newTake(author);
  await req('POST', at(`/social/reviews/${take.id}/comments`), { body: 'oi' }, reader.cookie);

  await req('DELETE', at(`/reviews/${take.id}`), null, author.cookie);
  const { body } = await feed();
  assert.equal(body.items.filter(i => i.reviewId === take.id).length, 0);
});

test('o mural é leitura aberta, como o resto do acervo', async () => {
  assert.equal((await feed()).status, 200);
});
