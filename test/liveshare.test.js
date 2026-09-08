const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

/* O segundo modo da sala: uma pessoa transmite a própria tela e as outras
   recebem por WebRTC. O servidor não carrega vídeo nenhum, então o que existe
   para testar aqui é exatamente o que ele faz — dizer de quem é a vaga, e
   entregar recado a quem é dele.

   Sem rede: uma "conexão" é um objeto com `write`, do mesmo jeito que o resto
   dos testes desta sala. */
const screening = require('../screening');
const turn = require('../turn');

const T0 = 1_700_000_000_000;
const FILM = { id: 1, title: 'Duna: Parte Dois', year: 2024, genre: 'Ficção', poster: null, runtime: 166 };
const session = (id, name) => ({ reviewer_id: id, name, dot: '#b5abfc' });

const CLUBE = 'c-teste';
let room;

/** Uma conexão de mentira que guarda o que recebeu. */
function socket() {
  const frames = [];
  return {
    res: { write: chunk => frames.push(JSON.parse(chunk.replace(/^data: /, ''))) },
    frames,
    /** Só os recados de sinalização, que é o que quase todo teste quer ver. */
    signals: () => frames.filter(f => f.type === 'signal'),
  };
}

test.beforeEach(() => {
  screening.reset();
  room = screening.roomFor(CLUBE);
  screening.open(room, FILM, T0);
});

/* ── a vaga é de uma pessoa ───────────────────────────────────────────── */

test('quem chega primeiro fica com a transmissão, e o segundo é recusado', () => {
  assert.equal(screening.startLive(room, session('p1', 'Vinicius'), T0), true);
  assert.equal(room.live.hostId, 'p1');
  assert.equal(screening.startLive(room, session('p2', 'Ana'), T0), false);
  // E a recusa não derruba quem está no ar.
  assert.equal(room.live.hostId, 'p1');
});

test('assumir de novo a própria transmissão não é recusa', () => {
  screening.startLive(room, session('p1', 'Vinicius'), T0);
  assert.equal(screening.startLive(room, session('p1', 'Vinicius'), T0 + 1000), true);
});

test('só quem está com a tela pode largá-la', () => {
  screening.startLive(room, session('p1', 'Vinicius'), T0);
  assert.equal(screening.stopLive(room, 'p2', T0), false);
  assert.equal(room.live.hostId, 'p1');
  assert.equal(screening.stopLive(room, 'p1', T0), true);
  assert.equal(room.live, null);
});

test('a transmissão aparece no snapshot, que é como cada aba sabe o próprio papel', () => {
  assert.equal(screening.snapshot(room, T0).live, null);
  screening.startLive(room, session('p1', 'Vinicius'), T0);
  assert.deepEqual(screening.snapshot(room, T0).live, {
    hostId: 'p1',
    hostName: 'Vinicius',
    hostDot: '#b5abfc',
    since: T0,
  });
});

/* ── e ela morre com quem estava nela ─────────────────────────────────── */

test('quem transmitia fechou a aba: a sala para de apontar para uma fonte que não existe', () => {
  const s = socket();
  screening.attach(room, session('p1', 'Vinicius'));
  screening.subscribe(room, s.res, 'p1');
  screening.startLive(room, session('p1', 'Vinicius'), T0);

  screening.detach(room, 'p1');
  assert.equal(room.live, null);
});

test('uma segunda aba da mesma pessoa não derruba a transmissão dela', () => {
  screening.attach(room, session('p1', 'Vinicius'));
  screening.attach(room, session('p1', 'Vinicius'));
  screening.startLive(room, session('p1', 'Vinicius'), T0);

  screening.detach(room, 'p1');
  assert.equal(room.live?.hostId, 'p1');
  screening.detach(room, 'p1');
  assert.equal(room.live, null);
});

test('encerrar a sessão apaga a transmissão junto', () => {
  screening.startLive(room, session('p1', 'Vinicius'), T0);
  screening.close(room, T0 + 1000);
  assert.equal(room.live, null);
});

test('abrir outro filme também: a tela no ar era do anterior', () => {
  screening.startLive(room, session('p1', 'Vinicius'), T0);
  screening.open(room, { ...FILM, id: 2, title: 'Outro' }, T0 + 1000);
  assert.equal(room.live, null);
});

/* ── o carteiro ───────────────────────────────────────────────────────── */

test('o recado chega a quem é, e a mais ninguém', () => {
  const um = socket();
  const dois = socket();
  const tres = socket();
  screening.attach(room, session('p1', 'Vinicius'));
  screening.attach(room, session('p2', 'Ana'));
  screening.attach(room, session('p3', 'Bea'));
  screening.subscribe(room, um.res, 'p1');
  screening.subscribe(room, dois.res, 'p2');
  screening.subscribe(room, tres.res, 'p3');

  assert.equal(screening.signal(room, 'p1', 'p2', 'offer', { sdp: 'v=0' }), true);

  assert.equal(dois.signals().length, 1);
  assert.deepEqual(dois.signals()[0], {
    type: 'signal',
    from: 'p1',
    kind: 'offer',
    data: { sdp: 'v=0' },
  });
  assert.equal(um.signals().length, 0);
  assert.equal(tres.signals().length, 0);
});

