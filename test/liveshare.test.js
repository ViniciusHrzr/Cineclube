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

/* ── onde os navegadores se procuram ──────────────────────────────────── */

test('sem nada configurado sobra o STUN público, e nenhum relay é prometido', () => {
  delete process.env.TURN_URLS;
  delete process.env.TURN_SECRET;
  delete process.env.TURN_USERNAME;
  delete process.env.TURN_PASSWORD;

  const servers = turn.iceServers('p1');
  assert.equal(servers.length, 1);
  assert.deepEqual(servers[0].urls, turn.STUN_FALLBACK);
  assert.equal(turn.hasTurn(), false);
});

test('com segredo, a credencial expira e é assinada — e ninguém a cadastrou em lugar nenhum', () => {
  process.env.TURN_URLS = 'turn:relay.exemplo:3478';
  process.env.TURN_SECRET = 'segredo';
  delete process.env.TURN_USERNAME;
  delete process.env.TURN_PASSWORD;

  const [, relay] = turn.iceServers('pabc', T0);
  const expira = Math.floor(T0 / 1000) + turn.TTL_SECONDS;
  assert.equal(relay.username, `${expira}:pabc`);
  assert.equal(
    relay.credential,
    crypto.createHmac('sha1', 'segredo').update(relay.username).digest('base64')
  );
  assert.equal(turn.hasTurn(), true);
});

test('sem segredo, usuário e senha fixos servem — é o que os serviços prontos dão', () => {
  process.env.TURN_URLS = 'turn:relay.exemplo:3478';
  delete process.env.TURN_SECRET;
  process.env.TURN_USERNAME = 'clube';
  process.env.TURN_PASSWORD = 'senha';

  const [, relay] = turn.iceServers('pabc', T0);
  assert.equal(relay.username, 'clube');
  assert.equal(relay.credential, 'senha');
  assert.equal(turn.hasTurn(), true);
});

test('um relay sem credencial nenhuma não é oferecido: seria um endereço que recusa todo mundo', () => {
  process.env.TURN_URLS = 'turn:relay.exemplo:3478';
  delete process.env.TURN_SECRET;
  delete process.env.TURN_USERNAME;
  delete process.env.TURN_PASSWORD;

  assert.equal(turn.iceServers('pabc', T0).length, 1);
  assert.equal(turn.hasTurn(), false);
});

test.after(() => {
  delete process.env.TURN_URLS;
  delete process.env.TURN_SECRET;
  delete process.env.TURN_USERNAME;
  delete process.env.TURN_PASSWORD;
});
