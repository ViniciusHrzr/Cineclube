const db = require('./db');
const { handlesFor, mentionedIn } = require('./handles');

/* ══════════════════════════════════════════════════════════════════════════
   OS AVISOS DE UMA SALA. A mesma construção serve duas leituras — o sino de um
   clube e o da REDE, que junta todas as salas de uma pessoa.

   Não existe tabela de notificação: as fontes já são tabelas, com autor e hora
   em cada linha. Gravar o aviso no momento do evento manteria a mesma verdade
   em dois lugares, e o segundo é o que envelhece — um comentário apagado
   deixaria para trás o aviso de que ele existiu. Derivar custa alguns SELECTs
   por leitura num banco de dezenas de linhas por tabela.

   Todas as consultas excluem o PRÓPRIO ator, e não é higiene: sem isso,
   responder um comentário na sua avaliação acenderia o sino para você mesmo.

   Um dos avisos não tem ator nenhum: o episódio que estreia hoje numa série que
   você acompanha. Ele não é reação a coisa nenhuma — é o calendário —, e por
   isso é o único que chega sem retrato e sem nome de gente.

   As marcas d'água ficam por (clube, pessoa) mesmo na leitura da rede: uma
   marca só, por pessoa, faria abrir o sino marcar como visto o que aconteceu
   numa sala que ela nem abriu.
   ══════════════════════════════════════════════════════════════════════════ */

/** Quantos eventos o sino carrega, por sala. Passado isto é histórico. */
const LIMIT = 60;

/* `parent_id IS NULL` porque uma resposta pendurada num comentário da minha
   ficha já me avisa por outro caminho. Sem isto o dono da ficha receberia dois
   avisos do mesmo texto — "comentou sua avaliação" e "respondeu você" — sem
   nem ter escrito o comentário respondido. */
const commentsOnMine = db.prepare(`
  SELECT c.id, c.created_at, c.body,
         a.id AS actor_id, a.name AS actor_name, a.dot AS actor_dot, a.avatar_rev AS actor_avatar_rev,
         rv.id AS review_id, rv.movie_id, rv.movie_title
  FROM review_comments c
  JOIN reviews rv ON rv.id = c.review_id
  JOIN reviewers a ON a.id = c.reviewer_id
  WHERE rv.club_id = ? AND rv.reviewer_id = ? AND c.reviewer_id <> ? AND c.parent_id IS NULL
  ORDER BY c.created_at DESC
  LIMIT ${LIMIT}
`);

/* Respostas aos MEUS comentários, em qualquer ficha. O que importa é quem
   escreveu o comentário respondido, não de quem é a avaliação embaixo. */
const repliesToMine = db.prepare(`
  SELECT c.id, c.created_at, c.body,
         a.id AS actor_id, a.name AS actor_name, a.dot AS actor_dot, a.avatar_rev AS actor_avatar_rev,
         rv.id AS review_id, rv.movie_id, rv.movie_title
  FROM review_comments c
  JOIN review_comments p ON p.id = c.parent_id
  JOIN reviews rv ON rv.id = c.review_id
  JOIN reviewers a ON a.id = c.reviewer_id
  WHERE rv.club_id = ? AND p.reviewer_id = ? AND c.reviewer_id <> ?
  ORDER BY c.created_at DESC
  LIMIT ${LIMIT}
`);

/* Duas fontes, porque há dois lugares onde se escreve: o comentário numa
   conversa e o que a pessoa deixa ao avaliar um filme.

   Vem tudo e a filtragem é em JS: quem foi mencionado depende dos apelidos, que
   dependem de quem mais existe no clube (ver handles.js), e isso não é uma
   pergunta que SQL responde. */
const recentWriting = db.prepare(`
  SELECT c.id, c.created_at, c.body, c.reviewer_id,
         a.name AS actor_name, a.dot AS actor_dot, a.avatar_rev AS actor_avatar_rev,
         rv.id AS review_id, rv.movie_id, rv.movie_title
  FROM review_comments c
  JOIN reviews rv ON rv.id = c.review_id
  JOIN reviewers a ON a.id = c.reviewer_id
  WHERE rv.club_id = ?
  ORDER BY c.created_at DESC
  LIMIT ${LIMIT * 3}
`);

