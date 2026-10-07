const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const dbPath = path.join(os.tmpdir(), `cineclube-live-${crypto.randomUUID()}.db`);
process.env.CINECLUBE_DB = dbPath;

const app = require('../server');
const db = require('../lib/db');
const live = require('../lib/live');
const { critsFor } = require('../rules/criteria');
const kit = require('../lib/testkit');

let CLUB;
const at = p => `/api/c/${CLUB.slug}${p}`;

let baseUrl;
let server;

test.before(async () => {
  await app.ready;
  server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  CLUB = await kit.makeClub({ name: 'Clube do Cano' });
});

test.after(async () => {
  live.stopTimers();
  await new Promise(resolve => server.close(resolve));
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
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null, setCookie: res.headers.get('set-cookie') };
}

let seq = 0;

async function newReviewer(name) {
  const who = await kit.signIn(name || `Sócio ${++seq}`);
  await kit.join(CLUB.id, who.id);
  return who;
}

const movie = () => ({ id: 810000 + ++seq, title: 'Filme de Teste', year: 2024, genre: 'Terror' });

function scoresFor(genre, value) {
  const o = {};
  critsFor(genre).forEach(c => { o[c.key] = value; });
  return o;
}

async function newTake(who) {
  const m = movie();
  const res = await req('POST', at('/reviews'), { movie: m, scores: scoresFor('Terror', 7) }, who.cookie);
  assert.equal(res.status, 201);
  return { ...res.body, movie: m };
}