test('todas as abas do destinatário recebem, porque não se sabe em qual ele está', () => {
  const a = socket();
  const b = socket();
  screening.attach(room, session('p1', 'Vinicius'));
  screening.attach(room, session('p2', 'Ana'));
  screening.attach(room, session('p2', 'Ana'));
  screening.subscribe(room, a.res, 'p2');
  screening.subscribe(room, b.res, 'p2');

  screening.signal(room, 'p1', 'p2', 'ice', { candidate: 'candidate:1' });
  assert.equal(a.signals().length, 1);
  assert.equal(b.signals().length, 1);
});

test('recado para quem não está na sala não é entregue', () => {
  screening.attach(room, session('p1', 'Vinicius'));
  assert.equal(screening.signal(room, 'p1', 'fantasma', 'offer', {}), false);
});

test('recado de quem não está na sala também não', () => {
  const s = socket();
  screening.attach(room, session('p2', 'Ana'));
  screening.subscribe(room, s.res, 'p2');
  assert.equal(screening.signal(room, 'estranho', 'p2', 'offer', {}), false);
  assert.equal(s.signals().length, 0);
});

test('só as quatro palavras do aperto de mão passam', () => {
  const s = socket();
  screening.attach(room, session('p1', 'Vinicius'));
  screening.attach(room, session('p2', 'Ana'));
  screening.subscribe(room, s.res, 'p2');

  for (const kind of ['want', 'offer', 'answer', 'ice']) {
    assert.equal(screening.signal(room, 'p1', 'p2', kind, {}), true, kind);
  }
  for (const kind of ['play', 'eval', '__proto__', '']) {
    assert.equal(screening.signal(room, 'p1', 'p2', kind, {}), false, kind);
  }
  assert.equal(s.signals().length, 4);
});

test('um recado sem tamanho é recusado inteiro, e não cortado', () => {
  const s = socket();
  screening.attach(room, session('p1', 'Vinicius'));
  screening.attach(room, session('p2', 'Ana'));
  screening.subscribe(room, s.res, 'p2');

  const gordo = { sdp: 'x'.repeat(screening.MAX_SIGNAL + 1) };
  assert.equal(screening.signal(room, 'p1', 'p2', 'offer', gordo), false);
  assert.equal(s.signals().length, 0);
});

test('a sinalização tem balde próprio: o aperto de mão não gasta as fichas do play', () => {
  // Onze comandos estouram o balde de comandos...
  for (let i = 0; i < 10; i++) screening.withinRate('p1', T0);
  assert.equal(screening.withinRate('p1', T0), false);
  // ...e a sinalização daquela mesma pessoa continua passando.
  assert.equal(screening.withinSignalRate('p1', T0), true);
});

/* ── onde os navegadores se procuram ────────────────────────────────────
   Nenhum destes toca a rede: o caminho da Cloudflare é o único que sairia da
   máquina, e ele é exercitado com um `fetch` trocado. O que se testa é a
   decisão — qual credencial sai daqui, e o que acontece quando o relay não
   responde. */

/** Zera o ambiente de relay. Chamado por todo teste desta seção. */
function semRelay() {
  for (const v of [
    'TURN_URLS',
    'TURN_SECRET',
    'TURN_USERNAME',
    'TURN_PASSWORD',
    'CLOUDFLARE_TURN_KEY_ID',
    'CLOUDFLARE_TURN_API_TOKEN',
  ]) {
    delete process.env[v];
  }
  turn.reset();
}

const CF_ICE = [
  { urls: ['stun:stun.cloudflare.com:3478'] },
  {
    urls: ['turn:turn.cloudflare.com:3478?transport=udp', 'turns:turn.cloudflare.com:443?transport=tcp'],
    username: 'gerado',
    credential: 'temporaria',
  },
];

/** Um `fetch` que responde o que o teste mandar, e conta quantas vezes foi chamado. */
function fakeFetch(responder) {
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init });
    return responder();
  };
  return { calls, restore: () => (globalThis.fetch = original) };
}

const ok = body => ({ ok: true, status: 201, json: async () => body });

test('sem nada configurado sobra o STUN público, e nenhum relay é prometido', async () => {
  semRelay();
  const servers = await turn.iceServers('p1');
  assert.equal(servers.length, 1);
  assert.deepEqual(servers[0].urls, turn.STUN_FALLBACK);
  assert.equal(turn.hasTurn(), false);
});

test('com segredo, a credencial expira e é assinada — e ninguém a cadastrou em lugar nenhum', async () => {
  semRelay();
  process.env.TURN_URLS = 'turn:relay.exemplo:3478';
  process.env.TURN_SECRET = 'segredo';

  const [, relay] = await turn.iceServers('pabc', T0);
  const expira = Math.floor(T0 / 1000) + turn.TTL_SECONDS;
  assert.equal(relay.username, `${expira}:pabc`);
  assert.equal(
    relay.credential,
    crypto.createHmac('sha1', 'segredo').update(relay.username).digest('base64')
  );
  assert.equal(turn.hasTurn(), true);
});

