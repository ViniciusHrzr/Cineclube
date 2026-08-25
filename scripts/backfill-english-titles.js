/* ══════════════════════════════════════════════════════════════════════════
   Preenche o nome em inglês dos filmes que já estavam no acervo e na fila.

       npm run backfill:ingles           escreve
       npm run backfill:ingles -- --dry  só mostra o que faria

   Três telas filtram uma lista lida do banco — a fila, a sessão e o acervo — e
   a busca delas casa com qualquer nome do filme. Para Parasita esse nome é
   `Parasite`, que não é o título em português nem o original, e sem ele o
   filme simplesmente não é encontrado numa lista que está na tela.

   De hoje em diante isso se resolve sozinho: o nome em inglês entra quando o
   filme entra na fila, quando é avaliado, e de graça quando alguém abre a
   ficha. O que não se cura sozinho é o que já estava lá — a fila e o acervo
   leem o banco e nunca voltam ao TMDB por conta própria.

   Só olha o que está exposto numa busca: filme avaliado e filme na fila. O
   catálogo não precisa, porque a busca dele é a do próprio TMDB, que já acha
   um filme por qualquer um dos seus nomes.

   Seguro de rodar duas vezes: quem já tem o nome não é consultado. Filme cujo
   nome em inglês é igual ao que já temos fica nulo de propósito — não é falha,
   é o TMDB dizendo que não há um terceiro nome — e será perguntado de novo numa
   próxima rodada, que é o preço de não ter uma coluna só para lembrar disso.
   ══════════════════════════════════════════════════════════════════════════ */

try { require('node:process').loadEnvFile('.env'); } catch (e) { /* env may come from elsewhere */ }

const db = require('../db');
const tmdb = require('../tmdb');

const DRY = process.argv.includes('--dry');

/* Uma quarta de segundo entre filmes, igual aos outros backfills. Isto é tarefa
   de fundo e ninguém está esperando. */
const PAUSE_MS = 250;
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* Todo filme que aparece numa tela que filtra o banco e que ainda não sabe o
   próprio nome em inglês. O INNER JOIN é de propósito, ao contrário do backfill
   das notas: sem linha no cache não há onde escrever a coluna, e esse filme
   ganha a linha inteira na próxima vez que aparecer numa busca. */
const pendingStmt = db.prepare(`
  SELECT DISTINCT id, title FROM (
    SELECT rv.movie_id AS id, mc.title AS title
    FROM reviews rv
    JOIN movies_cache mc ON mc.tmdb_id = rv.movie_id
    WHERE mc.english_title IS NULL

    UNION

    SELECT w.movie_id, mc.title
    FROM watchlist w
    JOIN movies_cache mc ON mc.tmdb_id = w.movie_id
    WHERE mc.english_title IS NULL
  )
  ORDER BY title
`);

const fillStmt = db.prepare('UPDATE movies_cache SET english_title = ? WHERE tmdb_id = ?');

async function main() {
  await db.ready;

  const target = process.env.TURSO_DATABASE_URL;
  console.log(`[ingles] banco: ${target ? `Turso — ${target}` : 'arquivo local (data/cineclube.db)'}`);
  if (DRY) console.log('[ingles] simulação: nada será escrito');

  const films = await pendingStmt.all();
  if (!films.length) {
    console.log('[ingles] nada pendente — todo filme do acervo e da fila já foi consultado');
    return;
  }
  console.log(`[ingles] ${films.length} filme(s) sem nome em inglês; consultando`);

  let filled = 0;
  let same = 0;
  let failed = 0;

  for (const film of films) {
    try {
      const english = await tmdb.englishTitleFor(film.id);
      if (!english) {
        /* O nome em inglês é o título que já temos, ou o original, ou o TMDB
           não tem tradução para o inglês. Nos três casos não há terceiro nome
           para procurar, e a coluna fica nula. */
        same++;
        console.log(`[ingles] ${film.title}: sem um nome em inglês diferente dos que já temos`);
      } else {
        if (!DRY) await fillStmt.run(english, film.id);
        filled++;
        console.log(`[ingles] ${DRY ? '(simulado) ' : ''}${film.title}: ${english}`);
      }
    } catch (e) {
      /* Um filme inalcançável não é motivo para abandonar o resto; a próxima
         rodada pega, porque nada foi escrito para ele. */
      failed++;
      console.warn(`[ingles] ${film.title} (${film.id}) falhou: ${e.message}`);
    }
    await sleep(PAUSE_MS);
  }

  console.log(
    `[ingles] ${DRY ? 'simulação' : 'pronto'} — ${filled} ${DRY ? 'seriam preenchidos' : 'preenchido(s)'}, ` +
    `${same} sem nome próprio em inglês, ${failed} com falha`
  );
}

main()
  .then(() => db.close())
  .catch(e => {
    console.error('[ingles] ' + e.message);
    db.close();
    process.exitCode = 1;
  });
