const db = require('./db');

/* ══════════════════════════════════════════════════════════════════════════
   O TRAILER DE VINTE OBRAS DE UMA VEZ.

   Gêmeo de providers.js e pelo mesmo motivo: o TMDB só entrega vídeo no
   endpoint de UMA obra, e o reel são vinte por página. Sem este cache, cada
   rolagem custaria vinte requisições, para sempre.

   A diferença entre os dois está no relógio. Um catálogo se move — um filme sai
   da Netflix e a linha guardada vira mentira —, então lá a validade é curta. Um
   trailer não se move: uma vez achado, ele é o mesmo daqui a um ano. O que
   envelhece aqui é a AUSÊNCIA — um filme que ainda não estreou não tem trailer
   hoje e tem no mês que vem —, e é só ela que se repergunta cedo.
   ══════════════════════════════════════════════════════════════════════════ */

/** Um trailer achado. Longo porque a resposta não muda. */
const HIT_TTL = 180;
/** Um "não tem". Curto porque essa é a resposta que vira falsa sozinha. */
const MISS_TTL = 7;
/* Sobe quando o FORMATO do que se guarda muda, invalidando tudo de uma vez. */
const VERSION = 1;
const LANES = 6;

/** Roda `job` sobre `items`, no máximo `lanes` de cada vez. */
async function inLanes(items, lanes, job) {
  const queue = [...items];
  const workers = Array.from({ length: Math.min(lanes, queue.length) }, async () => {
    while (queue.length) await job(queue.shift());
  });
  await Promise.all(workers);
}

const days = iso => (Date.now() - Date.parse(iso.replace(' ', 'T') + 'Z')) / 86400000;

/* `table` é interpolado porque um nome de tabela não pode ser parâmetro
   ligado — e é seguro porque as duas únicas strings que chegam aqui são
   literais escritas nas rotas.

   `fetch` é quem sabe perguntar pela obra daquela tabela: um filme e uma série
   são endpoints diferentes com a mesma resposta, uma chave do YouTube. */
function trailerCache({ table, fetch }) {
  const held = count => db.prepare(`
    SELECT tmdb_id, trailer, trailer_at FROM ${table}
    WHERE tmdb_id IN (${Array.from({ length: count }, () => '?').join(',')})
      AND trailer IS NOT NULL
  `);
  const save = db.prepare(
    `UPDATE ${table} SET trailer = ?, trailer_at = datetime('now') WHERE tmdb_id = ?`
  );

  /** Pendura `trailerKey` em cada resultado. Null é uma resposta. */
  return async function fill(results) {
    if (!results.length) return results;

    const known = new Map();
    try {
      const ids = results.map(r => r.id);
      for (const row of await held(ids.length).all(...ids)) {
        const saved = JSON.parse(row.trailer);
        if (saved?.v !== VERSION) continue;
        const age = row.trailer_at ? days(row.trailer_at) : Infinity;
        if (age > (saved.key ? HIT_TTL : MISS_TTL)) continue;
        known.set(Number(row.tmdb_id), saved.key ?? null);
      }
    } catch (e) {
      // Um cache ilegível é um cache vazio, não um erro.
      console.warn(`[trailers] cache ilegível em ${table}:`, e.message);
    }

    const missing = results.filter(r => !known.has(r.id));
    await inLanes(missing, LANES, async r => {
      try {
        const key = await fetch(r.id);
        known.set(r.id, key);
        /* O nulo é gravado de propósito: sem isso, toda obra sem trailer
           custaria uma requisição a cada rolagem do reel, para sempre. */
        await save.run(JSON.stringify({ v: VERSION, key }), r.id);
      } catch {
        /* Fora de `known`: esta obra fica sem trailer e é perguntada de novo da
           próxima vez. Uma indisponível não pode custar as outras dezenove. */
      }
    });

    for (const r of results) r.trailerKey = known.get(r.id) ?? null;
    return results;
  };
}

module.exports = { trailerCache };
