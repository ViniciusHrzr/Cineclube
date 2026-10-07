const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const dbPath = path.join(os.tmpdir(), `cineclube-contract-${crypto.randomUUID()}.db`);
process.env.CINECLUBE_DB = dbPath;

const app = require('../server');
const db = require('../lib/db');
const live = require('../lib/live');
const screening = require('../lib/screening');
const throttle = require('../lib/throttle');
const kit = require('../lib/testkit');
const { critsFor } = require('../rules/criteria');

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
    try { fs.rmSync(dbPath + suffix, { force: true }); } catch { }
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
  return { status: res.status, body: parsed };
}

function promete(objeto, campos, quem) {
  assert.ok(objeto && typeof objeto === 'object', `${quem}: veio ${objeto}`);
  const tem = Object.keys(objeto);
  const faltando = campos.filter(c => !tem.includes(c));
  assert.deepEqual(faltando, [], `${quem} perdeu ${faltando.join(', ')}`);
}

let seq = 0;
const at = (club, p) => `/api/c/${club.slug}${p}`;
const movie = () => ({ id: 700000 + ++seq, title: `Filme ${seq}`, year: 2024, genre: 'Terror' });
const show = () => ({
  id: 700000 + ++seq, title: `Série ${seq}`, year: 2024, genre: 'Drama', poster: `/s/${seq}.jpg`,
});

function scoresFor(genre, value) {
  const o = {};
  critsFor(genre).forEach(c => { o[c.key] = value; });
  return o;
}

test('a conta que a sessão devolve', async () => {
  const p = await kit.signIn();
  const { body } = await req('GET', '/api/auth/me', null, p.cookie);
  promete(body, ['reviewer', 'google', 'mail'], '/api/auth/me');
  promete(
    body.reviewer,
    ['id', 'name', 'dot', 'isAdmin', 'email', 'emailVerified', 'avatar'],
    'reviewer'
  );
});

test('a sala', async () => {
  const p = await kit.signIn();
  const club = await kit.makeClub({ owner: p.id });
  const { body } = await req('GET', `/api/c/${club.slug}`, null, p.cookie);
  promete(
    body.club,
    ['id', 'name', 'slug', 'tagline', 'visibility', 'photo', 'role', 'isMember'],
    'club'
  );
});

test('a ficha de um filme', async () => {
  const p = await kit.signIn();
  const club = await kit.makeClub({ owner: p.id });
  await req('POST', at(club, '/reviews'), { movie: movie(), scores: scoresFor('Terror', 8) }, p.cookie);

  const { body } = await req('GET', at(club, '/reviews'), null, p.cookie);
  promete(
    body.reviews[0],
    [
      'id', 'reviewerId', 'reviewerName', 'reviewerDot',
      'movieId', 'movieTitle', 'movieYear', 'movieGenre', 'moviePoster', 'movieDirector',
      'scores', 'final', 'date', 'comment', 'breakdown',
    ],
    'review'
  );
  promete(body.reviews[0].breakdown[0], ['key', 'name', 'w', 'group', 'value'], 'breakdown');
});

test('a série na lista do clube', async () => {
  const p = await kit.signIn();
  const club = await kit.makeClub({ owner: p.id });
  await req('POST', at(club, '/shows'), { show: show() }, p.cookie);

  const { body } = await req('GET', at(club, '/shows'), null, p.cookie);
  promete(
    body.shows[0],
    [
      'id', 'title', 'year', 'genre', 'poster', 'addedAt', 'wanters',
      'seen', 'rated', 'average',
      'upNext', 'upcoming', 'caughtUp',
    ],
    'queued show'
  );
});

test('a marca de um episódio e a ficha de uma temporada', async () => {
  const p = await kit.signIn();
  const club = await kit.makeClub({ owner: p.id });
  const s = show();
  const base = { showTitle: s.title, genre: 'Drama' };

  await req('PUT', at(club, `/shows/${s.id}/1/1`), { ...base, episodeTitle: 'Piloto' }, p.cookie);
  await req('PUT', at(club, `/shows/${s.id}/1`), { ...base, quick: 8 }, p.cookie);

  const { body } = await req('GET', at(club, '/shows/takes'), null, p.cookie);
  const campos = [
    'id', 'kind', 'showId', 'showTitle', 'showPoster', 'genre',
    'season', 'episode', 'episodeTitle',
    'reviewerId', 'reviewerName', 'reviewerDot',
    'scores', 'quick', 'final', 'comment', 'watchedAt', 'ratedAt', 'breakdown',
  ];
  for (const take of body.takes) promete(take, campos, `take ${take.kind}`);

  assert.deepEqual(
    body.takes.map(t => t.kind).sort(),
    ['episode', 'season']
  );
});

test('o sino da rede', async () => {
  const dono = await kit.signIn();
  const outra = await kit.signIn();
  const club = await kit.makeClub({ owner: dono.id });
  await kit.join(club.id, outra.id);

  const ficha = await req(
    'POST', at(club, '/reviews'), { movie: movie(), scores: scoresFor('Terror', 7) }, dono.cookie
  );
  await req(
    'POST', at(club, `/social/reviews/${ficha.body.id}/comments`), { body: 'boa' }, outra.cookie
  );

  const { body } = await req('GET', '/api/notices', null, dono.cookie);
  promete(body, ['items', 'unread', 'account', 'clubs'], '/api/notices');
  promete(body.items[0], ['id', 'kind', 'at', 'text', 'club'], 'notice');
  promete(body.items[0].actor, ['id', 'name', 'dot'], 'notice.actor');
});

test('a versão da API', async () => {
  const { body } = await req('GET', '/api/meta');
  promete(body, ['api', 'minClient'], '/api/meta');
});
