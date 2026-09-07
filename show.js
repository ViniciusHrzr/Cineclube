const { GENRES } = require('./criteria');
const { MAX_TITLE, MAX_POSTER, MAX_ID } = require('./movie');

/* ── a série e o episódio que o cliente mandou ────────────────────────────
   O mesmo trabalho que movie.js faz, pelo mesmo motivo escrito lá: o id e os
   textos vêm de quem escreve, o corpo aceita 1 MB, e sem teto uma linha da fila
   é um jeito de gravar um megabyte por chamada.

   O que muda é o que identifica a coisa. Um filme é um id; um episódio é uma
   TRIPLA — série, temporada, número —, e as três precisam ser inteiros
   plausíveis antes de virarem chave primária de alguma coisa. */

const MAX_EPISODE_TITLE = 300;
/* Uma série pode ter dezenas de temporadas e uma novela passa de mil capítulos.
   Os tetos são folgados de propósito: existem para barrar o absurdo, não para
   recusar uma série de verdade. */
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

/* ── a tripla que aponta um episódio ──────────────────────────────────────
   A temporada zero é aceita e não é engano: o TMDB numera especiais e piloto
   não exibido como zero, e quem foi atrás de um especial está apontando uma
   coisa que existe. O que a lista de temporadas esconde é outra decisão, e ela
   mora na tela. */
function cleanEpisodeRef(params) {
  const showId = whole(params?.showId, { min: 1, max: MAX_ID });
  const season = whole(params?.season, { min: 0, max: MAX_SEASON });
  const episode = whole(params?.episode, { min: 1, max: MAX_EPISODE });
  if (showId === null || season === null || episode === null) {
    return { error: 'Episódio inválido.' };
  }
  return { ref: { showId, season, episode } };
}

module.exports = {
  cleanShow, cleanEpisodeRef, text,
  MAX_EPISODE_TITLE, MAX_SEASON, MAX_EPISODE,
};
