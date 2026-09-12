const db = require('./db');
const series = require('./series');
const { cacheShow, cacheEpisodes } = require('./showcache');

/* ══════════════════════════════════════════════════════════════════════════
   O QUE VOCÊ VÊ A SEGUIR.

   A lista do clube dizia onde a SALA está — "5/88 vistos" — e essa é a segunda
   pergunta de quem abre a aba. A primeira é pessoal e é sempre a mesma: qual é
   o próximo, o meu. Sem ela, retomar uma série de oitenta episódios começava
   por abrir a série, achar a temporada e correr a lista atrás do primeiro
   quadrado apagado.

   Três respostas, e só uma delas aparece de cada vez:

   · **o próximo a ver** — o primeiro episódio JÁ NO AR que você não marcou.
   · **o próximo a estrear** — quando você está em dia e a série continua. A
     pergunta de quem alcançou uma série no ar não é "o que vejo agora", é
     "quando vem".
   · **nada** — você viu tudo o que existe, e a série acabou.

   Nulo é a quarta resposta e não é nenhuma das três: o TMDB não respondeu e
   este módulo não sabe. A tela cala, em vez de chutar que você está em dia.

   ── o que custa ─────────────────────────────────────────────────────────
   Uma requisição por série na primeira vez, e zero depois: o inventário —
   quantas temporadas, quantos episódios em cada uma, qual o próximo a
   estrear — fica em `shows_cache.shape`. Só a temporada onde o seu progresso
   está precisa da lista de episódios, e ela cai em `episodes_cache`, que é o
   mesmo cache que a tela da série enche ao ser aberta.

   Uma série terminada que você já viu inteira não custa nem consulta: a conta
   para na primeira temporada em que falta alguma coisa.
   ══════════════════════════════════════════════════════════════════════════ */

/** Sobe quando a FORMA do que se guarda muda, e invalida tudo de uma vez. */
const VERSION = 1;

/* Uma série no ar ganha episódio toda semana; uma que acabou não ganha mais
   nenhum. Os dois números são dias. */
const TTL_NO_AR = 1;
const TTL_ACABOU = 14;

/** Quantas séries são perguntadas ao TMDB de uma vez. O mesmo teto de providers.js. */
const LANES = 4;

const DIA = 24 * 60 * 60 * 1000;

/** O dia de hoje na régua do TMDB, que é uma data sem hora. */
const today = () => new Date().toISOString().slice(0, 10);

/* O carimbo do SQLite é UTC sem fuso escrito. Sem o `Z` isto seria lido como
   hora local, e o cache nasceria três horas velho no Brasil. */
function fresh(at, days) {
  if (!at) return false;
  const when = Date.parse(String(at).replace(' ', 'T') + 'Z');
  return Number.isFinite(when) && Date.now() - when < days * DIA;
}

/* ── as duas contas, sem banco e sem rede ─────────────────────────────────
   Exportadas para o teste: é aqui que "o próximo" pode errar em silêncio, e
   errar aqui é a tela mandando alguém ver de novo um episódio que já viu. */

/** A primeira temporada em que falta alguma coisa a esta pessoa. */
function pendingSeason(seasons, marks) {
  for (const s of seasons) {
    for (let e = 1; e <= s.episodes; e++) {
      if (!marks.has(`${s.season}x${e}`)) return s;
    }
  }
  return null;
}

/** Dentro de uma temporada: o primeiro não marcado, e se ele já foi ao ar. */
function pickIn(episodes, marks, day) {
  for (const ep of episodes) {
    if (marks.has(`${ep.season}x${ep.episode}`)) continue;
    return ep.airDate && ep.airDate > day ? { upcoming: ep } : { next: ep };
  }
  return {};
}

const atOrAfter = (a, b) => a.season > b.season || (a.season === b.season && a.episode >= b.episode);

/** Do inventário e do que a pessoa marcou, as três respostas. */
function decide(shape, marks, episodes, day = today()) {
  /* Sem inventário não há resposta, e "em dia" seria uma invenção: uma série
     que o TMDB não descreveu não pode virar "você viu tudo". */
  if (!shape?.seasons?.length) return { next: null, upcoming: null, caughtUp: false };

  const pend = pendingSeason(shape.seasons, marks);
  if (!pend) {
    const upcoming = shape.nextAir ?? null;
    return { next: null, upcoming, caughtUp: true };
  }

  /* Sem a lista da temporada — cache vazio e TMDB fora —, os números dela
     ainda dizem qual é o próximo. Fica sem nome e sem data, que é menos do que
     se quer e mais do que nada. */
  const lista = episodes.length
    ? episodes
    : Array.from({ length: pend.episodes }, (_, i) => ({
        season: pend.season, episode: i + 1, title: null, airDate: null,
      }));

  const achado = pickIn(lista, marks, day);
  let next = achado.next ?? null;
  let upcoming = achado.upcoming ?? null;

  /* A data de estreia é do TMDB e a lista sintética não tem nenhuma: sem esta
     correção, um episódio que ainda vem seria anunciado como "o seu próximo". */
  if (next && shape.nextAir && atOrAfter(next, shape.nextAir)) {
    upcoming = shape.nextAir;
    next = null;
  }
  if (!next && !upcoming) upcoming = shape.nextAir ?? null;

  return { next, upcoming, caughtUp: !next };
}

/* ── e o mesmo, com o TMDB atrás ──────────────────────────────────────────── */

