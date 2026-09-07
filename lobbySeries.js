const db = require('./db');
const { eligible, readable, clubDTO } = require('./lobby');
const { excerpt } = require('./takes');
const { episodeAnsweredIn } = require('./criteria');

/* ══════════════════════════════════════════════════════════════════════════
   O SAGUÃO, pela lente de séries.

   Mesma tela, mesma forma, outro acervo. O saguão de filmes lê `reviews`; este
   lê `episode_takes`. As duas paredes de privacidade são importadas de lobby.js
   e não reescritas — a regra de quem empresta o quê é uma só, e uma segunda
   cópia dela é a que fica para trás quando um interruptor novo aparecer.

   ── o que muda de verdade ─────────────────────────────────────────────────
   A unidade avaliada é o episódio, e a unidade que se mostra é a SÉRIE. Um
   cartaz é de série; um pódio de episódios seria uma lista de números sem
   cartaz para pendurar neles, e a parede do saguão é feita de cartazes.

   Então a média de uma série é a média dos episódios avaliados dela, que é a
   agregação derivada que o produto escolheu: nada é declarado duas vezes, e a
   nota da série nunca contradiz as partes porque ela É as partes.

   ── e o que não existe aqui ───────────────────────────────────────────────
   A sessão ao vivo. A sala de projeção é de filme hoje, e anunciar uma sessão
   de série que não existe seria a tela prometendo uma porta que não abre. Volta
   quando a sala aprender a tocar episódio.
   ══════════════════════════════════════════════════════════════════════════ */

const ELIGIBLE = eligible('c');
const READABLE = readable('c');

const WALL = 28;
const PODIUM = 6;
/* O mesmo piso do pódio de filmes, e pela mesma razão: uma média sobre uma
   amostra de tamanho um não é um ranking, é um entusiasmo. Aqui ele conta
   EPISÓDIOS avaliados da série, não pessoas — uma série com três episódios
   avaliados por uma pessoa já tem uma curva, e uma com um episódio não tem. */
const FLOOR = 3;
const ACTIVE = 6;
const WINDOW_DAYS = 30;
const TAKES = 5;

/* Só o que tem nota entra em contagem de avaliação. Uma linha sem `final` é
   alguém que viu e não avaliou, e contá-la como avaliação seria inflar o número
   com o gesto mais barato do produto. */
const RATED = 't.final IS NOT NULL';

const countsStmt = db.prepare(`
  SELECT
    (SELECT COUNT(*) FROM episode_takes t JOIN clubs c ON c.id = t.club_id
      WHERE ${ELIGIBLE} AND ${RATED}) AS reviews,
    (SELECT COUNT(DISTINCT t.show_id) FROM episode_takes t JOIN clubs c ON c.id = t.club_id
      WHERE ${ELIGIBLE}) AS movies,
    (SELECT COUNT(DISTINCT t.season || 'x' || t.episode || 'x' || t.show_id)
      FROM episode_takes t JOIN clubs c ON c.id = t.club_id
      WHERE ${ELIGIBLE}) AS episodes,
    (SELECT COUNT(*) FROM clubs) AS clubs
`);

/* A parede: uma série por caixa, a mais recentemente mexida primeiro. Sem
   cartaz não entra, como na de filmes. */
const wallStmt = db.prepare(`
  SELECT t.show_id, t.show_title, t.show_poster,
         AVG(t.final) AS average,
         COUNT(CASE WHEN t.final IS NOT NULL THEN 1 END) AS takes,
         MAX(t.watched_at) AS last_at
  FROM episode_takes t
  JOIN clubs c ON c.id = t.club_id
  WHERE ${ELIGIBLE} AND t.show_poster IS NOT NULL AND t.show_poster <> ''
  GROUP BY t.show_id
  ORDER BY last_at DESC
  LIMIT ${WALL}
`);

/* O pódio de séries. A média é a dos episódios avaliados — a agregação
   derivada —, e o piso conta episódios DISTINTOS: quatro pessoas avaliando o
   mesmo episódio é uma opinião sobre um episódio, não quatro sobre a série. */
const podiumStmt = db.prepare(`
  SELECT t.show_id, t.show_title, t.show_poster, t.show_genre,
         AVG(t.final) AS average,
         COUNT(CASE WHEN t.final IS NOT NULL THEN 1 END) AS takes,
         COUNT(DISTINCT CASE WHEN t.final IS NOT NULL
               THEN t.season || 'x' || t.episode END) AS episodes,
         COUNT(DISTINCT t.club_id) AS clubs
  FROM episode_takes t
  JOIN clubs c ON c.id = t.club_id
  WHERE ${ELIGIBLE} AND ${RATED}
  GROUP BY t.show_id
  HAVING episodes >= ${FLOOR}
  ORDER BY average DESC, takes DESC
  LIMIT ${PODIUM}
`);

