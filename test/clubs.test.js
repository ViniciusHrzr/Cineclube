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

/* ══════════════════════════════════════════════════════════════════════════
   Os clubes, e a parede entre eles.

   Este arquivo existe por um motivo diferente do resto da suíte. Os outros
   protegem o que o produto FAZ; este protege o que ele NÃO PODE fazer, e a
   diferença importa porque um vazamento não se parece com um defeito: nada
   quebra, nada dá erro, nenhuma tela fica estranha. Alguém simplesmente vê uma
   coisa que não é dele.

   São quatro paredes, e cada uma pode cair sozinha:

   1. a leitura — o acervo, o mural e a conversa de um clube privado;
   2. a escrita — quem não é da sala não escreve nela, nem sendo membro de outra;
   3. o cano ao vivo — que antes era um broadcast para todo mundo conectado;
   4. a sala de projeção — que era uma sala em memória para o produto inteiro.

   A terceira é a mais fácil de esquecer e a mais silenciosa: um aviso de
   `social` não carrega conteúdo nenhum, só a palavra. Mas ele diz "alguma coisa
   aconteceu agora", e num clube privado isso já é mais do que quem está de fora
   tem direito de saber.
   ══════════════════════════════════════════════════════════════════════════ */

let baseUrl;
let server;

test.before(async () => {
  await app.ready;
  server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

/* ── por que este arquivo zera as travas ──────────────────────────────────
   Esta suíte cadastra e funda muito mais do que uma pessoa cadastraria e
   fundaria, e faz tudo do mesmo endereço: sem isto ela bate na trava de
   `/register` (cinco por hora por IP) e falha em testes que não são sobre ela.

   Zerar aqui não afrouxa nada — quem verifica que as travas travam é
   `abuse.test.js`, e lá elas rodam de verdade. */
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

/* ── fundar ─────────────────────────────────────────────────────────────── */

test('quem funda um clube é ADM dele', async () => {
  const quem = await kit.signIn();
  const res = await req('POST', '/api/clubs', { name: `Clube ${crypto.randomUUID().slice(0, 6)}` }, quem.cookie);
  assert.equal(res.status, 201);
  assert.equal(res.body.club.role, 'admin');
  assert.equal(res.body.club.visibility, 'public', 'sem dizer nada, um clube nasce aberto');
});

test('nome de clube é único, e a caixa não faz diferença', async () => {
  const quem = await kit.signIn();
  const nome = `Sala ${crypto.randomUUID().slice(0, 6)}`;
  assert.equal((await req('POST', '/api/clubs', { name: nome }, quem.cookie)).status, 201);
  const outro = await req('POST', '/api/clubs', { name: nome.toUpperCase() }, quem.cookie);
  assert.equal(outro.status, 409, 'duas salas com o mesmo nome no saguão são uma sala que ninguém sabe escolher');
});

test('fundar exige estar logado', async () => {
  assert.equal((await req('POST', '/api/clubs', { name: 'Anônimo' })).status, 401);
});

/* ── a parede da leitura ────────────────────────────────────────────────── */

/* ── a fachada e o conteúdo ──────────────────────────────────────────────
   São duas camadas, e é a confusão entre elas que faz um produto assim ficar
   errado. Um clube fechado QUER ser achado — é como alguém pede para entrar; o
   que ele não quer é ser lido. */

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
  // E nem deslogado.
  assert.equal((await req('GET', at(sala, '/reviews'))).status, 403);
});

/* ══════════════════════════════════════════════════════════════════════════
   A política de leitura de um clube fechado.

   Fechado deixou de ser uma coisa só: o ADM decide, em dois interruptores, se um
   estranho vê as avaliações, os comentários, os dois ou nenhum. Com os dois
   ligados o clube fica fechado APENAS NA PORTA — ler é livre, entrar e avaliar
   não.

   Uma regra de leitura que erra não parece um defeito: ninguém vê um erro, uma
   pessoa só vê o que não era dela. Por isso a matriz inteira está aqui, e não
   uma amostra dela.
   ══════════════════════════════════════════════════════════════════════════ */

