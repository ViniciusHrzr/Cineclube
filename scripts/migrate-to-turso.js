/* ══════════════════════════════════════════════════════════════════════════
   Copies the local SQLite file into a Turso database, once, before the first
   deploy. Run it from the app directory with the destination in the
   environment:

       $env:TURSO_DATABASE_URL="libsql://..."; $env:TURSO_AUTH_TOKEN="..."
       npm run migrate:turso

   It is safe to run twice: every row is written with INSERT OR REPLACE, so a
   second pass overwrites rather than duplicates. Sessions are deliberately
   left behind — everyone simply signs in again.
   ══════════════════════════════════════════════════════════════════════════ */

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

  // Requiring the app's db.js with TURSO_DATABASE_URL set points it at the
  // remote database, and its ready promise is the schema. The destination is
  // therefore built by exactly the same code that builds it in production.
  const remote = require('../db');
  await remote.ready;
  console.log('[migrate] esquema conferido no destino');

  const local = createClient({ url: 'file:' + localPath });

  for (const table of TABLES) {
    const { rows } = await local.execute(`SELECT * FROM ${table}`);
    if (!rows.length) {
      console.log(`[migrate] ${table}: vazio, nada a copiar`);
      continue;
    }

    // Take the column list from the local table rather than hardcoding it, so
    // this keeps working when the schema gains a column.
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