async function listen(cookie) {
  const control = new AbortController();
  const res = await fetch(baseUrl + at('/live/stream'), {
    headers: { Cookie: cookie, Accept: 'text/event-stream' },
    signal: control.signal
  });
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/event-stream/);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let pending = null;

  async function next(ms = 4000) {
    const deadline = Date.now() + ms;
    for (;;) {
      const line = buffer.indexOf('\n\n');
      if (line >= 0) {
        const chunk = buffer.slice(0, line);
        buffer = buffer.slice(line + 2);
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
  const res = await fetch(baseUrl + at('/live/stream'));
  assert.equal(res.status, 401);
  await res.text();
});

test('um comentário avisa o clube, e o comentário já está lá quando o aviso chega', async () => {
  const author = await newReviewer();
  const reader = await newReviewer();
  const take = await newTake(author);

  const ear = await listen(author.cookie);
  try {
    assert.equal((await ear.next()).kind, 'hello');

    await req('POST', at(`/social/reviews/${take.id}/comments`), { body: 'teu 7 em roteiro é generoso' }, reader.cookie);

    const frame = await ear.next();
    assert.equal(frame.kind, 'social');
    assert.equal(frame.by, reader.id);

    const all = await req('GET', at('/social'), null, author.cookie);
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
    'POST', at(`/social/reviews/${take.id}/comments`), { body: 'discordo' }, reader.cookie
  );

  const ear = await listen(author.cookie);
  try {
    assert.equal((await ear.next()).kind, 'hello');

    await req('PUT', at(`/social/comments/${posted.body.id}/like`), { liked: true }, author.cookie);
    assert.equal((await ear.next()).kind, 'social');

    await req('PUT', at(`/social/reviews/${take.id}/vote`), { value: -1 }, reader.cookie);
    assert.equal((await ear.next()).kind, 'social');

    await req('DELETE', at(`/social/comments/${posted.body.id}`), null, reader.cookie);
    assert.equal((await ear.next()).kind, 'social');
  } finally {
    ear.close();
  }
});

test('gravar uma nota avisa o acervo E a fila, porque mexe nas duas', async () => {
  const who = await newReviewer();
  const m = movie();
  await req('POST', at('/watchlist'), { movie: m }, who.cookie);

  const ear = await listen(who.cookie);
  try {
    assert.equal((await ear.next()).kind, 'hello');

    await req('POST', at('/reviews'), { movie: m, scores: scoresFor('Terror', 8) }, who.cookie);

    const kinds = new Set([(await ear.next()).kind, (await ear.next()).kind]);
    assert.ok(kinds.has('reviews'));
    assert.ok(kinds.has('watchlist'), 'a fila perdeu o filme e ninguém foi avisado');

    const queue = await req('GET', at('/watchlist'), null, who.cookie);
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

    await req('POST', at('/watchlist'), { movie: m }, who.cookie);
    assert.equal((await ear.next()).kind, 'watchlist');

    await req('DELETE', at(`/watchlist/${m.id}`), null, who.cookie);
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

test('abrir e fechar a sessão avisa o clube que não está na sala', async () => {
  const who = await newReviewer();
  const m = movie();
  await req('POST', at('/watchlist'), { movie: m }, who.cookie);

  const ear = await listen(who.cookie);
  try {
    assert.equal((await ear.next()).kind, 'hello');

    const opened = await req('POST', at('/screening/open'), { movieId: m.id }, who.cookie);
    assert.equal(opened.status, 201);
    assert.equal((await ear.next()).kind, 'screening');

    const now = await req('GET', at('/screening'), null, who.cookie);
    assert.equal(now.body.open, true);

    await req('POST', at('/screening/close'), null, who.cookie);
    assert.equal((await ear.next()).kind, 'screening');
  } finally {
    ear.close();
    await req('POST', at('/screening/close'), null, who.cookie);
  }
});

test('play e pause avisam, e arrastar a barra não', async () => {
  const who = await newReviewer();
  const m = movie();
  await req('POST', at('/watchlist'), { movie: m }, who.cookie);
  await req('POST', at('/screening/open'), { movieId: m.id }, who.cookie);

  const ear = await listen(who.cookie);
  try {
    assert.equal((await ear.next()).kind, 'hello');

    await req('POST', at('/screening/command'), { type: 'play', position: 0 }, who.cookie);
    assert.equal((await ear.next()).kind, 'screening');

    await req('POST', at('/screening/command'), { type: 'seek', position: 90 }, who.cookie);
    await req('POST', at('/screening/command'), { type: 'seek', position: 120 }, who.cookie);
    await assert.rejects(() => ear.next(400), /nenhum quadro chegou a tempo/);

    await req('POST', at('/screening/command'), { type: 'pause', position: 120 }, who.cookie);
    assert.equal((await ear.next()).kind, 'screening');

    await req('POST', at('/screening/command'), { type: 'pause', position: 120 }, who.cookie);
    await assert.rejects(() => ear.next(400), /nenhum quadro chegou a tempo/);
  } finally {
    ear.close();
    await req('POST', at('/screening/close'), null, who.cookie);
  }
});

test('uma palavra que não está na lista não vira quadro', () => {
  const seen = [];
  const entry = live.subscribe({ write: s => seen.push(s) }, 'p-teste', 'c-teste');
  try {
    live.emit('qualquer-coisa', 'p-teste', 'c-teste');
    live.emit('social', 'p-teste', 'c-teste');
    assert.equal(seen.length, 2);
    assert.match(seen[1], /"kind":"social"/);
  } finally {
    live.unsubscribe(entry);
  }
});

test('um aviso sem clube não vira quadro nenhum', () => {
  const seen = [];
  const entry = live.subscribe({ write: s => seen.push(s) }, 'p-teste', 'c-teste');
  try {
    live.emit('social', 'p-teste');
    live.emit('social', 'p-teste', null);
    assert.equal(seen.length, 1, 'só o quadro de abertura deveria ter saído');
  } finally {
    live.unsubscribe(entry);
  }
});

test('um aviso de outro clube não chega nesta conexão', () => {
  const seen = [];
  const entry = live.subscribe({ write: s => seen.push(s) }, 'p-teste', 'c-um');
  try {
    live.emit('social', 'p-teste', 'c-outro');
    assert.equal(seen.length, 1, 'só o quadro de abertura deveria ter saído');
    live.emit('social', 'p-teste', 'c-um');
    assert.equal(seen.length, 2, 'o da própria sala tem de chegar');
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
    assert.ok(live.canSubscribe('p-outra'));
  } finally {
    held.forEach(live.unsubscribe);
  }
});
