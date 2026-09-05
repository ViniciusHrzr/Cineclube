/* ══════════════════════════════════════════════════════════════════════════
   UMA CÓPIA DO BANCO, NUM ARQUIVO.

       npm run backup

   Sai em `data/backups/cineclube-AAAA-MM-DD-HHMM.db`, que é um arquivo SQLite
   comum: abre no DB Browser, no `sqlite3`, ou volta para o Turso apontando o
   `migrate:turso` para ele.

   ── por que uma cópia sua, se o Turso tem restauração ─────────────────────
   O plano grátis do Turso restaura para um ponto no tempo dos últimos dias, e
   isso cobre o acidente — um DELETE errado, uma migração que estragou algo.

   Não cobre os dois casos que fazem uma pessoa querer backup: a conta acabar
   (suspensa por limite, encerrada, esquecida) e o serviço mudar de ideia sobre
   o que oferece de graça. Nos dois, a restauração some junto com o banco. Uma
   cópia que mora noutro lugar é a única que sobrevive ao lugar de origem.

   ── o que entra ──────────────────────────────────────────────────────────
   Toda tabela que o banco tiver, descoberta na hora e não escrita numa lista
   aqui. Uma lista fixa envelhece em silêncio: a tabela criada no mês que vem
   não estaria nela, e ninguém descobre isso até precisar dela de volta.

   As sessões vão junto e é de propósito, ainda que não sirvam para nada depois
   de restaurar: um backup que decide o que é importante é um backup que erra.

   ── o que NÃO entra, e é a única exceção ──────────────────────────────────
   Nada. Inclusive os hashes de senha, que são o dado mais sensível aqui — o
   ponto de um backup é poder voltar, e um banco restaurado sem credencial é um
   banco em que ninguém entra. O que isso exige é do lado de fora: o arquivo é
   um segredo, e `data/` já está no .gitignore.
   ══════════════════════════════════════════════════════════════════════════ */

const fs = require('node:fs');
const path = require('node:path');
const { createClient } = require('@libsql/client');

const CHUNK = 200;

/** `2026-09-05-1432`, em hora local, que é a que a pessoa reconhece. */
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

  /* Um arquivo novo a cada vez. Sobrescrever a cópia anterior transformaria o
     backup numa cópia só, e a cópia só é a que já foi estragada quando você
     descobre que precisava dela. */
  if (fs.existsSync(destinoPath)) fs.rmSync(destinoPath);
  const destino = createClient({ url: 'file:' + destinoPath });

  try {
    /* O ESQUEMA vem do banco de origem, e não do db.js. É a diferença entre uma
       cópia e uma reconstrução: com o esquema do código, um backup feito hoje e
       restaurado depois de uma migração traria as tabelas de hoje com os dados
       de ontem. Aqui o arquivo é o que o banco era naquele instante. */
    const esquema = await origem.execute(
      `SELECT type, name, sql FROM sqlite_master
       WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%'`
    );
    const tabelas = esquema.rows.filter(r => r.type === 'table');
    const resto = esquema.rows.filter(r => r.type !== 'table');

    for (const row of tabelas) await destino.execute(row.sql);

    /* ── as chaves ficam desligadas durante a carga ────────────────────────
       Este é o mesmo gesto que o `.dump` do próprio SQLite faz, e ele existe
       por uma razão que só aparece com dados de verdade: as tabelas são
       copiadas na ordem em que foram criadas, e essa ordem não é a das
       dependências. `review_comments` referencia `reviews` e foi criada antes
       dela, então o primeiro comentário copiado bate num FOREIGN KEY.

       Ordenar as tabelas por dependência resolveria isso e não resolveria o
       resto: `review_comments.parent_id` aponta para a PRÓPRIA tabela, e aí a
       ordem teria de valer também entre as linhas — uma resposta não pode
       entrar antes do comentário que ela responde, e um lote de duzentas não
       sabe disso.

       Desligar é correto porque a origem JÁ é consistente: isto é uma cópia, e
       não uma escrita nova. E não é um voto de confiança — a conferência no
       fim liga as chaves de volta e manda o banco verificar cada uma. */
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
        /* Sem o nome da tabela, uma falha de cópia é uma mensagem do SQLite sem
           endereço — e foi exatamente assim que este defeito apareceu. */
        throw new Error(`ao copiar ${tabela}: ${e.message}`);
      }
      total += rows.length;
      console.log(`[backup] ${tabela}: ${rows.length} linha(s)`);
    }

    /* Índices e gatilhos DEPOIS das linhas: um índice construído durante a
       carga é reordenado a cada lote, e construído no fim é uma passada só. Um
       índice único que falhe aqui é sinal de origem inconsistente, e é melhor
       falhar do que gravar um arquivo que esconde isso. */
    for (const row of resto) await destino.execute(row.sql);

    /* ── conferir antes de dizer que deu certo ─────────────────────────────
       Um backup que ninguém abriu é uma esperança, não uma cópia. São duas
       conferências, e cada uma pega uma falha que a outra não vê.

       AS CONTAGENS pegam a tabela que não copiou: é a falha que não levanta
       erro nenhum enquanto se escreve.

       AS CHAVES pegam o preço de tê-las desligado durante a carga. Ligadas de
       volta, `foreign_key_check` percorre o arquivo inteiro e devolve uma linha
       por referência quebrada. Zero linhas é a prova de que desligar não
       escondeu nada — sem isto, a carga sem restrição seria um voto de
       confiança em vez de uma técnica. */
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
