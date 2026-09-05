const { critsFor, GENRES } = require('./criteria');

/* ══════════════════════════════════════════════════════════════════════════
   O que se lê de uma ficha sem abri-la.

   Duas funções, e as duas nasceram dentro do feed. Saíram de lá quando o saguão
   passou a mostrar uma ficha inteira: são regras de LEITURA de uma avaliação —
   o que é o alto e o baixo dela, e quanto do que a pessoa escreveu cabe numa
   linha — e uma regra escrita duas vezes é uma regra que diverge na terceira.
   ══════════════════════════════════════════════════════════════════════════ */

/* Meio ponto é o menor passo que o controle permite, então uma diferença menor
   que isso não existe. Exijo um ponto inteiro: abaixo disso o "mais alto" é
   ruído de arredondamento e não uma preferência. */
const SPREAD = 1;

/** Um trecho do que a pessoa escreveu, cortado no espaço e não no meio da palavra. */
function excerpt(body, max = 120) {
  const text = String(body || '').replace(/\s+/g, ' ').trim();
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const space = cut.lastIndexOf(' ');
  return (space > max * 0.6 ? cut.slice(0, space) : cut) + '…';
}

/* ── onde a pessoa se entusiasmou e onde se decepcionou ───────────────────
   O par mais alto e mais baixo da ficha, com o nome que o gênero dá ao
   critério. Só quando há distância entre eles: uma ficha de onze notas iguais
   não tem alto nem baixo, tem uma nota, e apontar dois critérios ali seria
   inventar uma opinião que a pessoa não teve. */
function endsOf(genre, raw) {
  let scores;
  try {
    scores = JSON.parse(raw) || {};
  } catch {
    return null;
  }
  const marked = critsFor(GENRES.includes(genre) ? genre : 'Drama')
    .map(c => ({ name: c.name, value: scores[c.key] }))
    .filter(c => typeof c.value === 'number');
  if (marked.length < 3) return null;

  const high = marked.reduce((a, b) => (b.value > a.value ? b : a));
  const low = marked.reduce((a, b) => (b.value < a.value ? b : a));
  if (high.value - low.value < SPREAD) return null;
  return { high, low };
}

module.exports = { SPREAD, excerpt, endsOf };