const shapeRows = count => db.prepare(`
  SELECT tmdb_id, shape, shape_at FROM shows_cache
  WHERE tmdb_id IN (${Array.from({ length: count }, () => '?').join(',')})
`);

const saveShape = db.prepare(
  "UPDATE shows_cache SET shape = ?, shape_at = datetime('now') WHERE tmdb_id = ?"
);

const epsStmt = db.prepare(`
  SELECT season, episode, title, air_date, cached_at FROM episodes_cache
  WHERE show_id = ? AND season = ? ORDER BY episode ASC
`);

const marksStmt = db.prepare(`
  SELECT show_id, season, episode FROM episode_takes
  WHERE club_id = ? AND reviewer_id = ? AND episode <> 0
`);

/** O que esta pessoa marcou no clube, por série. */
async function marksOf(clubId, reviewerId) {
  const rows = await marksStmt.all(clubId, reviewerId);
  const por = new Map();
  for (const row of rows) {
    const id = Number(row.show_id);
    let held = por.get(id);
    if (!held) {
      held = new Set();
      por.set(id, held);
    }
    held.add(`${row.season}x${row.episode}`);
  }
  return por;
}

async function shapeOf(showId, held) {
  const guardado = held?.shape?.v === VERSION ? held.shape : null;
  if (guardado && fresh(held.at, guardado.inProduction ? TTL_NO_AR : TTL_ACABOU)) return guardado;

  try {
    const detail = await series.showDetails(showId);
    const shape = {
      v: VERSION,
      inProduction: !!detail.inProduction,
      seasons: (detail.seasons || []).map(s => ({ season: s.season, episodes: s.episodes || 0 })),
      nextAir: detail.nextAir ?? null,
    };
    // A linha tem de existir antes de receber a forma: o UPDATE não cria.
    await cacheShow(detail);
    await saveShape.run(JSON.stringify(shape), showId);
    return shape;
  } catch {
    /* O guardado velho vale mais do que nada: um episódio a menos na contagem
       erra o "próximo" de quem está no fim da última temporada, e cala o resto
       da lista se isto devolvesse nulo. */
    return guardado;
  }
}

async function episodesOf(showId, season, expected, day) {
  const lido = async () => (await epsStmt.all(showId, season)).map(r => ({
    season: Number(r.season),
    episode: Number(r.episode),
    title: r.title ?? null,
    airDate: r.air_date ?? null,
    cachedAt: r.cached_at,
  }));

  const rows = await lido();
  /* Curta quer dizer temporada que cresceu — ou nunca aberta. E uma temporada
     com episódio ainda por estrear tem datas que mudam: elas valem um dia. */
  const curta = rows.length < expected;
  const porVir = rows.some(e => e.airDate && e.airDate > day);
  if (!curta && !(porVir && !rows.every(e => fresh(e.cachedAt, TTL_NO_AR)))) return rows;

  try {
    const got = await series.seasonDetails(showId, season);
    await cacheEpisodes(showId, got.episodes);
    return got.episodes;
  } catch {
    // O que está em cache continua servindo, mesmo curto: ver `decide`.
    return rows;
  }
}

/* A tripla, o nome e a data, e nada mais: o episódio que vem do cache da
   temporada traz sinopse, quadro e nota do TMDB, e uma lista de vinte séries
   carregaria vinte sinopses para escrever "T1E02" num cartaz. */
const refOf = ep =>
  ep && {
    season: ep.season,
    episode: ep.episode,
    title: ep.title ?? null,
    airDate: ep.airDate ?? null,
  };

/** Roda `job` sobre `items`, no máximo `lanes` de cada vez. */
async function inLanes(items, lanes, job) {
  const queue = [...items];
  await Promise.all(
    Array.from({ length: Math.min(lanes, queue.length) }, async () => {
      while (queue.length) await job(queue.shift());
    })
  );
}

/* Pendura `upNext`, `upcoming` e `caughtUp` em cada série da lista. Nunca
   derruba a lista: uma série que não respondeu fica com os três nulos, e a
   tela não diz nada sobre ela — que é o que ela já faz com quem não tem
   provedor. */
async function fill(shows, { clubId, reviewerId }) {
  if (!shows.length) return shows;

  const dia = today();
  const marks = await marksOf(clubId, reviewerId);

  const guardado = new Map();
  try {
    const ids = shows.map(s => s.id);
    for (const row of await shapeRows(ids.length).all(...ids)) {
      guardado.set(Number(row.tmdb_id), {
        shape: row.shape ? JSON.parse(row.shape) : null,
        at: row.shape_at,
      });
    }
  } catch (e) {
    // Um cache ilegível é um cache vazio, não um erro.
    console.warn('[upnext] cache ilegível:', e.message);
  }

  await inLanes(shows, LANES, async show => {
    try {
      const shape = await shapeOf(show.id, guardado.get(show.id));
      const meus = marks.get(show.id) ?? new Set();
      const pend = shape?.seasons?.length ? pendingSeason(shape.seasons, meus) : null;
      const eps = pend ? await episodesOf(show.id, pend.season, pend.episodes, dia) : [];
      const { next, upcoming, caughtUp } = decide(shape, meus, eps, dia);
      show.upNext = refOf(next);
      show.upcoming = refOf(upcoming);
      show.caughtUp = caughtUp;
    } catch (e) {
      console.warn('[upnext] série', show.id, e.message);
    }
  });

  return shows;
}

module.exports = { fill, decide, pendingSeason, pickIn };