/** Uma sala fechada com conteúdo dentro, e um estranho olhando de fora. */
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

  /* A fila e o elenco acompanham o interruptor mais permissivo: quem lê o que o
     clube escreveu vê quem escreveu e o que ele pretende assistir. */
  assert.equal((await req('GET', at(sala, '/watchlist'), null, fora.cookie)).status, 200);
  assert.equal((await req('GET', at(sala, '/reviewers'), null, fora.cookie)).status, 200);

  // E o mural fica com metade das linhas.
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
  // Até deslogado.
  assert.equal((await req('GET', at(sala, '/reviews'))).status, 200);

  /* O que continua trancado é o que o usuário pediu que continuasse: entrar e
     avaliar. Ler tudo não vira direito de escrever nada. */
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

/* ── a parede da escrita ────────────────────────────────────────────────── */

test('ler um clube aberto não dá direito de escrever nele — entrar dá', async () => {
  const dono = await kit.signIn();
  const fora = await kit.signIn();
  const sala = await kit.makeClub({ name: `Aberto ${++seq}`, owner: dono.id, visibility: 'public' });

  /* Aberto não quer dizer sem porta: quer dizer que a porta não tem tranca.
     Quem só passou lendo ainda não entrou, e escrever é de quem entrou. */
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

  /* O id de uma ficha da sala B, usado numa rota da sala A. É o ataque mais
     natural que existe aqui — um id é público — e o que o barra é `club_id` na
     CONDIÇÃO das consultas de escrita, não no que elas leem. */
  const comentario = await req(
    'POST', at(salaA, `/social/reviews/${ficha.body.id}/comments`), { body: 'oi' }, a.cookie
  );
  assert.equal(comentario.status, 404);

  const voto = await req(
    'PUT', at(salaA, `/social/reviews/${ficha.body.id}/vote`), { value: 1 }, a.cookie
  );
  assert.equal(voto.status, 404);

  const apagar = await req('DELETE', at(salaA, `/reviews/${ficha.body.id}`), null, a.cookie);
  assert.equal(apagar.status, 404);

  // E a ficha continua lá, inteira.
  const depois = await req('GET', at(salaB, '/reviews'), null, b.cookie);
  assert.equal(depois.body.reviews.length, 1);
});

/* ── a mesma pessoa, o mesmo filme, duas salas ──────────────────────────── */

