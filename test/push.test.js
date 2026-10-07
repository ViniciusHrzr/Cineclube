const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const crypto = require('node:crypto');

const dbPath = path.join(os.tmpdir(), `cineclube-push-${crypto.randomUUID()}.db`);
process.env.CINECLUBE_DB = dbPath;

const push = require('../push');
const par = push.generate();
process.env.VAPID_PUBLIC = par.public;
process.env.VAPID_PRIVATE = par.private;
process.env.VAPID_SUBJECT = 'mailto:teste@exemplo.com';
process.env.CINECLUBE_CRON_SECRET = 'segredo-do-relogio';

const { privateKey } = require('node:crypto').generateKeyPairSync('rsa', { modulusLength: 2048 });
process.env.FCM_PROJECT_ID = 'cineclube-de-teste';
process.env.FCM_CLIENT_EMAIL = 'robo@cineclube-de-teste.iam.gserviceaccount.com';
process.env.FCM_PRIVATE_KEY = privateKey.export({ type: 'pkcs8', format: 'pem' });

const app = require('../server');
const db = require('../db');
const live = require('../live');
const screening = require('../screening');
const throttle = require('../throttle');
const kit = require('../testkit');

let baseUrl;
let server;

let entregas = [];
let servico;
let servicoUrl;
let resposta = 201;

test.before(async () => {
  await app.ready;
  server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;

  servico = http.createServer((req, res) => {
    const pedacos = [];
    req.on('data', p => pedacos.push(p));
    req.on('end', () => {
      entregas.push({
        url: req.url,
        headers: req.headers,
        body: Buffer.concat(pedacos),
      });
      if (req.url === '/token') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end('{"access_token":"token-de-acesso-de-teste","expires_in":3600}');
        return;
      }
      if (req.url.includes('/messages:send')) {
        res.writeHead(resposta, { 'Content-Type': 'application/json' });
        res.end(resposta === 200 ? '{"name":"projects/x/messages/1"}' : '{"error":{"status":"UNREGISTERED"}}');
        return;
      }
      res.writeHead(resposta).end();
    });
  });
  servico.listen(0);
  await new Promise(resolve => servico.once('listening', resolve));
  servicoUrl = `http://127.0.0.1:${servico.address().port}`;
  process.env.FCM_BASE = servicoUrl;
  process.env.FCM_OAUTH = `${servicoUrl}/token`;
});

test.after(async () => {
  live.stopTimers();
  screening.stopTimers();
  throttle.stopTimers();
  const closed = new Promise(resolve => server.close(resolve));
  server.closeAllConnections?.();
  await closed;
  servico.closeAllConnections?.();
  await new Promise(resolve => servico.close(resolve));
  db.close();
  for (const suffix of ['', '-shm', '-wal']) {
    try { fs.rmSync(dbPath + suffix, { force: true }); } catch { }
  }
});

test.beforeEach(() => {
  throttle.reset();
  entregas = [];
  resposta = 201;
});

