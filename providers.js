const db = require('./db');
const justwatch = require('./justwatch');

/* ══════════════════════════════════════════════════════════════════════════
   ONDE ISTO ESTÁ PASSANDO, EM GRADE.

   As rotas de lista não carregam provedor — só a do detalhe carrega —, então
   uma página de vinte cartazes são vinte requisições ao TMDB na primeira vez
   que ela é vista. Isto é o cache que faz a segunda vez custar zero, e é o
   mesmo mecanismo para filme, para série e para a lista que o clube acompanha.

   Um módulo e não uma cópia por rota: eram duas, idênticas exceto pela tabela,
   e a terceira ia nascer igual. As regras que elas repetiam são estas, e cada
   uma é um jeito diferente de isto ter dado errado:

   · Nunca derruba a página. Uma obra cujos provedores não vieram fica sem
     nenhum, que é o que o cartão já desenha para o que não passa em lugar
     nenhum.
   · Nunca segura o lote inteiro: as buscas correm com um teto de quantas estão
     no ar, e a rota segue de qualquer jeito.
   · Nunca serve uma resposta velha como nova — "está na Netflix" errado é pior
     do que ausente —, e por isso a linha guarda QUANDO foi perguntada.
   ══════════════════════════════════════════════════════════════════════════ */

/* Longo o bastante para o clube não pagar pela mesma obra duas vezes numa
   noite, curto o bastante para uma saída de catálogo estar errada por dias e
   não para sempre. */
const TTL = '-7 days';
/* Quantas requisições ficam no ar de uma vez. O TMDB aguenta muito mais, mas
   isto roda numa instância pequena e uma página de catálogo não vale vinte
   sockets simultâneos. */
const LANES = 6;

/** Roda `job` sobre `items`, no máximo `lanes` de cada vez. */
async function inLanes(items, lanes, job) {
  const queue = [...items];
  const workers = Array.from({ length: Math.min(lanes, queue.length) }, async () => {
    while (queue.length) await job(queue.shift());
  });
  await Promise.all(workers);
}

/* `table` é interpolado porque um nome de tabela não pode ser parâmetro
   ligado — e é seguro porque as duas únicas strings que chegam aqui são
   literais escritas nas rotas, nunca nada que veio de fora.

   `fetch` é quem sabe perguntar ao TMDB pela obra daquela tabela: um filme e
   uma série são endpoints diferentes com a mesma resposta. */
/* ── e o endereço de cada um ──────────────────────────────────────────────
   O TMDB diz QUAIS serviços têm o título; o link de abrir o título DENTRO de
   cada um vem do JustWatch e é pendurado aqui, no mesmo momento em que a linha
   é gravada. É o que faz o atalho custar zero requisição depois: ele viaja no
   mesmo cache de sete dias que os provedores.

   Falhar não é falhar: sem link fundo o provedor fica com `url: null` e a tela
   cai na busca do serviço, que é o que ela fazia antes de isto existir. */
async function withDeepLinks(watch, { id, title, kind }) {
  if (!watch?.streaming?.length) return watch;
  const links = await justwatch.deepLinks({ tmdbId: id, title, kind });
  if (!links.size) return watch;
  return {
    ...watch,
    streaming: watch.streaming.map(p => ({ ...p, url: justwatch.urlFor(links, p.name) })),
  };
}

function providerCache({ table, fetch, kind }) {
  /* Montado por chamada porque o número de ids varia, o que só é possível
     porque `db.prepare` aqui guarda uma string — nada é compilado antes de a
     consulta rodar. Os ids continuam sendo parâmetros; o que se interpola é
     quantas interrogações existem. */
  const fresh = count => db.prepare(`
    SELECT tmdb_id, providers FROM ${table}
    WHERE tmdb_id IN (${Array.from({ length: count }, () => '?').join(',')})
      AND providers IS NOT NULL
      AND providers_at > datetime('now', '${TTL}')
  `);
  const save = db.prepare(
    `UPDATE ${table} SET providers = ?, providers_at = datetime('now') WHERE tmdb_id = ?`
  );

  /** Pendura `watch` em cada resultado, do cache quando ele está fresco. */
  return async function fill(results) {
    if (!results.length) return results;

    const known = new Map();
    try {
      const ids = results.map(r => r.id);
      // Espalhado, e não o array: um argumento só seria lido como UM parâmetro
      // posicional em vez de como a lista deles.
      for (const row of await fresh(ids.length).all(...ids)) {
        known.set(Number(row.tmdb_id), JSON.parse(row.providers));
      }
    } catch (e) {
      // Um cache ilegível é um cache vazio, não um erro.
      console.warn(`[providers] cache ilegível em ${table}:`, e.message);
    }

    const missing = results.filter(r => !known.has(r.id));
    await inLanes(missing, LANES, async r => {
      try {
        const watch = await withDeepLinks(await fetch(r.id), { ...r, kind });
        known.set(r.id, watch);
        /* O nulo é gravado também, de propósito: "não passa em lugar nenhum
           aqui" é uma resposta, e não escrevê-la faria toda obra que não passa
           custar uma requisição a cada abertura de página, para sempre. */
        await save.run(JSON.stringify(watch), r.id);
      } catch {
        /* Fora de `known`: esta obra não mostra nada e é perguntada de novo da
           próxima vez. Uma indisponível não pode custar as outras dezenove. */
      }
    });

    for (const r of results) r.watch = known.get(r.id) ?? null;
    return results;
  };
}

module.exports = { providerCache };
