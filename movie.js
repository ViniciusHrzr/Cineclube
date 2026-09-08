const { GENRES } = require('./criteria');

/* ══════════════════════════════════════════════════════════════════════════
   O FILME QUE O CLIENTE MANDOU.

   O risco não é injeção — todo valor vai por parâmetro. É TAMANHO: o corpo
   aceita 1 MB, e o `movie.id` é escolhido por quem escreve, então a restrição
   de unicidade não limita nada (basta mudar o número). Sem teto, mil pedidos
   põem um gigabyte de lixo num plano de 500 MB que suspende quando estoura.

   Os tetos abaixo são folgados de propósito: existem para barrar o absurdo,
   não para recusar um filme de verdade.
   ══════════════════════════════════════════════════════════════════════════ */

const MAX_TITLE = 300;
const MAX_POSTER = 500;
const MAX_DIRECTOR = 200;
/* O maior id do TMDB hoje tem sete dígitos; nove é folga e cabe num inteiro. */
const MAX_ID = 999_999_999;
/* Aberto no futuro porque a fila aceita filme ainda não lançado. */
const MIN_YEAR = 1870;
const MAX_YEAR = 2200;
/** Minutos. O recorde documentado passa de 800; mil é teto e não julgamento. */
const MAX_RUNTIME = 1000;

/** Texto de tamanho conhecido, ou null. Nunca string vazia — isso é ausência. */
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

/* Id e título são o mínimo. Os outros quatro campos viram `null` quando não
   servem, em vez de recusar o filme inteiro: um pôster com caminho estranho é
   um quadrado não exposto — um estado real deste produto —, e recusar a ficha
   por causa dele perderia a opinião de alguém por causa de uma imagem. */
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

module.exports = { cleanMovie, MAX_TITLE, MAX_POSTER, MAX_DIRECTOR, MAX_ID };
