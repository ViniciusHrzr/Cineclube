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

/* ══════════════════════════════════════════════════════════════════════════
   O QUE UM APLICATIVO PRECISA DO SERVIDOR, e que o site nunca precisou.

   Três coisas, e nenhuma delas é o aplicativo — são o que fica de pé do lado de
   cá para que ele exista depois, escrito antes de existir porque cada uma é
   cara de acrescentar num cliente já instalado.

   1. **Apresentar a sessão sem cookie.** Numa casca com os arquivos
      embarcados, a origem é `capacitor://localhost` e o cookie do site é
      cookie de terceiro — o WebView pode nem guardar. Então: `Bearer`, uma
      sessão curta, e uma chave de noventa dias que a repõe.
   2. **Falar de outra origem.** Mesma razão: a página não é servida por este
      servidor, então toda chamada é CORS.
   3. **Uma API que não encolhe.** Quem baixou o app em março continua com a
      tela de março, e um campo removido é tela em branco no aparelho de alguém.

   O que estes testes seguram é o que falha em silêncio: uma chave de renovação
   que continua valendo depois de usada, uma origem estranha recebendo
   permissão, e um cookie voltando para quem entrou por token.
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
  throttle.stopTimers();
  const closed = new Promise(resolve => server.close(resolve));
  server.closeAllConnections?.();
  await closed;
  db.close();
  for (const suffix of ['', '-shm', '-wal']) {
    try { fs.rmSync(dbPath + suffix, { force: true }); } catch { /* arquivo temporário */ }
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

/** Uma conta com senha, que é como um app entra. */
async function comSenha(senha = 'senha-de-teste') {
  const p = await kit.signIn();
  await auth.setPassword(p.id, senha);
  const email = (await db.prepare('SELECT email FROM reviewers WHERE id = ?').get(p.id)).email;
  return { ...p, email, senha };
}

/* ══ 0. INSTALAR ═════════════════════════════════════════════════════════
   O manifesto e os ícones são o que faz o navegador do celular oferecer
   "instalar" — e é a base de tudo que vem depois, TWA e casca inclusive. Falham
   em silêncio de um jeito específico: um caminho de ícone errado não quebra
   nada, só tira o convite de instalar da tela sem dizer por quê. */

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

/* Um escopo, um registro. Se este arquivo deixar de importar o do WebTorrent,
   o vídeo da Sessão para de ser servido — e nada no console diz isso. */
test('o service worker do app carrega o do WebTorrent dentro dele', async () => {
  const res = await fetch(baseUrl + '/app-sw.js');
  assert.equal(res.status, 200);
  const code = await res.text();
  assert.match(code, /importScripts\(['"]\/sw\.min\.js['"]\)/);
  assert.match(code, /addEventListener\(['"]fetch['"]/);
});

/* ══ 1. A SESSÃO SEM COOKIE ══════════════════════════════════════════════ */

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

/* O cookie é HttpOnly de propósito. Devolvê-lo a quem entrou por token daria ao
   app uma segunda chave que ele não pediu e não sabe apagar. */
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

/* O caminho de quem entrou pelo Google numa aba do sistema: a volta cria a
   sessão de navegador, e o app a troca por um par sem pedir senha nenhuma. */
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

/* ══ 2. A CHAVE DE RENOVAÇÃO ═════════════════════════════════════════════ */

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

/* Receber a mesma chave duas vezes quer dizer que existem duas cópias dela no
   mundo. Não dá para saber qual das duas é o dono, então a família inteira cai
   e as duas voltam para a tela de entrar — que é o desfecho certo quando uma
   delas é ladrão. */
test('apresentar uma chave já gasta derruba a família inteira', async () => {
  const p = await comSenha();
  const primeiro = (await req('POST', '/api/auth/token', {
    body: { email: p.email, password: p.senha },
  })).body;
  const segundo = (await req('POST', '/api/auth/refresh', {
    body: { refresh: primeiro.refresh },
  })).body;

  // O ladrão, com a cópia velha.
  const reuso = await req('POST', '/api/auth/refresh', { body: { refresh: primeiro.refresh } });
  assert.equal(reuso.status, 401);

  // E o dono, com a chave boa, também perde a vez.
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

/* A sessão do app é curta porque o que o aparelho guarda, ele lê. Deslizar a
   cada uso desfaria o prazo — e ainda seria uma escrita por toque. */
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

/* ══ 3. FALAR DE OUTRA ORIGEM ════════════════════════════════════════════ */

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

/* Sem `Vary`, um cache na frente serviria a permissão de um pedido para a
   origem do seguinte. */
test('a resposta diz que ela depende da origem', async () => {
  const r = await req('GET', '/api/auth/me', { origin: SHELL });
  assert.match(r.headers.get('vary') || '', /Origin/i);
  assert.equal(r.headers.get('access-control-allow-origin'), SHELL);
});

/* ══ 4. A API QUE NÃO ENCOLHE ════════════════════════════════════════════ */

test('a API diz de que versão ela é, e qual cliente ela ainda atende', async () => {
  const meta = await req('GET', '/api/meta', {});
  assert.equal(meta.status, 200);
  assert.equal(typeof meta.body.api, 'number');
  assert.equal(typeof meta.body.minClient, 'number');
  assert.ok(meta.body.minClient <= meta.body.api);

  const qualquer = await req('GET', '/api/auth/me', {});
  assert.equal(qualquer.headers.get('x-api-version'), String(meta.body.api));
});

/* ══ 5. ATUALIZAR SEM PASSAR PELA LOJA ═══════════════════════════════════
   O APK carrega os arquivos dentro dele, então um deploy do site não alcança
   quem já instalou. Estas duas rotas alcançam: o app pergunta se há coisa nova
   e baixa um zip com o cliente publicado agora.

   O que falha em silêncio aqui é caro em dobro — um pacote quebrado vira tela
   branca no aparelho de todo mundo de uma vez. Por isso o zip é conferido de
   verdade: assinatura, índice, e o endereço da API dentro do HTML. */

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

/* O pacote é a pasta public/ zipada na hora. Três coisas têm de ser verdade, e
   cada uma quebra de um jeito diferente: a soma errada faz o plugin recusar, o
   index fora da raiz faz o app abrir em branco, e o endereço ausente faz o app
   procurar a API dentro do próprio aparelho. */
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

  /* O índice do zip fica no fim do arquivo, e é dele que sai a lista de nomes
     sem descompactar nada. `index.html` tem de estar na RAIZ: é o que o plugin
     procura para saber o que servir. */
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

/* ── lendo o zip sem descompactador ──────────────────────────────────────
   Um leitor mínimo, e de propósito: o escritor está em zip.js, e um teste que
   usasse o escritor para conferir o escrito não conferiria nada. Isto lê o
   índice central, que é a parte do formato que um descompactador de verdade
   também lê primeiro. */
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

/** O conteúdo de um arquivo do zip, descomprimido pelo caminho do cabeçalho local. */
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
