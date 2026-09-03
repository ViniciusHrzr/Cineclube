const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const dbPath = path.join(os.tmpdir(), `cineclube-live-${crypto.randomUUID()}.db`);
process.env.CINECLUBE_DB = dbPath;

const app = require('../server');
const db = require('../db');
const live = require('../live');
const { critsFor } = require('../criteria');

/* ══════════════════════════════════════════════════════════════════════════
   O clube ao vivo.

   Dois riscos, e são de naturezas diferentes.

   O primeiro é o silêncio: uma escrita que não emite deixa a tela de todo mundo
   parada sem que nada acuse — não há erro, não há log, só um comentário que
   ninguém vê até apertar F5. É o defeito que este arquivo existe para pegar, e
   por isso os testes de emissão passam pela ROTA e não pela função: o que se
   quer garantir não é que `emit` funciona, é que gravar um comentário emite.

   O segundo é o contrário — falar demais, ou falar cedo. Um aviso emitido antes
   do commit manda o clube buscar um estado que ainda não existe, e não há
   segundo aviso a caminho para consertar. Daí o teste que lê a coleção no
   instante do quadro: quando ele chega, o dado tem de estar lá.
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
  assert.equal(res.status, 201);
  const login = await req('POST', '/api/auth/login', { reviewerId: res.body.id, pin: PIN });
  return { ...res.body, cookie: cookieOf(login.setCookie) };
}

const movie = () => ({ id: 810000 + ++seq, title: 'Filme de Teste', year: 2024, genre: 'Terror' });

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

/* ── uma orelha ───────────────────────────────────────────────────────────
   Uma conexão de verdade, aberta pela rota, lida quadro a quadro. Testar o
   `emit` contra um objeto de mentira provaria que o Set funciona; o que precisa
   de prova é o caminho inteiro — sessão, cabeçalhos, e o quadro chegando do
   outro lado de um socket. */
async function listen(cookie) {
  const control = new AbortController();
  const res = await fetch(baseUrl + '/api/live/stream', {
    headers: { Cookie: cookie, Accept: 'text/event-stream' },
    signal: control.signal
  });
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/event-stream/);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  /* ── a leitura que sobrevive ao relógio ─────────────────────────────────
     A espera abaixo é uma corrida entre ler e desistir, e quando o relógio
     ganha a leitura CONTINUA pendente — ela não é cancelável. Sem guardá-la
     aqui, a chamada seguinte pediria uma segunda leitura ao mesmo reader, a
     primeira comeria o próximo pedaço, e o quadro sumiria no meio de duas
     asserções que parecem não ter relação nenhuma uma com a outra.

     Sem consequência enquanto ninguém esperava um silêncio; virou um teste que
     falhava sozinho no dia em que alguém quis provar que uma rota NÃO emite. */
  let pending = null;

  /** O próximo quadro `data:`, ou uma falha se ele não vier a tempo. */
  async function next(ms = 4000) {
    const deadline = Date.now() + ms;
    for (;;) {
      const line = buffer.indexOf('\n\n');
      if (line >= 0) {
        const chunk = buffer.slice(0, line);
        buffer = buffer.slice(line + 2);
        // Os `: ping` são para o proxy, não para quem está ouvindo.
        if (!chunk.startsWith('data: ')) continue;
        return JSON.parse(chunk.slice(6));
      }
      if (Date.now() > deadline) throw new Error('nenhum quadro chegou a tempo');
      if (!pending) pending = reader.read();
      const read = await Promise.race([
        pending,
        new Promise(resolve => setTimeout(() => resolve({ timeout: true }), deadline - Date.now()))
      ]);
      if (read.timeout) throw new Error('nenhum quadro chegou a tempo');
      pending = null;
      if (read.done) throw new Error('a conexão fechou');
      buffer += decoder.decode(read.value, { stream: true });
    }
  }

  return { next, close: () => control.abort() };
}

/* ── o cano ───────────────────────────────────────────────────────────── */

test('a conexão abre com um quadro que não é aviso de nada', async () => {
  const who = await newReviewer();
  const ear = await listen(who.cookie);
  try {
    assert.equal((await ear.next()).kind, 'hello');
  } finally {
    ear.close();
  }
});

