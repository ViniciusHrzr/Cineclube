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
  const dono = await kit.signIn();
  const sala = await kit.makeClub({ name: `Único ${++seq}`, owner: dono.id });

  const saida = await req('DELETE', at(sala, `/members/${dono.id}`), null, dono.cookie);
  assert.equal(saida.status, 409, 'sem ADM ninguém aprova entrada nem muda nada, e as fichas ficam trancadas lá dentro');

  // Com um segundo ADM, sai.
  const outro = await kit.signIn();
  await kit.join(sala.id, outro.id, 'admin');
  assert.equal((await req('DELETE', at(sala, `/members/${dono.id}`), null, dono.cookie)).status, 204);
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