async function req(method, pathname, body, cookie, headers = {}) {
  const h = { ...headers };
  if (body) h['Content-Type'] = 'application/json';
  if (cookie) h.Cookie = cookie;
  const res = await fetch(baseUrl + pathname, {
    method,
    headers: Object.keys(h).length ? h : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let parsed = null;
  try { parsed = text ? JSON.parse(text) : null; } catch { parsed = null; }
  return { status: res.status, body: parsed };
}

let seq = 0;
async function aparelho(reviewerId) {
  const endpoint = `${servicoUrl}/entrega/${++seq}`;
  const ecdh = crypto.createECDH('prime256v1');
  ecdh.generateKeys();
  await db
    .prepare('INSERT INTO push_subs (id, reviewer_id, endpoint, p256dh, auth) VALUES (?,?,?,?,?)')
    .run(
      crypto.createHash('sha256').update(endpoint).digest('hex'),
      reviewerId,
      endpoint,
      ecdh.getPublicKey().toString('base64url'),
      crypto.randomBytes(16).toString('base64url')
    );
  return endpoint;
}

async function aparelhoApp(reviewerId) {
  const token = `token-do-aparelho-${++seq}`;
  await db
    .prepare(
      "INSERT INTO push_subs (id, reviewer_id, kind, endpoint, p256dh, auth) VALUES (?,?,'fcm',?,'','')"
    )
    .run(crypto.createHash('sha256').update(token).digest('hex'), reviewerId, token);
  return token;
}

test('a cifra bate byte a byte com o vetor do RFC 8291', () => {
  const esperado =
    'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLoc' +
    'InmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLV' +
    'WGNWQexSgSxsj_Qulcy4a-fN';

  const saida = push.encrypt(
    'When I grow up, I want to be a watermelon',
    {
      p256dh:
        'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
      auth: 'BTBZMqHH6r4Tts7J_aSIgg',
    },
    'yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw',
    Buffer.from('DGv6ra1nlYgDCS1FRnbzlw', 'base64url')
  );

  assert.equal(saida.toString('base64url'), esperado);
});

test('a mesma mensagem sai diferente cada vez', () => {
  const sub = {
    p256dh:
      'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
    auth: 'BTBZMqHH6r4Tts7J_aSIgg',
  };
  const a = push.encrypt('oi', sub).toString('base64url');
  const b = push.encrypt('oi', sub).toString('base64url');
  assert.notEqual(a, b);
});

test('a chave pública é servida para quem vai se inscrever', async () => {
  const { status, body } = await req('GET', '/api/push/key');
  assert.equal(status, 200);
  assert.equal(body.key, par.public);
});

test('inscrever o mesmo aparelho duas vezes é uma linha só', async () => {
  const p = await kit.signIn();
  const corpo = {
    endpoint: 'https://push.exemplo.com/abc',
    keys: { p256dh: 'chave-publica-do-aparelho', auth: 'segredo' },
  };

  assert.equal((await req('POST', '/api/push/subscribe', corpo, p.cookie)).status, 201);
  assert.equal((await req('POST', '/api/push/subscribe', corpo, p.cookie)).status, 201);

  const linhas = await db.prepare('SELECT * FROM push_subs WHERE reviewer_id = ?').all(p.id);
  assert.equal(linhas.length, 1);

  assert.equal(
    (await req('DELETE', '/api/push/subscribe', { endpoint: corpo.endpoint }, p.cookie)).status,
    204
  );
  assert.equal((await db.prepare('SELECT * FROM push_subs WHERE reviewer_id = ?').all(p.id)).length, 0);
});

test('sem sessão ninguém inscreve aparelho nenhum', async () => {
  const solto = await req('POST', '/api/push/subscribe', {
    endpoint: 'https://push.exemplo.com/xyz',
    keys: { p256dh: 'a', auth: 'b' },
  });
  assert.equal(solto.status, 401);
});

test('um endereço que não é https é recusado', async () => {
  const p = await kit.signIn();
  const torto = await req(
    'POST',
    '/api/push/subscribe',
    { endpoint: 'http://push.exemplo.com/abc', keys: { p256dh: 'a', auth: 'b' } },
    p.cookie
  );
  assert.equal(torto.status, 400);
});

const hojeBR = () => new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 10);

async function estreiaHoje(p, club) {
  const showId = 600000 + ++seq;
  await req(
    'POST',
    `/api/c/${club.slug}/shows`,
    { show: { id: showId, title: `Série ${seq}`, year: 2024, genre: 'Drama', poster: null } },
    p.cookie
  );
  await db
    .prepare(
      `INSERT INTO episodes_cache (show_id, season, episode, title, air_date)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(showId, 4, 2, 'A Volta', hojeBR());
  return showId;
}

const relogio = (secret = 'segredo-do-relogio') =>
  req('POST', '/api/push/airing', null, null, { 'X-Cineclube-Cron': secret });

test('o relógio manda a estreia do dia para quem acompanha', async () => {
  const p = await kit.signIn();
  const club = await kit.makeClub({ owner: p.id });
  await estreiaHoje(p, club);
  await aparelho(p.id);

  const saida = await relogio();
  assert.equal(saida.status, 200);
  assert.equal(saida.body.avisos, 1);
  assert.equal(saida.body.falhas, 0);
  assert.equal(entregas.length, 1);

  const entrega = entregas[0];
  assert.match(entrega.headers.authorization || '', /^vapid t=.+, k=.+/);
  assert.equal(entrega.headers['content-encoding'], 'aes128gcm');
  assert.ok(entrega.body.length > 16, 'o corpo cifrado não pode estar vazio');
});

test('rodar de novo no mesmo dia não acorda ninguém duas vezes', async () => {
  const p = await kit.signIn();
  const club = await kit.makeClub({ owner: p.id });
  await estreiaHoje(p, club);
  await aparelho(p.id);

  await relogio();
  entregas = [];
  const segunda = await relogio();
  assert.equal(segunda.body.avisos, 0);
  assert.equal(entregas.length, 0);
});

test('quem não acompanha não é avisado', async () => {
  const dono = await kit.signIn();
  const outra = await kit.signIn();
  const club = await kit.makeClub({ owner: dono.id });
  await kit.join(club.id, outra.id);
  await estreiaHoje(dono, club);
  await aparelho(outra.id);

  const saida = await relogio();
  assert.equal(saida.body.avisos, 0);
  assert.equal(entregas.length, 0);
});

test('o aparelho que respondeu 410 sai da lista', async () => {
  const p = await kit.signIn();
  const club = await kit.makeClub({ owner: p.id });
  await estreiaHoje(p, club);
  await aparelho(p.id);

  resposta = 410;
  const saida = await relogio();
  assert.equal(saida.body.avisos, 0);
  assert.equal(saida.body.falhas, 1);

  const sobrou = await db.prepare('SELECT * FROM push_subs WHERE reviewer_id = ?').all(p.id);
  assert.equal(sobrou.length, 0, 'a inscrição morta tinha de sair');
});

test('sem o segredo, o relógio não dispara nada', async () => {
  const p = await kit.signIn();
  const club = await kit.makeClub({ owner: p.id });
  await estreiaHoje(p, club);
  await aparelho(p.id);

  assert.equal((await relogio('chute')).status, 403);
  assert.equal((await req('POST', '/api/push/airing')).status, 403);
  assert.equal(entregas.length, 0);
});

test('o aplicativo se inscreve com um token, e a linha sabe por qual porta sai', async () => {
  const p = await kit.signIn();
  const posto = await req(
    'POST',
    '/api/push/subscribe',
    { kind: 'fcm', token: 'token-de-um-aparelho' },
    p.cookie
  );
  assert.equal(posto.status, 201);

  const linhas = await db.prepare('SELECT * FROM push_subs WHERE reviewer_id = ?').all(p.id);
  assert.equal(linhas.length, 1);
  assert.equal(linhas[0].kind, 'fcm');
  assert.equal(linhas[0].endpoint, 'token-de-um-aparelho');

  assert.equal(
    (await req('DELETE', '/api/push/subscribe', { token: 'token-de-um-aparelho' }, p.cookie)).status,
    204
  );
  assert.equal((await db.prepare('SELECT * FROM push_subs WHERE reviewer_id = ?').all(p.id)).length, 0);
});

test('a estreia do dia sai pela porta do Android quando a inscrição é de app', async () => {
  const p = await kit.signIn();
  const club = await kit.makeClub({ owner: p.id });
  await estreiaHoje(p, club);
  const token = await aparelhoApp(p.id);

  resposta = 200;
  await relogio();

  const envio = entregas.find(e => e.url.includes('/messages:send'));
  assert.ok(envio, 'nada foi mandado ao FCM');
  assert.equal(envio.headers.authorization, 'Bearer token-de-acesso-de-teste');

  const corpo = JSON.parse(envio.body.toString('utf8'));
  assert.equal(corpo.message.token, token);
  assert.ok(corpo.message.notification.title, 'o aviso precisa de um título');
  assert.match(corpo.message.notification.body, /T4E02/);
  assert.ok(corpo.message.android.notification.tag);
});

test('o aparelho que o Google diz não existir mais sai da lista', async () => {
  const p = await kit.signIn();
  const club = await kit.makeClub({ owner: p.id });
  await estreiaHoje(p, club);
  await aparelhoApp(p.id);

  resposta = 404;
  await relogio();
  assert.equal(
    (await db.prepare('SELECT * FROM push_subs WHERE reviewer_id = ?').all(p.id)).length,
    0,
    'a inscrição morta tinha de sair'
  );
});

test('quem tem os dois recebe nos dois', async () => {
  const p = await kit.signIn();
  const club = await kit.makeClub({ owner: p.id });
  await estreiaHoje(p, club);
  await aparelho(p.id);
  await aparelhoApp(p.id);

  resposta = 200;
  await relogio();
  assert.ok(entregas.some(e => e.url.includes('/messages:send')), 'o aplicativo não recebeu');
  assert.ok(entregas.some(e => e.url.startsWith('/entrega/')), 'o navegador não recebeu');
});
