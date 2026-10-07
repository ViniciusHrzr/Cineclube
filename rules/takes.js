const { critsFor, seasonCritsFor, GENRES } = require('./criteria');

const SPREAD = 1;

function excerpt(body, max = 120) {
  const text = String(body || '').replace(/\s+/g, ' ').trim();
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const space = cut.lastIndexOf(' ');
  return (space > max * 0.6 ? cut.slice(0, space) : cut) + '…';
}

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

const seasonEndsOf = (genre, raw) => endsWith(seasonCritsFor, genre, raw);

module.exports = { SPREAD, excerpt, endsOf, seasonEndsOf };
