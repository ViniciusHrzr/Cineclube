const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

/* ══════════════════════════════════════════════════════════════════════════
   The room over HTTP.

   `screening.test.js` covers the room's logic by calling it directly. This file
   covers the part that only exists once a socket is involved: the session gate,
   the film being read out of the server's own records instead of the request
   body, and — the reason this file exists at all — that a command posted by one
   member actually comes back out of another member's event stream.

   A separate file rather than more tests in the other one, because the room is
   module state: these tests need a listening server and real connections, and
   the unit tests need to reset that state between cases. `node --test` gives
   each file its own process, which is what keeps the two from stepping on each
   other.
   ══════════════════════════════════════════════════════════════════════════ */

const dbPath = path.join(os.tmpdir(), `cineclube-screening-${crypto.randomUUID()}.db`);
process.env.CINECLUBE_DB = dbPath;

const app = require('../server');
const db = require('../db');

let baseUrl;
let server;

test.before(async () => {
  await app.ready;
  server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  /* An event stream is a request that never ends, so `close` alone would wait
     for one forever — a test file that hangs instead of failing. */
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
  return { status: res.status, body: text ? JSON.parse(text) : null, setCookie: res.headers.get('set-cookie') };
}

let seq = 0;

async function newMember(name) {
  const pin = '4321';
  const created = await req('POST', '/api/reviewers', { name: name || `Sócio ${++seq}`, pin });
  assert.equal(created.status, 201);
  const login = await req('POST', '/api/auth/login', { reviewerId: created.body.id, pin });
  assert.equal(login.status, 200);
  return { ...created.body, cookie: login.setCookie.split(';')[0] };
}

/** A film in the club's queue, which is where `POST /open` looks it up. */
async function queuedFilm(overrides) {
  const member = await newMember();
  const film = {
    id: 500000 + ++seq,
    title: 'O Filme da Sessão',
    year: 1998,
    genre: 'Drama',
    poster: 'https://image.tmdb.org/t/p/w342/real.jpg',
    ...overrides,
  };
  assert.equal((await req('POST', '/api/watchlist', { movie: film }, member.cookie)).status, 201);
  return film;
}

/* ── an open ear on the room ──────────────────────────────────────────────
   A tiny SSE client: it holds the connection, parses whole frames out of the
   stream, and lets a test wait for the first frame that satisfies a predicate.
   Everything a browser's EventSource does that matters here, and nothing else. */
async function listen(cookie) {
  const control = new AbortController();
  const res = await fetch(`${baseUrl}/api/screening/stream`, {
    headers: { Cookie: cookie },
    signal: control.signal,
  });
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/event-stream/);

  const frames = [];
  const waiters = [];
  let buffer = '';

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  const pump = (async () => {
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) return;
        buffer += decoder.decode(value, { stream: true });
        let cut;
        while ((cut = buffer.indexOf('\n\n')) >= 0) {
          const chunk = buffer.slice(0, cut);
          buffer = buffer.slice(cut + 2);
          if (!chunk.startsWith('data: ')) continue; // a keep-alive comment
          const frame = JSON.parse(chunk.slice(6));
          frames.push(frame);
          for (const [predicate, resolve] of waiters.splice(0)) {
            if (predicate(frame)) resolve(frame);
            else waiters.push([predicate, resolve]);
          }
        }
      }
    } catch {
      /* the abort at the end of a test arrives here */
    }
  })();

  return {
    frames,
    /** Resolves with the first frame — past or future — matching `predicate`. */
    next(predicate, ms = 3000) {
      const seen = frames.find(predicate);
      if (seen) return Promise.resolve(seen);
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('nenhum frame chegou a tempo')), ms);
        waiters.push([predicate, frame => { clearTimeout(timer); resolve(frame); }]);
      });
    },
    async close() {
      control.abort();
      await pump;
    },
  };
}

/* ── the gate ─────────────────────────────────────────────────────────────── */

