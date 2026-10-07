const fs = require('node:fs');
const path = require('node:path');
const { createClient } = require('@libsql/client');

const CHUNK = 200;

function stamp() {
  const d = new Date();
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

async function main() {
  const url = (process.env.TURSO_DATABASE_URL || '').trim();
  const origem = url
    ? createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN })
    : createClient({
        url: 'file:' + (process.env.CINECLUBE_DB || path.join(__dirname, '..', 'data', 'cineclube.db')),
      });
  console.log(url ? '[backup] lendo o banco do Turso' : '[backup] lendo o banco local');

  const destinoDir = process.env.CINECLUBE_BACKUP_DIR || path.join(__dirname, '..', 'data', 'backups');
  fs.mkdirSync(destinoDir, { recursive: true });
  const destinoPath = path.join(destinoDir, `cineclube-${stamp()}.db`);

  if (fs.existsSync(destinoPath)) fs.rmSync(destinoPath);
  const destino = createClient({ url: 'file:' + destinoPath });

  try {
    const esquema = await origem.execute(
      `SELECT type, name, sql FROM sqlite_master
       WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%'`
    );
    const tabelas = esquema.rows.filter(r => r.type === 'table');
    const resto = esquema.rows.filter(r => r.type !== 'table');

    for (const row of tabelas) await destino.execute(row.sql);

    await destino.execute('PRAGMA foreign_keys = OFF');
    const off = (await destino.execute('PRAGMA foreign_keys')).rows[0];
    if (Number(Object.values(off)[0]) !== 0) {
      throw new Error('não consegui desligar as chaves estrangeiras no arquivo de destino');
    }

    let total = 0;
    for (const { name: tabela } of tabelas) {
      const { rows } = await origem.execute(`SELECT * FROM "${tabela}"`);
      if (!rows.length) {
        console.log(`[backup] ${tabela}: vazia`);
        continue;
      }
      const cols = (await origem.execute(`PRAGMA table_info("${tabela}")`)).rows.map(c => c.name);
      const sql = `INSERT INTO "${tabela}" (${cols.map(c => `"${c}"`).join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`;
      try {
        for (let i = 0; i < rows.length; i += CHUNK) {
          await destino.batch(
            rows.slice(i, i + CHUNK).map(row => ({ sql, args: cols.map(c => row[c] ?? null) }))
          );
        }
      } catch (e) {
        throw new Error(`ao copiar ${tabela}: ${e.message}`);
      }
      total += rows.length;
      console.log(`[backup] ${tabela}: ${rows.length} linha(s)`);
    }

    for (const row of resto) await destino.execute(row.sql);

    for (const { name: tabela } of tabelas) {
      const aqui = (await destino.execute(`SELECT COUNT(*) AS n FROM "${tabela}"`)).rows[0].n;
      const la = (await origem.execute(`SELECT COUNT(*) AS n FROM "${tabela}"`)).rows[0].n;
      if (Number(aqui) !== Number(la)) {
        throw new Error(`${tabela}: copiou ${aqui} de ${la} linha(s) — a cópia está incompleta`);
      }
    }

    await destino.execute('PRAGMA foreign_keys = ON');
    const quebradas = (await destino.execute('PRAGMA foreign_key_check')).rows;
    if (quebradas.length) {
      const onde = [...new Set(quebradas.map(r => Object.values(r)[0]))].join(', ');
      throw new Error(
        `${quebradas.length} referência(s) quebrada(s) na cópia, em: ${onde}`
      );
    }

    const kb = Math.max(1, Math.round(fs.statSync(destinoPath).size / 1024));
    console.log(`\n[backup] pronto: ${destinoPath}`);
    console.log(`[backup] ${tabelas.length} tabela(s), ${total} linha(s), ${kb} KB`);
    console.log('[backup] conferido: contagens batem e nenhuma referência quebrada');
  } finally {
    origem.close();
    destino.close();
  }
}

main().catch(err => {
  console.error('[backup] falhou:', err.message);
  process.exit(1);
});
