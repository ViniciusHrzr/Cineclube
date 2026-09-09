const express = require('express');
const db = require('../db');
const tmdb = require('../tmdb');
const series = require('../series');
const wrap = require('../wrap');
const { trailerCache } = require('../trailers');
const { GENRES, GENRE_TO_TMDB } = require('../criteria');

const router = express.Router();

/* ══════════════════════════════════════════════════════════════════════════
   O REEL: TRAILERES EM FILA, POR GÊNERO.

   Irmão de routes/catalog.js e de routes/series.js, e fora do escopo de clube
   pelo mesmo motivo que eles: o TMDB não é de clube nenhum. O que É do clube —
   quais destas obras alguém já avaliou, e portanto quais vêm primeiro — o
   cliente já tem em memória desde o boot e decide sozinho. Uma rota de reel que
   soubesse do clube estaria perguntando ao servidor o que a tela já sabe.

   Duas portas, porque são duas perguntas:

   · `/` é "me dê o que passar agora". Com `like=<ids>` a resposta deixa de ser
     o que está popular e passa a ser o que se parece com o que o clube gostou:
     a tela manda as obras mais bem avaliadas da sala e recebe as vizinhas
     delas. Sem `like`, ou quando elas não enchem a página, a descoberta comum
     completa. Nada disso é dito na tela — o reel não explica por que sugeriu,
     ele sugere.
   · `/pinned` é "estas aqui, nesta ordem" — as que o clube avaliou, que a tela
     intercala no meio do reel.

   ── só entra o que tem trailer ──────────────────────────────────────────
   Um quadro de reel sem vídeo não é um item mais fraco, é um buraco: a pessoa
   desliza, encontra um pôster parado e não tem o que fazer ali. Quem não tem
   trailer some da página em vez de ocupá-la, e é por isso que a contagem de
   resultados não bate com a do TMDB.
   ══════════════════════════════════════════════════════════════════════════ */

/** Quantas obras uma rolagem carrega. Uma página do TMDB, menos as sem vídeo. */
const PER_PAGE = 20;
/** Teto do que a tela pode fixar na frente. Além disto o reel virou uma lista. */
const MAX_PINNED = 12;
/* Quantas obras do clube alimentam a sugestão. Quatro dá variedade sem virar
   uma média de tudo: com dez sementes o resultado converge para "popular", que
   é exatamente o que a sugestão existe para não ser. */
const MAX_SEEDS = 4;

const fillMovieTrailers = trailerCache({ table: 'movies_cache', fetch: id => tmdb.videosFor(id) });
const fillShowTrailers = trailerCache({ table: 'shows_cache', fetch: id => series.videosFor(id) });

/* O cache guarda o que o reel desenha, e não só o que a grade desenhava: o
   quadro deitado e a sinopse. As duas viajam de graça em toda rota de lista do
   TMDB — o que faltava era gravá-las. Escrito por UPDATE e não pelo upsert
   grande das outras rotas: aqui a linha ou já existe (porque o clube guardou a
   obra) ou não é para existir. */
const rememberMovie = db.prepare(
  'UPDATE movies_cache SET backdrop = ?, overview = ? WHERE tmdb_id = ?'
);
const rememberShow = db.prepare(
  'UPDATE shows_cache SET backdrop = ?, overview = ? WHERE tmdb_id = ?'
);

const world = kind =>
  kind === 'show'
    ? {
        kind: 'show',
        genres: Object.keys(series.GENRE_TO_TV),
        popular: page => series.popularShows(page),
        discover: (genre, page) => series.discoverShows(series.GENRE_TO_TV[genre], page),
        details: id => series.showDetails(id),
        like: (id, page) => series.recommendations(id, page),
        fillTrailers: fillShowTrailers,
        remember: rememberShow,
        cache: db.prepare('SELECT * FROM shows_cache WHERE tmdb_id = ?'),
      }
    : {
        kind: 'movie',
        genres: GENRES,
        popular: page => tmdb.popularMovies(page),
        discover: (genre, page) => tmdb.discoverMovies(GENRE_TO_TMDB[genre], page),
        details: id => tmdb.movieDetails(id),
        like: (id, page) => tmdb.recommendations(id, page),
        fillTrailers: fillMovieTrailers,
        remember: rememberMovie,
        cache: db.prepare('SELECT * FROM movies_cache WHERE tmdb_id = ?'),
      };

/** O que um quadro de reel precisa, e nada além: a ficha busca o resto. */
const reelDTO = (o, kind) => ({
  id: o.id,
  kind,
  title: o.title,
  original: o.original ?? null,
  year: o.year ?? null,
  genre: o.genre,
  genres: o.genres || [o.genre],
  poster: o.poster ?? null,
  backdrop: o.backdrop ?? null,
  overview: o.overview ?? null,
  crowd: o.crowd ?? null,
  trailerKey: o.trailerKey,
});

const fromCache = c => ({
  id: c.tmdb_id,
  title: c.title,
  original: c.original_title ?? null,
  year: c.year,
  genre: c.genre,
  genres: c.genres ? c.genres.split(',') : [c.genre],
  poster: c.poster,
  backdrop: c.backdrop ?? null,
  overview: c.overview ?? null,
  crowd: c.tmdb_votes > 0 ? { score: c.tmdb_score, votes: c.tmdb_votes } : null,
});