test('the room is the club\'s, not the internet\'s', async () => {
  for (const [method, route, body] of [
    ['GET', '/api/screening'],
    ['GET', '/api/screening/stream'],
    ['POST', '/api/screening/open', { movieId: 1 }],
    ['POST', '/api/screening/close', {}],
    ['POST', '/api/screening/command', { type: 'play' }],
    ['POST', '/api/screening/ready', { ready: true }],
    ['GET', '/api/screening/subtitle'],
    ['POST', '/api/screening/subtitle', { subtitle: null }],
  ]) {
    const { status } = await req(method, route, body);
    assert.equal(status, 401, `${method} ${route} deveria exigir sessão`);
  }
});

/* ── opening ──────────────────────────────────────────────────────────────── */

test('the film is read out of the club\'s records, never out of the request', async () => {
  const member = await newMember();
  const film = await queuedFilm({ title: 'A Cópia Verdadeira' });

  const opened = await req(
    'POST',
    '/api/screening/open',
    // Everything but the id is noise, and the poster is the reason it matters:
    // accepted, it would be an arbitrary outbound request in every browser.
    { movieId: film.id, movie: { title: 'Outro Filme', poster: 'javascript:alert(1)' } },
    member.cookie
  );

  assert.equal(opened.status, 201);
  assert.equal(opened.body.open, true);
  assert.equal(opened.body.movie.title, 'A Cópia Verdadeira');
  assert.equal(opened.body.movie.poster, film.poster);

  await req('POST', '/api/screening/close', {}, member.cookie);
});

test('a film the club does not have is not a session', async () => {
  const member = await newMember();
  assert.equal((await req('POST', '/api/screening/open', { movieId: 999999999 }, member.cookie)).status, 404);
  assert.equal((await req('POST', '/api/screening/open', { movieId: 'nove' }, member.cookie)).status, 400);
});

/* ── commands ─────────────────────────────────────────────────────────────── */

test('a command needs an open session and a real name', async () => {
  const member = await newMember();
  await req('POST', '/api/screening/close', {}, member.cookie);

  assert.equal((await req('POST', '/api/screening/command', { type: 'play' }, member.cookie)).status, 409);
  assert.equal((await req('POST', '/api/screening/command', { type: 'rewind' }, member.cookie)).status, 400);

  const film = await queuedFilm();
  await req('POST', '/api/screening/open', { movieId: film.id }, member.cookie);
  const nonsense = await req(
    'POST',
    '/api/screening/command',
    { type: 'seek', position: 'meia hora' },
    member.cookie
  );
  assert.equal(nonsense.status, 400, 'um NaN gravado no estado trava a sessão do clube inteiro');

  await req('POST', '/api/screening/close', {}, member.cookie);
});

/* ── the stream, which is the whole point ─────────────────────────────────── */

test('one member presses play and the other member\'s stream says so', async () => {
  const ana = await newMember('Ana da Sessão');
  const bruno = await newMember('Bruno da Sessão');
  const film = await queuedFilm({ title: 'Sessão Sincronizada' });

  const ear = await listen(bruno.cookie);
  // The first thing a connection gets is where the room stands.
  const hello = await ear.next(f => f.type === 'state');
  assert.equal(hello.status, 'paused');
  assert.ok(hello.viewers.some(v => v.name === 'Bruno da Sessão'), 'quem conecta entra na sala');

  await req('POST', '/api/screening/open', { movieId: film.id }, ana.cookie);
  const opened = await ear.next(f => f.type === 'state' && f.open);
  assert.equal(opened.movie.title, 'Sessão Sincronizada');

  await req('POST', '/api/screening/command', { type: 'play', position: 0 }, ana.cookie);
  const playing = await ear.next(f => f.status === 'playing');
  assert.ok(playing.revision > opened.revision, 'toda mudança avança a revisão');

  await req('POST', '/api/screening/command', { type: 'seek', position: 1200 }, ana.cookie);
  const sought = await ear.next(f => f.position >= 1200);
  assert.equal(sought.status, 'playing', 'arrastar a barra não pausa o filme');

  await req('POST', '/api/screening/close', {}, ana.cookie);
  await ear.close();
});

