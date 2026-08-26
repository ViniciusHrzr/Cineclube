/* ══════════════════════════════════════════════════════════════════════════
   Recalcula a nota gravada de cada avaliação com a fórmula atual.

       npm run recalcular:notas           escreve
       npm run recalcular:notas -- --dry  só mostra o que faria

   Em 25/08/2026 os pesos ficaram todos iguais: o que era oito critérios ×1 mais
   dois ×2 dividido por 12 virou a média simples do que a ficha responde. Isso
   muda a nota de toda avaliação em que os dois critérios do gênero não estavam
   exatamente na média das outras — ou seja, praticamente todas.

   O que não se cura sozinho é a coluna `final` no banco. Ela foi gravada com a
   fórmula da época, e é ela que a média do clube e a aba "melhores do clube"
   somam. Sem isto o clube vê o detalhamento com pesos iguais e a nota ao lado
   vinda de outra conta.

   ── o que este script não faz ───────────────────────────────────────────
   Não inventa Aproveitamento para quem não respondeu. Uma avaliação anterior a
   esta data tem dez marcas, e finalOf divide pelo que a ficha responde: dez
   ali, onze numa nova. As duas continuam sendo médias na mesma escala de 0 a
   10, e ninguém leva um tombo de um ponto por uma pergunta que não existia.

   Seguro de rodar duas vezes: recalcular uma nota já correta escreve o mesmo
   número, e o script conta quantas de fato mudaram.
   ══════════════════════════════════════════════════════════════════════════ */

try { require('node:process').loadEnvFile('.env'); } catch (e) { /* env may come from elsewhere */ }

const db = require('../db');
const { finalOf, GENRES } = require('../criteria');

const DRY = process.argv.includes('--dry');

/* Duas casas: `final` é um REAL e a diferença que interessa é a que aparece na
   tela, que mostra uma casa decimal. */
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
      /* Uma avaliação com scores ilegíveis não tem nota para recalcular, e
         apagar ou zerar a que está lá seria pior do que deixá-la. */
      broken++;
      console.warn(`[notas] ${row.movie_title} (${row.reviewer_name}): scores ilegíveis, deixado como está`);
      continue;
    }

    // Um gênero que saiu da taxonomia cai em Drama, que é o mesmo que critsFor
    // faz — a conta tem que ser a mesma que o servidor faria hoje.
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
    // Numa transação só: ou o acervo inteiro passa para a fórmula nova ou nada
    // passa. Metade do acervo numa conta e metade em outra é o estado que este
    // script existe para não deixar acontecer.
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
