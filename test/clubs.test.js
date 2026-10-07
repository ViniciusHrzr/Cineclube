const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const dbPath = path.join(os.tmpdir(), `cineclube-clubs-${crypto.randomUUID()}.db`);
process.env.CINECLUBE_DB = dbPath;

const app = require('../server');
const db = require('../db');
const live = require('../live');
const screening = require('../screening');
const auth = require('../auth');
const clubs = require('../clubs');
const throttle = require('../throttle');
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

test.beforeEach(() => throttle.reset());

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
const movie = () => ({ id: 600000 + ++seq, title: `Filme ${seq}`, year: 2024, genre: 'Terror', poster: null });

function scoresFor(genre, value) {
  const o = {};
  critsFor(genre).forEach(c => { o[c.key] = value; });
  return o;
}

test('quem funda um clube é ADM dele', async () => {
  const quem = await kit.signIn();
  const res = await req('POST', '/api/clubs', { name: `Clube ${crypto.randomUUID().slice(0, 6)}` }, quem.cookie);
  assert.equal(res.status, 201);
  assert.equal(res.body.club.role, 'admin');
  assert.equal(res.body.club.visibility, 'public', 'sem dizer nada, um clube nasce aberto');
});

test('nome de clube é único, e a caixa não faz diferença', async () => {
  const quem = await kit.signIn();
  const outra = await kit.signIn();
  const nome = `Sala ${crypto.randomUUID().slice(0, 6)}`;
  assert.equal((await req('POST', '/api/clubs', { name: nome }, quem.cookie)).status, 201);
  const outro = await req('POST', '/api/clubs', { name: nome.toUpperCase() }, outra.cookie);
  assert.equal(outro.status, 409, 'duas salas com o mesmo nome na lista são uma sala que ninguém sabe escolher');
});

test('cada pessoa funda um clube só', async () => {
  const quem = await kit.signIn();
  const primeiro = await req('POST', '/api/clubs', { name: `Sala ${crypto.randomUUID().slice(0, 6)}` }, quem.cookie);
  assert.equal(primeiro.status, 201);

  const segundo = await req('POST', '/api/clubs', { name: `Outra ${crypto.randomUUID().slice(0, 6)}` }, quem.cookie);
  assert.equal(segundo.status, 403);
  assert.match(segundo.body.error, /já tem um clube/);

  const { body } = await req('GET', '/api/clubs', null, quem.cookie);
  assert.equal(body.founded, true, 'a lista precisa dizer que a chave de fundar não tem mais o que fazer');
});

test('encerrar a sua devolve o direito de fundar', async () => {
  const quem = await kit.signIn();
  const nome = `Sala ${crypto.randomUUID().slice(0, 6)}`;
  const feita = await req('POST', '/api/clubs', { name: nome }, quem.cookie);
  assert.equal(feita.status, 201);

  assert.equal((await req('DELETE', `/api/c/${feita.body.club.slug}`, null, quem.cookie)).status, 204);
  assert.equal(
    (await req('POST', '/api/clubs', { name: `Outra ${crypto.randomUUID().slice(0, 6)}` }, quem.cookie)).status,
    201
  );
});

test('fundar exige estar logado', async () => {
  assert.equal((await req('POST', '/api/clubs', { name: 'Anônimo' })).status, 401);
});

test('um clube fechado tem fachada: nome, foto e quantas pessoas', async () => {
  const dono = await kit.signIn();
  const fora = await kit.signIn();
  const sala = await kit.makeClub({ name: `Fechado ${++seq}`, owner: dono.id });

  const card = await req('GET', at(sala, ''), null, fora.cookie);
  assert.equal(card.status, 200, 'a fachada é de todo mundo');
  assert.equal(card.body.club.name, sala.name);
  assert.equal(card.body.club.members, 1);
  assert.equal(card.body.club.isMember, false);
});

test('mas o conteúdo de um clube fechado é só de quem é dele', async () => {
  const dono = await kit.signIn();
  const fora = await kit.signIn();
  const sala = await kit.makeClub({ name: `Fechado ${++seq}`, owner: dono.id });
  await req('POST', at(sala, '/reviews'), { movie: movie(), scores: scoresFor('Terror', 8) }, dono.cookie);

  for (const rota of ['/reviews', '/feed', '/social', '/watchlist', '/reviewers', '/members']) {
    const res = await req('GET', at(sala, rota), null, fora.cookie);
    assert.equal(res.status, 403, `${rota} deveria estar atrás da porta`);
  }
  assert.equal((await req('GET', at(sala, '/reviews'))).status, 403);
});

