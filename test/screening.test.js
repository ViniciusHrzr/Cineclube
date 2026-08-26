const test = require('node:test');
const assert = require('node:assert/strict');

/* The room is pure state plus a set of open responses, and it touches neither
   the database nor the network. So it is tested as what it is: a reducer.
   Every call takes an explicit `now`, which is what lets a two hour screening
   be exercised in a millisecond. */
const screening = require('../screening');

const T0 = 1_700_000_000_000;
const FILM = { id: 1, title: 'Duna: Parte Dois', year: 2024, genre: 'Ficção', poster: null, runtime: 166 };

const session = (id, name) => ({ reviewer_id: id, name, dot: '#b5abfc' });

/* Uma fonte aberta, que e o que faz alguem contar para a roda de travada: nao
   se trava num filme que nao se abriu. Os testes daqui para baixo mandam a
   fonte em toda leitura, do jeito que o player manda. */
const SRC = 'a1b2c3d4e5f6';

test.beforeEach(() => screening.reset());

test('a paused room does not move', () => {
  screening.open(FILM, T0);
  assert.equal(screening.positionAt(T0 + 60_000), 0);
});

test('a playing room moves with the clock, and stops where it is paused', () => {
  screening.open(FILM, T0);
  screening.play(null, T0);

  assert.equal(screening.positionAt(T0 + 10_000), 10);

  screening.pause(null, T0 + 30_000);
  assert.equal(screening.positionAt(T0 + 30_000), 30);
  // A minute later it is still thirty seconds in: this is the whole contract.
  assert.equal(screening.positionAt(T0 + 90_000), 30);
});

test('play resumes from where the pause left it', () => {
  screening.open(FILM, T0);
  screening.play(null, T0);
  screening.pause(null, T0 + 30_000);
  screening.play(null, T0 + 120_000);

  assert.equal(screening.positionAt(T0 + 130_000), 40);
});

test('seek moves the film without stopping it', () => {
  screening.open(FILM, T0);
  screening.play(null, T0);
  screening.seek(600, T0 + 5_000);

  assert.equal(screening.room.status, 'playing');
  assert.equal(screening.positionAt(T0 + 6_000), 601);
});

test('every mutation advances the revision', () => {
  const seen = [];
  screening.open(FILM, T0);
  seen.push(screening.room.revision);
  screening.play(null, T0);
  seen.push(screening.room.revision);
  screening.seek(10, T0);
  seen.push(screening.room.revision);
  screening.pause(null, T0);
  seen.push(screening.room.revision);

  for (let i = 1; i < seen.length; i++) assert.ok(seen[i] > seen[i - 1], `${seen[i]} > ${seen[i - 1]}`);
});

test('opening a film starts it from zero and paused', () => {
  screening.open(FILM, T0);
  screening.play(null, T0);
  screening.open({ ...FILM, id: 2, title: 'Outro' }, T0 + 60_000);

  assert.equal(screening.room.status, 'paused');
  assert.equal(screening.positionAt(T0 + 120_000), 0);
});

test('closing clears the film but keeps the people', () => {
  screening.attach(session('p1', 'Ana'));
  screening.open(FILM, T0);
  screening.close(T0 + 1000);

  assert.equal(screening.room.open, false);
  assert.equal(screening.room.movie, null);
  assert.equal(screening.room.viewers.size, 1);
});

/* ── what a bad request may not do ────────────────────────────────────────── */

test('a position that is not a number cannot enter the room', () => {
  // Infinity is not finite, so it is refused outright rather than clamped —
  // there is no sensible "very far into the film".
  assert.equal(screening.clampPosition(NaN), 0);
  assert.equal(screening.clampPosition(Infinity), 0);
  assert.equal(screening.clampPosition(-Infinity), 0);
  assert.equal(screening.clampPosition(-5), 0);
  assert.equal(screening.clampPosition('abc'), 0);
  assert.equal(screening.clampPosition(null), 0);
  assert.equal(screening.clampPosition(undefined), 0);
});

test('a position past the end of the film is clamped to the film', () => {
  screening.open(FILM, T0);
  // 166 minutes plus the slack, and not a second more.
  assert.equal(screening.clampPosition(999_999), 166 * 60 + 900);
});

test('a playing room never derives a position past the film either', () => {
  screening.open(FILM, T0);
  screening.play(null, T0);
  // A year later. Without the clamp inside positionAt this is astronomical.
  assert.equal(screening.positionAt(T0 + 31_536_000_000), 166 * 60 + 900);
});

