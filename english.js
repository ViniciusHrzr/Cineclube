const db = require('./db');
const tmdb = require('./tmdb');

/* O TMDB só carrega tradução no endpoint de UM filme, nunca numa lista: por
   isso isto não roda no catálogo (vinte filmes = vinte requisições a mais por
   página rolada). Roda quando o filme vira alguma coisa — entra na fila, é
   avaliado, tem a ficha aberta.

   Filme sem nome em inglês próprio deixa a coluna nula e é perguntado de novo
   na próxima. É de propósito: a alternativa era uma segunda coluna só para
   registrar "já perguntei". */

const knownStmt = db.prepare('SELECT english_title FROM movies_cache WHERE tmdb_id = ?');
const saveStmt = db.prepare('UPDATE movies_cache SET english_title = ? WHERE tmdb_id = ?');

/* Nunca lança: é conveniência de busca pendurada numa escrita que já deu
   certo, e o TMDB fora do ar não pode desfazer a escrita. */
async function fillEnglishTitle(movieId) {
  try {
    const row = await knownStmt.get(movieId);
    // Sem linha no cache não há onde escrever; o filme é cacheado inteiro na
    // próxima vez que aparecer numa busca.
    // na próxima vez que aparecer numa busca.
    if (!row || row.english_title) return;

    const english = await tmdb.englishTitleFor(movieId);
    if (english) await saveStmt.run(english, movieId);
  } catch (e) {
    console.warn('[english] nome em inglês de', movieId, 'falhou:', e.message);
  }
}

module.exports = { fillEnglishTitle };