async function salaComConteudo(nome, politica = {}) {
  const dono = await kit.signIn();
  const fora = await kit.signIn();
  const sala = await kit.makeClub({ name: `${nome} ${++seq}`, owner: dono.id });

  const ficha = await req(
    'POST', at(sala, '/reviews'), { movie: movie(), scores: scoresFor('Terror', 8) }, dono.cookie
  );
  const outro = await kit.signIn();
  await kit.join(sala.id, outro.id);
  await req('POST', at(sala, `/social/reviews/${ficha.body.id}/comments`), { body: 'discordo' }, outro.cookie);
  await req('POST', at(sala, '/watchlist'), { movie: movie() }, dono.cookie);

  if (Object.keys(politica).length) {
    await req('PATCH', at(sala, ''), politica, dono.cookie);
  }
  return { dono, fora, sala };
}

test('nenhum interruptor ligado: nada é legível de fora', async () => {
  const { fora, sala } = await salaComConteudo('Trancado');
  for (const rota of ['/reviews', '/social', '/feed', '/watchlist', '/reviewers']) {
    assert.equal((await req('GET', at(sala, rota), null, fora.cookie)).status, 403, rota);
  }
});

test('só avaliações: as fichas abrem, a conversa não', async () => {
  const { fora, sala } = await salaComConteudo('Só fichas', { showReviews: true });

  const fichas = await req('GET', at(sala, '/reviews'), null, fora.cookie);
  assert.equal(fichas.status, 200);
  assert.equal(fichas.body.reviews.length, 1);

  assert.equal((await req('GET', at(sala, '/social'), null, fora.cookie)).status, 403);

  assert.equal((await req('GET', at(sala, '/watchlist'), null, fora.cookie)).status, 200);
  assert.equal((await req('GET', at(sala, '/reviewers'), null, fora.cookie)).status, 200);

  const mural = await req('GET', at(sala, '/feed'), null, fora.cookie);
  assert.equal(mural.status, 200);
  assert.ok(mural.body.items.some(i => i.kind === 'review'));
  assert.ok(!mural.body.items.some(i => i.kind === 'comment'), 'o mural não pode vazar pelo lado');
});

test('só comentários: a conversa abre, as fichas não', async () => {
  const { fora, sala } = await salaComConteudo('Só conversa', { showComments: true });

  assert.equal((await req('GET', at(sala, '/social'), null, fora.cookie)).status, 200);
  assert.equal((await req('GET', at(sala, '/reviews'), null, fora.cookie)).status, 403);
  assert.equal((await req('GET', at(sala, '/reviews/averages'), null, fora.cookie)).status, 403);

  const mural = await req('GET', at(sala, '/feed'), null, fora.cookie);
  assert.ok(mural.body.items.some(i => i.kind === 'comment'));
  assert.ok(!mural.body.items.some(i => i.kind === 'review'));
});

test('as duas ligadas: fechado apenas na porta', async () => {
  const { fora, sala } = await salaComConteudo('Aberto para ler', {
    showReviews: true,
    showComments: true,
  });

  for (const rota of ['/reviews', '/social', '/feed', '/watchlist', '/reviewers']) {
    assert.equal((await req('GET', at(sala, rota), null, fora.cookie)).status, 200, rota);
  }
  assert.equal((await req('GET', at(sala, '/reviews'))).status, 200);

  const escreve = await req(
    'POST', at(sala, '/reviews'), { movie: movie(), scores: scoresFor('Terror', 5) }, fora.cookie
  );
  assert.equal(escreve.status, 403);
  assert.equal((await req('POST', at(sala, '/watchlist'), { movie: movie() }, fora.cookie)).status, 403);

  const entra = await req('POST', at(sala, '/join'), {}, fora.cookie);
  assert.equal(entra.body.requested, true, 'entrar continua sendo um pedido');
});

test('a sala de projeção nunca abre, com interruptor nenhum', async () => {
  const { fora, sala } = await salaComConteudo('Projeção', {
    showReviews: true,
    showComments: true,
  });
  assert.equal((await req('GET', at(sala, '/screening'), null, fora.cookie)).status, 403);
  assert.equal((await req('GET', at(sala, '/notifications'), null, fora.cookie)).status, 403);
});

test('só o ADM mexe na política de leitura', async () => {
  const { fora, sala } = await salaComConteudo('Quem manda');
  const res = await req('PATCH', at(sala, ''), { showReviews: true }, fora.cookie);
  assert.equal(res.status, 403);
});

