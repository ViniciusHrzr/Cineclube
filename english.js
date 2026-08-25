const db = require('./db');
const tmdb = require('./tmdb');

/* ══════════════════════════════════════════════════════════════════════════
   O nome em inglês de um filme, guardado quando o filme deixa de ser um
   pôster de passagem.

   Três telas filtram uma lista lida do banco — a fila, a sessão e o acervo —
   e nenhuma delas fala com o TMDB para isso. Então o nome pelo qual alguém
   vai procurar o filme precisa estar no banco antes de ser digitado, e para
   Parasita esse nome é `Parasite`: não é o título em português, não é o
   original, e a busca do TMDB, que acha os três, não é consultada aqui.

   TMDB só carrega tradução no endpoint de um filme, nunca numa lista. Uma
   página de catálogo são vinte filmes, e vinte requisições a mais por página
   rolada para preencher uma coluna que a maioria deles nunca vai usar é o
   contrário de um bom negócio — então isto não roda no catálogo. Roda quando
   o filme vira alguma coisa: entra na fila, é avaliado, tem a ficha aberta
   (esse é de graça, a tradução pega carona na requisição que já ia sair).

   Um filme sem nome em inglês próprio deixa a coluna nula e será perguntado
   de novo na próxima vez que alguém o colocar na fila ou avaliar. Isso é uma
   requisição ocasional em troca de não ter uma segunda coluna só para
   registrar "já perguntei" — e as duas ações que disparam isto acontecem
   algumas vezes por filme, não algumas vezes por minuto.
   ══════════════════════════════════════════════════════════════════════════ */

const knownStmt = db.prepare('SELECT english_title FROM movies_cache WHERE tmdb_id = ?');
const saveStmt = db.prepare('UPDATE movies_cache SET english_title = ? WHERE tmdb_id = ?');

/* Nunca lança. Isto é uma conveniência de busca pendurada numa escrita que já
   deu certo: o filme está na fila, a avaliação está gravada, e o TMDB fora do
   ar não pode desfazer nenhuma das duas. */
async function fillEnglishTitle(movieId) {
  try {
    const row = await knownStmt.get(movieId);
    // Sem linha no cache não há onde escrever, e o filme será cacheado inteiro
    // na próxima vez que aparecer numa busca.
    if (!row || row.english_title) return;

    const english = await tmdb.englishTitleFor(movieId);
    if (english) await saveStmt.run(english, movieId);
  } catch (e) {
    console.warn('[english] nome em inglês de', movieId, 'falhou:', e.message);
  }
}

module.exports = { fillEnglishTitle };
