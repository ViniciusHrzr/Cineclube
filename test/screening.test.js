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

/* ── the buffering wheel ──────────────────────────────────────────────────── */

test('one person stalling pauses the club', () => {
  screening.attach(session('p1', 'Ana'));
  screening.attach(session('p2', 'Bruno'));
  screening.open(FILM, T0);
  screening.play(null, T0);

  screening.setReady('p2', false, null, T0 + 20_000);

  assert.equal(screening.room.status, 'paused');
  assert.equal(screening.room.pausedByStall, true);
  // Paused where it actually was, not at zero.
  assert.equal(screening.positionAt(T0 + 60_000), 20);
});

test('the club starts again once everyone can play', () => {
  screening.attach(session('p1', 'Ana'));
  screening.attach(session('p2', 'Bruno'));
  screening.open(FILM, T0);
  screening.play(null, T0);
  screening.setReady('p2', false, null, T0 + 20_000);

  screening.setReady('p2', true, null, T0 + 25_000);

  assert.equal(screening.room.status, 'playing');
  assert.equal(screening.room.pausedByStall, false);
  assert.equal(screening.positionAt(T0 + 30_000), 25);
});

test('a person pausing during a stall stops the room resuming on its own', () => {
  screening.attach(session('p1', 'Ana'));
  screening.attach(session('p2', 'Bruno'));
  screening.open(FILM, T0);
  screening.play(null, T0);
  screening.setReady('p2', false, null, T0 + 20_000);

  // Somebody gets up to make coffee while Bruno buffers.
  screening.pause(null, T0 + 22_000);
  screening.setReady('p2', true, null, T0 + 25_000);

  assert.equal(screening.room.status, 'paused');
});

test('leaving releases a room that was held on the person who left', () => {
  screening.attach(session('p1', 'Ana'));
  screening.attach(session('p2', 'Bruno'));
  screening.open(FILM, T0);
  screening.play(null, T0);
  screening.setReady('p2', false, null, T0 + 20_000);

  screening.detach('p2', T0 + 30_000);

  assert.equal(screening.room.status, 'playing');
  assert.equal(screening.room.viewers.size, 1);
});

/* ── damping ──────────────────────────────────────────────────────────────
   These two are the ones that were missing, and their absence is what the club
   sat through: a stall pauses, the buffer fills a little, the room resumes, the
   same thin copy stalls again on the next breath. Nothing in the loop converged
   because nothing in it was allowed to give up. */

test('the room does not seize on a second stall right after releasing one', () => {
  screening.attach(session('p1', 'Ana'));
  screening.attach(session('p2', 'Bruno'));
  screening.open(FILM, T0);
  screening.play(null, T0);

  screening.setReady('p2', false, null, T0 + 20_000);
  screening.setReady('p2', true, null, T0 + 25_000);
  // Bruno's copy runs dry again two seconds later, as a thin copy does.
  screening.setReady('p2', false, null, T0 + 27_000);

  assert.equal(screening.room.status, 'playing', 'the film carries on without him');
  assert.equal(screening.room.pausedByStall, false);
  // He is still on the board as buffering, which is the part the club can act on.
  assert.equal(screening.room.viewers.get('p2').ready, false);
});

test('a film that keeps stopping itself stops being allowed to', () => {
  screening.attach(session('p1', 'Ana'));
  screening.attach(session('p2', 'Bruno'));
  screening.open(FILM, T0);
  screening.play(null, T0);

  // Six stalls, each one well clear of the cooldown, so every one is granted.
  let t = T0;
  for (let i = 0; i < 6; i++) {
    t += 60_000;
    screening.setReady('p2', false, null, t);
    assert.equal(screening.room.pausedByStall, true, `stall ${i + 1} should still pause`);
    t += 5000;
    screening.setReady('p2', true, null, t);
  }

  t += 60_000;
  screening.setReady('p2', false, null, t);

  assert.equal(screening.room.status, 'playing', 'the mechanism has run out of credit');
  assert.equal(screening.room.pausedByStall, false);
});

test('a new film gets the damping budget back', () => {
  screening.attach(session('p1', 'Ana'));
  screening.attach(session('p2', 'Bruno'));
  screening.open(FILM, T0);
  screening.play(null, T0);

  let t = T0;
  for (let i = 0; i < 6; i++) {
    t += 60_000;
    screening.setReady('p2', false, null, t);
    t += 5000;
    screening.setReady('p2', true, null, t);
  }

  screening.open(FILM, t + 1000);
  screening.play(null, t + 2000);
  screening.setReady('p2', false, null, t + 20_000);

  assert.equal(screening.room.pausedByStall, true);
});

test('a stall while already paused does not mark the pause as the room\'s', () => {
  screening.attach(session('p1', 'Ana'));
  screening.open(FILM, T0);

  screening.setReady('p1', false, null, T0 + 1000);

  assert.equal(screening.room.pausedByStall, false);
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

test('the snapshot never exposes the connection count', () => {
  screening.attach(session('p1', 'Ana'));
  const [viewer] = screening.snapshot(T0).viewers;

  assert.deepEqual(Object.keys(viewer).sort(), ['dot', 'id', 'name', 'ready', 'sourceTag']);
});
