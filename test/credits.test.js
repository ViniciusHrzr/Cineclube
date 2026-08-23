const test = require('node:test');
const assert = require('node:assert/strict');

const { signedBy } = require('../tmdb');

/* ── quem assina cada critério ───────────────────────────────────────────
   An allowlist of job titles per criterion, matched by exact string. TMDB does
   not spell these one way and never promised to, so every rule below is written
   against a payload shaped like the real thing — the fault this guards against
   is not a crash, it is a name quietly going missing from a card. */

const C = (name, job) => ({ name, job });
const A = name => ({ name });

test('a criterion with nobody credited is absent, not empty', () => {
  const out = signedBy([C('Alguém', 'Best Boy Grip')], []);
  assert.deepEqual(out, {});
  // Originalidade has no job at all, and never should.
  assert.equal('originalidade' in out, false);
});

test('the director is read from the crew, as before', () => {
  assert.deepEqual(signedBy([C('David Fincher', 'Director')], []).direcao, ['David Fincher']);
});

/* Oppenheimer and Inception say `Writer`; Fight Club says `Screenplay`. A find
   on one string is right about one of them and silent about the other. */
test('both spellings of the writing credit are found', () => {
  assert.deepEqual(signedBy([C('Christopher Nolan', 'Writer')], []).roteiro, ['Christopher Nolan']);
  assert.deepEqual(signedBy([C('Jim Uhls', 'Screenplay')], []).roteiro, ['Jim Uhls']);
});

/* The fault the allowlist exists for. Fight Club credits Chuck Palahniuk under
   `Novel`; he did not write the film. A department scan would have him here. */
test('the author of the source is not the writer of the film', () => {
  const out = signedBy([C('Jim Uhls', 'Screenplay'), C('Chuck Palahniuk', 'Novel')], []);
  assert.deepEqual(out.roteiro, ['Jim Uhls']);
  const book = signedBy([C('Kai Bird', 'Book'), C('Christopher Nolan', 'Writer')], []);
  assert.deepEqual(book.roteiro, ['Christopher Nolan']);
});

/* `som` is one slider over two crafts, and they are two different people. */
test('sound carries the composer and the sound designer, composer first', () => {
  const out = signedBy(
    [C('Richard King', 'Sound Designer'), C('Ludwig Göransson', 'Original Music Composer')],
    []
  );
  assert.deepEqual(out.som, ['Ludwig Göransson', 'Richard King']);
});

test('the declared job order wins over the order TMDB sent the crew in', () => {
  const a = signedBy([C('Screen', 'Screenplay'), C('Write', 'Writer')], []);
  const b = signedBy([C('Write', 'Writer'), C('Screen', 'Screenplay')], []);
  assert.deepEqual(a.roteiro, b.roteiro);
  assert.deepEqual(a.roteiro, ['Screen', 'Write']);
});

test('one person credited twice for the same criterion is named once', () => {
  const out = signedBy([C('Nolan', 'Writer'), C('Nolan', 'Screenplay')], []);
  assert.deepEqual(out.roteiro, ['Nolan']);
});

test('one person across two criteria is named in both', () => {
  const out = signedBy([C('Nolan', 'Director'), C('Nolan', 'Writer')], []);
  assert.deepEqual(out.direcao, ['Nolan']);
  assert.deepEqual(out.roteiro, ['Nolan']);
});

test('several people on one job all arrive, up to the cap', () => {
  const out = signedBy(
    [
      C('Conrad Vernon', 'Director'),
      C('Kelly Asbury', 'Director'),
      C('Andrew Adamson', 'Director'),
      C('Quarto', 'Director')
    ],
    []
  );
  assert.deepEqual(out.direcao, ['Conrad Vernon', 'Kelly Asbury', 'Andrew Adamson']);
});

/* An animation's cast is its voice cast — the same people, asked about under a
   different name because the genre swapped that slot of the base. */
test('the cast answers both the acting and the voice criteria', () => {
  const out = signedBy([], [A('Mike Myers'), A('Eddie Murphy'), A('Cameron Diaz'), A('Quarto')]);
  assert.deepEqual(out.atuacoes, ['Mike Myers', 'Eddie Murphy', 'Cameron Diaz']);
  assert.deepEqual(out.vozes, out.atuacoes);
});

test('a film with no cast listed claims no performances', () => {
  const out = signedBy([C('Alguém', 'Director')], []);
  assert.equal('atuacoes' in out, false);
  assert.equal('vozes' in out, false);
});

test('a crew member with no name is not a credit', () => {
  assert.deepEqual(signedBy([{ job: 'Editor' }, C('Real', 'Editor')], []).montagem, ['Real']);
});

test('the five criteria beyond the director are all reachable', () => {
  const out = signedBy(
    [
      C('D', 'Director'),
      C('R', 'Screenplay'),
      C('F', 'Director of Photography'),
      C('M', 'Editor'),
      C('S', 'Original Music Composer'),
      C('A', 'Production Design')
    ],
    [A('E')]
  );
  assert.deepEqual(Object.keys(out).sort(), [
    'arte', 'atuacoes', 'direcao', 'fotografia', 'montagem', 'roteiro', 'som', 'vozes'
  ]);
});
