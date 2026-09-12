const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const dbPath = path.join(os.tmpdir(), `cineclube-notices-${crypto.randomUUID()}.db`);
process.env.CINECLUBE_DB = dbPath;

const app = require('../server');
const db = require('../db');
const live = require('../live');
const screening = require('../screening');
const throttle = require('../throttle');
const kit = require('../testkit');
const { critsFor } = require('../criteria');

/* ══════════════════════════════════════════════════════════════════════════
   O SINO DA REDE.

   Um sino, em todo lugar. Antes havia um por sala e ele só existia dentro dela:
   quem estava em três clubes tinha três sinos e precisava entrar em cada um para
   descobrir se alguém tinha respondido. O saguão não tinha nenhum — justamente a
   tela em que "o que aconteceu enquanto eu não estava?" é a única pergunta.

   O que estes testes fixam:

   1. A lista junta as salas todas, e cada linha diz de qual sala veio.
   2. Ela NÃO junta as salas de que a pessoa não é. Esta é a mesma parede que
      `clubs.test.js` protege nas outras quatro superfícies, e é a que mais fácil
      cairia aqui: a consulta antiga filtrava por `req.club.id`, e esta filtra
      por uma lista que o servidor monta.
   3. As marcas d'água continuam por sala, e o sino da rede move todas.
   4. O aviso de conta não é um acontecimento: não some ao limpar.
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
  return { status: res.status, body: parsed, setCookie: res.headers.get('set-cookie') };
}

let seq = 0;
const at = (club, p) => `/api/c/${club.slug}${p}`;
const movie = () => ({ id: 800000 + ++seq, title: `Filme ${seq}`, year: 2024, genre: 'Terror' });

function scoresFor(genre, value) {
  const o = {};
  critsFor(genre).forEach(c => { o[c.key] = value; });
  return o;
}

/** Uma ficha do dono, comentada por outra pessoa: o aviso mais simples que existe. */
async function salaComAviso(dono, quemComenta, texto = 'discordo do teu 8') {
  const sala = await kit.makeClub({ owner: dono.id, visibility: 'private' });
  await kit.join(sala.id, quemComenta.id);
  const ficha = await req(
    'POST', at(sala, '/reviews'), { movie: movie(), scores: scoresFor('Terror', 8) }, dono.cookie
  );
  await req(
    'POST', at(sala, `/social/reviews/${ficha.body.id}/comments`), { body: texto }, quemComenta.cookie
  );
  return { sala, ficha: ficha.body };
}

/* ══════════════════════════════════════════════════════════════════════════
   1. UMA LISTA, TODAS AS SALAS
   ══════════════════════════════════════════════════════════════════════════ */

test('o sino junta as salas de que a pessoa é, e diz de qual veio cada linha', async () => {
  const dono = await kit.signIn();
  const outro = await kit.signIn();
  const uma = await salaComAviso(dono, outro, 'na primeira sala');
  const outra = await salaComAviso(dono, outro, 'na segunda sala');

  const sino = await req('GET', '/api/notices', null, dono.cookie);
  assert.equal(sino.status, 200);
  /* Três e não duas: toda conta nova nasce no clube principal, então as duas
     salas do teste vêm sempre com ela junto. Ver joinHomeClub.
     O que importa é o sino saber de qual sala veio cada linha, abaixo. */
  assert.equal(sino.body.clubs, 3);

  const salas = sino.body.items.map(i => i.club?.slug);
  assert.ok(salas.includes(uma.sala.slug), 'o aviso da primeira sala está lá');
  assert.ok(salas.includes(outra.sala.slug), 'e o da segunda também');
  /* Sem o nome da sala, um aviso da rede não tem para onde levar: a mesma ficha
     pode existir em duas salas, e "comentou sua avaliação" não diz onde. */
  assert.ok(sino.body.items.every(i => i.club?.name && i.club?.slug));
});

test('os ids não colidem entre salas', async () => {
  const dono = await kit.signIn();
  const outro = await kit.signIn();
  await salaComAviso(dono, outro);
  await salaComAviso(dono, outro);

  const { items } = (await req('GET', '/api/notices', null, dono.cookie)).body;
  assert.equal(new Set(items.map(i => i.id)).size, items.length, 'chave repetida esconde uma linha');
});

