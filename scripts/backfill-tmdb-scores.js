/* ══════════════════════════════════════════════════════════════════════════
   Preenche a nota do TMDB dos filmes que já estavam no acervo.

       npm run backfill:notas          escreve
       npm run backfill:notas -- --dry  só mostra o que faria

   A nota do TMDB entra no cache do filme sozinha, de qualquer busca ou de
   qualquer ficha aberta — todo endpoint de lista carrega vote_average. Então
   todo filme avaliado de hoje em diante já chega com ela.

   O que não se cura sozinho é o que já estava lá. Um filme avaliado antes das
   colunas existirem só ganha a nota quando alguém buscar por ele de novo, e a
   aba de avaliados nunca faz isso: ela lê o banco e pronto. O resultado é o
   acervo com algumas notas do TMDB e outras não, sem nenhum motivo visível para
   a diferença — que é exatamente como isso apareceu.

   Só olha o que está exposto: filme avaliado e filme na fila. O catálogo se
   cura sozinho na próxima busca e não precisa de ajuda.

   Seguro de rodar duas vezes: quem já tem nota não é consultado, e a escrita é
   um COALESCE que nunca apaga o que encontrar.
   ══════════════════════════════════════════════════════════════════════════ */

try { require('node:process').loadEnvFile('.env'); } catch (e) { /* env may come from elsewhere */ }

const db = require('../db');
const tmdb = require('../tmdb');

const DRY = process.argv.includes('--dry');

/* Uma quarta de segundo entre filmes. Isto é tarefa de fundo e ninguém está
   esperando; o TMDB aguenta muito mais, mas não há por que descobrir o teto. */
const PAUSE_MS = 250;
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* Todo filme que aparece numa tela lida do banco e que ninguém sabe a nota.
   O LEFT JOIN é o que pega também o caso raro do filme avaliado que nunca
   entrou no cache — a linha não existe, mc.tmdb_score vem nula, e o upsert
   abaixo cria. */
const pendingStmt = db.prepare(`
  SELECT DISTINCT id, title FROM (
    SELECT rv.movie_id AS id, rv.movie_title AS title, rv.movie_year AS year,
           rv.movie_genre AS genre, rv.movie_poster AS poster
    FROM reviews rv
    LEFT JOIN movies_cache mc ON mc.tmdb_id = rv.movie_id
    WHERE mc.tmdb_score IS NULL

    UNION

    SELECT w.movie_id, w.movie_title, w.movie_year, w.movie_genre, w.movie_poster
    FROM watchlist w
    LEFT JOIN movies_cache mc ON mc.tmdb_id = w.movie_id
    WHERE mc.tmdb_score IS NULL
  )
  ORDER BY title
`);

/* O filme quase sempre já está no cache e só faltava a nota, mas o INSERT existe
   para o caso em que não está. Os campos que não vieram do TMDB nesta chamada
   ficam com COALESCE para nunca apagarem o que já havia. */
const fillStmt = db.prepare(`
  INSERT INTO movies_cache (tmdb_id, title, year, genre, poster, director, runtime, tmdb_score, tmdb_votes, cached_at)
  VALUES (@id, @title, @year, @genre, @poster, @director, @runtime, @score, @votes, datetime('now'))
  ON CONFLICT(tmdb_id) DO UPDATE SET
    tmdb_score = COALESCE(excluded.tmdb_score, movies_cache.tmdb_score),
    tmdb_votes = COALESCE(excluded.tmdb_votes, movies_cache.tmdb_votes),
    runtime = COALESCE(movies_cache.runtime, excluded.runtime)
`);

async function main() {
  await db.ready;

  const target = process.env.TURSO_DATABASE_URL;
  console.log(`[notas] banco: ${target ? `Turso — ${target}` : 'arquivo local (data/cineclube.db)'}`);
  if (DRY) console.log('[notas] simulação: nada será escrito');

  const films = await pendingStmt.all();
  if (!films.length) {
    console.log('[notas] nada pendente — todo filme do acervo e da fila já tem a nota do TMDB');
    return;
  }
  console.log(`[notas] ${films.length} filme(s) sem a nota do TMDB; consultando`);

  let filled = 0;
  let missing = 0;
  let failed = 0;

  for (const film of films) {
    try {
      const m = await tmdb.movieDetails(film.id);
      if (!m.crowd) {
        /* Filme sem voto nenhum no TMDB. Não é falha e não vira zero: a coluna
           fica nula, que é como o cliente lê "ninguém votou". */
        missing++;
        console.log(`[notas] ${film.title}: ninguém votou neste filme no TMDB`);
      } else {
        if (!DRY) {
          await fillStmt.run({
            id: m.id, title: m.title, year: m.year ?? null, genre: m.genre,
            poster: m.poster ?? null, director: m.director ?? null, runtime: m.runtime ?? null,
            score: m.crowd.score, votes: m.crowd.votes
          });
        }
        filled++;
        console.log(`[notas] ${DRY ? '(simulado) ' : ''}${film.title}: ${m.crowd.score} de ${m.crowd.votes} votos`);
      }
    } catch (e) {
      /* Um filme inalcançável não é motivo para abandonar o resto; a próxima
         rodada pega, porque nada foi escrito para ele. */
      failed++;
      console.warn(`[notas] ${film.title} (${film.id}) falhou: ${e.message}`);
    }
    await sleep(PAUSE_MS);
  }

  console.log(
    `[notas] ${DRY ? 'simulação' : 'pronto'} — ${filled} ${DRY ? 'seriam preenchidos' : 'preenchido(s)'}, ` +
    `${missing} sem voto no TMDB, ${failed} com falha`
  );
}

main()
  .then(() => db.close())
  .catch(e => {
    console.error('[notas] ' + e.message);
    db.close();
    process.exitCode = 1;
  });