test('a ficha é do clube: a mesma pessoa avalia o mesmo filme duas vezes', async () => {
  const quem = await kit.signIn();
  const um = await kit.makeClub({ name: `Terror ${++seq}`, owner: quem.id });
  const dois = await kit.makeClub({ name: `Drama ${++seq}`, owner: quem.id });
  const filme = movie();

  const a = await req('POST', at(um, '/reviews'), { movie: filme, scores: scoresFor('Terror', 9) }, quem.cookie);
  const b = await req('POST', at(dois, '/reviews'), { movie: filme, scores: scoresFor('Terror', 4) }, quem.cookie);
  assert.equal(a.status, 201);
  assert.equal(b.status, 201);
  assert.notEqual(a.body.final, b.body.final, 'as duas notas são independentes');

  const listaUm = await req('GET', at(um, '/reviews'), null, quem.cookie);
  assert.equal(listaUm.body.reviews.length, 1, 'cada acervo só tem o que é dele');
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

/* ── pedir para entrar ──────────────────────────────────────────────────── */

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

/* ── um pedido tem que se anunciar ───────────────────────────────────────
   Estes nasceram de um defeito de produto, não de código: a fila de pedidos
   existia e funcionava, mas morava atrás de perfil → engrenagem → Ajustes, e
   nada em lugar nenhum dizia que ela estava lá. Alguém pedia para entrar e
   esperava indefinidamente porque o ADM não tinha como saber. */

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

/* ── abrir a sala admite quem estava esperando ───────────────────────────
   Um pedido é alguém dizendo "quero entrar aqui". Abrindo o clube, entrar virou
   um clique: deixar essas pessoas na fila seria fazê-las apertar um botão para
   conseguir o que já lhes foi concedido. */
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

/* ── quem manda ─────────────────────────────────────────────────────────── */

test('só o ADM muda o que a sala é', async () => {
  const dono = await kit.signIn();
  const gente = await kit.signIn();
  const sala = await kit.makeClub({ name: `Mando ${++seq}`, owner: dono.id, visibility: 'public' });
  await kit.join(sala.id, gente.id);

  assert.equal((await req('PATCH', at(sala, ''), { tagline: 'nova' }, gente.cookie)).status, 403);
  assert.equal((await req('PATCH', at(sala, ''), { tagline: 'nova' }, dono.cookie)).status, 200);
});

test('o último ADM não sai e deixa a sala trancada', async () => {
  /* Sem `owner`: uma sala sem fundador, como o clube que a migração criou. É o
     único caso em que esta regra ainda aparece sozinha — num clube fundado por
     alguém, quem barra a saída do último ADM é a regra de quem fundou, que é
     mais forte e vem antes. */
  const sala = await kit.makeClub({ name: `Único ${++seq}` });
  const um = await kit.signIn();
  const dois = await kit.signIn();
  await kit.join(sala.id, um.id, 'admin');

  const sozinho = await req('DELETE', at(sala, `/members/${um.id}`), null, um.cookie);
  assert.equal(sozinho.status, 409, 'sem ADM ninguém aprova entrada nem muda nada, e as fichas ficam trancadas lá dentro');

  // Com um segundo ADM, sai.
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

/* ══════════════════════════════════════════════════════════════════════════
   Quem fundou, e o que só ela pode.

   Duas regras que andam juntas: quem fundou é a única que encerra o clube, e a
   única que não pode deixar de administrá-lo. A segunda existe por causa da
   primeira — um clube cujo dono saiu continua existindo com o acervo de todo
   mundo dentro e sem ninguém que possa encerrá-lo.
   ══════════════════════════════════════════════════════════════════════════ */

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

  // E some de verdade: nem a fachada sobra.
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

  // A conta de quem fundou continua existindo: o clube acabou, a pessoa não.
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

  /* Com um segundo ADM na sala, a regra do "último ADM não sai" já não vale —
     então o que barra aqui é a regra de quem fundou, e não a outra. */
  const sozinho = await req('DELETE', at(sala, `/members/${dono.id}`), null, dono.cookie);
  assert.equal(sozinho.status, 409);
  const tirado = await req('DELETE', at(sala, `/members/${dono.id}`), null, outroAdm.cookie);
  assert.equal(tirado.status, 409, 'nem outro ADM tira quem fundou');
});

test('o clube fundador não tem quem o encerre', async () => {
  /* Cineclube foi criado pela migração, sem `created_by`. Ninguém casa com a
     condição, e é a propriedade certa para a sala que guarda o histórico de
     antes da rede. */
  const home = await db.prepare('SELECT id, slug FROM clubs WHERE name = ? COLLATE NOCASE').get('Cineclube');
  const dono = await kit.signInAdmin();
  await kit.join(home.id, dono.id, 'admin');
  const res = await req('DELETE', `/api/c/${home.slug}`, null, dono.cookie);
  assert.equal(res.status, 403);
});

/* ── a parede do cano ao vivo ───────────────────────────────────────────── */

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
    } catch { /* abortado no fim */ }
  })();

  const settle = () => new Promise(r => setTimeout(r, 250));
  await settle();
  kinds.length = 0; // descarta o `hello`

  try {
    // Uma escrita na OUTRA sala.
    await req('POST', at(outra, '/watchlist'), { movie: movie() }, dono.cookie);
    await settle();
    assert.deepEqual(kinds, [], 'nada da outra sala pode chegar aqui');

    // E uma na própria, que tem de chegar.
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

/* ── o ADM geral é um só ─────────────────────────────────────────────────
   Duas coisas com o mesmo nome em português, e confundir as duas é como poder
   vaza num produto assim: ADM de um clube manda na sala dele e em nada mais; o
   ADM da instalação cuida de contas. */

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

  // E na dele, manda.
  assert.equal((await req('PATCH', at(minha, ''), { tagline: 'aqui sim' }, chefe.cookie)).status, 200);
});

