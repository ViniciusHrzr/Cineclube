const db = require('../lib/db');
const tmdb = require('./tmdb');

const knownStmt = db.prepare('SELECT english_title FROM movies_cache WHERE tmdb_id = ?');
const saveStmt = db.prepare('UPDATE movies_cache SET english_title = ? WHERE tmdb_id = ?');

async function fillEnglishTitle(movieId) {
  try {
    const row = await knownStmt.get(movieId);
    if (!row || row.english_title) return;

    const english = await tmdb.englishTitleFor(movieId);
    if (english) await saveStmt.run(english, movieId);
  } catch (e) {
    console.warn('[english] nome em inglês de', movieId, 'falhou:', e.message);
  }
}

module.exports = { fillEnglishTitle };
