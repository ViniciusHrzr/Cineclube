const db = require('./db');
const screening = require('./screening');
const { excerpt, endsOf } = require('./takes');

/* ══════════════════════════════════════════════════════════════════════════
   O SAGUÃO, do lado do servidor.

   O produto virou uma rede de salas e a porta de entrada continuou sendo duas
   listas de clubes: o chaveiro de quem já chegou e a vitrine de quem está
   olhando. Nenhuma das duas diz o que a rede ESTÁ FAZENDO — e este produto tem
   centenas de pôsteres, milhares de notas e salas assistindo juntas agora,
   nenhum deles à vista de quem entra.

   Este arquivo é a única coisa do produto que lê acima da linha do clube. Por
   isso ele começa pela parede, e não pelas consultas.

   ── a parede ──────────────────────────────────────────────────────────────
   Todo agregado daqui conta só o que a sala EMPRESTOU. São dois níveis, e a
   diferença entre eles é a diferença entre um número e um texto:

   `ELIGIBLE` — a sala é aberta, ou o ADM ligou `show_charts`. Vale para o que é
   contagem e média: a parede de pôsteres, o pódio, as salas em atividade, o que
   está em cartaz. Uma média de rede não diz quem deu a nota nem onde; diz que
   alguém, em algum lugar, achou aquilo bom.

   `READABLE` — além do acima, o clube precisa deixar as fichas legíveis
   (`show_reviews`). Vale para a ficha da semana, que é a única coisa daqui que
   mostra o que uma pessoa ESCREVEU, com o nome dela em cima. Emprestar uma nota
   para uma média e publicar um texto assinado não são o mesmo gesto, e um
   interruptor só não teria como dizer os dois.

   Um clube fechado que não ligou nada não aparece em lugar nenhum desta tela —
   nem no número de fichas, nem num pôster, nem num filme mais bem avaliado. O
   que ele continua tendo é a fachada: nome, foto, descrição e quantas pessoas,
   que já eram de todo mundo (ver clubs.js) e são o que torna possível pedir para
   entrar.
   ══════════════════════════════════════════════════════════════════════════ */

/* As duas paredes como funções do apelido da tabela: a mesma regra precisa ser
   escrita sobre `c` na consulta de fora e sobre outro apelido numa subconsulta,
   e duas cópias da condição de privacidade são duas chances de uma delas ficar
   para trás. */
const eligible = t => `(${t}.visibility = 'public' OR ${t}.show_charts = 1)`;
const readable = t =>
  `(${t}.visibility = 'public' OR (${t}.show_charts = 1 AND ${t}.show_reviews = 1))`;

const ELIGIBLE = eligible('c');
const READABLE = readable('c');

/** Quantos pôsteres a parede carrega. Ela repete a lista para emendar sem costura. */
const WALL = 28;
/** Quantos filmes o pódio mostra. */
const PODIUM = 6;
/* ── o piso do pódio ──────────────────────────────────────────────────────
   Sem um mínimo de fichas, o filme mais bem avaliado da rede é para sempre
   aquele que uma pessoa só, uma vez, achou perfeito. É o defeito clássico
   desta tela e ele não se corrige na interface: um ranking de médias sobre
   amostras de tamanho um não é um ranking, é uma lista de entusiasmos.

   Três é baixo de propósito. A rede é pequena e um piso alto deixaria o pódio
   vazio por meses — o que também é uma mentira, só que mais silenciosa. O
   número de fichas viaja junto de toda linha e é impresso na tela: quem lê o
   pódio vê sobre quantas opiniões cada média foi feita. */
const FLOOR = 3;
/** Quantas salas a lista de atividade mostra, e sobre quanto tempo. */
const ACTIVE = 6;
const WINDOW_DAYS = 30;

/* O acervo da rede em números. Salas e pessoas são contadas por inteiro — a
   vitrine já lista toda sala pelo nome, e quantas pessoas existem não é fato de
   sala nenhuma. Fichas e filmes só contam o que foi emprestado. */
const countsStmt = db.prepare(`
  SELECT
    (SELECT COUNT(*) FROM reviews rv JOIN clubs c ON c.id = rv.club_id WHERE ${ELIGIBLE}) AS reviews,
    (SELECT COUNT(DISTINCT rv.movie_id) FROM reviews rv JOIN clubs c ON c.id = rv.club_id
      WHERE ${ELIGIBLE}) AS movies,
    (SELECT COUNT(*) FROM clubs) AS clubs
`);

/* A parede: um filme por caixa, o mais recentemente avaliado primeiro. Sem
   pôster não entra — uma caixa de cartaz vazia numa parede de cartazes é um
   buraco, e não um estado. */
