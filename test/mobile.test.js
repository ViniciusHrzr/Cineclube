const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const zlib = require('node:zlib');

const dbPath = path.join(os.tmpdir(), `cineclube-mobile-${crypto.randomUUID()}.db`);
process.env.CINECLUBE_DB = dbPath;

const app = require('../server');
const db = require('../db');
const live = require('../live');
const screening = require('../screening');
const throttle = require('../throttle');
const auth = require('../auth');
const kit = require('../testkit');

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

async function req(method, pathname, { body, cookie, bearer, origin, headers } = {}) {
  const h = { ...(headers || {}) };
  if (body) h['Content-Type'] = 'application/json';
  if (cookie) h.Cookie = cookie;
  if (bearer) h.Authorization = `Bearer ${bearer}`;
  if (origin) h.Origin = origin;
  const res = await fetch(baseUrl + pathname, {
    method,
    headers: Object.keys(h).length ? h : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let parsed = null;
  try { parsed = text ? JSON.parse(text) : null; } catch { parsed = null; }
  return { status: res.status, body: parsed, headers: res.headers };
}

async function comSenha(senha = 'senha-de-teste') {
  const p = await kit.signIn();
  await auth.setPassword(p.id, senha);
  const email = (await db.prepare('SELECT email FROM reviewers WHERE id = ?').get(p.id)).email;
  return { ...p, email, senha };
}

test('o manifesto está servido, e os ícones que ele promete existem', async () => {
  const manifesto = await req('GET', '/manifest.webmanifest', {});
  assert.equal(manifesto.status, 200);
  assert.equal(manifesto.body.start_url, '/');
  assert.equal(manifesto.body.display, 'standalone');
  assert.ok(manifesto.body.icons.length >= 2);
  assert.ok(
    manifesto.body.icons.some(i => i.purpose === 'maskable'),
    'sem um ícone mascarável o Android corta os cantos do desenho'
  );

  for (const icone of manifesto.body.icons) {
    const res = await fetch(baseUrl + icone.src);
    assert.equal(res.status, 200, `${icone.src} não está lá`);
    assert.equal(res.headers.get('content-type'), 'image/png');
  }
});

test('o service worker do app carrega o do WebTorrent dentro dele', async () => {
  const res = await fetch(baseUrl + '/app-sw.js');
  assert.equal(res.status, 200);
  const code = await res.text();
  assert.match(code, /importScripts\(['"]\/sw\.min\.js['"]\)/);
  assert.match(code, /addEventListener\(['"]fetch['"]/);
});

test('e-mail e senha devolvem um par de chaves, e o Bearer vale como sessão', async () => {
  const p = await comSenha();

  const porta = await req('POST', '/api/auth/token', {
    body: { email: p.email, password: p.senha },
  });
  assert.equal(porta.status, 200);
  assert.ok(porta.body.access, 'sem a chave de acesso não há sessão');
  assert.ok(porta.body.refresh, 'sem a de renovação o app pede senha todo dia');
  assert.equal(porta.body.expiresIn, auth.APP_SESSION_DAYS * 86400);
  assert.equal(porta.body.reviewer.id, p.id);

  const me = await req('GET', '/api/auth/me', { bearer: porta.body.access });
  assert.equal(me.body.reviewer?.id, p.id);
});

test('quem entra por Bearer não recebe cookie de volta', async () => {
  const p = await comSenha();
  const { body } = await req('POST', '/api/auth/token', {
    body: { email: p.email, password: p.senha },
  });

  const me = await req('GET', '/api/auth/me', { bearer: body.access });
  assert.equal(me.headers.get('set-cookie'), null);
});

test('a senha errada não abre a porta do app', async () => {
  const p = await comSenha();
  const errada = await req('POST', '/api/auth/token', {
    body: { email: p.email, password: 'nao-e-essa' },
  });
  assert.equal(errada.status, 401);
  assert.equal(errada.body.access, undefined);
});

test('uma sessão de navegador se troca por um par', async () => {
  const p = await kit.signIn();
  const trocado = await req('POST', '/api/auth/token', { cookie: p.cookie });
  assert.equal(trocado.status, 200);
  assert.ok(trocado.body.access);

  const me = await req('GET', '/api/auth/me', { bearer: trocado.body.access });
  assert.equal(me.body.reviewer.id, p.id);
});

test('sem sessão e sem senha, não há par nenhum', async () => {
  const vazio = await req('POST', '/api/auth/token', {});
  assert.equal(vazio.status, 401);
});

test('o cookie continua entrando, como sempre entrou', async () => {
  const p = await kit.signIn();
  const me = await req('GET', '/api/auth/me', { cookie: p.cookie });
  assert.equal(me.body.reviewer.id, p.id);
});

test('renovar devolve um par novo, e a chave usada não serve mais', async () => {
  const p = await comSenha();
  const primeiro = (await req('POST', '/api/auth/token', {
    body: { email: p.email, password: p.senha },
  })).body;

  const segundo = await req('POST', '/api/auth/refresh', { body: { refresh: primeiro.refresh } });
  assert.equal(segundo.status, 200);
  assert.notEqual(segundo.body.access, primeiro.access);
  assert.notEqual(segundo.body.refresh, primeiro.refresh);

  const nova = await req('GET', '/api/auth/me', { bearer: segundo.body.access });
  assert.equal(nova.body.reviewer.id, p.id);
});

test('apresentar uma chave já gasta derruba a família inteira', async () => {
  const p = await comSenha();
  const primeiro = (await req('POST', '/api/auth/token', {
    body: { email: p.email, password: p.senha },
  })).body;
  const segundo = (await req('POST', '/api/auth/refresh', {
    body: { refresh: primeiro.refresh },
  })).body;

  const reuso = await req('POST', '/api/auth/refresh', { body: { refresh: primeiro.refresh } });
  assert.equal(reuso.status, 401);

  const depois = await req('POST', '/api/auth/refresh', { body: { refresh: segundo.refresh } });
  assert.equal(depois.status, 401, 'a família tinha de cair inteira');
});

test('uma chave inventada não renova nada', async () => {
  const chutada = await req('POST', '/api/auth/refresh', { body: { refresh: 'nao-existe' } });
  assert.equal(chutada.status, 401);
});

test('sair no aparelho leva a sessão e a família junto', async () => {
  const p = await comSenha();
  const par = (await req('POST', '/api/auth/token', {
    body: { email: p.email, password: p.senha },
  })).body;

  const saida = await req('POST', '/api/auth/logout', {
    bearer: par.access,
    body: { refresh: par.refresh },
  });
  assert.equal(saida.status, 204);

  const me = await req('GET', '/api/auth/me', { bearer: par.access });
  assert.equal(me.body.reviewer, null, 'a sessão tinha de morrer');

  const renovada = await req('POST', '/api/auth/refresh', { body: { refresh: par.refresh } });
  assert.equal(renovada.status, 401, 'a chave de noventa dias não pode sobreviver ao sair');
});

test('a sessão do app é de um dia e não desliza', async () => {
  const p = await comSenha();
  const par = (await req('POST', '/api/auth/token', {
    body: { email: p.email, password: p.senha },
  })).body;

  const sha = crypto.createHash('sha256').update(par.access).digest('hex');
  const linha = await db.prepare(
    "SELECT kind, julianday(expires_at) - julianday('now') AS dias FROM sessions WHERE token_hash = ?"
  ).get(sha);
  assert.equal(linha.kind, 'app');
  assert.ok(Number(linha.dias) <= auth.APP_SESSION_DAYS + 0.01);

  await req('GET', '/api/auth/me', { bearer: par.access });
  const depois = await db.prepare(
    "SELECT julianday(expires_at) - julianday('now') AS dias FROM sessions WHERE token_hash = ?"
  ).get(sha);
  assert.ok(Number(depois.dias) <= auth.APP_SESSION_DAYS + 0.01, 'a sessão do app não desliza');
});

const SHELL = 'capacitor://localhost';

test('a casca do aplicativo é uma origem permitida', async () => {
  const voo = await req('OPTIONS', '/api/auth/me', {
    origin: SHELL,
    headers: {
      'Access-Control-Request-Method': 'GET',
      'Access-Control-Request-Headers': 'authorization',
    },
  });
  assert.equal(voo.status, 204);
  assert.equal(voo.headers.get('access-control-allow-origin'), SHELL);
  assert.equal(voo.headers.get('access-control-allow-credentials'), 'true');
  assert.match(voo.headers.get('access-control-allow-headers') || '', /Authorization/i);
});

test('uma origem estranha não recebe permissão', async () => {
  const voo = await req('OPTIONS', '/api/auth/me', {
    origin: 'https://coisa-ruim.exemplo',
    headers: { 'Access-Control-Request-Method': 'GET' },
  });
  assert.equal(voo.headers.get('access-control-allow-origin'), null);

  const direto = await req('GET', '/api/auth/me', { origin: 'https://coisa-ruim.exemplo' });
  assert.equal(direto.headers.get('access-control-allow-origin'), null);
});

test('a resposta diz que ela depende da origem', async () => {
  const r = await req('GET', '/api/auth/me', { origin: SHELL });
  assert.match(r.headers.get('vary') || '', /Origin/i);
  assert.equal(r.headers.get('access-control-allow-origin'), SHELL);
});

test('a API diz de que versão ela é, e qual cliente ela ainda atende', async () => {
  const meta = await req('GET', '/api/meta', {});
  assert.equal(meta.status, 200);
  assert.equal(typeof meta.body.api, 'number');
  assert.equal(typeof meta.body.minClient, 'number');
  assert.ok(meta.body.minClient <= meta.body.api);

  const qualquer = await req('GET', '/api/auth/me', {});
  assert.equal(qualquer.headers.get('x-api-version'), String(meta.body.api));
});

const APP_INFO = {
  platform: 'android',
  device_id: 'aparelho-de-teste',
  app_id: 'com.cineclube.app',
  version_name: '1.0',
  version_build: '1.0',
  version_os: '14',
  plugin_version: '6.0.0',
  is_emulator: true,
  is_prod: false,
};

test('o aplicativo pergunta se há versão nova, e recebe onde baixá-la', async () => {
  const r = await req('POST', '/api/app/update', { body: APP_INFO });
  assert.equal(r.status, 200);
  assert.ok(r.body.version, 'sem versão o plugin não sabe o que baixou');
  assert.match(r.body.url, /\/api\/app\/bundle\/.+\.zip$/);
  assert.match(r.body.checksum, /^[a-f0-9]{64}$/, 'o plugin confere sha256 antes de aplicar');
  assert.equal(r.body.message, undefined);
});

test('quem já está na última não baixa nada', async () => {
  const primeira = await req('POST', '/api/app/update', { body: APP_INFO });
  const denovo = await req('POST', '/api/app/update', {
    body: { ...APP_INFO, version_name: primeira.body.version },
  });
  assert.equal(denovo.body.url, undefined, 'nada a baixar');
  assert.ok(denovo.body.message);
  assert.equal(denovo.body.version, primeira.body.version);
});

test('o pacote confere com a soma, e carrega o endereço da API dentro', async () => {
  const { body } = await req('POST', '/api/app/update', { body: APP_INFO });

  const res = await fetch(body.url);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'application/zip');
  const bytes = Buffer.from(await res.arrayBuffer());

  assert.equal(
    crypto.createHash('sha256').update(bytes).digest('hex'),
    body.checksum,
    'a soma anunciada não descreve o pacote entregue'
  );
  assert.equal(bytes.subarray(0, 2).toString('ascii'), 'PK', 'isto não é um zip');

  const nomes = namesIn(bytes);
  assert.ok(nomes.includes('index.html'), 'index.html precisa estar na raiz do zip');
  assert.ok(nomes.some(n => n.startsWith('assets/')), 'o pacote veio sem o cliente');

  const html = fileIn(bytes, 'index.html');
  assert.match(html, /window\.__CINECLUBE_API__="http/, 'sem endereço, o app não acha a API');
  assert.ok(
    html.indexOf('__CINECLUBE_API__') < html.indexOf('<script type="module"'),
    'o endereço tem de estar escrito antes de o cliente rodar'
  );
});

test('um pacote que não é o publicado agora não é servido', async () => {
  const perdido = await req('GET', '/api/app/bundle/1.0.1.zip', {});
  assert.equal(perdido.status, 404);
});

function namesIn(buf) {
  const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  assert.ok(eocd > 0, 'zip sem registro de fim');
  const total = buf.readUInt16LE(eocd + 10);
  let pos = buf.readUInt32LE(eocd + 16);
  const nomes = [];
  for (let i = 0; i < total; i++) {
    assert.equal(buf.readUInt32LE(pos), 0x02014b50, 'entrada torta no índice');
    const tamNome = buf.readUInt16LE(pos + 28);
    const extra = buf.readUInt16LE(pos + 30);
    const comentario = buf.readUInt16LE(pos + 32);
    nomes.push(buf.subarray(pos + 46, pos + 46 + tamNome).toString('utf8'));
    pos += 46 + tamNome + extra + comentario;
  }
  return nomes;
}

function fileIn(buf, alvo) {
  const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const total = buf.readUInt16LE(eocd + 10);
  let pos = buf.readUInt32LE(eocd + 16);
  for (let i = 0; i < total; i++) {
    const tamNome = buf.readUInt16LE(pos + 28);
    const extra = buf.readUInt16LE(pos + 30);
    const comentario = buf.readUInt16LE(pos + 32);
    const nome = buf.subarray(pos + 46, pos + 46 + tamNome).toString('utf8');
    if (nome === alvo) {
      const metodo = buf.readUInt16LE(pos + 10);
      const tamanho = buf.readUInt32LE(pos + 20);
      const local = buf.readUInt32LE(pos + 42);
      const nomeLocal = buf.readUInt16LE(local + 26);
      const extraLocal = buf.readUInt16LE(local + 28);
      const inicio = local + 30 + nomeLocal + extraLocal;
      const corpo = buf.subarray(inicio, inicio + tamanho);
      return (metodo === 8 ? zlib.inflateRawSync(corpo) : corpo).toString('utf8');
    }
    pos += 46 + tamNome + extra + comentario;
  }
  throw new Error(`${alvo} não está no pacote`);
}

test('o bilhete vale como sessão no cano ao vivo, e só uma vez', async () => {
  const p = await comSenha();
  const par = (await req('POST', '/api/auth/token', {
    body: { email: p.email, password: p.senha },
  })).body;

  const { body } = await req('POST', '/api/auth/ticket', { bearer: par.access });
  assert.ok(body.ticket, 'sem bilhete não há cano ao vivo no app');

  const clubes = await req('GET', '/api/clubs', { bearer: par.access });
  const sala = clubes.body.mine[0];

  const aberto = await fetch(
    `${baseUrl}/api/c/${sala.slug}/live/stream?ticket=${encodeURIComponent(body.ticket)}`
  );
  assert.equal(aberto.status, 200);
  assert.match(aberto.headers.get('content-type') || '', /text\/event-stream/);
  await aberto.body.cancel();

  const denovo = await fetch(
    `${baseUrl}/api/c/${sala.slug}/live/stream?ticket=${encodeURIComponent(body.ticket)}`
  );
  assert.equal(denovo.status, 401);
});

test('um bilhete inventado não abre cano nenhum', async () => {
  const p = await kit.signIn();
  const clubes = await req('GET', '/api/clubs', { cookie: p.cookie });
  const sala = clubes.body.mine[0];

  const chute = await fetch(`${baseUrl}/api/c/${sala.slug}/live/stream?ticket=nao-existe`);
  assert.equal(chute.status, 401);
});

test('sem sessão ninguém tira bilhete', async () => {
  const solto = await req('POST', '/api/auth/ticket', {});
  assert.equal(solto.status, 401);
});