const recentTakeNotes = db.prepare(`
  SELECT rv.id AS review_id, rv.recorded_at, rv.comment, rv.reviewer_id,
         rv.movie_id, rv.movie_title,
         a.name AS actor_name, a.dot AS actor_dot, a.avatar_rev AS actor_avatar_rev
  FROM reviews rv
  JOIN reviewers a ON a.id = rv.reviewer_id
  WHERE rv.club_id = ? AND rv.comment IS NOT NULL AND rv.comment <> ''
  ORDER BY rv.recorded_at DESC
  LIMIT ${LIMIT * 3}
`);

/* O apelido é fato sobre o CLUBE: `@bruno` serve enquanto não houver dois
   Brunos na mesma sala. Calculado sobre a lista da rede, um clube de três
   pessoas herdaria `@brunosa` por causa de um Bruno que ele não conhece. */
const rosterStmt = db.prepare(`
  SELECT r.id, r.name FROM club_members m JOIN reviewers r ON r.id = m.reviewer_id
  WHERE m.club_id = ?
`);

/* A rota de voto já recusa votar na própria ficha, então o segundo termo é
   cinto e suspensório — e o cinto vale, porque linhas gravadas antes daquela
   regra não sabem dela. */
const votesOnMine = db.prepare(`
  SELECT v.value, v.created_at,
         a.id AS actor_id, a.name AS actor_name, a.dot AS actor_dot, a.avatar_rev AS actor_avatar_rev,
         rv.id AS review_id, rv.movie_id, rv.movie_title
  FROM review_votes v
  JOIN reviews rv ON rv.id = v.review_id
  JOIN reviewers a ON a.id = v.reviewer_id
  WHERE rv.club_id = ? AND rv.reviewer_id = ? AND v.reviewer_id <> ?
  ORDER BY v.created_at DESC
  LIMIT ${LIMIT}
`);

/* Curtidas nos meus comentários — em qualquer ficha, inclusive nas dos outros.
   O que importa é quem escreveu o texto. */
const likesOnMine = db.prepare(`
  SELECT l.created_at, c.id AS comment_id, c.body,
         a.id AS actor_id, a.name AS actor_name, a.dot AS actor_dot, a.avatar_rev AS actor_avatar_rev,
         rv.id AS review_id, rv.movie_id, rv.movie_title
  FROM comment_likes l
  JOIN review_comments c ON c.id = l.comment_id
  JOIN reviews rv ON rv.id = c.review_id
  JOIN reviewers a ON a.id = l.reviewer_id
  WHERE rv.club_id = ? AND c.reviewer_id = ? AND l.reviewer_id <> ?
  ORDER BY l.created_at DESC
  LIMIT ${LIMIT}
`);

/* O único aviso que não é sobre uma ficha, e o único que é só para o ADM. Ele
   existe porque um pedido ficava numa lista atrás de perfil → engrenagem →
   Ajustes, e nada dizia que ele estava lá. */
const knocking = db.prepare(`
  SELECT q.created_at, r.id AS actor_id, r.name AS actor_name, r.dot AS actor_dot, r.avatar_rev AS actor_avatar_rev
  FROM club_join_requests q
  JOIN reviewers r ON r.id = q.reviewer_id
  WHERE q.club_id = ?
  ORDER BY q.created_at DESC
  LIMIT ${LIMIT}
`);

/* ── o que estreia hoje ───────────────────────────────────────────────────
   O único aviso sem autor: ninguém fez nada, o dia é que chegou. Vale para as
   séries que VOCÊ acompanha — `added_by` é você —, porque acompanhar é de cada
   um e um aviso sobre a estreia de hoje só serve a quem está esperando por ela.

   Duas fontes, e a segunda existe porque a primeira tem um ponto cego:

   · `episodes_cache` sabe a temporada inteira, datas futuras inclusive, e é
     enchida pelo "o que eu vejo a seguir" toda vez que a lista é aberta. É a
     fonte que acerta a semana seguinte sem ninguém abrir a série.
   · `shows_cache.shape` guarda o próximo a estrear que o TMDB anuncia, e
     alcança a série cuja temporada ainda não foi listada — uma que volta depois
     de dois anos, por exemplo.

   O dia é o de Brasília e não o do servidor: um aviso de estreia que aparece às
   21h de ontem está falando de amanhã para quem lê. Sem horário de verão desde
   2019, três horas é uma conta e não uma tabela.

   Ver upnext.js, que é quem mantém as duas caches frescas. */
