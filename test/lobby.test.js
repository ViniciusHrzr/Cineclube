const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const dbPath = path.join(os.tmpdir(), `cineclube-lobby-${crypto.randomUUID()}.db`);
process.env.CINECLUBE_DB = dbPath;

const app = require('../server');
const db = require('../db');
const live = require('../live');
const screening = require('../screening');
const lobby = require('../lobby');
const kit = require('../testkit');
const { critsFor } = require('../criteria');

/* ══════════════════════════════════════════════════════════════════════════
   O saguão, e a quinta parede.

   `clubs.test.js` protege quatro paredes entre salas: a leitura, a escrita, o
   cano ao vivo e a sala de projeção. Esta é a quinta, e ela é nova porque o
   saguão é a primeira coisa deste produto que lê ACIMA da linha do clube.

   O modo de falhar é o mesmo dos outros quatro, e é por isso que este arquivo
   existe: nada quebra. Um clube fechado que vaza para um ranking de rede não
   produz erro nenhum — produz um pôster a mais numa parede bonita, e ninguém
   descobre até a pessoa errada reconhecer o filme.

   São dois níveis de empréstimo e eles têm de ser testados separados:

   1. `show_charts` — a sala entra nas CONTAS: parede, pódio, atividade, cartaz.
   2. `show_charts` + `show_reviews` — a sala entra na FICHA DA SEMANA, que é a
      única coisa daqui com um texto assinado dentro.

   Um clube que ligou só o primeiro e aparece com o nome de alguém e o que essa
   pessoa escreveu é um vazamento, mesmo tendo emprestado alguma coisa.
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
  const closed = new Promise(resolve => server.close(resolve));
  server.closeAllConnections?.();
  await closed;
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
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let parsed = null;
  try { parsed = text ? JSON.parse(text) : null; } catch { parsed = null; }
  return { status: res.status, body: parsed };
}

let seq = 0;
const at = (club, p) => `/api/c/${club.slug}${p}`;

const movie = title => ({
  id: 900000 + ++seq,
  title: title || `Filme ${seq}`,
  year: 2024,
  genre: 'Terror',
  /* Com pôster de propósito: a parede só carrega filme que tem um, então um
     teste sem pôster testaria o filtro em vez da parede. */
  poster: `/p/${seq}.jpg`,
});

function scoresFor(genre, value) {
  const o = {};
  critsFor(genre).forEach(c => { o[c.key] = value; });
  return o;
}

/** O saguão, sempre recém-calculado: ele guarda um minuto de cache. */
async function saguao() {
  lobby.invalidate();
  const res = await req('GET', '/api/lobby');
  assert.equal(res.status, 200);
  return res.body;
}

const temFilme = (lista, id) => lista.some(f => f.id === id);
const temSala = (lista, slug) => lista.some(c => c.slug === slug);

/* ══════════════════════════════════════════════════════════════════════════
   A parede
   ══════════════════════════════════════════════════════════════════════════ */

test('um clube fechado não empresta nada à rede', async () => {
  const dono = await kit.signIn();
  const sala = await kit.makeClub({ owner: dono.id, visibility: 'private' });
  const filme = movie('Segredo da Sala Fechada');

  await req('POST', at(sala, '/reviews'), { movie: filme, scores: scoresFor('Terror', 9) }, dono.cookie);

  const antes = await saguao();
  assert.equal(antes.counts.reviews, 0, 'a ficha de um clube fechado não é contada');
  assert.equal(antes.counts.movies, 0);
  assert.equal(temFilme(antes.wall, filme.id), false, 'nem o pôster dela');
  assert.equal(temSala(antes.active, sala.slug), false, 'nem a sala na lista de atividade');
  assert.equal(antes.feature, null, 'nem a ficha em destaque');
});

test('ligar os rankings empresta os números, e só eles', async () => {
  const dono = await kit.signIn();
  const sala = await kit.makeClub({ owner: dono.id, visibility: 'private' });
  const filme = movie('Emprestado à Rede');

  await req(
    'POST', at(sala, '/reviews'),
    { movie: filme, scores: scoresFor('Terror', 9), comment: 'o que eu escrevi' },
    dono.cookie
  );
  await req('PATCH', at(sala, ''), { showCharts: true }, dono.cookie);

  const meio = await saguao();
  assert.equal(meio.counts.reviews, 1, 'a ficha passa a contar');
  assert.equal(temFilme(meio.wall, filme.id), true, 'e o pôster entra na parede');
  assert.equal(temSala(meio.active, sala.slug), true, 'e a sala aparece na atividade');
  /* A parede que importa: emprestar uma nota para uma média não é publicar um
     texto assinado. `show_reviews` continua desligado. */
  assert.equal(meio.feature, null, 'mas a ficha da semana continua trancada');

  await req('PATCH', at(sala, ''), { showReviews: true }, dono.cookie);
  const depois = await saguao();
  assert.equal(depois.feature?.movieId, filme.id, 'com a leitura aberta, ela sai');
  assert.equal(depois.feature?.excerpt, 'o que eu escrevi');
});

