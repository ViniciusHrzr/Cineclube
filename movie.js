const { GENRES } = require('./criteria');

/* ══════════════════════════════════════════════════════════════════════════
   O FILME QUE O CLIENTE MANDOU.

   Duas rotas gravam um filme a partir do corpo da requisição — avaliar e pôr na
   fila — e as duas confiavam nele. A nota era limpa (0 a 10, o gênero conferido
   contra a lista, o comentário cortado em 2000), e ao lado disso o TÍTULO, o
   PÔSTER e o DIRETOR iam para o banco exatamente como chegaram.

   O buraco não é injeção — todo valor vai por parâmetro, e o SQL nunca é
   montado com texto de ninguém. É tamanho. O corpo aceita 1 MB, e nada impedia
   uma avaliação de carregar um título de novecentos mil caracteres. Pior: o
   `movie.id` é escolhido por quem escreve, então a restrição de unicidade
   (uma ficha por pessoa por filme) não segura nada — bastava mudar o número.
   Mil requisições e o banco tem um gigabyte de lixo, num plano cujo teto são
   500 MB e cuja punição por estourar é a suspensão do serviço.

   O TMDB é a fonte destes campos e nenhum deles chega perto dos limites abaixo:
   o título mais longo do catálogo tem algumas dezenas de caracteres e um
   caminho de pôster tem menos de sessenta. Os tetos são folgados de propósito —
   eles existem para impedir o absurdo, não para rejeitar um filme de verdade.

   Por que aqui e não em cada rota: são as mesmas regras sobre o mesmo objeto, e
   regra escrita duas vezes diverge na terceira.
   ══════════════════════════════════════════════════════════════════════════ */

const MAX_TITLE = 300;
const MAX_POSTER = 500;
const MAX_DIRECTOR = 200;
/* O TMDB é o espaço de ids possível. O maior hoje tem sete dígitos; nove
   dígitos é folga de sobra e ainda cabe num inteiro sem discussão. */
const MAX_ID = 999_999_999;
/* Cinema é de 1888 para cá. O teto é aberto porque um filme pode estar
   anunciado para daqui a alguns anos e a fila do clube aceita isso. */
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

/* ── um filme, limpo ──────────────────────────────────────────────────────
   Devolve `{ error }` quando não dá para gravar, e o objeto pronto quando dá.
   O id e o título são o mínimo: sem id não há a que a ficha se refere, e sem
   título a fila e o acervo mostrariam uma linha em branco.

   Os outros quatro campos são opcionais e viram `null` quando não servem, em
   vez de recusar o filme inteiro. Um pôster com um caminho estranho é um
   quadrado não exposto na tela — que é um estado real deste produto — e recusar
   a ficha por causa dele seria perder a opinião de alguém por causa de uma
   imagem. */
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
