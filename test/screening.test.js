const test = require('node:test');
const assert = require('node:assert/strict');

const screening = require('../lib/screening');

const T0 = 1_700_000_000_000;
const FILM = { id: 1, title: 'Duna: Parte Dois', year: 2024, genre: 'Ficção', poster: null, runtime: 166 };

const session = (id, name) => ({ reviewer_id: id, name, dot: '#b5abfc' });

const HOST = { id: 'dono', name: 'Vinicius', dot: '#b5abfc' };

const SRC = 'a1b2c3d4e5f6';

const CLUBE = 'c-teste';
let room;

test.beforeEach(() => {
  screening.reset();
  room = screening.roomFor(CLUBE);
});

test('a paused room does not move', () => {
  screening.open(room, FILM, HOST, T0);
  assert.equal(screening.positionAt(room, T0 + 60_000), 0);
});

test('a playing room moves with the clock, and stops where it is paused', () => {
  screening.open(room, FILM, HOST, T0);
  screening.play(room, null, T0);

  assert.equal(screening.positionAt(room, T0 + 10_000), 10);

  screening.pause(room, null, T0 + 30_000);
  assert.equal(screening.positionAt(room, T0 + 30_000), 30);
  assert.equal(screening.positionAt(room, T0 + 90_000), 30);
});

test('play resumes from where the pause left it', () => {
  screening.open(room, FILM, HOST, T0);
  screening.play(room, null, T0);
  screening.pause(room, null, T0 + 30_000);
  screening.play(room, null, T0 + 120_000);

  assert.equal(screening.positionAt(room, T0 + 130_000), 40);
});

test('seek moves the film without stopping it', () => {
  screening.open(room, FILM, HOST, T0);
  screening.play(room, null, T0);
  screening.seek(room, 600, T0 + 5_000);

  assert.equal(room.status, 'playing');
  assert.equal(screening.positionAt(room, T0 + 6_000), 601);
});

test('every mutation advances the revision', () => {
  const seen = [];
  screening.open(room, FILM, HOST, T0);
  seen.push(room.revision);
  screening.play(room, null, T0);
  seen.push(room.revision);
  screening.seek(room, 10, T0);
  seen.push(room.revision);
  screening.pause(room, null, T0);
  seen.push(room.revision);

  for (let i = 1; i < seen.length; i++) assert.ok(seen[i] > seen[i - 1], `${seen[i]} > ${seen[i - 1]}`);
});

test('opening a film starts it from zero and paused', () => {
  screening.open(room, FILM, HOST, T0);
  screening.play(room, null, T0);
  screening.open(room, { ...FILM, id: 2, title: 'Outro' }, HOST, T0 + 60_000);

  assert.equal(room.status, 'paused');
  assert.equal(screening.positionAt(room, T0 + 120_000), 0);
});

test('closing clears the film but keeps the people', () => {
  screening.attach(room, session('p1', 'Ana'));
  screening.open(room, FILM, HOST, T0);
  screening.close(room, T0 + 1000);

  assert.equal(room.open, false);
  assert.equal(room.movie, null);
  assert.equal(room.viewers.size, 1);
});

test('a position that is not a number cannot enter the room', () => {
  assert.equal(screening.clampPosition(room, NaN), 0);
  assert.equal(screening.clampPosition(room, Infinity), 0);
  assert.equal(screening.clampPosition(room, -Infinity), 0);
  assert.equal(screening.clampPosition(room, -5), 0);
  assert.equal(screening.clampPosition(room, 'abc'), 0);
  assert.equal(screening.clampPosition(room, null), 0);
  assert.equal(screening.clampPosition(room, undefined), 0);
});

test('a position past the end of the film is clamped to the film', () => {
  screening.open(room, FILM, HOST, T0);
  assert.equal(screening.clampPosition(room, 999_999), 166 * 60 + 900);
});

test('a playing room never derives a position past the film either', () => {
  screening.open(room, FILM, HOST, T0);
  screening.play(room, null, T0);
  assert.equal(screening.positionAt(room, T0 + 31_536_000_000), 166 * 60 + 900);
});

test('only the three real commands are commands', () => {
  screening.open(room, FILM, HOST, T0);
  assert.equal(screening.command(room, 'play', 0, T0), true);
  assert.equal(screening.command(room, 'destroy', 0, T0), false);
  assert.equal(screening.command(room, '__proto__', 0, T0), false);
  assert.equal(screening.command(room, '', 0, T0), false);
});

test('a command with no screening open is refused', () => {
  assert.equal(screening.command(room, 'play', 0, T0), false);
});

test('a source that could execute is not a source', () => {
  assert.equal(screening.isAllowedSource('javascript:alert(1)'), false);
  assert.equal(screening.isAllowedSource('data:text/html,<script>'), false);
  assert.equal(screening.isAllowedSource('file:///etc/passwd'), false);

  assert.equal(screening.isAllowedSource('https://exemplo.com/f.mp4'), true);
  assert.equal(screening.isAllowedSource('magnet:?xt=urn:btih:abc'), true);
  assert.equal(screening.isAllowedSource('blob:http://localhost/123'), true);
  assert.equal(screening.isAllowedSource('08ada5a7a6183aae1e09d831df6748d566095a10'), true);
  assert.equal(screening.isAllowedSource('<img src=x onerror=1>'), false);
});