test('desligar devolve a sala ao silêncio', async () => {
  const dono = await kit.signIn();
  const sala = await kit.makeClub({ owner: dono.id, visibility: 'private' });
  const filme = movie('Retirado da Rede');

  await req('POST', at(sala, '/reviews'), { movie: filme, scores: scoresFor('Terror', 7) }, dono.cookie);
  await req('PATCH', at(sala, ''), { showCharts: true, showReviews: true }, dono.cookie);
  assert.equal(temFilme((await saguao()).wall, filme.id), true);

  await req('PATCH', at(sala, ''), { showCharts: false }, dono.cookie);
  const depois = await saguao();
  assert.equal(temFilme(depois.wall, filme.id), false, 'o pôster sai da parede');
  assert.equal(temSala(depois.active, sala.slug), false);
});

test('um clube aberto está na rede sem ninguém ligar nada', async () => {
  const dono = await kit.signIn();
  const sala = await kit.makeClub({ owner: dono.id, visibility: 'public' });
  const filme = movie('Sala Aberta');

  await req('POST', at(sala, '/reviews'), { movie: filme, scores: scoresFor('Terror', 8) }, dono.cookie);

  const saguaoAberto = await saguao();
  assert.equal(temFilme(saguaoAberto.wall, filme.id), true);
  assert.equal(temSala(saguaoAberto.active, sala.slug), true);
});

/* ══════════════════════════════════════════════════════════════════════════
   O piso do pódio.

   Um ranking de médias sem mínimo de amostra é a lista de quem foi avaliado uma
   vez por alguém entusiasmado. Este teste é o que impede a tela de voltar a ser
   isso — e o piso está no DTO, então a tela consegue dizer qual é.
   ══════════════════════════════════════════════════════════════════════════ */

test('o pódio exige um piso de fichas', async () => {
  const dono = await kit.signIn();
  const sala = await kit.makeClub({ owner: dono.id, visibility: 'public' });

  const sozinho = movie('Nota Dez de Uma Pessoa Só');
  await req('POST', at(sala, '/reviews'), { movie: sozinho, scores: scoresFor('Terror', 10) }, dono.cookie);

  const votado = movie('Visto Pelo Clube Inteiro');
  await req('POST', at(sala, '/reviews'), { movie: votado, scores: scoresFor('Terror', 8) }, dono.cookie);
  for (let i = 0; i < lobby.FLOOR - 1; i++) {
    const outro = await kit.signIn();
    await kit.join(sala.id, outro.id);
    await req('POST', at(sala, '/reviews'), { movie: votado, scores: scoresFor('Terror', 8) }, outro.cookie);
  }

  const pódio = (await saguao()).podium;
  assert.equal(temFilme(pódio, votado.id), true, 'o filme com fichas suficientes entra');
  assert.equal(
    temFilme(pódio, sozinho.id),
    false,
    'e o 10 de uma pessoa só não lidera a rede'
  );
  assert.equal(pódio.find(f => f.id === votado.id).takes, lobby.FLOOR);
});

/* ══════════════════════════════════════════════════════════════════════════
   A FOLHA DE UM FILME.

   O que abre ao clicar num cartaz da parede. É a superfície mais delicada do
   saguão: ela mostra ficha ASSINADA — nome, nota, o que a pessoa escreveu — e
   por isso está atrás da parede mais alta, a mesma da ficha em destaque. Um
   clube que empresta os números para o pódio e não abre as fichas não pode
   aparecer aqui.

   E a ordem tem uma regra que a tela imprime: quem avaliou mais aparece
   primeiro. A contagem que ordena conta só as salas que emprestam — senão
   alguém com trezentas fichas numa sala fechada lideraria uma lista da qual ele
   não participa.
   ══════════════════════════════════════════════════════════════════════════ */

/** Uma sala com N fichas de uma pessoa, para dar credibilidade a ela. */
async function fichas(sala, quem, quantas) {
  for (let i = 0; i < quantas; i++) {
    await req('POST', at(sala, '/reviews'), { movie: movie(), scores: scoresFor('Terror', 7) }, quem.cookie);
  }
}

test('a folha ordena por quem mais avaliou', async () => {
  const sala = await kit.makeClub({ owner: (await kit.signIn()).id, visibility: 'public' });
  const calejado = await kit.signIn('Quem Avalia Muito');
  const novato = await kit.signIn('Quem Chegou Agora');
  await kit.join(sala.id, calejado.id);
  await kit.join(sala.id, novato.id);

  await fichas(sala, calejado, 4);

  const alvo = movie('O Filme Da Folha');
  await req('POST', at(sala, '/reviews'), { movie: alvo, scores: scoresFor('Terror', 6) }, novato.cookie);
  await req('POST', at(sala, '/reviews'), { movie: alvo, scores: scoresFor('Terror', 9) }, calejado.cookie);

  const folha = (await req('GET', `/api/lobby/film/${alvo.id}`)).body;
  assert.equal(folha.takes.length, 2);
  assert.equal(folha.takes[0].actor.name, 'Quem Avalia Muito', 'quem tem mais régua vem primeiro');
  assert.ok(folha.takes[0].credibility > folha.takes[1].credibility);
  /* A média não é ponderada: a ordem é edição, e a conta continua sendo a
     conta. (6 + 9) / 2 = 7,5. */
  assert.equal(folha.average, 7.5);
  assert.equal(folha.count, 2);
});