test('sem sessão não há conexão', async () => {
  const res = await fetch(baseUrl + '/api/live/stream');
  assert.equal(res.status, 401);
  await res.text();
});

/* ── as emissões ──────────────────────────────────────────────────────── */

test('um comentário avisa o clube, e o comentário já está lá quando o aviso chega', async () => {
  const author = await newReviewer();
  const reader = await newReviewer();
  const take = await newTake(author);

  const ear = await listen(author.cookie);
  try {
    assert.equal((await ear.next()).kind, 'hello');

    await req('POST', `/api/social/reviews/${take.id}/comments`, { body: 'teu 7 em roteiro é generoso' }, reader.cookie);

    const frame = await ear.next();
    assert.equal(frame.kind, 'social');
    assert.equal(frame.by, reader.id);

    /* O ponto do teste: buscar AGORA, no instante do aviso, tem de trazer o
       comentário. Se a emissão acontecesse antes da escrita, isto viria vazio —
       e seria exatamente o que o clube veria na tela. */
    const all = await req('GET', '/api/social');
    assert.ok(all.body.comments.some(c => c.reviewId === take.id));
  } finally {
    ear.close();
  }
});

test('curtir, votar e apagar também avisam', async () => {
  const author = await newReviewer();
  const reader = await newReviewer();
  const take = await newTake(author);
  const posted = await req(
    'POST', `/api/social/reviews/${take.id}/comments`, { body: 'discordo' }, reader.cookie
  );

  const ear = await listen(author.cookie);
  try {
    assert.equal((await ear.next()).kind, 'hello');

    await req('PUT', `/api/social/comments/${posted.body.id}/like`, { liked: true }, author.cookie);
    assert.equal((await ear.next()).kind, 'social');

    await req('PUT', `/api/social/reviews/${take.id}/vote`, { value: -1 }, reader.cookie);
    assert.equal((await ear.next()).kind, 'social');

    await req('DELETE', `/api/social/comments/${posted.body.id}`, null, reader.cookie);
    assert.equal((await ear.next()).kind, 'social');
  } finally {
    ear.close();
  }
});

test('gravar uma nota avisa o acervo E a fila, porque mexe nas duas', async () => {
  const who = await newReviewer();
  const m = movie();
  await req('POST', '/api/watchlist', { movie: m }, who.cookie);

  const ear = await listen(who.cookie);
  try {
    assert.equal((await ear.next()).kind, 'hello');

    await req('POST', '/api/reviews', { movie: m, scores: scoresFor('Terror', 8) }, who.cookie);

    const kinds = new Set([(await ear.next()).kind, (await ear.next()).kind]);
    assert.ok(kinds.has('reviews'));
    assert.ok(kinds.has('watchlist'), 'a fila perdeu o filme e ninguém foi avisado');

    // E a fila realmente perdeu o filme: o aviso não estava mentindo.
    const queue = await req('GET', '/api/watchlist');
    assert.ok(!queue.body.watchlist.some(w => Number(w.id) === m.id));
  } finally {
    ear.close();
  }
});

test('pôr e tirar da fila avisa', async () => {
  const who = await newReviewer();
  const m = movie();

  const ear = await listen(who.cookie);
  try {
    assert.equal((await ear.next()).kind, 'hello');

    await req('POST', '/api/watchlist', { movie: m }, who.cookie);
    assert.equal((await ear.next()).kind, 'watchlist');

    await req('DELETE', `/api/watchlist/${m.id}`, null, who.cookie);
    assert.equal((await ear.next()).kind, 'watchlist');
  } finally {
    ear.close();
  }
});

test('trocar o próprio nome avisa, porque ele aparece ao lado de tudo', async () => {
  const who = await newReviewer();
  const ear = await listen(who.cookie);
  try {
    assert.equal((await ear.next()).kind, 'hello');
    await req('PATCH', '/api/reviewers/me', { name: 'Outro Nome' }, who.cookie);
    assert.equal((await ear.next()).kind, 'reviewers');
  } finally {
    ear.close();
  }
});

/* ── a sala falando para fora ─────────────────────────────────────────────
   A sala de projeção tem o próprio cano, e ele é caro: um quadro a cada cinco
   segundos, e assinar ele te PÕE dentro da sala. Quem não está assistindo não
   pode pagar nenhuma das duas coisas — mas precisa saber que a sessão começou,
   senão a lâmpada da marquise nunca acende para quem ela existe.

   Por isso a sala emite aqui também, e por isso emite pouco. */

