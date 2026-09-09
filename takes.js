const { critsFor, GENRES } = require('./criteria');

/* Regras de LEITURA de uma ficha: qual é o alto e o baixo dela, e quanto do
   que a pessoa escreveu cabe numa linha. Num módulo próprio porque o saguão e a
   rede leem as mesmas fichas, e regra escrita duas vezes diverge na terceira. */

/* Meio ponto é o menor passo do controle. Exijo um ponto inteiro: abaixo disso
   o "mais alto" é ruído de arredondamento e não uma preferência. */
const SPREAD = 1;

/** Um trecho do que a pessoa escreveu, cortado no espaço e não no meio da palavra. */
function excerpt(body, max = 120) {
  const text = String(body || '').replace(/\s+/g, ' ').trim();
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const space = cut.lastIndexOf(' ');
  return (space > max * 0.6 ? cut.slice(0, space) : cut) + '…';
}

/* Só quando há distância entre os dois: uma ficha de onze notas iguais não tem
   alto nem baixo, tem uma nota, e apontar dois critérios ali inventaria uma
   opinião que a pessoa não teve. */
function endsWith(crits, genre, raw) {
  let scores;
  try {
    scores = JSON.parse(raw) || {};
  } catch {
    return null;
  }
  const marked = crits(GENRES.includes(genre) ? genre : 'Drama')
    .map(c => ({ name: c.name, value: scores[c.key] }))
    .filter(c => typeof c.value === 'number');
  if (marked.length < 3) return null;

  const high = marked.reduce((a, b) => (b.value > a.value ? b : a));
  const low = marked.reduce((a, b) => (b.value < a.value ? b : a));
  if (high.value - low.value < SPREAD) return null;
  return { high, low };
}

const endsOf = (genre, raw) => endsWith(critsFor, genre, raw);

module.exports = { SPREAD, excerpt, endsOf };