test('o retrato viaja no aviso — o elenco carregado é o de uma sala só', async () => {
  const dono = await kit.signIn();
  const outro = await kit.signIn();
  await salaComAviso(dono, outro);

  const { items } = (await req('GET', '/api/notices', null, dono.cookie)).body;
  const aviso = items.find(i => i.kind === 'comment');
  assert.ok(aviso, 'o comentário virou aviso');
  assert.ok('avatar' in aviso.actor, 'o campo existe mesmo quando a pessoa não tem foto');
  assert.ok(aviso.actor.name && aviso.actor.dot);
});

/* ══════════════════════════════════════════════════════════════════════════
   2. A PAREDE

   A quinta superfície que pode vazar entre salas, e a mais fácil de errar: a
   consulta antiga filtrava por `req.club.id`, imposto pelo middleware. Esta
   filtra por uma lista que o próprio servidor monta.
   ══════════════════════════════════════════════════════════════════════════ */

test('o sino não traz avisos de sala nenhuma de que a pessoa não é', async () => {
  const dono = await kit.signIn();
  const outro = await kit.signIn();
  const alheia = await salaComAviso(dono, outro, 'isto é de outra gente');

  const forasteiro = await kit.signIn();
  const sino = await req('GET', '/api/notices', null, forasteiro.cookie);
  assert.equal(sino.status, 200);
  /* Uma sala: a principal, onde ele nasceu e onde não aconteceu nada. O que se
     prova aqui é que a sala ALHEIA não vazou — não que ele esteja sozinho. */
  assert.equal(sino.body.clubs, 1);
  assert.equal(sino.body.items.length, 0);
  assert.ok(!JSON.stringify(sino.body).includes(alheia.sala.slug));
});

test('sair de um clube tira os avisos dele do sino', async () => {
  const dono = await kit.signIn();
  const outro = await kit.signIn();
  const { sala } = await salaComAviso(dono, outro);
  /* Quem comentou é membro; o aviso é do DONO. Então quem sai aqui é o dono —
     e ele fundou, então usamos outra sala para o teste sair limpo. */
  const segunda = await kit.makeClub({ owner: outro.id, visibility: 'private' });
  await kit.join(segunda.id, dono.id);
  const ficha = await req(
    'POST', at(segunda, '/reviews'), { movie: movie(), scores: scoresFor('Terror', 7) }, dono.cookie
  );
  await req(
    'POST', at(segunda, `/social/reviews/${ficha.body.id}/comments`), { body: 'oi' }, outro.cookie
  );

  const antes = (await req('GET', '/api/notices', null, dono.cookie)).body;
  assert.ok(antes.items.some(i => i.club.slug === segunda.slug));

  await req('DELETE', at(segunda, `/members/${dono.id}`), null, dono.cookie);
  const depois = (await req('GET', '/api/notices', null, dono.cookie)).body;
  assert.ok(!depois.items.some(i => i.club.slug === segunda.slug), 'a sala saiu junto');
  assert.ok(depois.items.some(i => i.club.slug === sala.slug), 'e a outra continua');
});

test('sem sessão, sino nenhum', async () => {
  assert.equal((await req('GET', '/api/notices')).status, 401);
  assert.equal((await req('POST', '/api/notices/seen', {})).status, 401);
  assert.equal((await req('POST', '/api/notices/clear', {})).status, 401);
});

/* ══════════════════════════════════════════════════════════════════════════
   3. AS MARCAS D'ÁGUA
   ══════════════════════════════════════════════════════════════════════════ */

