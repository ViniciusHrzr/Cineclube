/* ══════════════════════════════════════════════════════════════════════════
   Dá dono aos filmes que já estavam na fila.

       npm run backfill:fila -- --quem Leonardo --dry   só mostra o que faria
       npm run backfill:fila -- --quem Leonardo         escreve
       npm run backfill:fila -- --quem Leonardo --todos também reescreve os
                                                       que já têm dono

   `added_by` nasceu para o feed ter o que contar — "alguém pôs Fréamhacha na
   fila" não é acontecimento, é boletim — e por isso a coluna só passou a ser
   preenchida no dia em que apareceu. Tudo o que entrou na fila antes disso
   ficou sem autor, e enquanto a fila não mostrava autoria isso não custava
   nada: uma linha a menos no mural.

   Agora custa. A fila separa os filmes por quem escolheu, e um acervo em que
   metade dos pôsteres não tem retrato no canto não parece uma fila com
   histórico — parece uma fila quebrada.

   Por padrão só toca em quem está sem dono. Uma linha que já sabe de quem é
   está certa, e uma migração que sobrescreve o certo pelo provável é uma
   migração que apaga informação; `--todos` existe para o caso em que quem está
   rodando sabe que a fila inteira é de uma pessoa só, e diz isso explicitamente.

   Seguro de rodar duas vezes: depois da primeira não sobra nada sem dono.
   ══════════════════════════════════════════════════════════════════════════ */

try { require('node:process').loadEnvFile('.env'); } catch (e) { /* env may come from elsewhere */ }

const db = require('../db');

const DRY = process.argv.includes('--dry');
const ALL = process.argv.includes('--todos');

function argOf(flag) {
  const at = process.argv.indexOf(flag);
  return at >= 0 ? process.argv[at + 1] : null;
}

const WHO = argOf('--quem');

/* Pelo nome, e não pelo id: quem roda isto está lendo a tela do clube, onde
   ninguém tem id. COLLATE NOCASE porque a diferença entre "Leonardo" e
   "leonardo" não é uma diferença sobre a qual valha a pena errar. */
const byNameStmt = db.prepare('SELECT id, name FROM reviewers WHERE name = ? COLLATE NOCASE');
const countsStmt = db.prepare(`
  SELECT COALESCE(w.added_by, '—') AS owner, r.name AS name, COUNT(*) AS n
  FROM watchlist w
  LEFT JOIN reviewers r ON r.id = w.added_by
  GROUP BY w.added_by
  ORDER BY n DESC
`);
const fillStmt = db.prepare('UPDATE watchlist SET added_by = ? WHERE added_by IS NULL');
const fillAllStmt = db.prepare('UPDATE watchlist SET added_by = ?');
const totalStmt = db.prepare('SELECT COUNT(*) AS n FROM watchlist');

async function main() {
  await db.ready;

  if (!WHO) {
    console.error('Falta dizer de quem é a fila: --quem "Nome"');
    process.exitCode = 1;
    return;
  }

  const person = await byNameStmt.get(WHO);
  if (!person) {
    console.error(`Ninguém no clube se chama "${WHO}".`);
    process.exitCode = 1;
    return;
  }

  const { n: total } = await totalStmt.get();
  const rows = await countsStmt.all();

  console.log(`Fila do clube: ${total} ${total === 1 ? 'filme' : 'filmes'}`);
  for (const row of rows) {
    const label = row.name || (row.owner === '—' ? 'sem dono' : `id órfão ${row.owner}`);
    console.log(`  ${String(row.n).padStart(3)}  ${label}`);
  }

  const orphans = rows.find(r => r.owner === '—')?.n ?? 0;
  const target = ALL ? total : orphans;
  if (!target) {
    console.log('Nada a fazer.');
    return;
  }

  console.log(
    `\n${DRY ? 'Marcaria' : 'Marcando'} ${target} ${target === 1 ? 'filme' : 'filmes'} como escolha de ${person.name}` +
      (ALL ? ' (inclusive os que já tinham dono).' : ' (só os que estavam sem dono).')
  );
  if (DRY) return;

  await (ALL ? fillAllStmt : fillStmt).run(person.id);
  console.log('Pronto.');
}

main().then(
  () => db.close(),
  err => {
    console.error(err);
    db.close();
    process.exitCode = 1;
  }
);