test('sem segredo, usuário e senha fixos servem — é o que os serviços prontos dão', async () => {
  semRelay();
  process.env.TURN_URLS = 'turn:relay.exemplo:3478';
  process.env.TURN_USERNAME = 'clube';
  process.env.TURN_PASSWORD = 'senha';

  const [, relay] = await turn.iceServers('pabc', T0);
  assert.equal(relay.username, 'clube');
  assert.equal(relay.credential, 'senha');
  assert.equal(turn.hasTurn(), true);
});

test('um relay sem credencial nenhuma não é oferecido: seria um endereço que recusa todo mundo', async () => {
  semRelay();
  process.env.TURN_URLS = 'turn:relay.exemplo:3478';
  assert.equal((await turn.iceServers('pabc', T0)).length, 1);
  assert.equal(turn.hasTurn(), false);
});

/* ── a Cloudflare ─────────────────────────────────────────────────────── */

test('a lista da Cloudflare é servida inteira, e não costurada com a nossa', async () => {
  semRelay();
  process.env.CLOUDFLARE_TURN_KEY_ID = 'chave';
  process.env.CLOUDFLARE_TURN_API_TOKEN = 'token';
  const f = fakeFetch(() => ok({ iceServers: CF_ICE }));

  try {
    const servers = await turn.iceServers('p1', T0);
    // Inteira: as portas 443 e 80 deles são o que atravessa rede corporativa,
    // e substituí-las pelo nosso STUN seria jogar fora a metade que importa.
    assert.deepEqual(servers, CF_ICE);
    assert.equal(turn.hasTurn(), true);
    assert.match(f.calls[0].url, /credentials\/generate-ice-servers$/);
    assert.equal(f.calls[0].init.headers.Authorization, 'Bearer token');
  } finally {
    f.restore();
  }
});

test('a credencial é pedida uma vez e reaproveitada: a API não separa quem pediu', async () => {
  semRelay();
  process.env.CLOUDFLARE_TURN_KEY_ID = 'chave';
  process.env.CLOUDFLARE_TURN_API_TOKEN = 'token';
  const f = fakeFetch(() => ok({ iceServers: CF_ICE }));

  try {
    await turn.iceServers('p1', T0);
    await turn.iceServers('p2', T0 + 1000);
    await turn.iceServers('p3', T0 + 2000);
    assert.equal(f.calls.length, 1);
  } finally {
    f.restore();
  }
});

test('quatro pessoas entrando juntas fazem uma chamada, não quatro', async () => {
  semRelay();
  process.env.CLOUDFLARE_TURN_KEY_ID = 'chave';
  process.env.CLOUDFLARE_TURN_API_TOKEN = 'token';
  const f = fakeFetch(() => ok({ iceServers: CF_ICE }));

  try {
    await Promise.all([0, 1, 2, 3].map(i => turn.iceServers(`p${i}`, T0)));
    assert.equal(f.calls.length, 1);
  } finally {
    f.restore();
  }
});

test('vencida a validade, uma nova é pedida', async () => {
  semRelay();
  process.env.CLOUDFLARE_TURN_KEY_ID = 'chave';
  process.env.CLOUDFLARE_TURN_API_TOKEN = 'token';
  const f = fakeFetch(() => ok({ iceServers: CF_ICE }));

  try {
    await turn.iceServers('p1', T0);
    await turn.iceServers('p1', T0 + turn.TTL_SECONDS * 1000);
    assert.equal(f.calls.length, 2);
  } finally {
    f.restore();
  }
});

test('a Cloudflare fora do ar não derruba a tela: sobra o STUN e a tentativa continua', async () => {
  semRelay();
  process.env.CLOUDFLARE_TURN_KEY_ID = 'chave';
  process.env.CLOUDFLARE_TURN_API_TOKEN = 'token';
  const f = fakeFetch(() => ({ ok: false, status: 503, json: async () => ({}) }));

  try {
    const servers = await turn.iceServers('p1', T0);
    assert.equal(servers.length, 1);
    assert.deepEqual(servers[0].urls, turn.STUN_FALLBACK);
  } finally {
    f.restore();
  }
});

test('uma resposta sem iceServers é tratada como falha, e não servida vazia', async () => {
  semRelay();
  process.env.CLOUDFLARE_TURN_KEY_ID = 'chave';
  process.env.CLOUDFLARE_TURN_API_TOKEN = 'token';
  const f = fakeFetch(() => ok({ erro: 'nada aqui' }));

  try {
    const servers = await turn.iceServers('p1', T0);
    assert.deepEqual(servers[0].urls, turn.STUN_FALLBACK);
  } finally {
    f.restore();
  }
});

test.after(semRelay);