test('abrir o sino da rede marca como visto em todas as salas', async () => {
  const dono = await kit.signIn();
  const outro = await kit.signIn();
  const uma = await salaComAviso(dono, outro);
  const outra = await salaComAviso(dono, outro);

  assert.ok((await req('GET', '/api/notices', null, dono.cookie)).body.unread >= 2);
  await req('POST', '/api/notices/seen', {}, dono.cookie);
  assert.equal((await req('GET', '/api/notices', null, dono.cookie)).body.unread, 0);

  /* E o sino de cada sala concorda: a marca continua por (sala, pessoa), então
     entrar num clube depois não reapresenta o que já foi lido no saguão. */
  for (const sala of [uma.sala, outra.sala]) {
    const doClube = await req('GET', at(sala, '/notifications'), null, dono.cookie);
    assert.equal(doClube.body.unread, 0, `${sala.slug} deveria estar lido`);
  }
});

test('limpar esvazia a lista sem apagar o que alguém escreveu', async () => {
  const dono = await kit.signIn();
  const outro = await kit.signIn();
  const { sala, ficha } = await salaComAviso(dono, outro, 'isto continua existindo');

  await req('POST', '/api/notices/clear', {}, dono.cookie);
  const depois = (await req('GET', '/api/notices', null, dono.cookie)).body;
  assert.equal(depois.items.length, 0);
  assert.equal(depois.unread, 0);

  /* O comentário é de outra pessoa. Limpar o próprio sino move uma data; não dá
     a ninguém o direito de apagar o que outro escreveu. */
  const conversa = await req('GET', at(sala, '/social'), null, dono.cookie);
  assert.ok(
    conversa.body.comments.some(c => c.reviewId === ficha.id && c.body === 'isto continua existindo')
  );
});

/* ══════════════════════════════════════════════════════════════════════════
   4. O AVISO DE CONTA
   ══════════════════════════════════════════════════════════════════════════ */

test('confirmar o e-mail é estado, não acontecimento: limpar não o dispensa', async () => {
  const mail = `n${++seq}-${crypto.randomUUID().slice(0, 8)}@exemplo.com`;
  const feito = await req('POST', '/api/auth/register', {
    name: 'Recém', email: mail, password: 'umasenhaboa',
  });
  const cookie = feito.setCookie.split(';')[0];

  const antes = (await req('GET', '/api/notices', null, cookie)).body;
  assert.equal(antes.account.verifyEmail, true);
  assert.equal(antes.unread, 1, 'ele acende o sino');

  await req('POST', '/api/notices/clear', {}, cookie);
  const depois = (await req('GET', '/api/notices', null, cookie)).body;
  assert.equal(
    depois.account.verifyEmail,
    true,
    'limpar esconde o que já aconteceu, e isto ainda não aconteceu'
  );
});

test('uma conta do Google não vê o aviso de confirmar', async () => {
  const quem = await kit.signIn();
  const sino = (await req('GET', '/api/notices', null, quem.cookie)).body;
  assert.equal(sino.account.verifyEmail, false);
});

/* ══════════════════════════════════════════════════════════════════════════
   5. E O LINK SAI SOZINHO NO CADASTRO

   O momento em que a pessoa entende por que confirmar é o de acabar de criar a
   conta. Pedir a mesma ação duas telas depois é pedi-la a alguém que já esqueceu
   o motivo. O botão de reenviar continua existindo — um é o caminho, o outro é
   o conserto.
   ══════════════════════════════════════════════════════════════════════════ */

test('criar a conta já dispara a confirmação', async () => {
  const mail = `auto${++seq}-${crypto.randomUUID().slice(0, 8)}@exemplo.com`;
  const feito = await req('POST', '/api/auth/register', {
    name: 'Automático', email: mail, password: 'umasenhaboa',
  });
  assert.equal(feito.status, 201);

  /* O token existe antes de qualquer clique. O envio em si não sai nos testes
     (sem chave configurada), e é justamente por isso que o que se verifica é o
     link ter sido criado: é a metade que fica do nosso lado. */
  const linhas = await db.prepare(
    `SELECT t.kind FROM email_tokens t JOIN reviewers r ON r.id = t.reviewer_id
     WHERE r.email = ?`
  ).all(mail);
  assert.deepEqual(linhas.map(r => r.kind), ['verify']);
});

/* ══════════════════════════════════════════════════════════════════════════
   5. O AVISO QUE NÃO TEM AUTOR

   Todos os outros são reação de alguém ao que é seu. Este é o calendário: hoje
   estreia um episódio de uma série que VOCÊ acompanha. Três coisas podem falhar
   em silêncio nele, e são as três daqui.
   ══════════════════════════════════════════════════════════════════════════ */

