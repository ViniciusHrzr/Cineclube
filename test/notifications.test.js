const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const dbPath = path.join(os.tmpdir(), `cineclube-notif-${crypto.randomUUID()}.db`);
process.env.CINECLUBE_DB = dbPath;

const app = require('../server');
const db = require('../db');
const { critsFor } = require('../criteria');

/* ══════════════════════════════════════════════════════════════════════════
   O sino.

   O feed é derivado das três tabelas de reação, e é por isso que estes testes
   olham tanto para o que NÃO aparece nele quanto para o que aparece:

   · o que você mesmo fez nunca vira aviso;
   · um evento desfeito some do feed, porque não há cópia dele em lugar nenhum;
   · a marca d'água é uma data, então "não lidas" é quantos eventos são mais
     novos que ela — e ver o sino zera a conta sem apagar nada.
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

const movie = () => ({ id: 800000 + ++seq, title: `Filme ${seq}`, year: 2024, genre: 'Terror' });

function scoresFor(genre, value) {
  const o = {};
  critsFor(genre).forEach(c => { o[c.key] = value; });
  return o;
}

async function newTake(who) {
  const m = movie();
  const res = await req('POST', '/api/reviews', { movie: m, scores: scoresFor('Terror', 7) }, who.cookie);
  assert.equal(res.status, 201);
  return { ...res.body, movie: m };
}

const feed = who => req('GET', '/api/notifications', null, who.cookie);
const seen = who => req('POST', '/api/notifications/seen', {}, who.cookie);

const comment = (take, body, who) =>
  req('POST', `/api/social/reviews/${take.id}/comments`, { body }, who.cookie);
const vote = (take, value, who) =>
  req('PUT', `/api/social/reviews/${take.id}/vote`, { value }, who.cookie);
const like = (c, liked, who) =>
  req('PUT', `/api/social/comments/${c.id}/like`, { liked }, who.cookie);

/* ── as três coisas que acendem o sino ───────────────────────────────── */

test('um comentário na minha ficha vira aviso, com trecho do que foi dito', async () => {
  const author = await newReviewer();
  const reader = await newReviewer('Bruno Sá');
  const take = await newTake(author);
  await comment(take, 'teu 7 em roteiro é generoso', reader);

  const { body } = await feed(author);
  assert.equal(body.items.length, 1);
  const item = body.items[0];
  assert.equal(item.kind, 'comment');
  assert.equal(item.actor.id, reader.id);
  assert.equal(item.reviewId, take.id);
  assert.match(item.text, /comentou sua avaliação/);
  assert.equal(item.excerpt, 'teu 7 em roteiro é generoso');
});

test('um voto na minha ficha vira aviso, e diz o filme', async () => {
  const author = await newReviewer();
  const reader = await newReviewer();
  const take = await newTake(author);
  await vote(take, 1, reader);

  const { body } = await feed(author);
  assert.equal(body.items.length, 1);
  assert.equal(body.items[0].kind, 'vote');
  assert.equal(body.items[0].value, 1);
  assert.match(body.items[0].text, /concordou com sua avaliação de/);
});

test('discordar diz discordou, e não concordou com sinal trocado', async () => {
  const author = await newReviewer();
  const reader = await newReviewer();
  const take = await newTake(author);
  await vote(take, -1, reader);

  const { body } = await feed(author);
  assert.match(body.items[0].text, /discordou da sua avaliação de/);
});

/* Um por pessoa por ficha. Quando o voto era por critério, a mesma pessoa
   podia encher o sino com onze avisos sobre a mesma avaliação — e o que ela
   estava dizendo era uma coisa só. */
test('a mesma pessoa votando de novo não vira um segundo aviso', async () => {
  const author = await newReviewer();
  const reader = await newReviewer();
  const take = await newTake(author);

  await vote(take, 1, reader);
  await vote(take, -1, reader);

  const { body } = await feed(author);
  assert.equal(body.items.length, 1);
  assert.equal(body.items[0].value, -1);
});

