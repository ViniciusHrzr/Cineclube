try { require('node:process').loadEnvFile('.env'); } catch (e) { }

const db = require('../db');

const DRY = process.argv.includes('--dry');

const RENAMES = {
  'Animação': { atuacoes: 'vozes' },
  'Documentário': { arte: 'material', atuacoes: 'acesso', relevancia: 'etica' },
  'Suspense': { atmosfera: 'informacao' }
};

const readStmt = db.prepare('SELECT id, movie_genre, movie_title, scores FROM reviews');
const writeStmt = db.prepare('UPDATE reviews SET scores = ? WHERE id = ?');

function rename(scores, map) {
  const out = {};
  let changed = 0;
  for (const [key, value] of Object.entries(scores)) {
    const to = map[key];
    if (to && !(to in scores)) {
      out[to] = value;
      changed++;
    } else {
      out[key] = value;
    }
  }
  return { out, changed };
}

async function main() {
  await db.ready;

  const target = process.env.TURSO_DATABASE_URL;
  console.log(`[critérios] banco: ${target ? `Turso — ${target}` : 'arquivo local (data/cineclube.db)'}`);
  if (DRY) console.log('[critérios] simulação: nada será escrito');

  const rows = await readStmt.all();
  if (!rows.length) {
    console.log('[critérios] o acervo está vazio — nada a migrar');
    return;
  }

  let touched = 0;
  let skipped = 0;

  for (const row of rows) {
    const map = RENAMES[row.movie_genre];
    if (!map) {
      skipped++;
      continue;
    }

    let scores;
    try {
      scores = JSON.parse(row.scores);
    } catch (e) {
      console.warn(`[critérios] ${row.movie_title}: notas ilegíveis, deixada como está`);
      continue;
    }

    const { out, changed } = rename(scores, map);
    if (!changed) {
      skipped++;
      continue;
    }

    if (!DRY) await writeStmt.run(JSON.stringify(out), row.id);
    touched++;
    const moved = Object.entries(map)
      .filter(([from]) => from in scores)
      .map(([from, to]) => `${from}→${to}`)
      .join(', ');
    console.log(`[critérios] ${DRY ? '(simulado) ' : ''}${row.movie_title} (${row.movie_genre}): ${moved}`);
  }

  console.log(
    DRY
      ? `[critérios] simulação — ${touched} avaliação(ões) seriam migradas, ${skipped} já em dia`
      : `[critérios] pronto — ${touched} avaliação(ões) migrada(s), ${skipped} já em dia`
  );
}

main()
  .then(() => db.close())
  .catch(e => {
    console.error('[critérios] ' + e.message);
    db.close();
    process.exitCode = 1;
  });
