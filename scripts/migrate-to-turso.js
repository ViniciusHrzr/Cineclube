const path = require('node:path');
const fs = require('node:fs');
const { createClient } = require('@libsql/client');

const TABLES = ['reviewers', 'reviews', 'movies_cache', 'watchlist'];
const CHUNK = 100;

async function main() {
  if (!process.env.TURSO_DATABASE_URL) {
    throw new Error('TURSO_DATABASE_URL não está definida — sem destino para copiar.');
  }

  const localPath = process.env.CINECLUBE_DB || path.join(__dirname, '..', 'data', 'cineclube.db');
  if (!fs.existsSync(localPath)) {
    throw new Error(`Banco local não encontrado em ${localPath}`);
  }

  const remote = require('../lib/db');
  await remote.ready;
  console.log('[migrate] esquema conferido no destino');

  const local = createClient({ url: 'file:' + localPath });

  for (const table of TABLES) {
    const { rows } = await local.execute(`SELECT * FROM ${table}`);
    if (!rows.length) {
      console.log(`[migrate] ${table}: vazio, nada a copiar`);
      continue;
    }

    const cols = (await local.execute(`PRAGMA table_info(${table})`)).rows.map(c => c.name);
    const placeholders = cols.map(() => '?').join(', ');
    const sql = `INSERT OR REPLACE INTO ${table} (${cols.join(', ')}) VALUES (${placeholders})`;

    for (let i = 0; i < rows.length; i += CHUNK) {
      const slice = rows.slice(i, i + CHUNK);
      await remote.batch(slice.map(row => ({ sql, args: cols.map(c => row[c] ?? null) })));
    }
    console.log(`[migrate] ${table}: ${rows.length} linha(s) copiada(s)`);
  }

  local.close();
  await remote.close();
  console.log('[migrate] concluído.');
}

main().catch(e => {
  console.error('[migrate] FALHOU:', e.message);
  process.exit(1);
});
