const db = require('./db');
const airing = require('./airing');
const { handlesFor, mentionedIn } = require('./handles');

const LIMIT = 60;

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

const rosterStmt = db.prepare(`
  SELECT r.id, r.name FROM club_members m JOIN reviewers r ON r.id = m.reviewer_id
  WHERE m.club_id = ?
`);

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

const knocking = db.prepare(`
  SELECT q.created_at, r.id AS actor_id, r.name AS actor_name, r.dot AS actor_dot, r.avatar_rev AS actor_avatar_rev
  FROM club_join_requests q
  JOIN reviewers r ON r.id = q.reviewer_id
  WHERE q.club_id = ?
  ORDER BY q.created_at DESC
  LIMIT ${LIMIT}
`);

const marksStmt = db.prepare(
  'SELECT notifications_seen_at, notifications_cleared_at FROM club_members WHERE club_id = ? AND reviewer_id = ?'
);
const markSeenStmt = db.prepare(
  "UPDATE club_members SET notifications_seen_at = datetime('now') WHERE club_id = ? AND reviewer_id = ?"
);
const markClearedStmt = db.prepare(
  `UPDATE club_members
   SET notifications_cleared_at = datetime('now'), notifications_seen_at = datetime('now')
   WHERE club_id = ? AND reviewer_id = ?`
);

function excerpt(body, max = 90) {
  const text = String(body || '').replace(/\s+/g, ' ').trim();
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const space = cut.lastIndexOf(' ');
  return (space > max * 0.6 ? cut.slice(0, space) : cut) + '…';
}

function say(kind, item) {
  if (kind === 'comment') return `comentou sua avaliação de ${item.movie_title}`;
  if (kind === 'reply') return `respondeu você em ${item.movie_title}`;
  if (kind === 'mention') return `mencionou você em ${item.movie_title}`;
  if (kind === 'like') return 'curtiu seu comentário';
  if (kind === 'join') return 'pediu para entrar no clube';
  if (kind === 'airing') {
    return `tem episódio novo hoje — ${airing.tagOf(item)}${item.episodeTitle ? ` · ${item.episodeTitle}` : ''}`;
  }
  return item.value === 1
    ? `concordou com sua avaliação de ${item.movie_title}`
    : `discordou da sua avaliação de ${item.movie_title}`;
}

const avatarOf = row =>
  row.actor_avatar_rev ? `/api/reviewers/${row.actor_id}/avatar?v=${row.actor_avatar_rev}` : null;

const actorOf = row => ({
  id: row.actor_id,
  name: row.actor_name,
  dot: row.actor_dot,
  avatar: avatarOf(row),
});

async function forClub({ clubId, me, manda }) {
  const [comments, replies, votes, likes, writing, notes, roster, marks, pedidos, estreias] =
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
      airing.forQueue(clubId, me),
    ]);

  const handles = handlesFor(roster);
  const items = [];

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

  for (const estreia of estreias) {
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

  const already = new Set(items.map(i => i.id));

  for (const row of writing) {
    if (row.reviewer_id === me) continue;
    if (!mentionedIn(row.body, handles).includes(me)) continue;
    if (already.has(`c:${row.id}`) || already.has(`p:${row.id}`)) continue;
    items.push({
      id: `m:${row.id}`,
      kind: 'mention',
      at: row.created_at,
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

  for (const row of notes) {
    if (row.reviewer_id === me) continue;
    if (!mentionedIn(row.comment, handles).includes(me)) continue;
    items.push({
      id: `mr:${row.review_id}`,
      kind: 'mention',
      at: row.recorded_at,
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

  items.sort((a, b) => String(b.at).localeCompare(String(a.at)));

  const clearedAt = marks?.notifications_cleared_at || null;
  const seenAt = marks?.notifications_seen_at || null;
  const visible = (clearedAt ? items.filter(i => String(i.at) > clearedAt) : items).slice(0, LIMIT);

  return { items: visible, seenAt, clearedAt };
}

const unreadIn = (items, seenAt) =>
  seenAt ? items.filter(i => String(i.at) > seenAt).length : items.length;

const marksFor = (clubId, me) => marksStmt.get(clubId, me);
const markSeen = (clubId, me) => markSeenStmt.run(clubId, me);
const markCleared = (clubId, me) => markClearedStmt.run(clubId, me);

module.exports = { forClub, unreadIn, marksFor, markSeen, markCleared, LIMIT };