test('curtir meu comentário vira aviso, mesmo na ficha de outra pessoa', async () => {
  const host = await newReviewer();
  const writer = await newReviewer();
  const liker = await newReviewer();
  const take = await newTake(host);
  const c = (await comment(take, 'a cena do corredor', writer)).body;

  await like(c, true, liker);
  const { body } = await feed(writer);
  const mine = body.items.filter(i => i.kind === 'like');
  assert.equal(mine.length, 1);
  assert.equal(mine[0].actor.id, liker.id);
  assert.equal(mine[0].excerpt, 'a cena do corredor');
});

/* ── responder e mencionar ───────────────────────────────────────────── */

test('responder meu comentário me avisa, mesmo na ficha de outra pessoa', async () => {
  const host = await newReviewer();
  const writer = await newReviewer();
  const answerer = await newReviewer();
  const take = await newTake(host);
  const parent = (await comment(take, 'o roteiro cai', writer)).body;
  await req('POST', `/api/social/reviews/${take.id}/comments`, {
    body: 'discordo', parentId: parent.id
  }, answerer.cookie);

  const { body } = await feed(writer);
  const mine = body.items.filter(i => i.kind === 'reply');
  assert.equal(mine.length, 1);
  assert.equal(mine[0].actor.id, answerer.id);
  assert.equal(mine[0].excerpt, 'discordo');
});

test('o dono da ficha não recebe dois avisos pelo mesmo texto', async () => {
  // Uma resposta pendurada num comentário da minha ficha me avisaria como
  // "comentou sua avaliação" E como resposta, sendo que nem fui eu que escrevi
  // o comentário respondido.
  const host = await newReviewer();
  const a = await newReviewer();
  const b = await newReviewer();
  const take = await newTake(host);
  const parent = (await comment(take, 'primeiro', a)).body;
  await req('POST', `/api/social/reviews/${take.id}/comments`, {
    body: 'respondendo', parentId: parent.id
  }, b.cookie);

  const { body } = await feed(host);
  assert.equal(body.items.length, 1, 'o dono da ficha foi avisado duas vezes');
  assert.equal(body.items[0].excerpt, 'primeiro');
});

test('ser mencionado num comentário acende o sino', async () => {
  const host = await newReviewer('Dono da Ficha');
  const chamado = await newReviewer('Beren Costa');
  const quemChama = await newReviewer('Bruno Sá');
  const take = await newTake(host);
  await comment(take, '@beren o terceiro ato desmonta', quemChama);

  const { body } = await feed(chamado);
  const mention = body.items.filter(i => i.kind === 'mention');
  assert.equal(mention.length, 1);
  assert.equal(mention[0].actor.id, quemChama.id);
  assert.match(mention[0].text, /mencionou você/);
});

test('ser mencionado no comentário de uma avaliação também acende', async () => {
  // O outro lugar do produto onde se escreve.
  const chamado = await newReviewer('Cauro Neves');
  const quemAvalia = await newReviewer();
  await req('POST', '/api/reviews', {
    movie: movie(), scores: scoresFor('Terror', 7), comment: 'discordo do @cauro nessa'
  }, quemAvalia.cookie);

  const { body } = await feed(chamado);
  assert.equal(body.items.filter(i => i.kind === 'mention').length, 1);
});

test('mencionar a si mesmo não acende nada', async () => {
  const eu = await newReviewer('Gipico Alves');
  const host = await newReviewer();
  const take = await newTake(host);
  await comment(take, 'como o @gipico disse', eu);

  assert.equal((await feed(eu)).body.items.length, 0);
});

test('responder e mencionar na mesma frase é um aviso, não dois', async () => {
  const host = await newReviewer();
  const writer = await newReviewer('Leonardo Dias');
  const answerer = await newReviewer();
  const take = await newTake(host);
  const parent = (await comment(take, 'primeiro', writer)).body;
  await req('POST', `/api/social/reviews/${take.id}/comments`, {
    body: '@leonardo discordo', parentId: parent.id
  }, answerer.cookie);

  const { body } = await feed(writer);
  assert.equal(body.items.length, 1, 'o mesmo texto virou dois avisos');
  assert.equal(body.items[0].kind, 'reply', 'a resposta é o fato mais forte');
});

