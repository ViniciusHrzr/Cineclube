const { GENRES } = require('./criteria');

const MAX_TITLE = 300;
const MAX_POSTER = 500;
const MAX_DIRECTOR = 200;
const MAX_ID = 999_999_999;
const MIN_YEAR = 1870;
const MAX_YEAR = 2200;
const MAX_RUNTIME = 1000;

function text(value, max) {
  if (typeof value !== 'string') return null;
  const clean = value.trim().slice(0, max);
  return clean || null;
}

function whole(value, { min, max }) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  const round = Math.round(n);
  return round >= min && round <= max ? round : null;
}

function cleanMovie(raw) {
  if (!raw || typeof raw !== 'object') return { error: 'Filme inválido.' };

  const id = whole(raw.id, { min: 1, max: MAX_ID });
  if (id === null) return { error: 'Filme inválido.' };

  const title = text(raw.title, MAX_TITLE);
  if (!title) return { error: 'Filme inválido.' };

  return {
    movie: {
      id,
      title,
      year: whole(raw.year, { min: MIN_YEAR, max: MAX_YEAR }),
      genre: GENRES.includes(raw.genre) ? raw.genre : 'Drama',
      poster: text(raw.poster, MAX_POSTER),
      director: text(raw.director, MAX_DIRECTOR),
      runtime: whole(raw.runtime, { min: 1, max: MAX_RUNTIME }),
    },
  };
}

module.exports = { cleanMovie, text, whole, MAX_TITLE, MAX_POSTER, MAX_DIRECTOR, MAX_ID };