const wallStmt = db.prepare(`
  SELECT rv.movie_id, rv.movie_title, rv.movie_year, rv.movie_poster,
         AVG(rv.final) AS average, COUNT(*) AS takes, MAX(rv.recorded_at) AS last_at
  FROM reviews rv
  JOIN clubs c ON c.id = rv.club_id
  WHERE ${ELIGIBLE} AND rv.movie_poster IS NOT NULL AND rv.movie_poster <> ''
  GROUP BY rv.movie_id
  ORDER BY last_at DESC
  LIMIT ${WALL}
`);

/* O pódio. Empate de média se desfaz por número de fichas: entre dois 9,0, o
   que foi visto por mais gente é o que a rede afirmou com mais força. */
const podiumStmt = db.prepare(`
  SELECT rv.movie_id, rv.movie_title, rv.movie_year, rv.movie_poster, rv.movie_genre,
         AVG(rv.final) AS average, COUNT(*) AS takes, COUNT(DISTINCT rv.club_id) AS clubs
  FROM reviews rv
  JOIN clubs c ON c.id = rv.club_id
  WHERE ${ELIGIBLE}
  GROUP BY rv.movie_id
  HAVING COUNT(*) >= ${FLOOR}
  ORDER BY average DESC, takes DESC
  LIMIT ${PODIUM}
`);

/* ── salas em atividade ───────────────────────────────────────────────────
   Fichas nos últimos trinta dias, e não desde sempre. Um ranking de total
   histórico é um pódio que a sala mais antiga nunca perde: ela ganhou o lugar
   por ter existido primeiro, e nenhum clube fundado hoje tem como alcançá-la.
   Trinta dias mede vida, que é o que uma pessoa parada no saguão quer saber —
   onde é que está acontecendo alguma coisa.

   Uma sala sem nenhuma ficha no período não aparece. Não é castigo: uma lista de
   atividade cheia de zeros é ruído com forma de dado. */
const activeStmt = db.prepare(`
  SELECT c.id, c.name, c.slug, c.tagline, c.visibility, c.photo_rev,
         COUNT(rv.id) AS recent,
         (SELECT COUNT(*) FROM club_members m WHERE m.club_id = c.id) AS members
  FROM clubs c
  LEFT JOIN reviews rv
    ON rv.club_id = c.id AND rv.recorded_at >= datetime('now', '-${WINDOW_DAYS} days')
  WHERE ${ELIGIBLE}
  GROUP BY c.id
  HAVING recent > 0
  ORDER BY recent DESC, members DESC
  LIMIT ${ACTIVE}
`);

/* ── a ficha da semana ────────────────────────────────────────────────────
   Uma avaliação inteira, com o texto que a pessoa escreveu. É a única coisa
   deste arquivo que tem voz humana — todo o resto é pôster e número —, e é por
   isso que ela pede a parede mais alta (`READABLE`).

   O critério é reação: quantas respostas e quantos votos a ficha recebeu. Sem
   nenhuma reação em lugar nenhum, a ordem cai para quem escreveu alguma coisa e
   depois para a mais recente — que é o mais honesto que sobra quando a rede
   ainda não reagiu a nada, e nunca é uma escolha inventada. */
const featureStmt = db.prepare(`
  SELECT rv.id, rv.movie_id, rv.movie_title, rv.movie_year, rv.movie_poster,
         rv.movie_genre, rv.scores, rv.final, rv.comment, rv.recorded_at,
         r.id AS actor_id, r.name AS actor_name, r.dot AS actor_dot,
         r.avatar_rev AS actor_avatar_rev,
         c.name AS club_name, c.slug AS club_slug, c.visibility AS club_visibility,
         (SELECT COUNT(*) FROM review_comments x WHERE x.review_id = rv.id)
           + (SELECT COUNT(*) FROM review_votes v WHERE v.review_id = rv.id) AS reactions,
         (SELECT COUNT(*) FROM review_comments x WHERE x.review_id = rv.id) AS replies,
         (SELECT COUNT(*) FROM review_votes v WHERE v.review_id = rv.id AND v.value > 0) AS agrees,
         (SELECT COUNT(*) FROM review_votes v WHERE v.review_id = rv.id AND v.value < 0) AS disagrees
  FROM reviews rv
  JOIN reviewers r ON r.id = rv.reviewer_id
  JOIN clubs c ON c.id = rv.club_id
  WHERE ${READABLE} AND rv.recorded_at >= datetime('now', '-${WINDOW_DAYS} days')
  ORDER BY reactions DESC, (rv.comment IS NOT NULL AND rv.comment <> '') DESC, rv.recorded_at DESC
  LIMIT 1
`);