/* Clubes em atividade, contados por EPISÓDIO mexido nos últimos trinta dias —
   visto ou avaliado. Neste universo acompanhar é a atividade principal, e um
   clube que assistiu uma temporada inteira sem avaliar nada está vivo. */
const activeStmt = db.prepare(`
  SELECT c.id, c.name, c.slug, c.tagline, c.visibility, c.photo_rev,
         COUNT(t.id) AS recent,
         (SELECT COUNT(*) FROM club_members m WHERE m.club_id = c.id) AS members
  FROM clubs c
  LEFT JOIN episode_takes t
    ON t.club_id = c.id AND t.watched_at >= datetime('now', '-${WINDOW_DAYS} days')
  WHERE ${ELIGIBLE}
  GROUP BY c.id
  HAVING recent > 0
  ORDER BY recent DESC, members DESC
  LIMIT ${ACTIVE}
`);

/* ── o episódio em destaque ───────────────────────────────────────────────
   O par da avaliação em destaque do saguão de filmes, e a única coisa desta
   tela com voz humana — por isso pede a parede mais alta.

   A ordem é por reação, e ainda não há reação: a conversa sobre um episódio é
   uma fatia que não foi construída. Então ela cai direto no critério de
   desempate do outro saguão — quem escreveu alguma coisa, depois o mais
   recente. É o mais honesto que sobra, e é o mesmo comportamento que o saguão
   de filmes tem numa rede que ainda não reagiu a nada. */
const featureStmt = db.prepare(`
  SELECT t.id, t.show_id, t.show_title, t.show_poster, t.show_genre,
         t.season, t.episode, t.episode_title,
         t.scores, t.final, t.comment, t.watched_at, t.rated_at,
         r.id AS actor_id, r.name AS actor_name, r.dot AS actor_dot,
         r.avatar_rev AS actor_avatar_rev,
         c.name AS club_name, c.slug AS club_slug, c.visibility AS club_visibility
  FROM episode_takes t
  JOIN reviewers r ON r.id = t.reviewer_id
  JOIN clubs c ON c.id = t.club_id
  WHERE ${READABLE} AND ${RATED}
    AND t.watched_at >= datetime('now', '-${WINDOW_DAYS} days')
  ORDER BY (t.comment IS NOT NULL AND t.comment <> '') DESC,
           (t.scores IS NOT NULL) DESC,
           t.watched_at DESC
  LIMIT 1
`);

/* ── as fichas de uma série, em toda a rede ───────────────────────────────
   O que se lê ao abrir um cartaz da parede. Mesma regra de credibilidade do
   saguão de filmes: quem enfrentou os critérios mais vezes aparece primeiro, e
   isso decide ORDEM e nunca peso. Uma ficha por pessoa, escolhida em JS depois
   de ordenar — GROUP BY no SQLite escolheria uma linha arbitrária. */
const showTakesStmt = db.prepare(`
  SELECT t.id, t.final, t.scores, t.show_genre, t.comment, t.watched_at,
         t.season, t.episode, t.episode_title,
         r.id AS actor_id, r.name AS actor_name, r.dot AS actor_dot,
         r.avatar_rev AS actor_avatar_rev,
         c.name AS club_name, c.slug AS club_slug,
         (SELECT COUNT(*) FROM episode_takes x JOIN clubs xc ON xc.id = x.club_id
           WHERE x.reviewer_id = r.id AND x.final IS NOT NULL AND ${eligible('xc')}) AS credibility
  FROM episode_takes t
  JOIN reviewers r ON r.id = t.reviewer_id
  JOIN clubs c ON c.id = t.club_id
  WHERE ${READABLE} AND ${RATED} AND t.show_id = ?
  ORDER BY credibility DESC, t.final DESC, t.watched_at DESC
  LIMIT ${TAKES * 4}
`);

const showVerdictStmt = db.prepare(`
  SELECT AVG(t.final) AS average,
         COUNT(*) AS takes,
         COUNT(DISTINCT t.season || 'x' || t.episode) AS episodes,
         COUNT(DISTINCT t.club_id) AS clubs
  FROM episode_takes t
  JOIN clubs c ON c.id = t.club_id
  WHERE ${ELIGIBLE} AND ${RATED} AND t.show_id = ?
`);

/* A média por temporada, que é a leitura que só este universo tem: uma série
   não é uma nota, é uma curva. Derivada dos mesmos episódios que produzem a
   média da série, então as duas nunca se contradizem. */