/** O dia em Brasília, que é a régua do aviso — ver notices.js. */
const hojeBR = (dias = 0) =>
  new Date(Date.now() - 3 * 3600_000 + dias * 86400_000).toISOString().slice(0, 10);

const serie = () => ({
  id: 900000 + ++seq,
  title: `Série ${seq}`,
  year: 2024,
  genre: 'Drama',
  poster: `/s/${seq}.jpg`,
});

/** Grava o episódio no cache, que é o que a tela da série faz ao ser aberta. */
const cacheEpisode = (showId, season, episode, title, airDate) =>
  db.prepare(`
    INSERT INTO episodes_cache (show_id, season, episode, title, air_date)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(show_id, season, episode) DO UPDATE SET air_date = excluded.air_date
  `).run(showId, season, episode, title, airDate);

test('a estreia de hoje avisa quem acompanha, e só quem acompanha', async () => {
  const dono = await kit.signIn();
  const outra = await kit.signIn();
  const sala = await kit.makeClub({ owner: dono.id, visibility: 'private' });
  await kit.join(sala.id, outra.id);

  const s = serie();
  await req('POST', at(sala, '/shows'), { show: s }, dono.cookie);
  await cacheEpisode(s.id, 2, 5, 'O Retorno', hojeBR());

  const meu = await req('GET', '/api/notices', null, dono.cookie);
  const aviso = meu.body.items.find(i => i.kind === 'airing');
  assert.ok(aviso, 'quem acompanha tem de ser avisado');
  assert.equal(aviso.showId, s.id);
  assert.equal(aviso.season, 2);
  assert.equal(aviso.episode, 5);
  assert.match(aviso.text, /T2E05/);
  assert.match(aviso.text, /O Retorno/);
  /* Sem ator: não houve quem. A tela desenha o cartaz no lugar do retrato, e um
     `actor` vazio aqui faria ela procurar um nome que não existe. */
  assert.equal(aviso.actor, undefined);
  assert.ok(aviso.club?.slug, 'o aviso diz de qual sala veio, como todos');

  /* A outra está na MESMA sala e não acompanha a série: acompanhar é de cada
     um, e o aviso é sobre o que você está esperando. */
  const dela = await req('GET', '/api/notices', null, outra.cookie);
  assert.equal(dela.body.items.filter(i => i.kind === 'airing').length, 0);
});

test('o episódio de ontem não é estreia de hoje', async () => {
  const dono = await kit.signIn();
  const sala = await kit.makeClub({ owner: dono.id, visibility: 'private' });
  const s = serie();
  await req('POST', at(sala, '/shows'), { show: s }, dono.cookie);
  await cacheEpisode(s.id, 1, 1, 'Piloto', hojeBR(-1));
  await cacheEpisode(s.id, 1, 2, 'Amanhã', hojeBR(1));

  const sino = await req('GET', '/api/notices', null, dono.cookie);
  assert.equal(sino.body.items.filter(i => i.kind === 'airing').length, 0);
});

/* A estreia é sobre a SÉRIE, e a mesma série acompanhada em duas salas é uma
   estreia só. Sem isto, quem acompanha em três clubes é avisado três vezes do
   mesmo episódio — e o contador do sino conta as três. */
test('a mesma série em duas salas avisa uma vez', async () => {
  const dono = await kit.signIn();
  const uma = await kit.makeClub({ owner: dono.id, visibility: 'private' });
  const outra = await kit.makeClub({ owner: dono.id, visibility: 'private' });
  const s = serie();
  await req('POST', at(uma, '/shows'), { show: s }, dono.cookie);
  await req('POST', at(outra, '/shows'), { show: s }, dono.cookie);
  await cacheEpisode(s.id, 3, 1, 'Volta', hojeBR());

  const sino = await req('GET', '/api/notices', null, dono.cookie);
  const avisos = sino.body.items.filter(i => i.kind === 'airing');
  assert.equal(avisos.length, 1);
});