/* ══════════════════════════════════════════════════════════════════════════
   AS FICHAS DE UM FILME, EM TODA A REDE.

   O que se lê ao abrir um cartaz da parede: quem já viu isto, e o que achou.

   ── a ordem é por quem avaliou mais ───────────────────────────────────────
   Escolhido pelo dono do produto, e o argumento dele é bom: quem tem cem fichas
   neste app já enfrentou os onze critérios cem vezes, e um 7 dessa pessoa
   carrega uma régua que um 7 de quem avaliou uma vez não carrega. Não é
   qualidade de opinião — é quantidade de calibragem, que é a única coisa aqui
   que um banco sabe medir.

   O que ela NÃO é: uma média ponderada. As notas continuam valendo todas o
   mesmo no pódio e na média da rede. O que a credibilidade decide é quem
   aparece primeiro numa lista de cinco, que é uma pergunta de edição e não de
   aritmética.

   A contagem que ordena conta só as salas que emprestam — senão alguém com
   trezentas fichas numa sala fechada lideraria uma lista da qual ele não
   participa.

   ── uma ficha por pessoa ──────────────────────────────────────────────────
   A mesma pessoa avalia o mesmo filme em dois clubes com notas independentes, e
   é assim que este produto funciona de propósito. Numa lista de cinco, porém,
   ela apareceria duas vezes — e uma lista com a mesma cara duas vezes é uma
   lista com quatro pessoas se dizendo cinco. Escolhida em JS, depois de ordenar:
   `GROUP BY` no SQLite escolheria uma linha arbitrária da dupla.
   ══════════════════════════════════════════════════════════════════════════ */

/** Quantas fichas a folha de um filme mostra. */
const TAKES = 5;

const filmTakesStmt = db.prepare(`
  SELECT rv.id, rv.final, rv.scores, rv.movie_genre, rv.comment, rv.recorded_at,
         r.id AS actor_id, r.name AS actor_name, r.dot AS actor_dot,
         r.avatar_rev AS actor_avatar_rev,
         c.name AS club_name, c.slug AS club_slug,
         (SELECT COUNT(*) FROM reviews x JOIN clubs xc ON xc.id = x.club_id
           WHERE x.reviewer_id = r.id AND ${eligible('xc')}) AS credibility
  FROM reviews rv
  JOIN reviewers r ON r.id = rv.reviewer_id
  JOIN clubs c ON c.id = rv.club_id
  WHERE ${READABLE} AND rv.movie_id = ?
  ORDER BY credibility DESC, rv.recorded_at DESC
  LIMIT ${TAKES * 4}
`);

/* A conta da rede sobre este filme, sob a parede mais frouxa: uma média não diz
   quem deu a nota, então ela vale para toda sala que empresta — inclusive as que
   não abrem as fichas assinadas. É o mesmo critério do pódio. */
const filmVerdictStmt = db.prepare(`
  SELECT AVG(rv.final) AS average, COUNT(*) AS takes, COUNT(DISTINCT rv.club_id) AS clubs
  FROM reviews rv
  JOIN clubs c ON c.id = rv.club_id
  WHERE ${ELIGIBLE} AND rv.movie_id = ?
`);

