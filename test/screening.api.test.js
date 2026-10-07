const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const dbPath = path.join(os.tmpdir(), `cineclube-screening-${crypto.randomUUID()}.db`);
process.env.CINECLUBE_DB = dbPath;

const app = require('../server');
const db = require('../db');
const kit = require('../testkit');

let CLUB;
const at = p => `/api/c/${CLUB.slug}${p}`;

let baseUrl;
let server;

test.before(async () => {
  await app.ready;
  server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  CLUB = await kit.makeClub({ name: 'Clube da Sessão', visibility: 'public' });
});

test.after(async () => {
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
  return { status: res.status, body: text ? JSON.parse(text) : null, setCookie: res.headers.get('set-cookie') };
}

let seq = 0;

async function newMember(name) {
  const who = await kit.signIn(name || `Sócio ${++seq}`);
  await kit.join(CLUB.id, who.id);
  return who;
}

async function newOutsider(name) {
  return kit.signIn(name || `De Fora ${++seq}`);
}

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
  assert.equal((await req('POST', at('/watchlist'), { movie: film }, member.cookie)).status, 201);
  return film;
}

async function listen(cookie) {
  const control = new AbortController();
  const res = await fetch(baseUrl + at('/screening/stream'), {
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
          if (!chunk.startsWith('data: ')) continue;
          const frame = JSON.parse(chunk.slice(6));
          frames.push(frame);
          for (const [predicate, resolve] of waiters.splice(0)) {
            if (predicate(frame)) resolve(frame);
            else waiters.push([predicate, resolve]);
          }
        }
      }
    } catch {
    }
  })();

  return {
    frames,
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

test('the room is the club\'s, not the internet\'s', async () => {
  for (const [method, route, body] of [
    ['GET', at('/screening')],
    ['GET', at('/screening/stream')],
    ['POST', at('/screening/open'), { movieId: 1 }],
    ['POST', at('/screening/close'), {}],
    ['POST', at('/screening/command'), { type: 'play' }],
    ['POST', at('/screening/ready'), { ready: true }],
    ['GET', at('/screening/subtitle')],
    ['POST', at('/screening/subtitle'), { subtitle: null }],
  ]) {
    const { status } = await req(method, route, body);
    assert.equal(status, 401, `${method} ${route} deveria exigir sessão`);
  }
});

test('the film is read out of the club\'s records, never out of the request', async () => {
  const member = await newMember();
  const film = await queuedFilm({ title: 'A Cópia Verdadeira' });

  const opened = await req(
    'POST',
    at('/screening/open'),
    { movieId: film.id, movie: { title: 'Outro Filme', poster: 'javascript:alert(1)' } },
    member.cookie
  );

  assert.equal(opened.status, 201);
  assert.equal(opened.body.open, true);
  assert.equal(opened.body.movie.title, 'A Cópia Verdadeira');
  assert.equal(opened.body.movie.poster, film.poster);

  await req('POST', at('/screening/close'), {}, member.cookie);
});

test('a film the club does not have is not a session', async () => {
  const member = await newMember();
  assert.equal((await req('POST', at('/screening/open'), { movieId: 999999999 }, member.cookie)).status, 404);
  assert.equal((await req('POST', at('/screening/open'), { movieId: 'nove' }, member.cookie)).status, 400);
});

async function cachedEpisode(overrides) {
  const showId = 700000 + ++seq;
  const show = {
    title: 'A Série da Sessão',
    year: 2019,
    genre: 'Drama',
    poster: 'https://image.tmdb.org/t/p/w342/serie.jpg',
    ...overrides,
  };
  await db
    .prepare(
      `INSERT INTO shows_cache (tmdb_id, title, year, genre, genres, poster, runtime, cached_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))`
    )
    .run(showId, show.title, show.year, show.genre, show.genre, show.poster, 22);
  for (const [numero, nome] of [[5, 'O Episódio'], [6, 'O Seguinte']]) {
    await db
      .prepare(
        `INSERT INTO episodes_cache (show_id, season, episode, title, runtime, cached_at)
         VALUES (?, ?, ?, ?, ?, datetime('now'))`
      )
      .run(showId, 2, numero, nome, 47);
  }
  return { showId, ...show };
}

test('a sessão abre num episódio, e diz que é um', async () => {
  const member = await newMember();
  const serie = await cachedEpisode({ title: 'Fim de Temporada' });

  const opened = await req(
    'POST',
    at('/screening/open'),
    { showId: serie.showId, season: 2, episode: 5 },
    member.cookie
  );
  assert.equal(opened.status, 201);
  assert.equal(opened.body.movie.kind, 'episode');
  assert.equal(opened.body.movie.id, serie.showId);
  assert.equal(opened.body.movie.title, 'Fim de Temporada');
  assert.equal(opened.body.movie.season, 2);
  assert.equal(opened.body.movie.episode, 5);
  assert.equal(opened.body.movie.episodeTitle, 'O Episódio');
  assert.equal(opened.body.movie.runtime, 47);
  assert.equal(opened.body.movie.poster, serie.poster);

  const film = await queuedFilm();
  const outro = await req('POST', at('/screening/open'), { movieId: film.id }, member.cookie);
  assert.equal(outro.body.movie.kind, 'movie');
  assert.equal(outro.body.movie.season, undefined);

  await req('POST', at('/screening/close'), {}, member.cookie);
});

test('um episódio que ninguém abriu ainda não é uma sessão', async () => {
  const member = await newMember();
  const serie = await cachedEpisode();

  const semCache = await req(
    'POST',
    at('/screening/open'),
    { showId: serie.showId, season: 2, episode: 99 },
    member.cookie
  );
  assert.equal(semCache.status, 404);

  for (const corpo of [
    { showId: serie.showId, season: 2 },
    { showId: serie.showId, season: 2, episode: 0 },
    { showId: serie.showId, season: -1, episode: 5 },
    { showId: 'duas', season: 2, episode: 5 },
  ]) {
    const { status } = await req('POST', at('/screening/open'), corpo, member.cookie);
    assert.equal(status, 400, JSON.stringify(corpo));
  }
});

test('a virada de episódio marca o anterior para quem estava na sala', async () => {
  const ana = await newMember('Ana da Série');
  const bruno = await newMember('Bruno da Série');
  const deFora = await newMember('Longe da Série');
  const serie = await cachedEpisode({ title: 'A Vista Junto' });
  const vistos = async who =>
    (await req('GET', at('/shows/takes'), null, who.cookie)).body.takes.filter(
      t => t.showId === serie.showId && t.reviewerId === who.id
    );

  assert.equal(
    (
      await req(
        'PUT',
        at(`/shows/${serie.showId}/2`),
        { showTitle: serie.title, genre: 'Drama', quick: 8 },
        bruno.cookie
      )
    ).status,
    201
  );

  const dela = await listen(ana.cookie);
  const dele = await listen(bruno.cookie);
  await dela.next(f => f.type === 'state');
  await dele.next(f => f.type === 'state');

  await req('POST', at('/screening/open'), { showId: serie.showId, season: 2, episode: 5 }, ana.cookie);
  assert.equal((await vistos(ana)).length, 0, 'chegar num episódio não é tê-lo visto');

  assert.equal(
    (await req('POST', at('/screening/open'), { showId: serie.showId, season: 2, episode: 6 }, ana.cookie))
      .status,
    201
  );

  const daAna = await vistos(ana);
  assert.equal(daAna.length, 1, 'só o episódio que saiu, e uma vez');
  assert.equal(daAna[0].season, 2);
  assert.equal(daAna[0].episode, 5);
  assert.equal(daAna[0].final, null, 'visto não é avaliado');

  const doBruno = await vistos(bruno);
  const marcadosDoBruno = doBruno.filter(t => t.kind === 'episode');
  assert.equal(marcadosDoBruno.length, 1, 'quem estava na sala e não apertou nada também viu');
  assert.equal(marcadosDoBruno[0].episode, 5);
  const fichaDoBruno = doBruno.filter(t => t.kind === 'season');
  assert.equal(fichaDoBruno.length, 1, 'a ficha da temporada não podia sumir na virada');
  assert.equal(fichaDoBruno[0].final, 8, 'e a nota de quem já tinha avaliado continua lá');

  assert.equal((await vistos(deFora)).length, 0, 'quem não estava na sala não viu nada');

  await dela.close();
  await dele.close();
  await req('POST', at('/screening/close'), {}, ana.cookie);
  assert.equal((await vistos(ana)).length, 1);
});

test('a command needs an open session and a real name', async () => {
  const member = await newMember();
  await req('POST', at('/screening/close'), {}, member.cookie);

  assert.equal((await req('POST', at('/screening/command'), { type: 'play' }, member.cookie)).status, 409);
  assert.equal((await req('POST', at('/screening/command'), { type: 'rewind' }, member.cookie)).status, 400);

  const film = await queuedFilm();
  await req('POST', at('/screening/open'), { movieId: film.id }, member.cookie);
  const nonsense = await req(
    'POST',
    at('/screening/command'),
    { type: 'seek', position: 'meia hora' },
    member.cookie
  );
  assert.equal(nonsense.status, 400, 'um NaN gravado no estado trava a sessão do clube inteiro');

  await req('POST', at('/screening/close'), {}, member.cookie);
});

test('só quem abriu a sessão comanda o filme', async () => {
  const dona = await newMember('Dona da Sessão');
  const outro = await newMember('Outro da Sessão');
  const film = await queuedFilm({ title: 'A Sessão Dela' });

  await req('POST', at('/screening/close'), {}, dona.cookie);
  assert.equal((await req('POST', at('/screening/open'), { movieId: film.id }, dona.cookie)).status, 201);

  const refused = await req('POST', at('/screening/command'), { type: 'play', position: 0 }, outro.cookie);
  assert.equal(refused.status, 403);
  assert.match(refused.body.error, /Dona da Sessão/, 'a recusa diz de quem é o controle');

  const shut = await req('POST', at('/screening/close'), {}, outro.cookie);
  assert.equal(shut.status, 403, 'encerrar a sessão de outra pessoa é mexer no player dela');

  const outroFilme = await queuedFilm({ title: 'O Filme Dele' });
  const roubo = await req('POST', at('/screening/open'), { movieId: outroFilme.id }, outro.cookie);
  assert.equal(roubo.status, 403, 'trocar o filme por baixo da sessão é tomar o controle dela');

  const still = await req('GET', at('/screening'), null, outro.cookie);
  assert.equal(still.body.status, 'paused');
  assert.equal(still.body.host.name, 'Dona da Sessão');

  assert.equal((await req('POST', at('/screening/command'), { type: 'play', position: 0 }, dona.cookie)).status, 200);
  await req('POST', at('/screening/close'), {}, dona.cookie);
});

test('o controle passa a quem ficou quando a dona sai da sala', async () => {
  const dona = await newMember('Dona Que Sai');
  const resta = await newMember('Quem Fica');
  const film = await queuedFilm({ title: 'A Sessão Herdada' });

  const ear = await listen(resta.cookie);
  await ear.next(f => f.type === 'state');

  const dela = await listen(dona.cookie);
  await req('POST', at('/screening/open'), { movieId: film.id }, dona.cookie);
  await ear.next(f => f.type === 'state' && f.host?.name === 'Dona Que Sai');

  await dela.close();
  const herdada = await ear.next(f => f.type === 'state' && f.host?.name === 'Quem Fica');
  assert.equal(herdada.open, true, 'a sessão continua aberta; só o controle mudou de mão');

  assert.equal(
    (await req('POST', at('/screening/command'), { type: 'pause', position: 10 }, resta.cookie)).status,
    200
  );

  await ear.close();
  await req('POST', at('/screening/close'), {}, resta.cookie);
});

test('one member presses play and the other member\'s stream says so', async () => {
  const ana = await newMember('Ana da Sessão');
  const bruno = await newMember('Bruno da Sessão');
  const film = await queuedFilm({ title: 'Sessão Sincronizada' });

  const ear = await listen(bruno.cookie);
  const hello = await ear.next(f => f.type === 'state');
  assert.equal(hello.status, 'paused');
  assert.ok(hello.viewers.some(v => v.name === 'Bruno da Sessão'), 'quem conecta entra na sala');

  await req('POST', at('/screening/open'), { movieId: film.id }, ana.cookie);
  const opened = await ear.next(f => f.type === 'state' && f.open);
  assert.equal(opened.movie.title, 'Sessão Sincronizada');

  await req('POST', at('/screening/command'), { type: 'play', position: 0 }, ana.cookie);
  const playing = await ear.next(f => f.status === 'playing');
  assert.ok(playing.revision > opened.revision, 'toda mudança avança a revisão');

  await req('POST', at('/screening/command'), { type: 'seek', position: 1200 }, ana.cookie);
  const sought = await ear.next(f => f.position >= 1200);
  assert.equal(sought.status, 'playing', 'arrastar a barra não pausa o filme');

  await req('POST', at('/screening/close'), {}, ana.cookie);
  await ear.close();
});

test('uma travada chega ao painel do clube sem parar o filme', async () => {
  const ana = await newMember('Ana do Buffer');
  const bruno = await newMember('Bruno do Buffer');
  const film = await queuedFilm();

  const ear = await listen(ana.cookie);
  const brunoEar = await listen(bruno.cookie);
  await ear.next(f => f.type === 'state' && f.viewers.some(v => v.name === 'Bruno do Buffer'));

  await req('POST', at('/screening/open'), { movieId: film.id }, ana.cookie);
  await req('POST', at('/screening/command'), { type: 'play', position: 0 }, ana.cookie);
  const playing = await ear.next(f => f.status === 'playing');

  await req('POST', at('/screening/ready'), { ready: false, sourceTag: 'abc123' }, bruno.cookie);
  const stalled = await ear.next(
    f => f.type === 'state' && f.viewers.some(v => v.name === 'Bruno do Buffer' && !v.ready)
  );
  assert.equal(stalled.status, 'playing', 'a sala parou por uma travada');
  assert.ok(stalled.revision >= playing.revision);
  assert.equal(stalled.viewers.find(v => v.name === 'Bruno do Buffer').sourceTag, 'abc123');

  await req('POST', at('/screening/ready'), { ready: true }, bruno.cookie);
  const now = (await req('GET', at('/screening'), null, ana.cookie)).body;
  assert.equal(now.status, 'playing');
  assert.equal(now.viewers.find(v => v.name === 'Bruno do Buffer').ready, true);

  await req('POST', at('/screening/close'), {}, ana.cookie);
  await ear.close();
  await brunoEar.close();
});

test('the link the club is on reaches a member who arrives later', async () => {
  const first = await newMember('Quem Abriu');
  const late = await newMember('Quem Chegou Depois');
  const film = await queuedFilm();
  const magnet = 'magnet:?xt=urn:btih:0123456789abcdef0123456789abcdef01234567&dn=Filme';

  await req('POST', at('/screening/open'), { movieId: film.id }, first.cookie);
  const published = await req('POST', at('/screening/link'), { link: magnet }, first.cookie);
  assert.equal(published.status, 200);

  const ear = await listen(late.cookie);
  const hello = await ear.next(f => f.type === 'state');
  assert.equal(hello.link, magnet);

  await ear.close();
  await req('POST', at('/screening/close'), {}, first.cookie);
});

test('the link is refused unless it is one a browser can be handed', async () => {
  const member = await newMember();
  const film = await queuedFilm();
  await req('POST', at('/screening/open'), { movieId: film.id }, member.cookie);

  for (const bad of ['javascript:alert(1)', 'data:text/html,<script>1</script>', 'blob:http://x/1', 'nada']) {
    const { status } = await req('POST', at('/screening/link'), { link: bad }, member.cookie);
    assert.equal(status, 400, `${bad} deveria ser recusado`);
  }

  const { body } = await req('GET', at('/screening'), null, member.cookie);
  assert.equal(body.link, null);

  await req('POST', at('/screening/close'), {}, member.cookie);
});

test('there is nothing to point at without a session', async () => {
  const member = await newMember();
  await req('POST', at('/screening/close'), {}, member.cookie);

  const { status } = await req(
    'POST',
    at('/screening/link'),
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

  for (let i = 0; i < 40; i++) {
    const { body } = await req('GET', at('/screening'), null, member.cookie);
    if (!body.viewers.some(v => v.name === 'Quem Sai')) return;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  assert.fail('o espectador continuou na sala depois de fechar a conexão');
});

test('a subtitle posted by one member is announced to another, and collected', async () => {
  const film = await queuedFilm({ title: 'A Sessão Legendada' });
  const ana = await newMember('Ana da Legenda');
  const bruno = await newMember('Bruno da Legenda');
  assert.equal((await req('POST', at('/screening/open'), { movieId: film.id }, ana.cookie)).status, 201);

  const ear = await listen(bruno.cookie);
  const vtt = 'WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nboa noite';

  const sent = await req(
    'POST',
    at('/screening/subtitle'),
    { subtitle: { name: 'filme.srt', vtt } },
    ana.cookie
  );
  assert.equal(sent.status, 200);

  const frame = await ear.next(f => f.type === 'state' && f.subtitle?.name === 'filme.srt');
  assert.equal(frame.subtitle.vtt, undefined);

  const got = await req('GET', at('/screening/subtitle'), null, bruno.cookie);
  assert.equal(got.status, 200);
  assert.equal(got.body.vtt, vtt);
  assert.equal(got.body.id, frame.subtitle.id, 'o id busca exatamente o que foi anunciado');

  assert.equal(
    (await req('POST', at('/screening/subtitle'), { subtitle: null }, bruno.cookie)).status,
    200
  );
  await ear.next(f => f.type === 'state' && f.subtitle === null);
  assert.equal((await req('GET', at('/screening/subtitle'), null, ana.cookie)).status, 404);

  await ear.close();
  await req('POST', at('/screening/close'), {}, ana.cookie);
});

test('a subtitle needs an open session, and has to look like one', async () => {
  const member = await newMember();
  const vtt = 'WEBVTT\n\n00:00:01.000 --> 00:00:02.000\noi';

  await req('POST', at('/screening/close'), {}, member.cookie);
  const shut = await req(
    'POST',
    at('/screening/subtitle'),
    { subtitle: { name: 'a.srt', vtt } },
    member.cookie
  );
  assert.equal(shut.status, 409);

  const film = await queuedFilm();
  assert.equal((await req('POST', at('/screening/open'), { movieId: film.id }, member.cookie)).status, 201);

  for (const subtitle of [{ name: 'a.srt' }, { name: '  ', vtt }, { vtt }, 'WEBVTT']) {
    const { status } = await req('POST', at('/screening/subtitle'), { subtitle }, member.cookie);
    assert.equal(status, 400, JSON.stringify(subtitle));
  }
  assert.equal((await req('GET', at('/screening/subtitle'), null, member.cookie)).status, 404);

  await req('POST', at('/screening/close'), {}, member.cookie);
});

test('the clock endpoint answers with the server\'s instant', async () => {
  const member = await newMember();
  const before = Date.now();
  const { status, body } = await req('GET', at('/screening/time'), null, member.cookie);
  const after = Date.now();

  assert.equal(status, 200);
  assert.ok(body.t >= before && body.t <= after, 'o cliente mede o próprio desvio contra este número');
});