test('a stalled member pauses the room, and coming back starts it again', async () => {
  const ana = await newMember('Ana do Buffer');
  const bruno = await newMember('Bruno do Buffer');
  const film = await queuedFilm();

  const ear = await listen(ana.cookie);
  const brunoEar = await listen(bruno.cookie);
  // Ana's stream is the one that has to notice Bruno arriving, and it is the
  // one every later assertion in this test reads from.
  await ear.next(f => f.type === 'state' && f.viewers.some(v => v.name === 'Bruno do Buffer'));

  await req('POST', '/api/screening/open', { movieId: film.id }, ana.cookie);
  await req('POST', '/api/screening/command', { type: 'play', position: 0 }, ana.cookie);
  await ear.next(f => f.status === 'playing');

  await req('POST', '/api/screening/ready', { ready: false, sourceTag: 'abc123' }, bruno.cookie);
  const held = await ear.next(f => f.type === 'state' && f.pausedByStall);
  assert.equal(held.status, 'paused', 'seguir sem quem travou é justamente a dessincronia a evitar');
  assert.equal(held.viewers.find(v => v.name === 'Bruno do Buffer').sourceTag, 'abc123');

  await req('POST', '/api/screening/ready', { ready: true }, bruno.cookie);
  // Newer than the pause, or this would match the play frame from before it.
  const resumed = await ear.next(f => f.type === 'state' && f.status === 'playing' && f.revision > held.revision);
  assert.equal(resumed.pausedByStall, false);

  await req('POST', '/api/screening/close', {}, ana.cookie);
  await ear.close();
  await brunoEar.close();
});

/* ── the source, handed to whoever arrives ────────────────────────────────── */

test('the link the club is on reaches a member who arrives later', async () => {
  const first = await newMember('Quem Abriu');
  const late = await newMember('Quem Chegou Depois');
  const film = await queuedFilm();
  const magnet = 'magnet:?xt=urn:btih:0123456789abcdef0123456789abcdef01234567&dn=Filme';

  await req('POST', '/api/screening/open', { movieId: film.id }, first.cookie);
  const published = await req('POST', '/api/screening/link', { link: magnet }, first.cookie);
  assert.equal(published.status, 200);

  /* The whole point: the newcomer's very first frame already names the source,
     so nobody has to ask in the chat what everyone is watching. */
  const ear = await listen(late.cookie);
  const hello = await ear.next(f => f.type === 'state');
  assert.equal(hello.link, magnet);

  await ear.close();
  await req('POST', '/api/screening/close', {}, first.cookie);
});

test('the link is refused unless it is one a browser can be handed', async () => {
  const member = await newMember();
  const film = await queuedFilm();
  await req('POST', '/api/screening/open', { movieId: film.id }, member.cookie);

  for (const bad of ['javascript:alert(1)', 'data:text/html,<script>1</script>', 'blob:http://x/1', 'nada']) {
    const { status } = await req('POST', '/api/screening/link', { link: bad }, member.cookie);
    assert.equal(status, 400, `${bad} deveria ser recusado`);
  }

  const { body } = await req('GET', '/api/screening', null, member.cookie);
  assert.equal(body.link, null);

  await req('POST', '/api/screening/close', {}, member.cookie);
});

test('there is nothing to point at without a session', async () => {
  const member = await newMember();
  await req('POST', '/api/screening/close', {}, member.cookie);

  const { status } = await req(
    'POST',
    '/api/screening/link',
    { link: 'https://arquivo.exemplo/filme.mp4' },
    member.cookie
  );
  assert.equal(status, 409);
});

test('arriving is announced to the people already in the room', async () => {
  const first = await newMember('Primeiro a Chegar');
  const second = await newMember('Segundo a Chegar');

  const ear = await listen(first.cookie);
  await ear.next(f => f.type === 'state');

  const late = await listen(second.cookie);
  /* Nothing else happens in this test on purpose. Arriving has to be news by
     itself: the sync frames carry no viewers, so a room that only redrew on the
     next command would hide whoever joined during a quiet stretch — which,
     mid-film, is the entire film. */
  const seen = await ear.next(f => f.type === 'state' && f.viewers.some(v => v.name === 'Segundo a Chegar'));
  assert.ok(seen.viewers.some(v => v.name === 'Primeiro a Chegar'), 'e sem apagar quem já estava');

  await late.close();
  await ear.close();
});