async function film(movieId) {
  const id = Number(movieId);
  if (!Number.isInteger(id) || id <= 0) return null;

  const [linhas, conta] = await Promise.all([
    filmTakesStmt.all(id),
    filmVerdictStmt.get(id),
  ]);

  const vistos = new Set();
  const takes = [];
  for (const row of linhas) {
    if (vistos.has(row.actor_id)) continue;
    vistos.add(row.actor_id);
    takes.push({
      id: row.id,
      actor: {
        id: row.actor_id,
        name: row.actor_name,
        dot: row.actor_dot,
        avatar: row.actor_avatar_rev
          ? `/api/reviewers/${row.actor_id}/avatar?v=${row.actor_avatar_rev}`
          : null,
      },
      club: { name: row.club_name, slug: row.club_slug },
      final: Number(row.final),
      at: row.recorded_at,
      ends: endsOf(row.movie_genre, row.scores),
      excerpt: row.comment ? excerpt(row.comment, 200) : null,
      /* Vai para a tela porque é o que explica a ordem. Um ranking cuja regra
         não está à vista é um ranking que parece arbitrário. */
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

/** As salas que emprestaram alguma coisa, por id. É o que a sessão ao vivo casa. */
const eligibleClubsStmt = db.prepare(`
  SELECT c.id, c.name, c.slug, c.visibility, c.photo_rev
  FROM clubs c
  WHERE ${ELIGIBLE}
`);

const photoUrl = row => (row.photo_rev ? `/api/c/${row.slug}/photo?v=${row.photo_rev}` : null);

/* O id vai junto do slug porque a cor de uma sala sem foto é derivada dele — a
   mesma cor que o painel do chaveiro usa. Derivá-la do slug aqui daria à mesma
   sala duas cores na mesma tela, o que é a tela dizendo que são duas. */
const clubDTO = row => ({
  id: row.id,
  name: row.name,
  slug: row.slug,
  visibility: row.visibility,
  photo: photoUrl(row),
});

/* ══════════════════════════════════════════════════════════════════════════
   Em cartaz agora.

   Não sai do banco: sai do `Map` de salas em memória do screening, que é onde a
   sessão ao vivo mora. Uma sala aberta com um filme dentro é literalmente uma
   sessão acontecendo, e não há tabela nenhuma a consultar — é por isso que esta
   parte é recalculada a cada pedido enquanto o resto do saguão fica em cache.
   Um "agora" com um minuto de atraso não é agora.

   `viewers` é quem está com a sala aberta neste segundo. Uma sessão com o filme
   posto e ninguém dentro ainda conta: alguém acabou de abrir a sala e está
   esperando o clube chegar, que é exatamente o momento em que o saguão anunciar
   isso vale mais.
   ══════════════════════════════════════════════════════════════════════════ */
async function nowPlaying() {
  if (!screening.rooms.size) return [];

  const eligible = new Map();
  for (const row of await eligibleClubsStmt.all()) eligible.set(row.id, row);

  const out = [];
  for (const room of screening.rooms.values()) {
    if (!room.open || !room.movie) continue;
    const club = eligible.get(room.clubId);
    if (!club) continue;
    out.push({
      club: clubDTO(club),
      movie: {
        id: room.movie.id,
        title: room.movie.title,
        year: room.movie.year ?? null,
        poster: room.movie.poster ?? null,
      },
      watching: room.viewers.size,
      /* 'playing' ou 'paused'. Uma sala pausada continua sendo uma sessão — o
         clube parou para discutir, que é o que este clube faz. */
      status: room.status,
    });
  }
  return out.sort((a, b) => b.watching - a.watching);
}

/* ══════════════════════════════════════════════════════════════════════════
   O cache.

   Seis agregações sobre a tabela de avaliações inteira, na porta de entrada do
   produto, para uma resposta que muda quando alguém grava uma ficha — o que
   acontece algumas vezes por noite. Um minuto de idade é invisível para quem lê
   e é a diferença entre a porta abrir na hora e a porta pensar.

   O que NÃO entra aqui é o que está em cartaz: ver acima.
   ══════════════════════════════════════════════════════════════════════════ */
const TTL_MS = 60_000;
let cached = null;
let cachedAt = 0;

/** Joga o cache fora. Chamado quando uma sala muda o que empresta à rede. */
function invalidate() {
  cached = null;
}

async function aggregates() {
  if (cached && Date.now() - cachedAt < TTL_MS) return cached;

  const [counts, wall, podium, active, feature] = await Promise.all([
    countsStmt.get(),
    wallStmt.all(),
    podiumStmt.all(),
    activeStmt.all(),
    featureStmt.get(),
  ]);

  cached = {
    counts: {
      reviews: Number(counts?.reviews) || 0,
      movies: Number(counts?.movies) || 0,
      clubs: Number(counts?.clubs) || 0,
    },
    wall: wall.map(row => ({
      id: Number(row.movie_id),
      title: row.movie_title,
      year: row.movie_year ?? null,
      poster: row.movie_poster,
      average: Number(row.average),
      takes: Number(row.takes),
    })),
    podium: podium.map(row => ({
      id: Number(row.movie_id),
      title: row.movie_title,
      year: row.movie_year ?? null,
      poster: row.movie_poster ?? null,
      genre: row.movie_genre,
      average: Number(row.average),
      takes: Number(row.takes),
      clubs: Number(row.clubs),
    })),
    active: active.map(row => ({
      ...clubDTO(row),
      tagline: row.tagline || null,
      recent: Number(row.recent),
      members: Number(row.members) || 0,
    })),
    /* O piso do pódio, junto do pódio: a tela imprime "com pelo menos N fichas"
       em vez de deixar o leitor supor que aquilo é a lista inteira. */
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
            avatar: feature.actor_avatar_rev
              ? `/api/reviewers/${feature.actor_id}/avatar?v=${feature.actor_avatar_rev}`
              : null,
          },
          movieId: Number(feature.movie_id),
          movieTitle: feature.movie_title,
          movieYear: feature.movie_year ?? null,
          moviePoster: feature.movie_poster ?? null,
          genre: feature.movie_genre,
          final: Number(feature.final),
          at: feature.recorded_at,
          ends: endsOf(feature.movie_genre, feature.scores),
          excerpt: feature.comment ? excerpt(feature.comment, 220) : null,
          replies: Number(feature.replies) || 0,
          agrees: Number(feature.agrees) || 0,
          disagrees: Number(feature.disagrees) || 0,
        }
      : null,
  };
  cachedAt = Date.now();
  return cached;
}

async function snapshot() {
  const [base, live] = await Promise.all([aggregates(), nowPlaying()]);
  return { ...base, live };
}

module.exports = { snapshot, film, invalidate, FLOOR, WINDOW_DAYS, TAKES };