test('a política sobrevive a um período de porta aberta', async () => {
  const { dono, fora, sala } = await salaComConteudo('Vai e volta', { showReviews: true });

  await req('PATCH', at(sala, ''), { visibility: 'public' }, dono.cookie);
  assert.equal((await req('GET', at(sala, '/social'), null, fora.cookie)).status, 200, 'aberto, tudo abre');

  await req('PATCH', at(sala, ''), { visibility: 'private' }, dono.cookie);
  const volta = await req('GET', at(sala, ''), null, dono.cookie);
  assert.equal(volta.body.club.showReviews, true, 'a escolha do ADM não se perde por ele ter aberto um mês');
  assert.equal(volta.body.club.showComments, false);
  assert.equal((await req('GET', at(sala, '/social'), null, fora.cookie)).status, 403);
});

test('um clube fechado nasce sem mostrar nada', async () => {
  const quem = await kit.signIn();
  const res = await req(
    'POST', '/api/clubs', { name: `Novo Fechado ${++seq}`, visibility: 'private' }, quem.cookie
  );
  assert.equal(res.body.club.showReviews, false);
  assert.equal(res.body.club.showComments, false, 'abrir a leitura é sempre um gesto de alguém');
});

test('um clube fechado aparece na vitrine — é assim que se pede para entrar', async () => {
  const dono = await kit.signIn();
  const fora = await kit.signIn();
  const nome = `Achável ${++seq}`;
  await kit.makeClub({ name: nome, owner: dono.id });

  const lista = await req('GET', '/api/clubs', null, fora.cookie);
  const achado = lista.body.open.find(c => c.name === nome);
  assert.ok(achado, 'uma sala que ninguém enxerga é uma sala em que ninguém consegue entrar');
  assert.equal(achado.visibility, 'private');
});

test('um clube público é lido por qualquer um, até deslogado', async () => {
  const dono = await kit.signIn();
  const sala = await kit.makeClub({ name: `Aberto ${++seq}`, owner: dono.id, visibility: 'public' });
  await req('POST', at(sala, '/reviews'), { movie: movie(), scores: scoresFor('Terror', 8) }, dono.cookie);

  const semSessao = await req('GET', at(sala, '/reviews'));
  assert.equal(semSessao.status, 200);
  assert.equal(semSessao.body.reviews.length, 1);
});

test('ler um clube aberto não dá direito de escrever nele — entrar dá', async () => {
  const dono = await kit.signIn();
  const fora = await kit.signIn();
  const sala = await kit.makeClub({ name: `Aberto ${++seq}`, owner: dono.id, visibility: 'public' });

  const antes = await req(
    'POST', at(sala, '/reviews'), { movie: movie(), scores: scoresFor('Terror', 7) }, fora.cookie
  );
  assert.equal(antes.status, 403);

  const entrada = await req('POST', at(sala, '/join'), {}, fora.cookie);
  assert.equal(entrada.status, 201);
  assert.equal(entrada.body.joined, true, 'num clube aberto entrar é um clique, sem esperar ninguém');

  const depois = await req(
    'POST', at(sala, '/reviews'), { movie: movie(), scores: scoresFor('Terror', 7) }, fora.cookie
  );
  assert.equal(depois.status, 201);
});

test('ser de um clube não dá direito nenhum sobre outro', async () => {
  const a = await kit.signIn();
  const b = await kit.signIn();
  const salaA = await kit.makeClub({ name: `Um ${++seq}`, owner: a.id, visibility: 'public' });
  const salaB = await kit.makeClub({ name: `Dois ${++seq}`, owner: b.id, visibility: 'public' });

  const ficha = await req('POST', at(salaB, '/reviews'), { movie: movie(), scores: scoresFor('Terror', 9) }, b.cookie);
  assert.equal(ficha.status, 201);

  const comentario = await req(
    'POST', at(salaA, `/social/reviews/${ficha.body.id}/comments`), { body: 'oi' }, a.cookie
  );
  assert.equal(comentario.status, 404);

  const voto = await req(
    'PUT', at(salaA, `/social/reviews/${ficha.body.id}/vote`), { value: 1 }, a.cookie
  );
  assert.equal(voto.status, 404);

  const apagar = await req('DELETE', at(salaA, `/reviews/${ficha.body.id}`), null, a.cookie);
  assert.equal(apagar.status, 403);

  const depois = await req('GET', at(salaB, '/reviews'), null, b.cookie);
  assert.equal(depois.body.reviews.length, 1);
});