test('text a member sent is trimmed and capped', () => {
  assert.equal(screening.text('  oi  '), 'oi');
  assert.equal(screening.text(''), null);
  assert.equal(screening.text(42), null);
  assert.equal(screening.text('x'.repeat(9999)).length, screening.MAX_TEXT);
});

test('a travada de um membro não para mais o filme de ninguém', () => {
  screening.attach(room, session('p1', 'Ana'));
  screening.attach(room, session('p2', 'Bruno'));
  screening.open(room, FILM, HOST, T0);
  screening.play(room, null, T0);

  screening.setReady(room, 'p2', false, SRC, T0 + 20_000);

  assert.equal(room.status, 'playing');
  assert.equal(screening.positionAt(room, T0 + 60_000), 60, 'o filme parou de correr');
  assert.equal(room.viewers.get('p2').ready, false);
});

test('nem quando todo mundo trava ao mesmo tempo', () => {
  screening.attach(room, session('p1', 'Ana'));
  screening.attach(room, session('p2', 'Bruno'));
  screening.open(room, FILM, HOST, T0);
  screening.play(room, null, T0);

  screening.setReady(room, 'p1', false, SRC, T0 + 10_000);
  screening.setReady(room, 'p2', false, SRC, T0 + 11_000);

  assert.equal(room.status, 'playing');
});

test('e a sala não recomeça sozinha quando o buffer enche', () => {
  screening.attach(room, session('p1', 'Ana'));
  screening.attach(room, session('p2', 'Bruno'));
  screening.open(room, FILM, HOST, T0);
  screening.play(room, null, T0);
  screening.setReady(room, 'p2', false, SRC, T0 + 20_000);

  screening.pause(room, null, T0 + 22_000);
  screening.setReady(room, 'p2', true, SRC, T0 + 25_000);

  assert.equal(room.status, 'paused', 'a sala voltou sem ninguém pedir');
  assert.equal(screening.positionAt(room, T0 + 90_000), 22);
});

test('sair da sala não mexe no filme', () => {
  screening.attach(room, session('p1', 'Ana'));
  screening.attach(room, session('p2', 'Bruno'));
  screening.open(room, FILM, HOST, T0);
  screening.play(room, null, T0);
  screening.setReady(room, 'p2', false, SRC, T0 + 20_000);

  screening.detach(room, 'p2');

  assert.equal(room.status, 'playing');
  assert.equal(room.viewers.size, 1);
});

test('a roda continua dizendo quem está carregando e o que cada um abriu', () => {
  screening.attach(room, session('p1', 'Ana'));
  screening.open(room, FILM, HOST, T0);
  screening.play(room, null, T0);

  screening.setReady(room, 'p1', false, SRC, T0 + 5000);
  assert.equal(room.viewers.get('p1').ready, false);
  assert.equal(room.viewers.get('p1').sourceTag, SRC);

  screening.setReady(room, 'p1', true, SRC, T0 + 9000);
  assert.equal(room.viewers.get('p1').ready, true);
});

test('two tabs are one person, and closing one leaves them in the room', () => {
  screening.attach(room, session('p1', 'Ana'));
  screening.attach(room, session('p1', 'Ana'));
  assert.equal(room.viewers.size, 1);

  screening.detach(room, 'p1');
  assert.equal(room.viewers.size, 1, 'still watching in the other tab');

  screening.detach(room, 'p1');
  assert.equal(room.viewers.size, 0);
});

test('connections are capped per person and overall', () => {
  for (let i = 0; i < screening.MAX_STREAMS_PER_VIEWER; i++) {
    assert.equal(screening.canSubscribe(room, 'p1'), true);
    screening.attach(room, session('p1', 'Ana'));
  }
  assert.equal(screening.canSubscribe(room, 'p1'), false);
  assert.equal(screening.canSubscribe(room, 'p2'), true, 'one person cannot lock everyone out');
});

test('a runaway loop of commands is cut off', () => {
  let allowed = 0;
  for (let i = 0; i < 50; i++) if (screening.withinRate('p1', T0)) allowed++;

  assert.ok(allowed > 0 && allowed < 50, `let ${allowed} through`);
  assert.equal(screening.withinRate('p2', T0), true);
});

test('the bucket refills once the window has passed', () => {
  for (let i = 0; i < 50; i++) screening.withinRate('p1', T0);
  assert.equal(screening.withinRate('p1', T0 + 10_000), true);
});

