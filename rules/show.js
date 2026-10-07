const { GENRES } = require('./criteria');
const { MAX_TITLE, MAX_POSTER, MAX_ID, text, whole } = require('./movie');

const MAX_EPISODE_TITLE = 300;
const MAX_SEASON = 200;
const MAX_EPISODE = 5000;
const MIN_YEAR = 1870;
const MAX_YEAR = 2200;

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

function cleanEpisodeRef(params) {
  const showId = whole(params?.showId, { min: 1, max: MAX_ID });
  const season = whole(params?.season, { min: 0, max: MAX_SEASON });
  const episode = whole(params?.episode, { min: 1, max: MAX_EPISODE });
  if (showId === null || season === null || episode === null) {
    return { error: 'Episódio inválido.' };
  }
  return { ref: { showId, season, episode } };
}

const SEASON_ROW = 0;

function cleanSeasonRef(params) {
  const showId = whole(params?.showId, { min: 1, max: MAX_ID });
  const season = whole(params?.season, { min: 0, max: MAX_SEASON });
  if (showId === null || season === null) return { error: 'Temporada inválida.' };
  return { ref: { showId, season, episode: SEASON_ROW } };
}

module.exports = {
  cleanShow, cleanEpisodeRef, cleanSeasonRef, text,
  SEASON_ROW, MAX_EPISODE_TITLE,
};