test('a ficha é da pessoa: avaliar o mesmo filme noutra sala regrava a mesma ficha', async () => {
  const quem = await kit.signIn();
  const um = await kit.makeClub({ name: `Terror ${++seq}`, owner: quem.id });
  const dois = await kit.makeClub({ name: `Drama ${++seq}`, owner: quem.id });
  const filme = movie();

  const a = await req('POST', at(um, '/reviews'), { movie: filme, scores: scoresFor('Terror', 9) }, quem.cookie);
  const b = await req('POST', at(dois, '/reviews'), { movie: filme, scores: scoresFor('Terror', 4) }, quem.cookie);
  assert.equal(a.status, 201);
  assert.equal(b.status, 201);
  assert.equal(a.body.id, b.body.id, 'uma ficha por pessoa por filme, no produto inteiro');
  assert.notEqual(a.body.final, b.body.final, 'a segunda gravação é a que vale');

  const listaUm = await req('GET', at(um, '/reviews'), null, quem.cookie);
  assert.equal(listaUm.body.reviews.length, 1);
  assert.equal(listaUm.body.reviews[0].origin.slug, dois.slug);
  const listaDois = await req('GET', at(dois, '/reviews'), null, quem.cookie);
  assert.equal(listaDois.body.reviews.length, 1);
  assert.equal(listaDois.body.reviews[0].origin, null);
});

test('quem entra numa sala nova chega com o acervo, etiquetado de onde veio', async () => {
  const quem = await kit.signIn();
  const casa = await kit.makeClub({ name: `Casa ${++seq}`, owner: quem.id });
  const filme = movie();
  const ficha = await req(
    'POST', at(casa, '/reviews'), { movie: filme, scores: scoresFor('Terror', 9) }, quem.cookie
  );
  assert.equal(ficha.status, 201);

  const dono = await kit.signIn();
  const nova = await kit.makeClub({ name: `Nova ${++seq}`, owner: dono.id });
  const antes = await req('GET', at(nova, '/reviews'), null, dono.cookie);
  assert.equal(antes.body.reviews.length, 0, 'antes de ela entrar, a sala está vazia');

  await kit.join(nova.id, quem.id);
  const depois = await req('GET', at(nova, '/reviews'), null, dono.cookie);
  assert.equal(depois.body.reviews.length, 1);
  assert.equal(depois.body.reviews[0].id, ficha.body.id);
  assert.equal(depois.body.reviews[0].origin.slug, casa.slug, 'a etiqueta diz de onde veio');

  const medias = await req('GET', at(nova, '/reviews/averages'), null, dono.cookie);
  assert.equal(medias.body.averages[filme.id].count, 1);

  const comentario = await req(
    'POST', at(nova, `/social/reviews/${ficha.body.id}/comments`), { body: 'oi' }, dono.cookie
  );
  assert.equal(comentario.status, 404);
});

test('a fila também é por clube', async () => {
  const quem = await kit.signIn();
  const um = await kit.makeClub({ name: `Fila A ${++seq}`, owner: quem.id });
  const dois = await kit.makeClub({ name: `Fila B ${++seq}`, owner: quem.id });
  const filme = movie();

  assert.equal((await req('POST', at(um, '/watchlist'), { movie: filme }, quem.cookie)).status, 201);
  assert.equal((await req('POST', at(dois, '/watchlist'), { movie: filme }, quem.cookie)).status, 201);

  const a = await req('GET', at(um, '/watchlist'), null, quem.cookie);
  const b = await req('GET', at(dois, '/watchlist'), null, quem.cookie);
  assert.equal(a.body.watchlist.length, 1);
  assert.equal(b.body.watchlist.length, 1);
});

test('pedir, aparecer para o ADM, e ser aceito', async () => {
  const dono = await kit.signIn();
  const quer = await kit.signIn();
  const sala = await kit.makeClub({ name: `Porta ${++seq}`, owner: dono.id });

  const pedido = await req('POST', at(sala, '/join'), {}, quer.cookie);
  assert.equal(pedido.status, 201);
  assert.equal(pedido.body.requested, true, 'num clube fechado o clique vira um pedido');

  const fila = await req('GET', at(sala, '/requests'), null, dono.cookie);
  assert.equal(fila.body.requests.length, 1);
  assert.equal(fila.body.requests[0].id, quer.id);

  assert.equal(
    (await req('GET', at(sala, '/requests'), null, quer.cookie)).status, 403,
    'a fila de pedidos é de quem administra'
  );

  assert.equal((await req('POST', at(sala, `/requests/${quer.id}`), { approve: true }, dono.cookie)).status, 200);
  assert.equal(
    (await req('POST', at(sala, '/reviews'), { movie: movie(), scores: scoresFor('Terror', 6) }, quer.cookie)).status,
    201,
    'aceito, ele escreve'
  );
});

