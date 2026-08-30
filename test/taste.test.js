import test from 'node:test';
import assert from 'node:assert/strict';

import {
  affinityOf,
  clashesOf,
  crowdGapOf,
  endsOf,
  genresOf,
  memberSince,
  spreadOf,
  takesOf,
} from '../client/src/lib/taste.ts';

/* ══════════════════════════════════════════════════════════════════════════
   O que o perfil afirma sobre uma pessoa.

   Este módulo mora no cliente e é testado daqui pela mesma razão que o
   `chunkStore` é: o Node deste projeto lê TypeScript direto, e o que está
   sendo verificado é aritmética — a única espécie de erro que não falha na
   tela. Uma média errada não quebra nada. Ela desenha uma barra bonita e
   afirma, com a mesma confiança de todas as outras, que a pessoa valoriza
   fotografia. Ninguém tem como perceber olhando.

   O que estes testes protegem, acima de tudo, são os SILÊNCIOS. Metade deste
   módulo é a decisão de não responder: os extremos se calam abaixo de três
   fichas, o TMDB abaixo de quatro filmes com nota, a afinidade abaixo de três
   filmes em comum. Um piso que quebre em silêncio não deixa a página errada —
   deixa a página confiante, que é pior, e é exatamente o defeito que ninguém
   revisando a tela vai enxergar.

   Uma regra fina que também está fixada aqui, porque já foi escrita do jeito
   errado em produtos parecidos: a afinidade soma DISTÂNCIAS e não diferenças
   com sinal. Com sinal, quem dá dois pontos a mais num filme e dois a menos no
   outro aparece em acordo perfeito, que é o contrário do que aconteceu.

   > Quatro testes saíram daqui em 30/08/2026 junto com `tasteOf`, que o dono
   > cortou do perfil. Um deles fixava que a média do clube exclui a própria
   > pessoa — se a ficha do gosto voltar, esse é o teste a escrever primeiro.
   ══════════════════════════════════════════════════════════════════════════ */

const ANA = 'pAna';
const BIA = 'pBia';
const CAI = 'pCai';

let n = 0;
function take(reviewerId, movieId, final, marks, extra = {}) {
  n += 1;
  return {
    id: `r${n}`,
    reviewerId,
    reviewerName: reviewerId,
    reviewerDot: '#b5abfc',
    movieId,
    movieTitle: `Filme ${movieId}`,
    movieGenre: extra.genre ?? 'Drama',
    moviePoster: null,
    final,
    date: extra.date ?? `2026-08-${String(10 + n).padStart(2, '0')}`,
    comment: extra.comment ?? '',
    breakdown: Object.entries(marks).map(([key, value]) => ({ key, name: key, w: 1, value })),
    crowd: extra.crowd ?? null,
  };
}

const person = id => ({ id, name: id, dot: '#b5abfc' });

/* ── os extremos ───────────────────────────────────────────────────────── */

test('os extremos se calam abaixo de tres fichas e sem distancia', () => {
  const two = [take(ANA, 1, 9, {}), take(ANA, 2, 3, {})];
  assert.equal(endsOf(two, ANA), null, 'duas fichas nao tem extremos');

  const flat = [1, 2, 3].map(m => take(ANA, m, 7, {}));
  assert.equal(endsOf(flat, ANA), null, 'tres notas iguais nao tem alto nem baixo');

  const near = [take(ANA, 1, 7.5, {}), take(ANA, 2, 7, {}), take(ANA, 3, 6.8, {})];
  assert.equal(endsOf(near, ANA), null, 'menos de um ponto de distancia e arredondamento');

  const real = [take(ANA, 1, 9, {}), take(ANA, 2, 7, {}), take(ANA, 3, 4, {})];
  const ends = endsOf(real, ANA);
  assert.equal(ends.best.final, 9);
  assert.equal(ends.worst.final, 4);
});

/* ── contra o publico ──────────────────────────────────────────────────── */

test('o TMDB e a media das diferencas por filme, com piso de quatro', () => {
  const three = [1, 2, 3].map(m => take(ANA, m, 8, {}, { crowd: { score: 7, votes: 10 } }));
  assert.equal(crowdGapOf(three, ANA), null);

  const four = [
    take(ANA, 1, 8, {}, { crowd: { score: 7, votes: 10 } }), // +1
    take(ANA, 2, 8, {}, { crowd: { score: 7, votes: 10 } }), // +1
    take(ANA, 3, 9, {}, { crowd: { score: 6, votes: 10 } }), // +3
    take(ANA, 4, 5, {}, { crowd: { score: 6, votes: 10 } }), // -1
    take(ANA, 5, 5, {}), // sem nota do TMDB: nao entra
  ];
  const got = crowdGapOf(four, ANA);
  assert.equal(got.n, 4);
  assert.equal(got.gap, 1); // (1+1+3-1)/4
  assert.equal(got.widestGap, 3);
  assert.equal(got.widest.movieId, 3);
});

/* ── a regua ───────────────────────────────────────────────────────────── */

test('a regua agrupa por faixa e o dez cai na ultima', () => {
  const reviews = [
    take(ANA, 1, 10, {}),
    take(ANA, 2, 9.5, {}),
    take(ANA, 3, 0, {}),
    take(ANA, 4, 7.4, {}),
  ];
  const s = spreadOf(reviews, ANA);
  assert.equal(s.bands.length, 10);
  assert.equal(s.bands[9].length, 2, '10,0 e 9,5 dividem a ultima faixa');
  assert.equal(s.bands[0].length, 1);
  assert.equal(s.bands[7].length, 1);
  assert.equal(s.bands[5].length, 0, 'faixa vazia e uma lista vazia, nao um buraco');
  assert.equal(s.peak, 2);
  assert.equal(s.low, 0);
  assert.equal(s.high, 10);
  assert.equal(s.n, 4);
});