router.get('/genres', (req, res) => {
  res.json({ genres: world(req.query.kind).genres });
});

/* ── a sugestão sai do que o clube gostou ─────────────────────────────────
   As sementes chegam da tela, que sabe quem avaliou o quê e com que nota, e são
   as obras mais bem avaliadas da sala. Para cada uma, o TMDB devolve as vizinhas
   dela; as listas voltam intercaladas em volta, uma de cada semente por vez, e
   não emendadas — emendadas, a primeira semente dominaria os primeiros vinte
   quadros e as outras três só apareceriam quem chegasse ao fim.

   As próprias sementes saem do resultado: o clube já viu aquilo, e é justamente
   por isso que elas estão aqui.

   Uma semente que falha não derruba nada; sem nenhuma sobrando, quem responde é
   a descoberta comum. */
async function likeOf(w, seeds, page, genre) {
  const lists = await Promise.all(
    seeds.map(id => w.like(id, page).then(r => r.results).catch(() => []))
  );
  const out = [];
  const seen = new Set(seeds);
  for (let i = 0; out.length < PER_PAGE * 2; i++) {
    if (lists.every(l => i >= l.length)) break;
    for (const list of lists) {
      const item = list[i];
      if (!item || seen.has(item.id)) continue;
      if (genre && !(item.genres || [item.genre]).includes(genre)) continue;
      seen.add(item.id);
      out.push(item);
    }
  }
  return out;
}

router.get('/', wrap(async (req, res) => {
  const w = world(req.query.kind);
  const page = Number(req.query.page) || 1;
  const genre = req.query.genre;
  /* Gênero desconhecido não é erro: a tela oferece as duas taxonomias e elas não
     são a mesma lista. Cair em "tudo" é a resposta que continua sendo um reel. */
  const known = genre && w.genres.includes(genre);
  const seeds = String(req.query.like || '')
    .split(',')
    .map(Number)
    .filter(n => Number.isInteger(n) && n > 0)
    .slice(0, MAX_SEEDS);

  try {
    const suggested = seeds.length ? await likeOf(w, seeds, page, known ? genre : null) : [];
    /* A descoberta comum entra quando a sugestão não enche a página — e quando
       não há semente nenhuma, que é o clube que ainda não avaliou nada. */
    const data =
      suggested.length >= PER_PAGE
        ? { page, totalPages: null, results: suggested }
        : known
          ? await w.discover(genre, page)
          : await w.popular(page);
    const seen = new Set(suggested.map(r => r.id));
    const results = suggested
      .concat(suggested.length >= PER_PAGE ? [] : data.results.filter(r => !seen.has(r.id)))
      .slice(0, PER_PAGE);
    await w.fillTrailers(results);
    /* Gravado depois do trailer e sem esperar: é conveniência para quando o
       TMDB cair, e ninguém deve ficar olhando para uma tela preta por causa
       dela. */
    for (const r of results) {
      w.remember.run(r.backdrop ?? null, r.overview ?? null, r.id).catch(() => {});
    }
    res.json({
      page,
      /* Sem número quando a página é de sugestão: uma lista montada de quatro
         listas não tem um fim que se saiba de antemão, e chutar um seria a tela
         parar de pedir mais antes da hora. */
      totalPages: data.totalPages ?? page + 1,
      results: results.filter(r => r.trailerKey).map(r => reelDTO(r, w.kind)),
    });
  } catch (e) {
    console.error('[reels] página falhou:', e.message);
    res.status(502).json({ error: 'Não foi possível falar com o TMDB agora.' });
  }
}));

/* ── as que o clube já avaliou ────────────────────────────────────────────
   A tela manda os ids na ordem em que quer, e recebe na mesma ordem: quem
   decide o que vem primeiro no reel é quem sabe quando cada ficha foi escrita.

   O cache responde primeiro e o TMDB só é chamado pelo que falta. A linha de um
   filme avaliado sempre existe, mas nem sempre com o quadro deitado — ele nasceu
   com o reel —, e é por isso que a condição é ter BACKDROP e não existir. */
router.get('/pinned', wrap(async (req, res) => {
  const w = world(req.query.kind);
  const ids = String(req.query.ids || '')
    .split(',')
    .map(Number)
    .filter(n => Number.isInteger(n) && n > 0)
    .slice(0, MAX_PINNED);
  if (!ids.length) return res.json({ results: [] });

  const found = new Map();
  for (const id of ids) {
    try {
      const row = await w.cache.get(id);
      if (row?.backdrop) found.set(id, fromCache(row));
    } catch {
      /* Uma linha ilegível é uma linha ausente: o TMDB responde por ela. */
    }
  }

  await Promise.all(
    ids
      .filter(id => !found.has(id))
      .map(async id => {
        try {
          const full = await w.details(id);
          found.set(id, full);
          w.remember.run(full.backdrop ?? null, full.overview ?? null, id).catch(() => {});
        } catch {
          /* Uma obra que o TMDB não devolveu simplesmente não é fixada. O reel
             continua inteiro sem ela. */
        }
      })
  );

  const results = ids.map(id => found.get(id)).filter(Boolean);
  await w.fillTrailers(results);
  res.json({ results: results.filter(r => r.trailerKey).map(r => reelDTO(r, w.kind)) });
}));

module.exports = router;