test('um pedido acende o sino do ADM', async () => {
  const dono = await kit.signIn();
  const quer = await kit.signIn('Quer Entrar');
  const sala = await kit.makeClub({ name: `Sino ${++seq}`, owner: dono.id });

  const antes = await req('GET', at(sala, '/notifications'), null, dono.cookie);
  assert.equal(antes.body.items.length, 0);

  await req('POST', at(sala, '/join'), {}, quer.cookie);

  const depois = await req('GET', at(sala, '/notifications'), null, dono.cookie);
  const aviso = depois.body.items.find(i => i.kind === 'join');
  assert.ok(aviso, 'o ADM precisa ficar sabendo sem ir procurar');
  assert.equal(aviso.actor.id, quer.id);
  assert.equal(depois.body.unread, 1);
});

test('quem não administra não recebe o aviso — nem a lista de quem quer entrar', async () => {
  const dono = await kit.signIn();
  const gente = await kit.signIn();
  const quer = await kit.signIn();
  const sala = await kit.makeClub({ name: `Só ADM ${++seq}`, owner: dono.id });
  await kit.join(sala.id, gente.id);

  await req('POST', at(sala, '/join'), {}, quer.cookie);

  const sino = await req('GET', at(sala, '/notifications'), null, gente.cookie);
  assert.ok(!sino.body.items.some(i => i.kind === 'join'), 'quem não decide não precisa saber quem pediu');
});

test('o clube diz quantos estão esperando, e só para quem pode abrir', async () => {
  const dono = await kit.signIn();
  const gente = await kit.signIn();
  const quer = await kit.signIn();
  const sala = await kit.makeClub({ name: `Contagem ${++seq}`, owner: dono.id });
  await kit.join(sala.id, gente.id);
  await req('POST', at(sala, '/join'), {}, quer.cookie);

  const paraOAdm = await req('GET', at(sala, ''), null, dono.cookie);
  assert.equal(paraOAdm.body.club.pending, 1, 'é este número que acende o distintivo na marquise');

  const paraOMembro = await req('GET', at(sala, ''), null, gente.cookie);
  assert.equal(paraOMembro.body.club.pending, 0);
});

test('aceitar zera a contagem', async () => {
  const dono = await kit.signIn();
  const quer = await kit.signIn();
  const sala = await kit.makeClub({ name: `Zera ${++seq}`, owner: dono.id });
  await req('POST', at(sala, '/join'), {}, quer.cookie);
  await req('POST', at(sala, `/requests/${quer.id}`), { approve: true }, dono.cookie);

  const depois = await req('GET', at(sala, ''), null, dono.cookie);
  assert.equal(depois.body.club.pending, 0);
  const sino = await req('GET', at(sala, '/notifications'), null, dono.cookie);
  assert.ok(!sino.body.items.some(i => i.kind === 'join'), 'o aviso some com o pedido, sem cópia para envelhecer');
});

test('recusar apaga o pedido e não põe ninguém dentro', async () => {
  const dono = await kit.signIn();
  const quer = await kit.signIn();
  const sala = await kit.makeClub({ name: `Recusa ${++seq}`, owner: dono.id });

  await req('POST', at(sala, '/join'), {}, quer.cookie);
  await req('POST', at(sala, `/requests/${quer.id}`), { approve: false }, dono.cookie);

  assert.equal((await req('GET', at(sala, '/requests'), null, dono.cookie)).body.requests.length, 0);
  const escrita = await req('POST', at(sala, '/watchlist'), { movie: movie() }, quer.cookie);
  assert.equal(escrita.status, 403);
});

test('num clube aberto ninguém fica esperando na fila', async () => {
  const dono = await kit.signIn();
  const quer = await kit.signIn();
  const sala = await kit.makeClub({ name: `Sem fila ${++seq}`, owner: dono.id, visibility: 'public' });

  await req('POST', at(sala, '/join'), {}, quer.cookie);
  const fila = await req('GET', at(sala, '/requests'), null, dono.cookie);
  assert.equal(fila.body.requests.length, 0, 'entrar foi direto — não há o que aprovar');
});

test('abrir o clube admite quem estava na fila de pedidos', async () => {
  const dono = await kit.signIn();
  const quer = await kit.signIn();
  const sala = await kit.makeClub({ name: `Abrindo ${++seq}`, owner: dono.id });

  await req('POST', at(sala, '/join'), {}, quer.cookie);
  await req('PATCH', at(sala, ''), { visibility: 'public' }, dono.cookie);

  assert.equal((await req('GET', at(sala, '/requests'), null, dono.cookie)).body.requests.length, 0);
  const escreve = await req(
    'POST', at(sala, '/reviews'), { movie: movie(), scores: scoresFor('Terror', 6) }, quer.cookie
  );
  assert.equal(escreve.status, 201, 'quem pediu entrou junto com a porta abrindo');
});