test('um e-mail no comentário não menciona ninguém', async () => {
  const chamado = await newReviewer('Ana Reis');
  const host = await newReviewer();
  const outro = await newReviewer();
  const take = await newTake(host);
  await comment(take, 'manda pro ana@gmail.com', outro);

  assert.equal((await feed(chamado)).body.items.length, 0);
});

/* ── o que não acende ────────────────────────────────────────────────── */

test('o que você mesmo faz nunca vira aviso para você', async () => {
  const author = await newReviewer();
  const take = await newTake(author);
  await comment(take, 'respondendo a mim mesmo', author);

  const { body } = await feed(author);
  assert.equal(body.items.length, 0, 'comentar a própria ficha acendeu o próprio sino');
  assert.equal(body.unread, 0);
});

test('reação na ficha de outra pessoa não aparece no meu sino', async () => {
  const author = await newReviewer();
  const other = await newReviewer();
  const reader = await newReviewer();
  const take = await newTake(author);
  await comment(take, 'nada a ver comigo', reader);

  assert.equal((await feed(other)).body.items.length, 0);
});

test('um evento desfeito some do feed, porque não há cópia dele', async () => {
  const author = await newReviewer();
  const reader = await newReviewer();
  const take = await newTake(author);

  await vote(take, 1, reader);
  assert.equal((await feed(author)).body.items.length, 1);

  await vote(take, 0, reader);
  assert.equal((await feed(author)).body.items.length, 0, 'o aviso sobreviveu ao voto retirado');
});

test('apagar o comentário apaga o aviso sobre ele', async () => {
  const author = await newReviewer();
  const reader = await newReviewer();
  const take = await newTake(author);
  const c = (await comment(take, 'some comigo', reader)).body;
  assert.equal((await feed(author)).body.items.length, 1);

  await req('DELETE', `/api/social/comments/${c.id}`, null, reader.cookie);
  assert.equal((await feed(author)).body.items.length, 0);
});

/* ── a marca d'água ──────────────────────────────────────────────────── */

test('tudo é novo até a primeira vez que o sino é aberto', async () => {
  const author = await newReviewer();
  const a = await newReviewer();
  const b = await newReviewer();
  const take = await newTake(author);
  await comment(take, 'primeiro', a);
  await vote(take, 1, b);

  const before = await feed(author);
  assert.equal(before.body.items.length, 2);
  assert.equal(before.body.unread, 2, 'quem nunca abriu o sino tem tudo por ler');
  assert.equal(before.body.seenAt, null);
});

test('ver o sino zera a conta sem apagar o histórico', async () => {
  const author = await newReviewer();
  const reader = await newReviewer();
  const take = await newTake(author);
  await comment(take, 'oi', reader);

  assert.equal((await seen(author)).status, 200);
  const after = await feed(author);
  assert.equal(after.body.unread, 0, 'a conta não zerou');
  assert.equal(after.body.items.length, 1, 'o histórico foi apagado junto');
  assert.ok(after.body.seenAt, 'a marca d\'água não foi gravada');
});

test('o que chega depois de visto conta como novo de novo', async () => {
  const author = await newReviewer();
  const a = await newReviewer();
  const b = await newReviewer();
  const take = await newTake(author);
  await comment(take, 'antes', a);
  await seen(author);

  // datetime('now') tem resolução de um segundo, então um evento gravado no
  // mesmo segundo da marca não conta como posterior a ela. Espera o relógio
  // virar antes de gerar o segundo, senão este teste mede a resolução do
  // banco em vez da regra.
  await new Promise(r => setTimeout(r, 1100));
  await comment(take, 'depois', b);

  const { body } = await feed(author);
  assert.equal(body.items.length, 2);
  assert.equal(body.unread, 1, 'só o que veio depois da marca é novo');
});