test('only the three real commands are commands', () => {
  screening.open(FILM, T0);
  assert.equal(screening.command('play', 0, T0), true);
  assert.equal(screening.command('destroy', 0, T0), false);
  assert.equal(screening.command('__proto__', 0, T0), false);
  assert.equal(screening.command('', 0, T0), false);
});

test('a command with no screening open is refused', () => {
  assert.equal(screening.command('play', 0, T0), false);
});

test('a source that could execute is not a source', () => {
  assert.equal(screening.isAllowedSource('javascript:alert(1)'), false);
  assert.equal(screening.isAllowedSource('data:text/html,<script>'), false);
  assert.equal(screening.isAllowedSource('file:///etc/passwd'), false);

  assert.equal(screening.isAllowedSource('https://exemplo.com/f.mp4'), true);
  assert.equal(screening.isAllowedSource('magnet:?xt=urn:btih:abc'), true);
  assert.equal(screening.isAllowedSource('blob:http://localhost/123'), true);
  // A bare infohash carries no scheme and is judged by shape.
  assert.equal(screening.isAllowedSource('08ada5a7a6183aae1e09d831df6748d566095a10'), true);
  assert.equal(screening.isAllowedSource('<img src=x onerror=1>'), false);
});

test('text a member sent is trimmed and capped', () => {
  assert.equal(screening.text('  oi  '), 'oi');
  assert.equal(screening.text(''), null);
  assert.equal(screening.text(42), null);
  assert.equal(screening.text('x'.repeat(9999)).length, screening.MAX_TEXT);
});

/* ── a roda de carregar, que só informa ───────────────────────────────────
   A sala já parou sozinha pela travada de um membro, e voltou sozinha quando
   ele voltou. O argumento era o certo no papel — seguir sem quem travou é a
   dessincronia que este módulo existe para evitar — e o clube passou noites
   sentado no resultado: uma sessão que para quando ninguém pediu e volta
   quando ninguém pediu.

   Era um laço de controle com quatro navegadores, um enxame e um filme dentro
   dele. Todo amortecedor que se somou (carência, teto por filme, almofada
   medida, "chegar não é travar") mudou a frequência e não a natureza.

   Estes testes são a garantia de que não volta. O que a roda faz agora é
   gravar quem está carregando; o filme só para quando uma pessoa para. */

test('a travada de um membro não para mais o filme de ninguém', () => {
  screening.attach(session('p1', 'Ana'));
  screening.attach(session('p2', 'Bruno'));
  screening.open(FILM, T0);
  screening.play(null, T0);

  screening.setReady('p2', false, SRC, T0 + 20_000);

  assert.equal(screening.room.status, 'playing');
  assert.equal(screening.positionAt(T0 + 60_000), 60, 'o filme parou de correr');
  // E o clube fica sabendo: é isso que o painel desenha, e é com isso que
  // alguém decide apertar pause.
  assert.equal(screening.room.viewers.get('p2').ready, false);
});

test('nem quando todo mundo trava ao mesmo tempo', () => {
  screening.attach(session('p1', 'Ana'));
  screening.attach(session('p2', 'Bruno'));
  screening.open(FILM, T0);
  screening.play(null, T0);

  screening.setReady('p1', false, SRC, T0 + 10_000);
  screening.setReady('p2', false, SRC, T0 + 11_000);

  assert.equal(screening.room.status, 'playing');
});

/* O outro lado, e o que mais incomodava: a sala também não recomeça sozinha.
   Uma sessão que volta a rodar sem ninguém apertar nada é a mesma surpresa da
   pausa, na direção contrária — e pega o clube fora da sala. */
test('e a sala não recomeça sozinha quando o buffer enche', () => {
  screening.attach(session('p1', 'Ana'));
  screening.attach(session('p2', 'Bruno'));
  screening.open(FILM, T0);
  screening.play(null, T0);
  screening.setReady('p2', false, SRC, T0 + 20_000);

  // Alguém para de propósito para esperar o Bruno, que é como isto se resolve
  // agora: uma pessoa decide.
  screening.pause(null, T0 + 22_000);
  screening.setReady('p2', true, SRC, T0 + 25_000);

  assert.equal(screening.room.status, 'paused', 'a sala voltou sem ninguém pedir');
  assert.equal(screening.positionAt(T0 + 90_000), 22);
});

