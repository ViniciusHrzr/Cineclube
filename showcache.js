const db = require('./db');

/* ══════════════════════════════════════════════════════════════════════════
   O QUE O TMDB DISSE DE UMA SÉRIE, GUARDADO.

   Duas rotas escrevem nas mesmas duas tabelas: a do catálogo, quando alguém
   abre uma série, e a de "o que eu vejo a seguir", que precisa saber quantos
   episódios existem sem perguntar de novo a cada carga da lista. Estava só na
   primeira, e a segunda ia nascer com uma cópia do mesmo INSERT.

   Gravar nunca derruba quem pediu: o cache é conveniência, e a resposta que o
   TMDB deu já está na mão de quem perguntou. O erro para aqui.
   ══════════════════════════════════════════════════════════════════════════ */

const upsertShow = db.prepare(`
  INSERT INTO shows_cache
    (tmdb_id, title, original_title, english_title, year, genre, genres, poster,
     backdrop, overview, status, seasons, episodes, runtime, tmdb_score, tmdb_votes, cached_at)
  VALUES
    (@id, @title, @original, @english, @year, @genre, @genres, @poster,
     @backdrop, @overview, @status, @seasons, @episodes, @runtime, @score, @votes, datetime('now'))
  ON CONFLICT(tmdb_id) DO UPDATE SET
    title = excluded.title, year = excluded.year, genre = excluded.genre,
    genres = excluded.genres, poster = excluded.poster,
    backdrop = COALESCE(excluded.backdrop, shows_cache.backdrop),
    overview = COALESCE(excluded.overview, shows_cache.overview),
    original_title = excluded.original_title,
    -- COALESCE nos campos que só o detalhe carrega: uma página de busca
    -- escrevendo por cima desta linha não sabe nada sobre eles, e não pode
    -- apagar o que uma abertura de série já descobriu.
    english_title = COALESCE(excluded.english_title, shows_cache.english_title),
    status = COALESCE(excluded.status, shows_cache.status),
    seasons = COALESCE(excluded.seasons, shows_cache.seasons),
    episodes = COALESCE(excluded.episodes, shows_cache.episodes),
    runtime = COALESCE(excluded.runtime, shows_cache.runtime),
    tmdb_score = COALESCE(excluded.tmdb_score, shows_cache.tmdb_score),
    tmdb_votes = COALESCE(excluded.tmdb_votes, shows_cache.tmdb_votes),
    cached_at = excluded.cached_at
`);

async function cacheShow(s) {
  try {
    await upsertShow.run({
      id: s.id, title: s.title, original: s.original ?? null, english: s.english ?? null,
      year: s.year ?? null, genre: s.genre, genres: (s.genres || [s.genre]).join(','),
      poster: s.poster ?? null, backdrop: s.backdrop ?? null,
      overview: s.overview ?? null, status: s.status ?? null,
      seasons: s.seasons ? s.seasons.length : null,
      episodes: s.totalEpisodes ?? null, runtime: s.runtime ?? null,
      score: s.crowd?.score ?? null, votes: s.crowd?.votes ?? null,
    });
  } catch (e) {
    console.warn('[series] falha ao cachear série', s.id, e.message);
  }
}

async function cacheEpisodes(showId, episodes) {
  try {
    if (!episodes.length) return;
    await db.batch(episodes.map(e => ({
      sql: `INSERT INTO episodes_cache
              (show_id, season, episode, title, overview, still, air_date, runtime, kind, cached_at)
            VALUES (?,?,?,?,?,?,?,?,?, datetime('now'))
            ON CONFLICT(show_id, season, episode) DO UPDATE SET
              title = excluded.title, overview = excluded.overview,
              still = excluded.still, air_date = excluded.air_date,
              runtime = excluded.runtime, kind = excluded.kind,
              cached_at = excluded.cached_at`,
      args: [showId, e.season, e.episode, e.title, e.overview ?? null, e.still ?? null,
             e.airDate ?? null, e.runtime ?? null, e.kind ?? null],
    })));
  } catch (e) {
    console.warn('[series] falha ao cachear episódios de', showId, e.message);
  }
}

module.exports = { cacheShow, cacheEpisodes };
