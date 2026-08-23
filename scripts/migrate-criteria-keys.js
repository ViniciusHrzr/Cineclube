/* ══════════════════════════════════════════════════════════════════════════
   Renomeia as chaves de critério guardadas nas avaliações antigas.

   A nota de uma avaliação é gravada como um objeto JSON chaveado pelos
   critérios que existiam no dia em que ela foi dada. Quando um gênero troca uma
   pergunta por outra — "Atuações" por "Vozes" numa animação — a chave muda, e
   sem esta migração toda avaliação anterior perde aquele critério: ele passa a
   ler zero na abertura da nota, porque a chave nova não existe no registro.

   Rode a partir do diretório app/:

       npm run migrate:criterios

   ── por que isto não mexe na nota final ─────────────────────────────────
   Toda troca abaixo cai num slot do mesmo peso: um critério ×1 vira outro ×1,
   um ×2 vira outro ×2. Renomear a chave preserva a soma exatamente, então a
   coluna `final` continua correta e não é tocada. Se alguma troca futura mudar
   de peso, isto aqui deixa de bastar e a nota precisa ser recalculada.

   É idempotente: uma chave já renomeada não é encontrada de novo, e uma linha
   em que nada mudou não é reescrita. Rodar duas vezes não faz nada na segunda.

   Com --dry não escreve nada: lê o acervo, imprime exatamente o que faria e
   sai. Existe por causa do banco de produção, que fica atrás de uma URL e um
   token de ambiente — quando o alvo é o clube inteiro e não este notebook, a
   primeira rodada deve ser a que não pode dar errado.
   ══════════════════════════════════════════════════════════════════════════ */

try { require('node:process').loadEnvFile('.env'); } catch (e) { /* env may come from elsewhere */ }

const db = require('../db');

const DRY = process.argv.includes('--dry');

/* ── o que virou o quê ────────────────────────────────────────────────────
   Por gênero, porque uma chave só muda dentro do gênero que a trocou:
   `atuacoes` continua sendo `atuacoes` num drama e vira `vozes` numa animação,
   e uma renomeação cega trocaria as duas.

   Esta tabela é o par de criteria.js. O teste
   "the keys a genre introduces are the ones the migration knows about" existe
   para que uma troca nova lá sem uma linha nova aqui quebre em vez de passar. */
const RENAMES = {
  'Animação': { atuacoes: 'vozes' },
  'Documentário': { arte: 'material', atuacoes: 'acesso', relevancia: 'etica' },
  'Suspense': { atmosfera: 'informacao' }
};

const readStmt = db.prepare('SELECT id, movie_genre, movie_title, scores FROM reviews');
const writeStmt = db.prepare('UPDATE reviews SET scores = ? WHERE id = ?');

/* Rebuilt key by key rather than deleted-and-set, so the criteria keep the
   order they were written in. Nothing depends on that order — the card is built
   from criteria.js — but a diff of the archive is worth being able to read. */
function rename(scores, map) {
  const out = {};
  let changed = 0;
  for (const [key, value] of Object.entries(scores)) {
    const to = map[key];
    /* Only when the new key is not already there: a row half-migrated by an
       interrupted run would otherwise have the old value overwrite the new. */
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

  /* Which database this is about to touch, said before anything happens. The
     script reads the same env the server does, so running it with the
     production variables unset is not an error — it quietly migrates the copy
     on this machine instead, which looks exactly like success. */
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
      /* A row whose JSON does not parse is a row this script must not rewrite:
         whatever is wrong with it, guessing is worse. */
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