const seasonsStmt = db.prepare(`
  SELECT t.season, AVG(t.final) AS average,
         COUNT(DISTINCT t.season || 'x' || t.episode) AS episodes
  FROM episode_takes t
  JOIN clubs c ON c.id = t.club_id
  WHERE ${ELIGIBLE} AND ${RATED} AND t.show_id = ?
  GROUP BY t.season
  ORDER BY t.season ASC
`);

const avatarOf = row =>
  row.actor_avatar_rev ? `/api/reviewers/${row.actor_id}/avatar?v=${row.actor_avatar_rev}` : null;

/* Os extremos de uma ficha de episódio: onde a pessoa se entusiasmou e onde se
   decepcionou. `endsOf` de takes.js resolve os onze de um filme; este resolve
   os nove de um episódio, que é outra lista de critérios. Null quando não há
   distância — onze notas iguais não têm extremos, e apontá-los inventaria uma
   opinião que ninguém teve. */
function endsOfEpisode(genre, scoresJson) {
  if (!scoresJson) return null;
  let scores;
  try { scores = JSON.parse(scoresJson); } catch { return null; }
  const answered = episodeAnsweredIn(genre, scores);
  if (answered.length < 2) return null;
  const sorted = [...answered].sort((a, b) => scores[b.key] - scores[a.key]);
  const high = sorted[0];
  const low = sorted[sorted.length - 1];
  if (scores[high.key] === scores[low.key]) return null;
  return {
    high: { name: high.name, value: scores[high.key] },
    low: { name: low.name, value: scores[low.key] },
  };
}

async function show(showId) {
  const id = Number(showId);
  if (!Number.isInteger(id) || id <= 0) return null;

  const [linhas, conta, temporadas] = await Promise.all([
    showTakesStmt.all(id),
    showVerdictStmt.get(id),
    seasonsStmt.all(id),
  ]);

  const vistos = new Set();
  const takes = [];
  for (const row of linhas) {
    if (vistos.has(row.actor_id)) continue;
    vistos.add(row.actor_id);
    takes.push({
      id: row.id,
      actor: { id: row.actor_id, name: row.actor_name, dot: row.actor_dot, avatar: avatarOf(row) },
      club: { name: row.club_name, slug: row.club_slug },
      season: row.season,
      episode: row.episode,
      episodeTitle: row.episode_title ?? null,
      final: Number(row.final),
      at: row.watched_at,
      ends: endsOfEpisode(row.show_genre, row.scores),
      excerpt: row.comment ? excerpt(row.comment, 200) : null,
      credibility: Number(row.credibility) || 0,
    });
    if (takes.length >= TAKES) break;
  }

  return {
    takes,
    average: conta?.takes ? Number(conta.average) : null,
    count: Number(conta?.takes) || 0,
    episodes: Number(conta?.episodes) || 0,
    clubs: Number(conta?.clubs) || 0,
    seasons: temporadas.map(s => ({
      season: Number(s.season),
      average: Number(s.average),
      episodes: Number(s.episodes),
    })),
  };
}

/* ── as fichas de UM episódio, em toda a rede ─────────────────────────────
   O que a folha de um episódio mostra quando alguém troca de "clube" para
   "todas". Mesmas paredes, mesma ordem por credibilidade, e a mesma regra de
   uma ficha por pessoa — a diferença é o alcance da pergunta.

   Existe separado de `show` porque é outra pergunta: aquele diz o que a rede
   achou da SÉRIE, este diz o que ela achou daquele episódio. Filtrar o primeiro
   no cliente daria a resposta certa por acidente e só enquanto a série coubesse
   nas cinco fichas que ele carrega. */
const episodeTakesStmt = db.prepare(`
  SELECT t.id, t.final, t.scores, t.show_genre, t.comment, t.watched_at,
         t.season, t.episode, t.episode_title,
         r.id AS actor_id, r.name AS actor_name, r.dot AS actor_dot,
         r.avatar_rev AS actor_avatar_rev,
         c.name AS club_name, c.slug AS club_slug,
         (SELECT COUNT(*) FROM episode_takes x JOIN clubs xc ON xc.id = x.club_id
           WHERE x.reviewer_id = r.id AND x.final IS NOT NULL AND ${eligible('xc')}) AS credibility
  FROM episode_takes t
  JOIN reviewers r ON r.id = t.reviewer_id
  JOIN clubs c ON c.id = t.club_id
  WHERE ${READABLE} AND ${RATED}
    AND t.show_id = ? AND t.season = ? AND t.episode = ?
  ORDER BY credibility DESC, t.watched_at DESC
  LIMIT ${TAKES * 4}
`);

const episodeVerdictStmt = db.prepare(`
  SELECT AVG(t.final) AS average, COUNT(*) AS takes, COUNT(DISTINCT t.club_id) AS clubs
  FROM episode_takes t
  JOIN clubs c ON c.id = t.club_id
  WHERE ${ELIGIBLE} AND ${RATED}
    AND t.show_id = ? AND t.season = ? AND t.episode = ?
`);