test('the snapshot carries the derived position and the server clock', () => {
  screening.attach(room, session('p1', 'Ana'));
  screening.open(room, FILM, HOST, T0);
  screening.play(room, null, T0);

  const frame = screening.snapshot(room, T0 + 42_000);

  assert.equal(frame.type, 'state');
  assert.equal(frame.position, 42);
  assert.equal(frame.serverTime, T0 + 42_000);
  assert.equal(frame.viewers.length, 1);
  assert.equal(frame.viewers[0].name, 'Ana');
});

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
  screening.open(room, FILM, HOST, T0);

  assert.equal(screening.setLink(room, huge, T0), false);
  assert.equal(room.link, null, 'meio magnet não é um magnet mais curto');
});

test('a refused link leaves the one the club already had', () => {
  const good = 'magnet:?xt=urn:btih:0123456789abcdef0123456789abcdef01234567';
  screening.open(room, FILM, HOST, T0);
  screening.setLink(room, good, T0);

  assert.equal(screening.setLink(room, 'javascript:alert(1)', T0 + 1000), false);
  assert.equal(room.link, good);
});

test('the link belongs to the film it was opened for', () => {
  screening.open(room, FILM, HOST, T0);
  screening.setLink(room, 'https://arquivo.exemplo/filme.mp4', T0);

  screening.open(room, { ...FILM, id: 2, title: 'Outro' }, HOST, T0 + 1000);
  assert.equal(room.link, null, 'apontar para o filme anterior é pior que não apontar');

  screening.setLink(room, 'https://arquivo.exemplo/outro.mp4', T0 + 2000);
  screening.close(room, T0 + 3000);
  assert.equal(room.link, null);
});

test('the snapshot carries the link, so whoever arrives can load it', () => {
  const link = 'magnet:?xt=urn:btih:0123456789abcdef0123456789abcdef01234567';
  screening.open(room, FILM, HOST, T0);
  screening.setLink(room, link, T0);

  assert.equal(screening.snapshot(room, T0).link, link);
});

const CUE = 'WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nboa noite';

test('a subtitle needs both a name and some text', () => {
  screening.open(room, FILM, HOST, T0);

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
    assert.equal(screening.setSubtitle(room, bad, T0), false, JSON.stringify(bad ?? null));
  }
  assert.equal(room.subtitle, null);
});

test('a subtitle too big to be one is refused whole, not trimmed', () => {
  screening.open(room, FILM, HOST, T0);

  const over = { name: 'filme.srt', vtt: 'a'.repeat(screening.MAX_SUBTITLE + 1) };
  assert.equal(screening.setSubtitle(room, over, T0), false);
  assert.equal(room.subtitle, null);

  const at = { name: 'filme.srt', vtt: 'a'.repeat(screening.MAX_SUBTITLE) };
  assert.equal(screening.setSubtitle(room, at, T0), true);
  assert.equal(room.subtitle.vtt.length, screening.MAX_SUBTITLE);
});

test('the snapshot announces the subtitle without carrying it', () => {
  screening.open(room, FILM, HOST, T0);
  screening.setSubtitle(room, { name: 'duna.srt', vtt: CUE }, T0);

  const announced = screening.snapshot(room, T0).subtitle;
  assert.deepEqual(Object.keys(announced).sort(), ['id', 'name']);
  assert.equal(announced.name, 'duna.srt');
  assert.equal(announced.vtt, undefined);
});

test('swapping the file changes the id, which is all a client compares', () => {
  screening.open(room, FILM, HOST, T0);
  screening.setSubtitle(room, { name: 'a.srt', vtt: CUE }, T0);
  const first = screening.snapshot(room, T0).subtitle.id;

  screening.setSubtitle(room, { name: 'b.srt', vtt: CUE + '\n' }, T0 + 1000);
  assert.notEqual(screening.snapshot(room, T0).subtitle.id, first);
});

test('removing the subtitle removes it for the whole room', () => {
  screening.open(room, FILM, HOST, T0);
  screening.setSubtitle(room, { name: 'a.srt', vtt: CUE }, T0);

  assert.equal(screening.setSubtitle(room, null, T0 + 1000), true);
  assert.equal(room.subtitle, null);
  assert.equal(screening.snapshot(room, T0).subtitle, null);
});

test('the subtitle belongs to the film it was loaded for', () => {
  screening.open(room, FILM, HOST, T0);
  screening.setSubtitle(room, { name: 'a.srt', vtt: CUE }, T0);

  screening.open(room, { ...FILM, id: 2, title: 'Outro Filme' }, HOST, T0 + 1000);
  assert.equal(room.subtitle, null);

  screening.setSubtitle(room, { name: 'b.srt', vtt: CUE }, T0 + 2000);
  screening.close(room, T0 + 3000);
  assert.equal(room.subtitle, null);
});

test('the snapshot never exposes the connection count', () => {
  screening.attach(room, session('p1', 'Ana'));
  const [viewer] = screening.snapshot(room, T0).viewers;

  assert.deepEqual(Object.keys(viewer).sort(), ['dot', 'id', 'name', 'ready', 'sourceTag']);
});