test('uma conta criada por senha nunca vira ADM da instalação', async () => {
  /* Um cadastro não verifica e-mail nenhum — este app não manda e-mail. Aceitar
     a cadeira por e-mail auto-declarado seria uma porta dos fundos com o nome de
     uma variável de ambiente. */
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

/* ── a parede da sala de projeção ───────────────────────────────────────── */

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
  /* Aberta de propósito: mesmo num clube que qualquer um lê, a sala de projeção
     não é. Assistir junto é uma coisa que se faz de dentro, e o painel diz quem
     está nela agora — que é informação sobre pessoas, não sobre filmes. */
  const sala = await kit.makeClub({ name: `Projeção aberta ${++seq}`, owner: dono.id, visibility: 'public' });

  assert.equal((await req('GET', at(sala, '/screening'), null, fora.cookie)).status, 403);
  assert.equal((await req('GET', at(sala, '/reviews'), null, fora.cookie)).status, 200, 'mas o acervo continua aberto');
});

/* ══════════════════════════════════════════════════════════════════════════
   Reivindicar a conta de antes do PIN.

   Dez pessoas tinham conta quando entrar era um PIN. As fichas delas continuam
   lá, e sem um caminho de volta cada uma ganharia uma conta nova e vazia.

   O que estes testes protegem é a condição que faz o PIN bastar: num clube de
   amigos os PINs se repetem, então nome mais quatro dígitos não seria prova
   suficiente sozinho. Ver a lista exige já dividir um clube com a conta órfã —
   e como as órfãs estão todas num clube fechado, isso quer dizer que o ADM já
   deixou a pessoa entrar.
   ══════════════════════════════════════════════════════════════════════════ */

/** Uma conta como as de antes: PIN, e nada mais. */
async function contaAntiga(nome, pin = '1234') {
  const crypto2 = require('node:crypto');
  const id = 'p' + crypto2.randomUUID();
  const salt = crypto2.randomBytes(16).toString('hex');
  const hash = crypto2.scryptSync(pin, salt, 64).toString('hex');
  await db.prepare('INSERT INTO reviewers (id, name, dot) VALUES (?, ?, ?)').run(id, nome, '#b5abfc');
  await db.prepare('UPDATE reviewers SET pin_hash = ?, pin_salt = ? WHERE id = ?').run(hash, salt, id);
  return { id, name: nome, pin };
}

test('quem está de fora do clube não vê conta órfã nenhuma', async () => {
  const dono = await kit.signIn();
  const sala = await kit.makeClub({ name: `Órfãos ${++seq}`, owner: dono.id });
  const velha = await contaAntiga(`Antigo ${++seq}`);
  await kit.join(sala.id, velha.id);

  const estranho = await kit.signIn();
  const lista = await req('GET', '/api/auth/claimable', null, estranho.cookie);
  assert.equal(lista.status, 200);
  assert.ok(!lista.body.accounts.some(a => a.id === velha.id), 'a lista é o primeiro portão');

  /* E o portão não é só a lista: o id viaja no corpo do pedido, então a mesma
     condição é cobrada na reivindicação. Sem isto a proteção seria decorativa. */
  const tenta = await req('POST', '/api/auth/claim', { reviewerId: velha.id, pin: velha.pin }, estranho.cookie);
  assert.equal(tenta.status, 403, 'saber o id e o PIN não basta para quem não é do clube');
});