test('a marca de uma pessoa não mexe na de outra', async () => {
  const a = await newReviewer();
  const b = await newReviewer();
  const reader = await newReviewer();
  const takeA = await newTake(a);
  const takeB = await newTake(b);
  await comment(takeA, 'para a', reader);
  await comment(takeB, 'para b', reader);

  await seen(a);
  assert.equal((await feed(a)).body.unread, 0);
  assert.equal((await feed(b)).body.unread, 1, 'ver o sino de um zerou o do outro');
});

/* ── limpar ──────────────────────────────────────────────────────────── */

const clear = who => req('POST', '/api/notifications/clear', {}, who.cookie);

test('limpar esvazia a lista e zera a conta', async () => {
  const author = await newReviewer();
  const a = await newReviewer();
  const b = await newReviewer();
  const take = await newTake(author);
  await comment(take, 'um', a);
  await vote(take, 1, b);
  assert.equal((await feed(author)).body.items.length, 2);

  assert.equal((await clear(author)).status, 200);
  const after = await feed(author);
  assert.equal(after.body.items.length, 0);
  assert.equal(after.body.unread, 0);
});

test('limpar não apaga o comentário nem o voto — só a projeção deles', async () => {
  const author = await newReviewer();
  const reader = await newReviewer();
  const take = await newTake(author);
  const c = (await comment(take, 'isto tem de sobreviver', reader)).body;
  await vote(take, 1, reader);

  await clear(author);

  // O sino do autor esvaziou, mas o que as outras pessoas escreveram continua
  // lá para o clube inteiro ver.
  const social = (await req('GET', '/api/social')).body;
  assert.ok(social.comments.some(x => x.id === c.id), 'o comentário foi apagado');
  assert.equal(social.votes.filter(v => v.reviewId === take.id).length, 1, 'o voto foi apagado');
});

test('o que chega depois de limpar volta a aparecer', async () => {
  const author = await newReviewer();
  const a = await newReviewer();
  const b = await newReviewer();
  const take = await newTake(author);
  await comment(take, 'antes', a);
  await clear(author);

  // datetime('now') tem resolução de um segundo: um evento gravado no mesmo
  // segundo da marca não é posterior a ela.
  await new Promise(r => setTimeout(r, 1100));
  await comment(take, 'depois', b);

  const { body } = await feed(author);
  assert.equal(body.items.length, 1, 'a lista deveria ter só o que veio depois');
  assert.equal(body.items[0].excerpt, 'depois');
  assert.equal(body.unread, 1, 'o que chega depois de limpar é novo');
});

test('limpar o próprio sino não mexe no de ninguém', async () => {
  const a = await newReviewer();
  const b = await newReviewer();
  const reader = await newReviewer();
  const takeA = await newTake(a);
  const takeB = await newTake(b);
  await comment(takeA, 'para a', reader);
  await comment(takeB, 'para b', reader);

  await clear(a);
  assert.equal((await feed(a)).body.items.length, 0);
  assert.equal((await feed(b)).body.items.length, 1, 'limpar de um esvaziou o do outro');
});

test('limpar exige sessão', async () => {
  assert.equal((await req('POST', '/api/notifications/clear', {})).status, 401);
});

/* ── quem pode ler ───────────────────────────────────────────────────── */

test('o sino exige sessão — nas duas rotas', async () => {
  assert.equal((await req('GET', '/api/notifications')).status, 401);
  assert.equal((await req('POST', '/api/notifications/seen', {})).status, 401);
});

test('o feed é o de quem está logado, e não aceita um id no caminho', async () => {
  const author = await newReviewer();
  const reader = await newReviewer();
  const take = await newTake(author);
  await comment(take, 'só o autor vê isto', reader);

  // A sessão é a única coisa que escolhe o destinatário: o leitor, com a
  // própria sessão, não vê o aviso que é do autor.
  assert.equal((await feed(reader)).body.items.length, 0);
  assert.equal((await feed(author)).body.items.length, 1);
});