async function episode(showId, season, number) {
  const id = Number(showId);
  const s = Number(season);
  const e = Number(number);
  if (![id, s, e].every(Number.isInteger) || id <= 0 || s < 0 || e <= 0) return null;

  const [linhas, conta] = await Promise.all([
    episodeTakesStmt.all(id, s, e),
    episodeVerdictStmt.get(id, s, e),
  ]);

  const vistos = new Set();
  const takes = [];
  for (const row of linhas) {
    if (vistos.has(row.actor_id)) continue;
    vistos.add(row.actor_id);
    takes.push({
      id: row.id,
      actor: { id: row.actor_id, name: row.actor_name, dot: row.actor_dot, avatar: avatarOf(row) },
      club: { name: row.club_name, slug: row.club_slug },
      season: row.season,
      episode: row.episode,
      episodeTitle: row.episode_title ?? null,
      final: Number(row.final),
      at: row.watched_at,
      ends: endsOfEpisode(row.show_genre, row.scores),
      excerpt: row.comment ? excerpt(row.comment, 200) : null,
      credibility: Number(row.credibility) || 0,
    });
    if (takes.length >= TAKES) break;
  }

  return {
    takes,
    average: conta?.takes ? Number(conta.average) : null,
    count: Number(conta?.takes) || 0,
    clubs: Number(conta?.clubs) || 0,
  };
}

const TTL_MS = 60_000;
let cached = null;
let cachedAt = 0;

function invalidate() {
  cached = null;
}

async function snapshot() {
  if (cached && Date.now() - cachedAt < TTL_MS) return cached;

  const [counts, wall, podium, active, feature] = await Promise.all([
    countsStmt.get(),
    wallStmt.all(),
    podiumStmt.all(),
    activeStmt.all(),
    featureStmt.get(),
  ]);

  cached = {
    /* As mesmas chaves do saguão de filmes, com outro conteúdo: é o que deixa
       uma tela só desenhar os dois universos. `movies` conta séries aqui, e o
       nome fica porque a tela lê a chave e o rótulo é dela. */
    counts: {
      reviews: Number(counts?.reviews) || 0,
      movies: Number(counts?.movies) || 0,
      episodes: Number(counts?.episodes) || 0,
      clubs: Number(counts?.clubs) || 0,
    },
    wall: wall.map(row => ({
      id: Number(row.show_id),
      title: row.show_title,
      year: null,
      poster: row.show_poster,
      average: row.average != null ? Number(row.average) : 0,
      takes: Number(row.takes) || 0,
    })),
    podium: podium.map(row => ({
      id: Number(row.show_id),
      title: row.show_title,
      year: null,
      poster: row.show_poster ?? null,
      genre: row.show_genre,
      average: Number(row.average),
      takes: Number(row.takes),
      episodes: Number(row.episodes),
      clubs: Number(row.clubs),
    })),
    active: active.map(row => ({
      ...clubDTO(row),
      tagline: row.tagline || null,
      recent: Number(row.recent),
      members: Number(row.members) || 0,
    })),
    floor: FLOOR,
    windowDays: WINDOW_DAYS,
    feature: feature
      ? {
          id: feature.id,
          club: {
            name: feature.club_name,
            slug: feature.club_slug,
            visibility: feature.club_visibility,
          },
          actor: {
            id: feature.actor_id,
            name: feature.actor_name,
            dot: feature.actor_dot,
            avatar: avatarOf(feature),
          },
          showId: Number(feature.show_id),
          movieId: Number(feature.show_id),
          movieTitle: feature.show_title,
          moviePoster: feature.show_poster ?? null,
          movieYear: null,
          genre: feature.show_genre,
          season: feature.season,
          episode: feature.episode,
          episodeTitle: feature.episode_title ?? null,
          final: Number(feature.final),
          at: feature.rated_at || feature.watched_at,
          ends: endsOfEpisode(feature.show_genre, feature.scores),
          excerpt: feature.comment ? excerpt(feature.comment, 220) : null,
          /* Zerados enquanto a conversa sobre um episódio não existir. A tela
             já cala toda contagem em zero, então ela some sozinha. */
          replies: 0,
          agrees: 0,
          disagrees: 0,
        }
      : null,
    /* Vazio, e não ausente: a tela lê o comprimento. A sala de projeção é de
       filme hoje — ver a nota de abertura. */
    live: [],
  };
  cachedAt = Date.now();
  return cached;
}

module.exports = { snapshot, show, episode, invalidate, FLOOR, WINDOW_DAYS, TAKES };