test('só o ADM muda o que a sala é', async () => {
  const dono = await kit.signIn();
  const gente = await kit.signIn();
  const sala = await kit.makeClub({ name: `Mando ${++seq}`, owner: dono.id, visibility: 'public' });
  await kit.join(sala.id, gente.id);

  assert.equal((await req('PATCH', at(sala, ''), { tagline: 'nova' }, gente.cookie)).status, 403);
  assert.equal((await req('PATCH', at(sala, ''), { tagline: 'nova' }, dono.cookie)).status, 200);
});

test('o último ADM não sai e deixa a sala trancada', async () => {
  const sala = await kit.makeClub({ name: `Único ${++seq}` });
  const um = await kit.signIn();
  const dois = await kit.signIn();
  await kit.join(sala.id, um.id, 'admin');

  const sozinho = await req('DELETE', at(sala, `/members/${um.id}`), null, um.cookie);
  assert.equal(sozinho.status, 409, 'sem ADM ninguém aprova entrada nem muda nada, e as fichas ficam trancadas lá dentro');

  await kit.join(sala.id, dois.id, 'admin');
  assert.equal((await req('DELETE', at(sala, `/members/${um.id}`), null, um.cookie)).status, 204);
});

test('um membro sai sozinho, e as fichas dele ficam', async () => {
  const dono = await kit.signIn();
  const gente = await kit.signIn();
  const sala = await kit.makeClub({ name: `Saída ${++seq}`, owner: dono.id, visibility: 'public' });
  await kit.join(sala.id, gente.id);

  await req('POST', at(sala, '/reviews'), { movie: movie(), scores: scoresFor('Terror', 5) }, gente.cookie);
  assert.equal((await req('DELETE', at(sala, `/members/${gente.id}`), null, gente.cookie)).status, 204);

  const acervo = await req('GET', at(sala, '/reviews'), null, dono.cookie);
  assert.equal(acervo.body.reviews.length, 1, 'sair de uma sala não desdiz o que se falou nela');
});

test('ninguém tira outra pessoa sem ser ADM', async () => {
  const dono = await kit.signIn();
  const a = await kit.signIn();
  const b = await kit.signIn();
  const sala = await kit.makeClub({ name: `Tesoura ${++seq}`, owner: dono.id });
  await kit.join(sala.id, a.id);
  await kit.join(sala.id, b.id);

  assert.equal((await req('DELETE', at(sala, `/members/${b.id}`), null, a.cookie)).status, 403);
  assert.equal((await req('DELETE', at(sala, `/members/${b.id}`), null, dono.cookie)).status, 204);
});

test('só quem fundou encerra o clube', async () => {
  const dono = await kit.signIn();
  const outroAdm = await kit.signIn();
  const membro = await kit.signIn();
  const sala = await kit.makeClub({ name: `Encerra ${++seq}`, owner: dono.id });
  await kit.join(sala.id, outroAdm.id, 'admin');
  await kit.join(sala.id, membro.id);

  assert.equal((await req('DELETE', at(sala, ''), null, membro.cookie)).status, 403);
  assert.equal(
    (await req('DELETE', at(sala, ''), null, outroAdm.cookie)).status, 403,
    'ADM é um cargo, não a propriedade da sala'
  );
  assert.equal((await req('DELETE', at(sala, ''), null, dono.cookie)).status, 204);

  assert.equal((await req('GET', at(sala, ''), null, dono.cookie)).status, 404);
});

test('encerrar leva tudo o que estava dentro', async () => {
  const dono = await kit.signIn();
  const sala = await kit.makeClub({ name: `Leva tudo ${++seq}`, owner: dono.id });
  const ficha = await req(
    'POST', at(sala, '/reviews'), { movie: movie(), scores: scoresFor('Terror', 8) }, dono.cookie
  );
  await req('POST', at(sala, `/social/reviews/${ficha.body.id}/comments`), { body: 'oi' }, dono.cookie);
  await req('POST', at(sala, '/watchlist'), { movie: movie() }, dono.cookie);

  await req('DELETE', at(sala, ''), null, dono.cookie);

  for (const [tabela, coluna] of [['reviews', 'club_id'], ['watchlist', 'club_id'], ['club_members', 'club_id']]) {
    const { n } = await db.prepare(`SELECT COUNT(*) AS n FROM ${tabela} WHERE ${coluna} = ?`).get(sala.id);
    assert.equal(n, 0, `${tabela} deveria ter ido junto em cascata`);
  }
  const { n: conversas } = await db
    .prepare('SELECT COUNT(*) AS n FROM review_comments WHERE review_id = ?').get(ficha.body.id);
  assert.equal(conversas, 0, 'a conversa pendura na ficha, e a ficha foi embora');

  assert.ok(await db.prepare('SELECT id FROM reviewers WHERE id = ?').get(dono.id));
});