test('sair da sala não mexe no filme', () => {
  screening.attach(session('p1', 'Ana'));
  screening.attach(session('p2', 'Bruno'));
  screening.open(FILM, T0);
  screening.play(null, T0);
  screening.setReady('p2', false, SRC, T0 + 20_000);

  screening.detach('p2');

  assert.equal(screening.room.status, 'playing');
  assert.equal(screening.room.viewers.size, 1);
});

test('a roda continua dizendo quem está carregando e o que cada um abriu', () => {
  screening.attach(session('p1', 'Ana'));
  screening.open(FILM, T0);
  screening.play(null, T0);

  screening.setReady('p1', false, SRC, T0 + 5000);
  assert.equal(screening.room.viewers.get('p1').ready, false);
  assert.equal(screening.room.viewers.get('p1').sourceTag, SRC);

  screening.setReady('p1', true, SRC, T0 + 9000);
  assert.equal(screening.room.viewers.get('p1').ready, true);
});

/* ── who is in the room ───────────────────────────────────────────────────── */

test('two tabs are one person, and closing one leaves them in the room', () => {
  screening.attach(session('p1', 'Ana'));
  screening.attach(session('p1', 'Ana'));
  assert.equal(screening.room.viewers.size, 1);

  screening.detach('p1');
  assert.equal(screening.room.viewers.size, 1, 'still watching in the other tab');

  screening.detach('p1');
  assert.equal(screening.room.viewers.size, 0);
});

test('connections are capped per person and overall', () => {
  for (let i = 0; i < screening.MAX_STREAMS_PER_VIEWER; i++) {
    assert.equal(screening.canSubscribe('p1'), true);
    screening.attach(session('p1', 'Ana'));
  }
  assert.equal(screening.canSubscribe('p1'), false);
  assert.equal(screening.canSubscribe('p2'), true, 'one person cannot lock everyone out');
});

test('a runaway loop of commands is cut off', () => {
  let allowed = 0;
  for (let i = 0; i < 50; i++) if (screening.withinRate('p1', T0)) allowed++;

  assert.ok(allowed > 0 && allowed < 50, `let ${allowed} through`);
  // A different person is unaffected by their neighbour's loop.
  assert.equal(screening.withinRate('p2', T0), true);
});

test('the bucket refills once the window has passed', () => {
  for (let i = 0; i < 50; i++) screening.withinRate('p1', T0);
  assert.equal(screening.withinRate('p1', T0 + 10_000), true);
});

/* ── what goes over the wire ──────────────────────────────────────────────── */

test('the snapshot carries the derived position and the server clock', () => {
  screening.attach(session('p1', 'Ana'));
  screening.open(FILM, T0);
  screening.play(null, T0);

  const frame = screening.snapshot(T0 + 42_000);

  assert.equal(frame.type, 'state');
  assert.equal(frame.position, 42);
  assert.equal(frame.serverTime, T0 + 42_000);
  assert.equal(frame.viewers.length, 1);
  assert.equal(frame.viewers[0].name, 'Ana');
});

/* ── the shared pointer ───────────────────────────────────────────────────
   This one string is handed to every browser that joins, so what it is allowed
   to contain is the whole of its security surface. */

test('only a magnet or an http(s) link may be shared', () => {
  for (const good of [
    'magnet:?xt=urn:btih:0123456789abcdef0123456789abcdef01234567',
    'https://arquivo.exemplo/filme.mp4',
    'http://192.168.0.10:8080/filme.webm',
  ]) {
    assert.equal(screening.isShareableLink(good), true, good);
  }

  for (const bad of [
    'javascript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    // A reference into one browser's own memory: meaningless in anyone else's.
    'blob:http://localhost:3000/8f2e',
    'ftp://arquivo.exemplo/filme.mp4',
    'só um texto',
    '',
    '   ',
    null,
    42,
  ]) {
    assert.equal(screening.isShareableLink(bad), false, JSON.stringify(bad));
  }
});

test('a magnet too long to be whole is refused, not trimmed', () => {
  const huge = `magnet:?xt=urn:btih:0123456789abcdef0123456789abcdef01234567&tr=${'x'.repeat(screening.MAX_LINK)}`;
  screening.open(FILM, T0);

  assert.equal(screening.setLink(huge, T0), false);
  assert.equal(screening.room.link, null, 'meio magnet não é um magnet mais curto');
});

test('a refused link leaves the one the club already had', () => {
  const good = 'magnet:?xt=urn:btih:0123456789abcdef0123456789abcdef01234567';
  screening.open(FILM, T0);
  screening.setLink(good, T0);

  assert.equal(screening.setLink('javascript:alert(1)', T0 + 1000), false);
  assert.equal(screening.room.link, good);
});