test('a faixa devolve as fichas, da maior nota para a menor', () => {
  /* A régua desenha uma célula por filme e derrama a faixa apontada embaixo,
     então o que ela precisa não é a contagem: é a lista, e numa ordem. */
  const reviews = [take(ANA, 1, 7.2, {}), take(ANA, 2, 7.9, {}), take(ANA, 3, 7.5, {})];
  const s = spreadOf(reviews, ANA);
  assert.deepEqual(s.bands[7].map(r => r.final), [7.9, 7.5, 7.2]);
  assert.deepEqual(s.bands[7].map(r => r.movieTitle), ['Filme 2', 'Filme 3', 'Filme 1']);
});

/* ── afinidade ─────────────────────────────────────────────────────────── */

test('afinidade e a distancia media, so nos filmes em comum, com piso de tres', () => {
  const reviews = [
    take(ANA, 1, 8, {}), take(ANA, 2, 6, {}), take(ANA, 3, 9, {}), take(ANA, 4, 5, {}),
    // Bia viu os mesmos quatro: distancias 1, 1, 4, 0 -> media 1,5
    take(BIA, 1, 7, {}), take(BIA, 2, 7, {}), take(BIA, 3, 5, {}), take(BIA, 4, 5, {}),
    // Cai viu dois: abaixo do piso, nao aparece
    take(CAI, 1, 8, {}), take(CAI, 2, 6, {}),
  ];
  const list = affinityOf(reviews, [person(ANA), person(BIA), person(CAI)], ANA);
  assert.equal(list.length, 1, 'Cai tem so dois filmes em comum');
  assert.equal(list[0].person.id, BIA);
  assert.equal(list[0].shared, 4);
  assert.equal(list[0].gap, 1.5);
  assert.equal(list[0].clash.movieId, 3, 'a briga e onde a distancia foi maior');
});

test('discordar para os dois lados nao vira acordo', () => {
  // +2 num filme e -2 no outro. Com sinal, a media seria zero.
  const reviews = [
    take(ANA, 1, 9, {}), take(ANA, 2, 5, {}), take(ANA, 3, 7, {}),
    take(BIA, 1, 7, {}), take(BIA, 2, 7, {}), take(BIA, 3, 7, {}),
  ];
  const [a] = affinityOf(reviews, [person(ANA), person(BIA)], ANA);
  assert.equal(a.gap, (2 + 2 + 0) / 3);
  assert.notEqual(a.gap, 0);
});

test('a lista de afinidade corre do mais parecido para o mais diferente', () => {
  const reviews = [
    take(ANA, 1, 8, {}), take(ANA, 2, 8, {}), take(ANA, 3, 8, {}),
    take(BIA, 1, 5, {}), take(BIA, 2, 5, {}), take(BIA, 3, 5, {}),
    take(CAI, 1, 8, {}), take(CAI, 2, 8, {}), take(CAI, 3, 7, {}),
  ];
  const list = affinityOf(reviews, [person(ANA), person(BIA), person(CAI)], ANA);
  assert.deepEqual(list.map(a => a.person.id), [CAI, BIA]);
});

/* ── comparar ──────────────────────────────────────────────────────────── */

test('a comparacao corre do maior desacordo para o menor', () => {
  const reviews = [
    take(ANA, 1, 8, {}), take(ANA, 2, 6, {}), take(ANA, 3, 9, {}),
    take(BIA, 1, 7, {}), take(BIA, 2, 7, {}), take(BIA, 3, 4, {}),
    take(BIA, 99, 7, {}), // so a Bia viu: fora
  ];
  const rows = clashesOf(reviews, ANA, BIA);
  assert.deepEqual(rows.map(r => r.movieId), [3, 1, 2]);
  assert.equal(rows[0].gap, 5);
  assert.equal(rows[0].mine, 9);
  assert.equal(rows[0].theirs, 4);
});

/* ── desde quando ──────────────────────────────────────────────────────── */

test('desde quando le mes e ano, e aguenta o que nao e data', () => {
  assert.equal(memberSince('2026-08-15 04:56:43'), 'agosto de 2026');
  assert.equal(memberSince(null), null);
  assert.equal(memberSince('nada disso'), null);
});

test('as fichas saem da mais nova para a mais velha', () => {
  const reviews = [
    take(ANA, 1, 8, {}, { date: '2026-08-01' }),
    take(ANA, 2, 8, {}, { date: '2026-08-20' }),
    take(ANA, 3, 8, {}, { date: '2026-08-10' }),
    take(BIA, 4, 8, {}, { date: '2026-08-30' }),
  ];
  const mine = takesOf(reviews, ANA);
  assert.deepEqual(mine.map(r => r.movieId), [2, 3, 1]);
});

test('uma pessoa sem fichas nao quebra nada', () => {
  assert.equal(endsOf([], ANA), null);
  assert.equal(crowdGapOf([], ANA), null);
  assert.equal(spreadOf([], ANA), null);
  assert.deepEqual(affinityOf([], [person(BIA)], ANA), []);
  assert.deepEqual(clashesOf([], ANA, BIA), []);
  assert.deepEqual(genresOf([], ANA), []);
});