test('quem fundou não deixa de ser ADM, nem por outro ADM nem sozinho', async () => {
  const dono = await kit.signIn();
  const outroAdm = await kit.signIn();
  const sala = await kit.makeClub({ name: `Cargo ${++seq}`, owner: dono.id });
  await kit.join(sala.id, outroAdm.id, 'admin');

  const rebaixa = await req('PATCH', at(sala, `/members/${dono.id}`), { role: 'member' }, outroAdm.cookie);
  assert.equal(rebaixa.status, 409);
  const sozinho = await req('PATCH', at(sala, `/members/${dono.id}`), { role: 'member' }, dono.cookie);
  assert.equal(sozinho.status, 409);

  const papel = await clubs.membership.get(sala.id, dono.id);
  assert.equal(papel.role, 'admin');
});

test('quem fundou não sai do clube — a saída dela é encerrar', async () => {
  const dono = await kit.signIn();
  const outroAdm = await kit.signIn();
  const sala = await kit.makeClub({ name: `Não sai ${++seq}`, owner: dono.id });
  await kit.join(sala.id, outroAdm.id, 'admin');

  const sozinho = await req('DELETE', at(sala, `/members/${dono.id}`), null, dono.cookie);
  assert.equal(sozinho.status, 409);
  const tirado = await req('DELETE', at(sala, `/members/${dono.id}`), null, outroAdm.cookie);
  assert.equal(tirado.status, 409, 'nem outro ADM tira quem fundou');
});

test('o clube fundador não tem quem o encerre', async () => {
  const home = await db.prepare('SELECT id, slug FROM clubs WHERE name = ? COLLATE NOCASE').get('Cineclube');
  const dono = await kit.signInAdmin();
  await kit.join(home.id, dono.id, 'admin');
  const res = await req('DELETE', `/api/c/${home.slug}`, null, dono.cookie);
  assert.equal(res.status, 403);
});

test('um aviso de outra sala não chega neste cano', async () => {
  const dono = await kit.signIn();
  const sala = await kit.makeClub({ name: `Cano A ${++seq}`, owner: dono.id });
  const outra = await kit.makeClub({ name: `Cano B ${++seq}`, owner: dono.id });

  const control = new AbortController();
  const res = await fetch(baseUrl + at(sala, '/live/stream'), {
    headers: { Cookie: dono.cookie, Accept: 'text/event-stream' },
    signal: control.signal,
  });
  assert.equal(res.status, 200);

  const kinds = [];
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  (async () => {
    let buf = '';
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) return;
        buf += dec.decode(value, { stream: true });
        let i;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const chunk = buf.slice(0, i);
          buf = buf.slice(i + 2);
          if (chunk.startsWith('data: ')) kinds.push(JSON.parse(chunk.slice(6)).kind);
        }
      }
    } catch { }
  })();

  const settle = () => new Promise(r => setTimeout(r, 250));
  await settle();
  kinds.length = 0;

  try {
    await req('POST', at(outra, '/watchlist'), { movie: movie() }, dono.cookie);
    await settle();
    assert.deepEqual(kinds, [], 'nada da outra sala pode chegar aqui');

    await req('POST', at(sala, '/watchlist'), { movie: movie() }, dono.cookie);
    await settle();
    assert.ok(kinds.includes('watchlist'), 'o que é desta sala tem de chegar');
  } finally {
    control.abort();
  }
});

test('quem não é do clube não abre o cano dele', async () => {
  const dono = await kit.signIn();
  const fora = await kit.signIn();
  const sala = await kit.makeClub({ name: `Cano fechado ${++seq}`, owner: dono.id });

  const res = await fetch(baseUrl + at(sala, '/live/stream'), { headers: { Cookie: fora.cookie } });
  await res.text();
  assert.equal(res.status, 403);
});

test('quem funda um clube não ganha poder nenhum fora dele', async () => {
  const chefe = await kit.signIn();
  const alheio = await kit.signIn();
  const minha = await kit.makeClub({ name: `Minha ${++seq}`, owner: chefe.id });
  const outra = await kit.makeClub({ name: `Alheia ${++seq}`, owner: alheio.id, visibility: 'public' });

  const eu = await req('GET', '/api/auth/me', null, chefe.cookie);
  assert.equal(eu.body.reviewer.isAdmin, false, 'fundar uma sala não senta ninguém na cadeira da instalação');

  assert.equal((await req('PATCH', at(outra, ''), { tagline: 'invadi' }, chefe.cookie)).status, 403);
  assert.equal((await req('GET', at(outra, '/requests'), null, chefe.cookie)).status, 403);
  assert.equal((await req('DELETE', `/api/reviewers/${alheio.id}`, null, chefe.cookie)).status, 403);

  assert.equal((await req('PATCH', at(minha, ''), { tagline: 'aqui sim' }, chefe.cookie)).status, 200);
});