test('quem é do clube reivindica, e leva o histórico junto', async () => {
  const dono = await kit.signIn();
  const sala = await kit.makeClub({ name: `Volta ${++seq}`, owner: dono.id });
  const velha = await contaAntiga(`Bruno Antigo ${++seq}`);
  await kit.join(sala.id, velha.id);

  // A ficha que ela deixou para trás.
  const filme = movie();
  await db.prepare(
    `INSERT INTO reviews (id, club_id, reviewer_id, movie_id, movie_title, movie_genre, scores, final, date)
     VALUES (?, ?, ?, ?, ?, 'Terror', '{}', 7, '2026-01-01')`
  ).run('r-antiga-' + seq, sala.id, velha.id, filme.id, filme.title);

  // A pessoa volta: entra de novo, e o ADM a aceita no clube.
  const nova = await kit.signIn('Bruno Novo');
  await kit.join(sala.id, nova.id);

  const lista = await req('GET', '/api/auth/claimable', null, nova.cookie);
  assert.ok(lista.body.accounts.some(a => a.id === velha.id), 'agora ela enxerga a própria conta antiga');

  const errado = await req('POST', '/api/auth/claim', { reviewerId: velha.id, pin: '9999' }, nova.cookie);
  assert.equal(errado.status, 401);

  const certo = await req('POST', '/api/auth/claim', { reviewerId: velha.id, pin: velha.pin }, nova.cookie);
  assert.equal(certo.status, 200);
  assert.equal(certo.body.reviewer.id, velha.id, 'a conta que sobrevive é a antiga, com o histórico');
  assert.equal(certo.body.reviewer.name, velha.name, 'e com o nome de antes');

  /* A sessão nova aponta para a conta antiga, e a credencial do Google veio
     junto — senão a pessoa acertaria o PIN e cairia na tela de entrada. */
  const cookie = certo.setCookie.split(';')[0];
  const eu = await req('GET', '/api/auth/me', null, cookie);
  assert.equal(eu.body.reviewer.id, velha.id);

  // A ficha continua onde estava, e a conta nova deixou de existir.
  const acervo = await req('GET', at(sala, '/reviews'), null, cookie);
  assert.ok(acervo.body.reviews.some(r => r.reviewerId === velha.id));
  assert.equal(await db.prepare('SELECT id FROM reviewers WHERE id = ?').get(nova.id), undefined);
});

/* ── a quem a tela é oferecida ───────────────────────────────────────────
   Estes três nasceram de um defeito em produção: a tela reaparecia para todo
   mundo, toda vez. A lista é "contas órfãs no seu clube", e ela continua cheia
   depois de você reclamar a sua — sobram as das outras pessoas. */

test('quem JÁ reivindicou não é perguntado de novo', async () => {
  const dono = await kit.signIn();
  const sala = await kit.makeClub({ name: `Dnv ${++seq}`, owner: dono.id });
  const minha = await contaAntiga(`Minha ${++seq}`);
  const alheia = await contaAntiga(`Alheia ${++seq}`);
  await kit.join(sala.id, minha.id);
  await kit.join(sala.id, alheia.id);

  const quem = await kit.signIn();
  await kit.join(sala.id, quem.id);

  const antes = await req('GET', '/api/auth/claimable', null, quem.cookie);
  assert.equal(antes.body.accounts.length, 2);

  const feito = await req('POST', '/api/auth/claim', { reviewerId: minha.id, pin: minha.pin }, quem.cookie);
  assert.equal(feito.status, 200);
  const cookie = feito.setCookie.split(';')[0];

  /* Sobra uma conta órfã na sala — a de outra pessoa — e é justamente por isso
     que a tela voltava. Quem já é uma conta antiga não tem o que reivindicar. */
  const depois = await req('GET', '/api/auth/claimable', null, cookie);
  assert.deepEqual(depois.body.accounts, [], 'a tela não pode voltar para quem já se ligou');
});

test('quem diz que não é nenhuma nunca mais é perguntado', async () => {
  const dono = await kit.signIn();
  const sala = await kit.makeClub({ name: `Dispensa ${++seq}`, owner: dono.id });
  const orfa = await contaAntiga(`Órfã ${++seq}`);
  await kit.join(sala.id, orfa.id);

  const novato = await kit.signIn();
  await kit.join(sala.id, novato.id);
  assert.equal((await req('GET', '/api/auth/claimable', null, novato.cookie)).body.accounts.length, 1);

  assert.equal((await req('POST', '/api/auth/claim/dismiss', {}, novato.cookie)).status, 200);
  const depois = await req('GET', '/api/auth/claimable', null, novato.cookie);
  assert.deepEqual(depois.body.accounts, [], 'a resposta é gravada, não é estado de tela');

  /* E vale noutro navegador: é uma coluna na conta, não `localStorage`. */
  const outroNavegador = await auth.createSession(novato.id);
  const deLa = await req('GET', '/api/auth/claimable', null, `cc_session=${outroNavegador}`);
  assert.deepEqual(deLa.body.accounts, []);
});