test('leaving the stream takes the viewer out of the room', async () => {
  const member = await newMember('Quem Sai');
  const ear = await listen(member.cookie);
  await ear.next(f => f.type === 'state' && f.viewers.some(v => v.name === 'Quem Sai'));

  await ear.close();

  // The close travels back through the socket, so it is not instant.
  for (let i = 0; i < 40; i++) {
    const { body } = await req('GET', '/api/screening', null, member.cookie);
    if (!body.viewers.some(v => v.name === 'Quem Sai')) return;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  assert.fail('o espectador continuou na sala depois de fechar a conexão');
});

/* ── the clock ────────────────────────────────────────────────────────────── */

test('a subtitle posted by one member is announced to another, and collected', async () => {
  const film = await queuedFilm({ title: 'A Sessão Legendada' });
  const ana = await newMember('Ana da Legenda');
  const bruno = await newMember('Bruno da Legenda');
  assert.equal((await req('POST', '/api/screening/open', { movieId: film.id }, ana.cookie)).status, 201);

  const ear = await listen(bruno.cookie);
  const vtt = 'WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nboa noite';

  const sent = await req(
    'POST',
    '/api/screening/subtitle',
    { subtitle: { name: 'filme.srt', vtt } },
    ana.cookie
  );
  assert.equal(sent.status, 200);

  const frame = await ear.next(f => f.type === 'state' && f.subtitle?.name === 'filme.srt');
  // Announced only: the text must never ride on a frame the room re-emits.
  assert.equal(frame.subtitle.vtt, undefined);

  const got = await req('GET', '/api/screening/subtitle', null, bruno.cookie);
  assert.equal(got.status, 200);
  assert.equal(got.body.vtt, vtt);
  assert.equal(got.body.id, frame.subtitle.id, 'o id busca exatamente o que foi anunciado');

  // And removing it is the room's doing, not one screen's.
  assert.equal(
    (await req('POST', '/api/screening/subtitle', { subtitle: null }, bruno.cookie)).status,
    200
  );
  await ear.next(f => f.type === 'state' && f.subtitle === null);
  assert.equal((await req('GET', '/api/screening/subtitle', null, ana.cookie)).status, 404);

  await ear.close();
  await req('POST', '/api/screening/close', {}, ana.cookie);
});

test('a subtitle needs an open session, and has to look like one', async () => {
  const member = await newMember();
  const vtt = 'WEBVTT\n\n00:00:01.000 --> 00:00:02.000\noi';

  await req('POST', '/api/screening/close', {}, member.cookie);
  const shut = await req(
    'POST',
    '/api/screening/subtitle',
    { subtitle: { name: 'a.srt', vtt } },
    member.cookie
  );
  assert.equal(shut.status, 409);

  const film = await queuedFilm();
  assert.equal((await req('POST', '/api/screening/open', { movieId: film.id }, member.cookie)).status, 201);

  for (const subtitle of [{ name: 'a.srt' }, { name: '  ', vtt }, { vtt }, 'WEBVTT']) {
    const { status } = await req('POST', '/api/screening/subtitle', { subtitle }, member.cookie);
    assert.equal(status, 400, JSON.stringify(subtitle));
  }
  assert.equal((await req('GET', '/api/screening/subtitle', null, member.cookie)).status, 404);

  await req('POST', '/api/screening/close', {}, member.cookie);
});

test('the clock endpoint answers with the server\'s instant', async () => {
  const member = await newMember();
  const before = Date.now();
  const { status, body } = await req('GET', '/api/screening/time', null, member.cookie);
  const after = Date.now();

  assert.equal(status, 200);
  assert.ok(body.t >= before && body.t <= after, 'o cliente mede o próprio desvio contra este número');
});
