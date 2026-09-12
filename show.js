const { GENRES } = require('./criteria');
const { MAX_TITLE, MAX_POSTER, MAX_ID } = require('./movie');

/* O mesmo trabalho de movie.js, pelo motivo escrito lá. O que muda é o que
   identifica a coisa: um filme é um id, um episódio é uma TRIPLA — série,
   temporada, número —, e as três viram chave primária. */

const MAX_EPISODE_TITLE = 300;
/* Uma novela passa de mil capítulos. Folgados de propósito: barram o absurdo,
   não uma série de verdade. */
const MAX_SEASON = 200;
const MAX_EPISODE = 5000;
const MIN_YEAR = 1870;
const MAX_YEAR = 2200;

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

function cleanShow(raw) {
  if (!raw || typeof raw !== 'object') return { error: 'Série inválida.' };

  const id = whole(raw.id, { min: 1, max: MAX_ID });
  if (id === null) return { error: 'Série inválida.' };

  const title = text(raw.title, MAX_TITLE);
  if (!title) return { error: 'Série inválida.' };

  return {
    show: {
      id,
      title,
      year: whole(raw.year, { min: MIN_YEAR, max: MAX_YEAR }),
      genre: GENRES.includes(raw.genre) ? raw.genre : 'Drama',
      poster: text(raw.poster, MAX_POSTER),
    },
  };
}

/* Temporada zero é aceita e não é engano: o TMDB numera especiais e piloto não
   exibido como zero. O que a lista de temporadas esconde é decisão da tela. */
function cleanEpisodeRef(params) {
  const showId = whole(params?.showId, { min: 1, max: MAX_ID });
  const season = whole(params?.season, { min: 0, max: MAX_SEASON });
  const episode = whole(params?.episode, { min: 1, max: MAX_EPISODE });
  if (showId === null || season === null || episode === null) {
    return { error: 'Episódio inválido.' };
  }
  return { ref: { showId, season, episode } };
}

/* ── onde a ficha de uma temporada mora ───────────────────────────────────
   Na MESMA tabela das marcas de episódio, na linha de número zero: o TMDB
   numera episódios a partir de 1, e `cleanEpisodeRef` exige isso, então o zero
   é um lugar que episódio nenhum ocupa.

   Uma tabela à parte pediria uma segunda tabela de comentários, uma segunda de
   votos e um segundo caminho no mural para cada uma — a conversa e o polegar
   penduram no id de uma ficha, e um id que às vezes é de uma tabela e às vezes
   de outra não é uma chave estrangeira. */
const SEASON_ROW = 0;

function cleanSeasonRef(params) {
  const showId = whole(params?.showId, { min: 1, max: MAX_ID });
  const season = whole(params?.season, { min: 0, max: MAX_SEASON });
  if (showId === null || season === null) return { error: 'Temporada inválida.' };
  return { ref: { showId, season, episode: SEASON_ROW } };
}

module.exports = {
  cleanShow, cleanEpisodeRef, cleanSeasonRef, text,
  SEASON_ROW, MAX_EPISODE_TITLE, MAX_SEASON, MAX_EPISODE,
};
