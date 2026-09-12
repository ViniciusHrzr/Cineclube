const db = require('./db');

/* ══════════════════════════════════════════════════════════════════════════
   O QUE ESTREIA HOJE, NAS SÉRIES QUE VOCÊ ACOMPANHA.

   Num módulo só porque a resposta é lida de dois lugares — o sino, que desenha
   a linha quando o app está aberto, e o aviso da noite, que alcança quem está
   com ele fechado. Duas cópias desta conta divergiriam, e no dia em que
   divergissem uma pessoa receberia um aviso sobre um episódio que a tela não
   mostra.

   Vale para as séries que VOCÊ acompanha — `added_by` é você —, porque
   acompanhar é de cada um e um aviso de estreia só serve a quem está esperando
   por ela.

   ── duas fontes, e a segunda cobre o ponto cego da primeira ─────────────
   · `episodes_cache` sabe a temporada inteira, datas futuras inclusive, e é
     enchida pelo "o que eu vejo a seguir" toda vez que a lista é aberta. É a
     fonte que acerta a semana seguinte sem ninguém abrir a série.
   · `shows_cache.shape` guarda o próximo a estrear que o TMDB anuncia, e
     alcança a série cuja temporada ainda não foi listada — uma que volta depois
     de dois anos, por exemplo.

   O dia é o de BRASÍLIA e não o do servidor: um aviso de estreia que aparece às
   21h de ontem está falando de amanhã para quem lê. Sem horário de verão desde
   2019, três horas é uma conta e não uma tabela.

   Ver upnext.js, que é quem mantém as duas caches frescas.
   ══════════════════════════════════════════════════════════════════════════ */

const AGORA_BR = "datetime('now', '-3 hours')";

const listadoNoClube = db.prepare(`
  SELECT q.show_id, q.show_title, q.show_poster,
         e.season, e.episode, e.title AS episode_title, e.air_date
  FROM show_queue q
  JOIN episodes_cache e ON e.show_id = q.show_id
  WHERE q.club_id = ? AND q.added_by = ? AND e.air_date = date(${AGORA_BR})
`);

const anunciadoNoClube = db.prepare(`
  SELECT q.show_id, q.show_title, q.show_poster, sc.shape, date(${AGORA_BR}) AS hoje
  FROM show_queue q
  JOIN shows_cache sc ON sc.tmdb_id = q.show_id
  WHERE q.club_id = ? AND q.added_by = ? AND sc.shape IS NOT NULL
`);

/* As mesmas duas, sobre o produto inteiro: é o trabalho da noite perguntando
   "quem precisa ser avisado hoje", em vez de perguntar sala por sala. */
const listadoGeral = db.prepare(`
  SELECT DISTINCT q.added_by AS reviewer_id, q.show_id, q.show_title, q.show_poster,
         e.season, e.episode, e.title AS episode_title, e.air_date
  FROM show_queue q
  JOIN episodes_cache e ON e.show_id = q.show_id
  WHERE q.added_by <> '' AND e.air_date = date(${AGORA_BR})
`);

const anunciadoGeral = db.prepare(`
  SELECT DISTINCT q.added_by AS reviewer_id, q.show_id, q.show_title, q.show_poster,
         sc.shape, date(${AGORA_BR}) AS hoje
  FROM show_queue q
  JOIN shows_cache sc ON sc.tmdb_id = q.show_id
  WHERE q.added_by <> '' AND sc.shape IS NOT NULL
`);

const epDe = row => ({
  showId: Number(row.show_id),
  showTitle: row.show_title,
  showPoster: row.show_poster,
  season: Number(row.season),
  episode: Number(row.episode),
  episodeTitle: row.episode_title ?? null,
  airDate: row.air_date,
});

/** As estreias de hoje, sem repetir o episódio que as duas fontes conhecem. */
function merge(listed, announced, chaveDe = () => '') {
  const por = new Map();
  for (const row of listed) {
    por.set(`${chaveDe(row)}${row.show_id}:${row.season}x${row.episode}`, {
      ...epDe(row),
      reviewerId: row.reviewer_id,
    });
  }
  for (const row of announced) {
    let shape;
    try {
      shape = JSON.parse(row.shape);
    } catch {
      // Um cache ilegível é um cache vazio, não um erro.
      continue;
    }
    const vem = shape?.nextAir;
    if (!vem || vem.airDate !== row.hoje) continue;
    const chave = `${chaveDe(row)}${row.show_id}:${vem.season}x${vem.episode}`;
    if (por.has(chave)) continue;
    por.set(chave, {
      showId: Number(row.show_id),
      showTitle: row.show_title,
      showPoster: row.show_poster,
      season: vem.season,
      episode: vem.episode,
      episodeTitle: vem.title ?? null,
      airDate: vem.airDate,
      reviewerId: row.reviewer_id,
    });
  }
  return [...por.values()];
}

/** O que estreia hoje para esta pessoa, nesta sala. É o que o sino desenha. */
async function forQueue(clubId, reviewerId) {
  const [listed, announced] = await Promise.all([
    listadoNoClube.all(clubId, reviewerId),
    anunciadoNoClube.all(clubId, reviewerId),
  ]);
  return merge(listed, announced);
}

/* E o mesmo para o produto inteiro, agrupado por pessoa: é o que o trabalho da
   noite percorre. A mesma série acompanhada em duas salas é uma estreia só —
   quem recebe o aviso é a pessoa, não a sala. */
async function todayByReviewer() {
  const [listed, announced] = await Promise.all([listadoGeral.all(), anunciadoGeral.all()]);
  const tudo = merge(listed, announced, row => `${row.reviewer_id}|`);

  const por = new Map();
  for (const item of tudo) {
    const held = por.get(item.reviewerId);
    if (held) held.push(item);
    else por.set(item.reviewerId, [item]);
  }
  return por;
}

/** `T3E07`, que é como um episódio é chamado por gente. */
const tagOf = ep => `T${ep.season}E${String(ep.episode).padStart(2, '0')}`;

module.exports = { forQueue, todayByReviewer, tagOf };
