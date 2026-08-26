const express = require('express');
const db = require('../db');
const auth = require('../auth');
const wrap = require('../wrap');
const { critsFor } = require('../criteria');
const { handlesFor, mentionedIn } = require('../handles');

const router = express.Router();

/* ══════════════════════════════════════════════════════════════════════════
   Quem reagiu ao que é seu.

   Três coisas acontecem com o que uma pessoa deixou no clube: alguém comenta a
   ficha dela, alguém vota em uma nota dela, alguém curte um comentário dela.
   Esta rota junta as três, da mais nova para a mais velha.

   ── por que não existe tabela de notificação ────────────────────────────
   Porque as três já são tabelas, com autor e hora em cada linha. Gravar um
   aviso no momento em que o evento acontece seria manter a mesma verdade em
   dois lugares, e o segundo lugar é o que envelhece: um comentário apagado
   deixaria para trás o aviso de que ele existiu, um voto desfeito idem, e o
   contador passaria a contar coisas que não estão mais lá.

   Derivar custa três SELECTs por leitura, num banco de dezenas de linhas por
   tabela. É barato agora e vai continuar sendo por muito mais tempo do que este
   clube vai existir. O dia em que não for, a troca é trocar este arquivo.

   ── o que não é notificação ─────────────────────────────────────────────
   O que você mesmo fez. Comentar a própria ficha é permitido e é metade de uma
   conversa, mas ninguém precisa ser avisado de que falou. As três consultas
   abaixo excluem o próprio ator, e não é só higiene: sem isso, responder um
   comentário na sua própria avaliação acenderia o sino para você mesmo.
   ══════════════════════════════════════════════════════════════════════════ */

/** Quantos eventos o sino carrega. Passado isto é histórico, não aviso. */
const LIMIT = 60;

/* Comentários nas minhas avaliações. O JOIN em reviews é o que decide de quem
   é a ficha; o autor do comentário vem de reviewers para o feed ter um nome.

   `parent_id IS NULL` porque uma resposta pendurada num comentário da minha
   ficha já me avisa por outro caminho — e sem isto o dono da ficha receberia
   dois avisos do mesmo texto, um dizendo "comentou sua avaliação" e outro
   "respondeu você", quando ele nem escreveu o comentário respondido. */
const commentsOnMine = db.prepare(`
  SELECT c.id, c.created_at, c.body,
         a.id AS actor_id, a.name AS actor_name, a.dot AS actor_dot,
         rv.id AS review_id, rv.movie_id, rv.movie_title
  FROM review_comments c
  JOIN reviews rv ON rv.id = c.review_id
  JOIN reviewers a ON a.id = c.reviewer_id
  WHERE rv.reviewer_id = ? AND c.reviewer_id <> ? AND c.parent_id IS NULL
  ORDER BY c.created_at DESC
  LIMIT ${LIMIT}
`);

/* Respostas aos MEUS comentários, em qualquer ficha. O que importa é quem
   escreveu o comentário respondido, não de quem é a avaliação embaixo. */
const repliesToMine = db.prepare(`
  SELECT c.id, c.created_at, c.body,
         a.id AS actor_id, a.name AS actor_name, a.dot AS actor_dot,
         rv.id AS review_id, rv.movie_id, rv.movie_title
  FROM review_comments c
  JOIN review_comments p ON p.id = c.parent_id
  JOIN reviews rv ON rv.id = c.review_id
  JOIN reviewers a ON a.id = c.reviewer_id
  WHERE p.reviewer_id = ? AND c.reviewer_id <> ?
  ORDER BY c.created_at DESC
  LIMIT ${LIMIT}
`);

/* ── e quem me chamou pelo nome ───────────────────────────────────────────
   Duas fontes, porque há dois lugares onde se escreve neste produto: o
   comentário numa conversa e o comentário que a própria pessoa deixa ao avaliar
   um filme. Uma menção no segundo é tão menção quanto no primeiro.

   Vem tudo e a filtragem é em JS, contra o clube inteiro: quem foi mencionado
   depende dos apelidos, que dependem de quem mais existe no clube (ver
   handles.js), e isso não é uma pergunta que SQL responde. Num acervo de
   dezenas de linhas, ler e filtrar é mais barato do que a complexidade de
   tentar o contrário. */
const recentWriting = db.prepare(`
  SELECT c.id, c.created_at, c.body, c.reviewer_id,
         a.name AS actor_name, a.dot AS actor_dot,
         rv.id AS review_id, rv.movie_id, rv.movie_title
  FROM review_comments c
  JOIN reviews rv ON rv.id = c.review_id
  JOIN reviewers a ON a.id = c.reviewer_id
  ORDER BY c.created_at DESC
  LIMIT ${LIMIT * 3}
`);