test('dispensar não impede ninguém de reivindicar depois, se pedir', async () => {
  /* Dispensar é sobre a PERGUNTA, não sobre o direito. Quem disse "não é
     nenhuma" e depois lembrar que era, ainda consegue — a rota continua lá. */
  const dono = await kit.signIn();
  const sala = await kit.makeClub({ name: `Mudou de ideia ${++seq}`, owner: dono.id });
  const orfa = await contaAntiga(`Era Minha ${++seq}`);
  await kit.join(sala.id, orfa.id);

  const quem = await kit.signIn();
  await kit.join(sala.id, quem.id);
  await req('POST', '/api/auth/claim/dismiss', {}, quem.cookie);

  const res = await req('POST', '/api/auth/claim', { reviewerId: orfa.id, pin: orfa.pin }, quem.cookie);
  assert.equal(res.status, 200);
});

test('uma conta já reivindicada some da lista e não é reivindicável de novo', async () => {
  const dono = await kit.signIn();
  const sala = await kit.makeClub({ name: `Uma vez ${++seq}`, owner: dono.id });
  const velha = await contaAntiga(`Só Uma Vez ${++seq}`);
  await kit.join(sala.id, velha.id);

  const primeira = await kit.signIn();
  await kit.join(sala.id, primeira.id);
  assert.equal(
    (await req('POST', '/api/auth/claim', { reviewerId: velha.id, pin: velha.pin }, primeira.cookie)).status,
    200
  );

  const segunda = await kit.signIn();
  await kit.join(sala.id, segunda.id);
  const lista = await req('GET', '/api/auth/claimable', null, segunda.cookie);
  assert.ok(!lista.body.accounts.some(a => a.id === velha.id), 'a porta se fecha sozinha');
  assert.equal(
    (await req('POST', '/api/auth/claim', { reviewerId: velha.id, pin: velha.pin }, segunda.cookie)).status,
    404
  );
});

test('PINs iguais em contas diferentes não confundem nada', async () => {
  const dono = await kit.signIn();
  const sala = await kit.makeClub({ name: `Mesmo PIN ${++seq}`, owner: dono.id });
  const ana = await contaAntiga(`Ana Igual ${++seq}`, '1234');
  const bruno = await contaAntiga(`Bruno Igual ${++seq}`, '1234');
  await kit.join(sala.id, ana.id);
  await kit.join(sala.id, bruno.id);

  const quem = await kit.signIn();
  await kit.join(sala.id, quem.id);

  /* O PIN é conferido contra A CONTA ESCOLHIDA, e não contra um conjunto. Quem
     escolhe a Ana e digita 1234 vira a Ana, nunca o Bruno. */
  const res = await req('POST', '/api/auth/claim', { reviewerId: ana.id, pin: '1234' }, quem.cookie);
  assert.equal(res.status, 200);
  assert.equal(res.body.reviewer.id, ana.id);
  assert.equal(res.body.reviewer.name, ana.name);

  // E a do Bruno continua intocada, esperando o dono.
  const bruAinda = await db.prepare('SELECT google_sub FROM reviewers WHERE id = ?').get(bruno.id);
  assert.equal(bruAinda.google_sub, null);
});

test('errar o PIN muitas vezes tranca a conta antiga por um tempo', async () => {
  const dono = await kit.signIn();
  const sala = await kit.makeClub({ name: `Trava ${++seq}`, owner: dono.id });
  const velha = await contaAntiga(`Trancada ${++seq}`, '4321');
  await kit.join(sala.id, velha.id);

  const quem = await kit.signIn();
  await kit.join(sala.id, quem.id);

  let last;
  for (let i = 0; i < 6; i++) {
    last = await req('POST', '/api/auth/claim', { reviewerId: velha.id, pin: '0000' }, quem.cookie);
  }
  assert.equal(last.status, 429);

  // E o PIN certo também espera — senão a trava seria só um aviso.
  const certo = await req('POST', '/api/auth/claim', { reviewerId: velha.id, pin: '4321' }, quem.cookie);
  assert.equal(certo.status, 429);
});

/* ── criar conta sem Google ──────────────────────────────────────────────
   Nem todo mundo tem, ou quer usar, uma conta Google. Um produto cuja única
   porta é a de outra empresa decidiu de quem os seus usuários precisam ser
   clientes. */

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