test('abrir e fechar a sessão avisa o clube que não está na sala', async () => {
  const who = await newReviewer();
  const m = movie();
  await req('POST', '/api/watchlist', { movie: m }, who.cookie);

  const ear = await listen(who.cookie);
  try {
    assert.equal((await ear.next()).kind, 'hello');

    const opened = await req('POST', '/api/screening/open', { movieId: m.id }, who.cookie);
    assert.equal(opened.status, 201);
    assert.equal((await ear.next()).kind, 'screening');

    /* O aviso não chega antes da sala: quando ele chega, a rota já responde que
       há sessão aberta. Mesma regra do resto do arquivo, mesmo motivo. */
    const now = await req('GET', '/api/screening', null, who.cookie);
    assert.equal(now.body.open, true);

    await req('POST', '/api/screening/close', null, who.cookie);
    assert.equal((await ear.next()).kind, 'screening');
  } finally {
    ear.close();
    await req('POST', '/api/screening/close', null, who.cookie);
  }
});

test('play e pause avisam, e arrastar a barra não', async () => {
  const who = await newReviewer();
  const m = movie();
  await req('POST', '/api/watchlist', { movie: m }, who.cookie);
  await req('POST', '/api/screening/open', { movieId: m.id }, who.cookie);

  const ear = await listen(who.cookie);
  try {
    assert.equal((await ear.next()).kind, 'hello');

    await req('POST', '/api/screening/command', { type: 'play', position: 0 }, who.cookie);
    assert.equal((await ear.next()).kind, 'screening');

    /* ── o silêncio que é o ponto deste teste ─────────────────────────────
       Procurar uma cena dispara comandos aos punhados, e cada um deles é o
       mesmo filme, rodando, na mesma sala. Se `seek` emitisse, uma pessoa
       arrastando a barra mandaria toda aba aberta do clube buscar a sala
       dezenas de vezes para receber a mesma resposta — e a lâmpada não teria
       mudado em nenhuma delas. O filtro é a virada do status, não o comando. */
    await req('POST', '/api/screening/command', { type: 'seek', position: 90 }, who.cookie);
    await req('POST', '/api/screening/command', { type: 'seek', position: 120 }, who.cookie);
    await assert.rejects(() => ear.next(400), /nenhum quadro chegou a tempo/);

    await req('POST', '/api/screening/command', { type: 'pause', position: 120 }, who.cookie);
    assert.equal((await ear.next()).kind, 'screening');

    // Pausar o que já está pausado não é uma virada, e portanto não é notícia.
    await req('POST', '/api/screening/command', { type: 'pause', position: 120 }, who.cookie);
    await assert.rejects(() => ear.next(400), /nenhum quadro chegou a tempo/);
  } finally {
    ear.close();
    await req('POST', '/api/screening/close', null, who.cookie);
  }
});

/* ── o que o cano recusa ──────────────────────────────────────────────── */

test('uma palavra que não está na lista não vira quadro', () => {
  const seen = [];
  const entry = live.subscribe({ write: s => seen.push(s) }, 'p-teste');
  try {
    live.emit('qualquer-coisa', 'p-teste');
    live.emit('social', 'p-teste');
    /* Um quadro de abertura mais UM aviso. Sem a lista, qualquer string que
       chegasse a `emit` viraria uma palavra que nenhuma tela sabe atender — e
       o defeito apareceria como uma tela que não atualiza, longe daqui. */
    assert.equal(seen.length, 2);
    assert.match(seen[1], /"kind":"social"/);
  } finally {
    live.unsubscribe(entry);
  }
});

test('há um teto de conexões por pessoa', () => {
  const held = [];
  try {
    for (let i = 0; i < live.MAX_STREAMS_PER_VIEWER; i++) {
      assert.ok(live.canSubscribe('p-teto'), 'recusou antes de encher');
      held.push(live.subscribe({ write() {} }, 'p-teto'));
    }
    assert.equal(live.canSubscribe('p-teto'), false);
    // E o teto é por pessoa: outra pessoa continua entrando.
    assert.ok(live.canSubscribe('p-outra'));
  } finally {
    held.forEach(live.unsubscribe);
  }
});