const recentTakeNotes = db.prepare(`
  SELECT rv.id AS review_id, rv.recorded_at, rv.comment, rv.reviewer_id,
         rv.movie_id, rv.movie_title,
         a.name AS actor_name, a.dot AS actor_dot
  FROM reviews rv
  JOIN reviewers a ON a.id = rv.reviewer_id
  WHERE rv.comment IS NOT NULL AND rv.comment <> ''
  ORDER BY rv.recorded_at DESC
  LIMIT ${LIMIT * 3}
`);

const rosterStmt = db.prepare('SELECT id, name FROM reviewers');

/* Votos em critérios das minhas avaliações. A rota de voto já recusa votar na
   própria ficha, então o segundo termo é cinto e suspensório — e o cinto vale,
   porque linhas gravadas antes daquela regra existirem não sabem dela. */
const votesOnMine = db.prepare(`
  SELECT v.criterion_key, v.value, v.created_at,
         a.id AS actor_id, a.name AS actor_name, a.dot AS actor_dot,
         rv.id AS review_id, rv.movie_id, rv.movie_title, rv.movie_genre, rv.scores
  FROM criterion_votes v
  JOIN reviews rv ON rv.id = v.review_id
  JOIN reviewers a ON a.id = v.reviewer_id
  WHERE rv.reviewer_id = ? AND v.reviewer_id <> ?
  ORDER BY v.created_at DESC
  LIMIT ${LIMIT}
`);

/* Curtidas nos meus comentários — em qualquer ficha, inclusive nas dos outros.
   O que importa é quem escreveu o texto. */
const likesOnMine = db.prepare(`
  SELECT l.created_at, c.id AS comment_id, c.body,
         a.id AS actor_id, a.name AS actor_name, a.dot AS actor_dot,
         rv.id AS review_id, rv.movie_id, rv.movie_title
  FROM comment_likes l
  JOIN review_comments c ON c.id = l.comment_id
  JOIN reviews rv ON rv.id = c.review_id
  JOIN reviewers a ON a.id = l.reviewer_id
  WHERE c.reviewer_id = ? AND l.reviewer_id <> ?
  ORDER BY l.created_at DESC
  LIMIT ${LIMIT}
`);

const marksStmt = db.prepare(
  'SELECT notifications_seen_at, notifications_cleared_at FROM reviewers WHERE id = ?'
);
const markSeenStmt = db.prepare(
  "UPDATE reviewers SET notifications_seen_at = datetime('now') WHERE id = ?"
);
/* Limpar é também ter visto: sem mover as duas juntas, a lista esvaziaria e o
   contador continuaria acusando avisos que ninguém consegue mais abrir. */
const markClearedStmt = db.prepare(
  `UPDATE reviewers
   SET notifications_cleared_at = datetime('now'), notifications_seen_at = datetime('now')
   WHERE id = ?`
);

/** O nome do critério como a ficha o fez, para o aviso dizer "Fotografia". */
function criterionName(genre, key) {
  const found = critsFor(genre).find(c => c.key === key);
  return found ? found.name : key;
}

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

/* O texto vem pronto do servidor. A alternativa é a tela montar a frase a
   partir de um `kind` e de meia dúzia de campos, o que espalha a redação do
   produto por um switch no cliente — e a redação é conteúdo autoral aqui. */
function say(kind, item) {
  if (kind === 'comment') return `comentou sua avaliação de ${item.movie_title}`;
  if (kind === 'reply') return `respondeu você em ${item.movie_title}`;
  if (kind === 'mention') return `mencionou você em ${item.movie_title}`;
  if (kind === 'like') return 'curtiu seu comentário';
  return item.value === 1
    ? `concordou com seu ${item.criterionName} em ${item.movie_title}`
    : `discordou do seu ${item.criterionName} em ${item.movie_title}`;
}

const actorOf = row => ({ id: row.actor_id, name: row.actor_name, dot: row.actor_dot });

