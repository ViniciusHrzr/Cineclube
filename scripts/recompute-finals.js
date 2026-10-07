try { require('node:process').loadEnvFile('.env'); } catch (e) { }

const db = require('../db');
const { finalOf, GENRES } = require('../criteria');

const DRY = process.argv.includes('--dry');

const round = n => Math.round(n * 100) / 100;
const fmt = n => n.toFixed(2).replace('.', ',');

const allStmt = db.prepare(`
  SELECT rv.id, rv.movie_title, rv.movie_genre, rv.scores, rv.final, r.name AS reviewer_name
  FROM reviews rv
  JOIN reviewers r ON r.id = rv.reviewer_id
  ORDER BY rv.date DESC, rv.movie_title
`);
const UPDATE = 'UPDATE reviews SET final = ? WHERE id = ?';

async function main() {
  await db.ready;

  const target = process.env.TURSO_DATABASE_URL;
  console.log(`[notas] banco: ${target ? `Turso — ${target}` : 'arquivo local (data/cineclube.db)'}`);
  if (DRY) console.log('[notas] simulação: nada será escrito');

  const rows = await allStmt.all();
  if (!rows.length) {
    console.log('[notas] o acervo está vazio — nada a recalcular');
    return;
  }

  const writes = [];
  let unchanged = 0;
  let broken = 0;

  for (const row of rows) {
    let scores;
    try {
      scores = JSON.parse(row.scores);
    } catch (e) {
      broken++;
      console.warn(`[notas] ${row.movie_title} (${row.reviewer_name}): scores ilegíveis, deixado como está`);
      continue;
    }

    const genre = GENRES.includes(row.movie_genre) ? row.movie_genre : 'Drama';
    const next = round(finalOf(genre, scores));
    const before = round(Number(row.final));
    const answered = Object.keys(scores).length;

    if (next === before) {
      unchanged++;
      continue;
    }

    writes.push({ sql: UPDATE, args: [next, row.id] });
    const arrow = next > before ? '↑' : '↓';
    console.log(
      `[notas] ${row.movie_title} (${row.reviewer_name}): ` +
      `${fmt(before)} → ${fmt(next)} ${arrow}  · ${answered} critérios`
    );
  }

  if (writes.length && !DRY) {
    await db.batch(writes);
  }

  console.log(
    `[notas] ${DRY ? 'simulação' : 'pronto'} — ${rows.length} avaliação(ões), ` +
    `${writes.length} ${DRY ? 'mudariam' : 'recalculada(s)'}, ${unchanged} já corretas` +
    (broken ? `, ${broken} ilegível(is)` : '')
  );
}

main()
  .then(() => db.close())
  .catch(e => {
    console.error('[notas] ' + e.message);
    db.close();
    process.exitCode = 1;
  });