test('the link belongs to the film it was opened for', () => {
  screening.open(FILM, T0);
  screening.setLink('https://arquivo.exemplo/filme.mp4', T0);

  screening.open({ ...FILM, id: 2, title: 'Outro' }, T0 + 1000);
  assert.equal(screening.room.link, null, 'apontar para o filme anterior é pior que não apontar');

  screening.setLink('https://arquivo.exemplo/outro.mp4', T0 + 2000);
  screening.close(T0 + 3000);
  assert.equal(screening.room.link, null);
});

test('the snapshot carries the link, so whoever arrives can load it', () => {
  const link = 'magnet:?xt=urn:btih:0123456789abcdef0123456789abcdef01234567';
  screening.open(FILM, T0);
  screening.setLink(link, T0);

  assert.equal(screening.snapshot(T0).link, link);
});

/* ── the subtitle the club shares ─────────────────────────────────────────
   The one file small enough to travel. What these cover is mostly the split
   between the announcement and the text: the room broadcasts its snapshot on
   every mutation it has, so anything heavy in there is multiplied by every
   member and every buffer report. */

const CUE = 'WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nboa noite';

test('a subtitle needs both a name and some text', () => {
  screening.open(FILM, T0);

  for (const bad of [
    { name: 'filme.srt' },
    { name: 'filme.srt', vtt: '' },
    { name: 'filme.srt', vtt: '   ' },
    { name: '   ', vtt: CUE },
    { vtt: CUE },
    {},
    CUE,
    42,
    undefined,
  ]) {
    assert.equal(screening.setSubtitle(bad, T0), false, JSON.stringify(bad ?? null));
  }
  assert.equal(screening.room.subtitle, null);
});

test('a subtitle too big to be one is refused whole, not trimmed', () => {
  screening.open(FILM, T0);

  const over = { name: 'filme.srt', vtt: 'a'.repeat(screening.MAX_SUBTITLE + 1) };
  assert.equal(screening.setSubtitle(over, T0), false);
  assert.equal(screening.room.subtitle, null);

  const at = { name: 'filme.srt', vtt: 'a'.repeat(screening.MAX_SUBTITLE) };
  assert.equal(screening.setSubtitle(at, T0), true);
  assert.equal(screening.room.subtitle.vtt.length, screening.MAX_SUBTITLE);
});

test('the snapshot announces the subtitle without carrying it', () => {
  screening.open(FILM, T0);
  screening.setSubtitle({ name: 'duna.srt', vtt: CUE }, T0);

  const announced = screening.snapshot(T0).subtitle;
  assert.deepEqual(Object.keys(announced).sort(), ['id', 'name']);
  assert.equal(announced.name, 'duna.srt');
  // The text lives behind its own route. On every frame, to everybody, it would
  // be the fan-out every ceiling in this module exists to prevent.
  assert.equal(announced.vtt, undefined);
});

test('swapping the file changes the id, which is all a client compares', () => {
  screening.open(FILM, T0);
  screening.setSubtitle({ name: 'a.srt', vtt: CUE }, T0);
  const first = screening.snapshot(T0).subtitle.id;

  screening.setSubtitle({ name: 'b.srt', vtt: CUE + '\n' }, T0 + 1000);
  assert.notEqual(screening.snapshot(T0).subtitle.id, first);
});

test('removing the subtitle removes it for the whole room', () => {
  screening.open(FILM, T0);
  screening.setSubtitle({ name: 'a.srt', vtt: CUE }, T0);

  assert.equal(screening.setSubtitle(null, T0 + 1000), true);
  assert.equal(screening.room.subtitle, null);
  assert.equal(screening.snapshot(T0).subtitle, null);
});

test('the subtitle belongs to the film it was loaded for', () => {
  screening.open(FILM, T0);
  screening.setSubtitle({ name: 'a.srt', vtt: CUE }, T0);

  screening.open({ ...FILM, id: 2, title: 'Outro Filme' }, T0 + 1000);
  assert.equal(screening.room.subtitle, null);

  screening.setSubtitle({ name: 'b.srt', vtt: CUE }, T0 + 2000);
  screening.close(T0 + 3000);
  assert.equal(screening.room.subtitle, null);
});

test('the snapshot never exposes the connection count', () => {
  screening.attach(session('p1', 'Ana'));
  const [viewer] = screening.snapshot(T0).viewers;

  assert.deepEqual(Object.keys(viewer).sort(), ['dot', 'id', 'name', 'ready', 'sourceTag']);
});