router.get('/', auth.requireSession, wrap(async (req, res) => {
  const me = req.session.reviewer_id;
  const [comments, replies, votes, likes, writing, notes, roster, marks] = await Promise.all([
    commentsOnMine.all(me, me),
    repliesToMine.all(me, me),
    votesOnMine.all(me, me),
    likesOnMine.all(me, me),
    recentWriting.all(),
    recentTakeNotes.all(),
    rosterStmt.all(),
    marksStmt.get(me)
  ]);

  const handles = handlesFor(roster);
  const items = [];

  for (const row of comments) {
    items.push({
      id: `c:${row.id}`,
      kind: 'comment',
      at: row.created_at,
      actor: actorOf(row),
      movieId: Number(row.movie_id),
      reviewId: row.review_id,
      text: say('comment', row),
      excerpt: excerpt(row.body)
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
      text: say('reply', row),
      excerpt: excerpt(row.body)
    });
  }

  /* ── quem me chamou pelo nome ─────────────────────────────────────────
     Um texto que menciona alguém pode ser a mesma linha que já virou aviso por
     outro motivo — responder alguém e mencioná-lo na mesma frase é natural. O
     `seen` guarda os ids já usados para que o sino não diga duas vezes a mesma
     coisa: entre "respondeu você" e "mencionou você", a resposta é o fato mais
     forte e chega primeiro. */
  const already = new Set(items.map(i => i.id));

  for (const row of writing) {
    if (row.reviewer_id === me) continue;
    if (!mentionedIn(row.body, handles).includes(me)) continue;
    if (already.has(`c:${row.id}`) || already.has(`p:${row.id}`)) continue;
    items.push({
      id: `m:${row.id}`,
      kind: 'mention',
      at: row.created_at,
      actor: { id: row.reviewer_id, name: row.actor_name, dot: row.actor_dot },
      movieId: Number(row.movie_id),
      reviewId: row.review_id,
      text: say('mention', row),
      excerpt: excerpt(row.body)
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
      actor: { id: row.reviewer_id, name: row.actor_name, dot: row.actor_dot },
      movieId: Number(row.movie_id),
      reviewId: row.review_id,
      text: say('mention', row),
      excerpt: excerpt(row.comment)
    });
  }

  for (const row of votes) {
    /* O nome do critério depende do gênero sob o qual a ficha foi gravada, que
       é o mesmo motivo pelo qual o detalhamento também lê dali: 'atuacoes' numa
       animação chama-se Vozes. */
    const named = criterionName(row.movie_genre, row.criterion_key);
    items.push({
      id: `v:${row.review_id}:${row.criterion_key}:${row.actor_id}`,
      kind: 'vote',
      at: row.created_at,
      actor: actorOf(row),
      movieId: Number(row.movie_id),
      reviewId: row.review_id,
      value: Number(row.value),
      criterion: named,
      text: say('vote', { ...row, criterionName: named })
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
      text: say('like', row),
      excerpt: excerpt(row.body)
    });
  }

  /* Ordenado depois de juntar, e não por consulta: as três chegam ordenadas
     entre si e desordenadas umas com as outras. Comparação de string funciona
     porque datetime('now') grava YYYY-MM-DD HH:MM:SS, que ordena como texto. */
  items.sort((a, b) => String(b.at).localeCompare(String(a.at)));

  /* Dispensado fica de fora da lista, e não só marcado. Comparação de string
     funciona porque datetime('now') grava YYYY-MM-DD HH:MM:SS, que ordena como
     texto. */
  const clearedAt = marks?.notifications_cleared_at || null;
  const feed = (clearedAt ? items.filter(i => String(i.at) > clearedAt) : items).slice(0, LIMIT);

  const seenAt = marks?.notifications_seen_at || null;
  const unread = seenAt ? feed.filter(i => String(i.at) > seenAt).length : feed.length;

  res.json({ items: feed, unread, seenAt, clearedAt });
}));

/* ── limpar o sino ────────────────────────────────────────────────────────
   Esvazia a lista de quem pediu, e de mais ninguém. Não apaga comentário, voto
   nem curtida: um aviso é a projeção de uma linha que pertence a outra pessoa,
   e o botão de limpar o próprio sino não tem o direito de apagar o que alguém
   escreveu. O que ele move é uma data.

   O que chegar depois volta a aparecer, porque nada foi destruído — só deixou
   de estar depois da marca. */
router.post('/clear', auth.requireSession, wrap(async (req, res) => {
  await markClearedStmt.run(req.session.reviewer_id);
  const row = await marksStmt.get(req.session.reviewer_id);
  res.json({
    seenAt: row?.notifications_seen_at || null,
    clearedAt: row?.notifications_cleared_at || null
  });
}));

/* Marca tudo como visto. Uma data, não uma lista: ver o sino aberto é ver o que
   está nele, e um item por item aqui seria estado que ninguém pediu. */
router.post('/seen', auth.requireSession, wrap(async (req, res) => {
  await markSeenStmt.run(req.session.reviewer_id);
  const row = await marksStmt.get(req.session.reviewer_id);
  res.json({ seenAt: row?.notifications_seen_at || null });
}));

module.exports = router;