const AGORA_BR = "datetime('now', '-3 hours')";

const airingListed = db.prepare(`
  SELECT q.show_id, q.show_title, q.show_poster,
         e.season, e.episode, e.title AS episode_title, e.air_date
  FROM show_queue q
  JOIN episodes_cache e ON e.show_id = q.show_id
  WHERE q.club_id = ? AND q.added_by = ? AND e.air_date = date(${AGORA_BR})
`);

const airingAnnounced = db.prepare(`
  SELECT q.show_id, q.show_title, q.show_poster, sc.shape, date(${AGORA_BR}) AS hoje
  FROM show_queue q
  JOIN shows_cache sc ON sc.tmdb_id = q.show_id
  WHERE q.club_id = ? AND q.added_by = ? AND sc.shape IS NOT NULL
`);

/** As estreias de hoje, sem repetir o episódio que as duas fontes conhecem. */
function airingFrom(listed, announced) {
  const por = new Map();
  for (const row of listed) {
    por.set(`${row.show_id}:${row.season}x${row.episode}`, {
      showId: Number(row.show_id),
      showTitle: row.show_title,
      showPoster: row.show_poster,
      season: Number(row.season),
      episode: Number(row.episode),
      episodeTitle: row.episode_title ?? null,
      airDate: row.air_date,
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
    const chave = `${row.show_id}:${vem.season}x${vem.episode}`;
    if (por.has(chave)) continue;
    por.set(chave, {
      showId: Number(row.show_id),
      showTitle: row.show_title,
      showPoster: row.show_poster,
      season: vem.season,
      episode: vem.episode,
      episodeTitle: vem.title ?? null,
      airDate: vem.airDate,
    });
  }
  return [...por.values()];
}

const marksStmt = db.prepare(
  'SELECT notifications_seen_at, notifications_cleared_at FROM club_members WHERE club_id = ? AND reviewer_id = ?'
);
const markSeenStmt = db.prepare(
  "UPDATE club_members SET notifications_seen_at = datetime('now') WHERE club_id = ? AND reviewer_id = ?"
);
/* Limpar é também ter visto: sem mover as duas juntas, a lista esvaziaria e o
   contador continuaria acusando avisos que ninguém consegue mais abrir. */
const markClearedStmt = db.prepare(
  `UPDATE club_members
   SET notifications_cleared_at = datetime('now'), notifications_seen_at = datetime('now')
   WHERE club_id = ? AND reviewer_id = ?`
);

/* Um pedaço do que foi escrito, para o aviso ter conteúdo em vez de só contar
   que alguma coisa aconteceu. Cortado na palavra, não no caractere: um trecho
   que termina no meio de uma sílaba parece defeito. */
function excerpt(body, max = 90) {
  const text = String(body || '').replace(/\s+/g, ' ').trim();
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const space = cut.lastIndexOf(' ');
  return (space > max * 0.6 ? cut.slice(0, space) : cut) + '…';
}

/* O texto vem pronto do servidor: montar a frase na tela a partir de um `kind`
   espalharia a redação do produto por um switch no cliente, e a redação é
   conteúdo autoral aqui. */
function say(kind, item) {
  if (kind === 'comment') return `comentou sua avaliação de ${item.movie_title}`;
  if (kind === 'reply') return `respondeu você em ${item.movie_title}`;
  if (kind === 'mention') return `mencionou você em ${item.movie_title}`;
  if (kind === 'like') return 'curtiu seu comentário';
  if (kind === 'join') return 'pediu para entrar no clube';
  if (kind === 'airing') {
    const tag = `T${item.season}E${String(item.episode).padStart(2, '0')}`;
    return `tem episódio novo hoje — ${tag}${item.episodeTitle ? ` · ${item.episodeTitle}` : ''}`;
  }
  return item.value === 1
    ? `concordou com sua avaliação de ${item.movie_title}`
    : `discordou da sua avaliação de ${item.movie_title}`;
}

/* O retrato viaja no aviso, repetindo a mesma URL dezenas de vezes na mesma
   resposta. É de propósito: o sino junta as salas todas, e o elenco carregado
   na tela é o de uma só — sem o retrato aqui, quem avisa de outra sala vira uma
   etiqueta colorida, que é a informação que faz a linha ser reconhecida antes
   de ser lida. */
const avatarOf = row =>
  row.actor_avatar_rev ? `/api/reviewers/${row.actor_id}/avatar?v=${row.actor_avatar_rev}` : null;

const actorOf = row => ({
  id: row.actor_id,
  name: row.actor_name,
  dot: row.actor_dot,
  avatar: avatarOf(row),
});

/* Os avisos de UMA sala, já filtrados pela marca de "limpo" dela. Quem chama
   decide o que fazer com as marcas: o sino de um clube conta o não lido daquela
   sala, o da rede soma o de todas. */
async function forClub({ clubId, me, manda }) {
  const [comments, replies, votes, likes, writing, notes, roster, marks, pedidos, listed, announced] =
    await Promise.all([
      commentsOnMine.all(clubId, me, me),
      repliesToMine.all(clubId, me, me),
      votesOnMine.all(clubId, me, me),
      likesOnMine.all(clubId, me, me),
      recentWriting.all(clubId),
      recentTakeNotes.all(clubId),
      rosterStmt.all(clubId),
      marksStmt.get(clubId, me),
      manda ? knocking.all(clubId) : [],
      airingListed.all(clubId, me),
      airingAnnounced.all(clubId, me),
    ]);

  const handles = handlesFor(roster);
  const items = [];

  /* Sem `movieId` e sem `reviewId`: este aviso não aponta para uma ficha, aponta
     para a porta do clube. A tela sabe o que fazer com ele pelo `kind`. */
  for (const row of pedidos) {
    if (row.actor_id === me) continue;
    items.push({
      id: `j:${row.actor_id}`,
      kind: 'join',
      at: row.created_at,
      actor: actorOf(row),
      text: say('join', row),
    });
  }

  /* Meia-noite e não a hora da leitura: a hora decide o que é "não lido", e um
     aviso carimbado com o instante em que o sino foi aberto nasceria sempre
     novo. Assim ele acende uma vez no dia e cala depois de visto. */
  for (const estreia of airingFrom(listed, announced)) {
    items.push({
      id: `air:${estreia.showId}:${estreia.season}x${estreia.episode}`,
      kind: 'airing',
      at: `${estreia.airDate} 00:00:00`,
      showId: estreia.showId,
      showTitle: estreia.showTitle,
      showPoster: estreia.showPoster,
      season: estreia.season,
      episode: estreia.episode,
      text: say('airing', estreia),
    });
  }

  /* `commentId` é o que faz o aviso levar ao TEXTO e não só à ficha: sem ele o
     link abria a avaliação certa e deixava a pessoa procurando qual resposta o
     sino anunciou. */
  for (const row of comments) {
    items.push({
      id: `c:${row.id}`,
      kind: 'comment',
      at: row.created_at,
      actor: actorOf(row),
      movieId: Number(row.movie_id),
      reviewId: row.review_id,
      commentId: row.id,
      text: say('comment', row),
      excerpt: excerpt(row.body),
    });
  }

  for (const row of replies) {
    items.push({
      id: `p:${row.id}`,
      kind: 'reply',
      at: row.created_at,
      actor: actorOf(row),
      movieId: Number(row.movie_id),
      reviewId: row.review_id,
      commentId: row.id,
      text: say('reply', row),
      excerpt: excerpt(row.body),
    });
  }

  /* Um texto que menciona alguém pode ser a mesma linha que já virou aviso por
     outro motivo. Entre "respondeu você" e "mencionou você", a resposta é o
     fato mais forte e chega primeiro. */
  const already = new Set(items.map(i => i.id));

  for (const row of writing) {
    if (row.reviewer_id === me) continue;
    if (!mentionedIn(row.body, handles).includes(me)) continue;
    if (already.has(`c:${row.id}`) || already.has(`p:${row.id}`)) continue;
    items.push({
      id: `m:${row.id}`,
      kind: 'mention',
      at: row.created_at,
      /* Nas menções o ator é o AUTOR do texto, então o id vem de `reviewer_id`
         e não do `actor_id` das outras consultas. */
      actor: {
        id: row.reviewer_id,
        name: row.actor_name,
        dot: row.actor_dot,
        avatar: avatarOf({ actor_id: row.reviewer_id, actor_avatar_rev: row.actor_avatar_rev }),
      },
      movieId: Number(row.movie_id),
      reviewId: row.review_id,
      commentId: row.id,
      text: say('mention', row),
      excerpt: excerpt(row.body),
    });
  }

  /* E o comentário que a pessoa deixa na própria ficha ao avaliar: é o outro
     lugar do produto onde se escreve, então é o outro lugar onde se chama
     alguém pelo nome. */
  for (const row of notes) {
    if (row.reviewer_id === me) continue;
    if (!mentionedIn(row.comment, handles).includes(me)) continue;
    items.push({
      id: `mr:${row.review_id}`,
      kind: 'mention',
      at: row.recorded_at,
      /* Nas menções o ator é o AUTOR do texto, então o id vem de `reviewer_id`
         e não do `actor_id` das outras consultas. */
      actor: {
        id: row.reviewer_id,
        name: row.actor_name,
        dot: row.actor_dot,
        avatar: avatarOf({ actor_id: row.reviewer_id, actor_avatar_rev: row.actor_avatar_rev }),
      },
      movieId: Number(row.movie_id),
      reviewId: row.review_id,
      text: say('mention', row),
      excerpt: excerpt(row.comment),
    });
  }

  /* Um por pessoa por ficha, agora que o voto é da ficha inteira: eram até onze
     avisos da mesma pessoa sobre a mesma avaliação. */
  for (const row of votes) {
    items.push({
      id: `v:${row.review_id}:${row.actor_id}`,
      kind: 'vote',
      at: row.created_at,
      actor: actorOf(row),
      movieId: Number(row.movie_id),
      reviewId: row.review_id,
      value: Number(row.value),
      text: say('vote', row),
    });
  }

  for (const row of likes) {
    items.push({
      id: `l:${row.comment_id}:${row.actor_id}`,
      kind: 'like',
      at: row.created_at,
      actor: actorOf(row),
      movieId: Number(row.movie_id),
      reviewId: row.review_id,
      commentId: row.comment_id,
      text: say('like', row),
      excerpt: excerpt(row.body),
    });
  }

  /* Ordenado depois de juntar, e não por consulta: as fontes chegam ordenadas
     entre si e desordenadas umas com as outras. Comparação de string funciona
     porque datetime('now') grava YYYY-MM-DD HH:MM:SS, que ordena como texto. */
  items.sort((a, b) => String(b.at).localeCompare(String(a.at)));

  /* Dispensado fica de fora da lista, e não só marcado. */
  const clearedAt = marks?.notifications_cleared_at || null;
  const seenAt = marks?.notifications_seen_at || null;
  const visible = (clearedAt ? items.filter(i => String(i.at) > clearedAt) : items).slice(0, LIMIT);

  return { items: visible, seenAt, clearedAt };
}

/** Quantos dos avisos desta sala chegaram depois da última abertura do sino. */
const unreadIn = (items, seenAt) =>
  seenAt ? items.filter(i => String(i.at) > seenAt).length : items.length;

const marksFor = (clubId, me) => marksStmt.get(clubId, me);
const markSeen = (clubId, me) => markSeenStmt.run(clubId, me);
const markCleared = (clubId, me) => markClearedStmt.run(clubId, me);

module.exports = { forClub, unreadIn, marksFor, markSeen, markCleared, LIMIT };