test('uma conta criada por senha nunca vira ADM da instalação', async () => {
  const res = await req('POST', '/api/auth/register', {
    name: 'Espertinho',
    email: (process.env.CINECLUBE_ADMIN_EMAIL || 'dono@exemplo.com'),
    password: 'umasenhaboa',
  });
  assert.ok(res.status === 201 || res.status === 409);
  if (res.status === 201) {
    assert.equal(res.body.reviewer.isAdmin, false);
  }
});

test('duas salas, duas sessões independentes', async () => {
  const dono = await kit.signIn();
  const um = await kit.makeClub({ name: `Projeção A ${++seq}`, owner: dono.id });
  const dois = await kit.makeClub({ name: `Projeção B ${++seq}`, owner: dono.id });

  const filme = movie();
  await req('POST', at(um, '/watchlist'), { movie: filme }, dono.cookie);

  assert.equal((await req('POST', at(um, '/screening/open'), { movieId: filme.id }, dono.cookie)).status, 201);

  const salaUm = await req('GET', at(um, '/screening'), null, dono.cookie);
  const salaDois = await req('GET', at(dois, '/screening'), null, dono.cookie);
  assert.equal(salaUm.body.open, true);
  assert.equal(salaDois.body.open, false, 'a sessão de um clube não acende a do outro');
});

test('a sala de projeção é de dentro: nem ler, sem ser membro', async () => {
  const dono = await kit.signIn();
  const fora = await kit.signIn();
  const sala = await kit.makeClub({ name: `Projeção aberta ${++seq}`, owner: dono.id, visibility: 'public' });

  assert.equal((await req('GET', at(sala, '/screening'), null, fora.cookie)).status, 403);
  assert.equal((await req('GET', at(sala, '/reviews'), null, fora.cookie)).status, 200, 'mas o acervo continua aberto');
});

test('cria conta com e-mail e senha, e já entra logado', async () => {
  const mail = `nova-${crypto.randomUUID().slice(0, 8)}@exemplo.com`;
  const res = await req('POST', '/api/auth/register', {
    name: 'Sem Google', email: mail, password: 'umasenhaboa',
  });
  assert.equal(res.status, 201);
  assert.equal(res.body.reviewer.name, 'Sem Google');

  const cookie = res.setCookie.split(';')[0];
  const eu = await req('GET', '/api/auth/me', null, cookie);
  assert.equal(eu.body.reviewer.id, res.body.reviewer.id);
  assert.equal(eu.body.needsPassword, false, 'quem cadastrou senha não precisa de outra');
});

test('o mesmo e-mail não vira duas contas', async () => {
  const mail = `dupla-${crypto.randomUUID().slice(0, 8)}@exemplo.com`;
  const um = { name: 'Primeiro', email: mail, password: 'umasenhaboa' };
  assert.equal((await req('POST', '/api/auth/register', um)).status, 201);
  const dois = await req('POST', '/api/auth/register', { ...um, name: 'Segundo' });
  assert.equal(dois.status, 409);
});

test('o cadastro recusa e-mail torto, nome vazio e senha curta', async () => {
  const base = { name: 'Alguém', email: 'ok@exemplo.com', password: 'umasenhaboa' };
  assert.equal((await req('POST', '/api/auth/register', { ...base, email: 'nao-e-email' })).status, 400);
  assert.equal((await req('POST', '/api/auth/register', { ...base, name: '   ' })).status, 400);
  assert.equal((await req('POST', '/api/auth/register', { ...base, password: 'curta' })).status, 400);
});

test('conta criada por senha entra por senha, e a senha não volta em resposta nenhuma', async () => {
  const mail = `volta-${crypto.randomUUID().slice(0, 8)}@exemplo.com`;
  const feita = await req('POST', '/api/auth/register', {
    name: 'Confere', email: mail, password: 'umasenhaboa',
  });
  const login = await req('POST', '/api/auth/login', { email: mail, password: 'umasenhaboa' });
  assert.equal(login.status, 200);
  const tudo = JSON.stringify(feita.body) + JSON.stringify(login.body);
  assert.ok(!tudo.includes('umasenhaboa'));
  assert.ok(!/password_hash|password_salt/.test(tudo));
});