test('a folha não mostra ficha de sala que não abre as fichas', async () => {
  const dono = await kit.signIn();
  const sala = await kit.makeClub({ owner: dono.id, visibility: 'private' });
  const filme = movie('Visto Só Lá Dentro');
  await req('POST', at(sala, '/reviews'), { movie: filme, scores: scoresFor('Terror', 9) }, dono.cookie);

  const fechada = (await req('GET', `/api/lobby/film/${filme.id}`)).body;
  assert.equal(fechada.takes.length, 0, 'clube fechado não assina nada aqui');
  assert.equal(fechada.count, 0);

  /* Emprestar os NÚMEROS põe o filme na conta da rede, e não a ficha assinada:
     são dois gestos diferentes e a folha respeita os dois. */
  await req('PATCH', at(sala, ''), { showCharts: true }, dono.cookie);
  const meio = (await req('GET', `/api/lobby/film/${filme.id}`)).body;
  assert.equal(meio.count, 1, 'a nota entra na média');
  assert.equal(meio.takes.length, 0, 'e a ficha continua sem aparecer');

  await req('PATCH', at(sala, ''), { showReviews: true }, dono.cookie);
  const aberta = (await req('GET', `/api/lobby/film/${filme.id}`)).body;
  assert.equal(aberta.takes.length, 1, 'com a leitura aberta, ela sai');
  assert.equal(aberta.takes[0].club.slug, sala.slug);
});

test('a mesma pessoa não ocupa duas vagas das cinco', async () => {
  /* A mesma pessoa avalia o mesmo filme em dois clubes com notas independentes,
     e é assim que este produto funciona. Numa lista de cinco, ela apareceria
     duas vezes — quatro pessoas se dizendo cinco. */
  const quem = await kit.signIn('Está Nos Dois');
  const uma = await kit.makeClub({ owner: quem.id, visibility: 'public' });
  const outra = await kit.makeClub({ owner: quem.id, visibility: 'public' });
  const filme = movie('Visto Duas Vezes');

  await req('POST', at(uma, '/reviews'), { movie: filme, scores: scoresFor('Terror', 8) }, quem.cookie);
  await req('POST', at(outra, '/reviews'), { movie: filme, scores: scoresFor('Terror', 4) }, quem.cookie);

  const folha = (await req('GET', `/api/lobby/film/${filme.id}`)).body;
  assert.equal(folha.takes.length, 1, 'uma ficha por pessoa na lista');
  assert.equal(folha.count, 2, 'mas as duas notas contam na média');
  assert.equal(folha.average, 6);
});

test('a folha aguenta um filme que ninguém avaliou, e um id torto', async () => {
  const vazia = await req('GET', '/api/lobby/film/999888777');
  assert.equal(vazia.status, 200);
  assert.deepEqual(vazia.body.takes, []);
  assert.equal(vazia.body.average, null, 'sem ficha não há média, e zero seria uma afirmação falsa');

  assert.equal((await req('GET', '/api/lobby/film/abc')).status, 400);
  assert.equal((await req('GET', '/api/lobby/film/-4')).status, 400);
});

/* ══════════════════════════════════════════════════════════════════════════
   Em cartaz agora.

   Sai do Map em memória do screening e não do banco, então ele tem uma parede
   própria para cair: o filtro é feito em lobby.js, sobre as salas elegíveis, e
   não pela rota da sessão.
   ══════════════════════════════════════════════════════════════════════════ */

test('a sessão de um clube fechado não aparece em cartaz', async () => {
  const dono = await kit.signIn();
  const fechado = await kit.makeClub({ owner: dono.id, visibility: 'private' });
  const aberto = await kit.makeClub({ owner: dono.id, visibility: 'public' });

  const escondido = movie('Sessão Fechada');
  const visível = movie('Sessão Aberta');
  await req('POST', at(fechado, '/watchlist'), { movie: escondido }, dono.cookie);
  await req('POST', at(aberto, '/watchlist'), { movie: visível }, dono.cookie);
  await req('POST', at(fechado, '/screening/open'), { movieId: escondido.id }, dono.cookie);
  await req('POST', at(aberto, '/screening/open'), { movieId: visível.id }, dono.cookie);

  const cartaz = (await saguao()).live;
  assert.equal(cartaz.some(s => s.movie.id === visível.id), true, 'a sala aberta é anunciada');
  assert.equal(cartaz.some(s => s.movie.id === escondido.id), false, 'a fechada não');
});
