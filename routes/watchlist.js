const express = require('express');
const db = require('../db');
const auth = require('../auth');
const clubs = require('../clubs');
const wrap = require('../wrap');
const { fillEnglishTitle } = require('../english');
const { cleanMovie } = require('../movie');
const throttle = require('../throttle');
const live = require('../live');

const router = express.Router({ mergeParams: true });

/* Encher a fila é um gesto de escolher, e escolher é lento. Sessenta por hora é
   uma tarde inteira montando a temporada do clube, e é pouco para um programa. */
const throttleQueue = throttle.limit({
  name: 'watchlist',
  max: 60,
  windowMs: 60 * 60_000,
  message: espera => `Muitos filmes postos na fila seguidos. Tente de novo em ${espera}.`,
});

/* position is the club's arrangement; added_at only breaks ties for rows that
   predate the column.

   The original title comes through the cache rather than being copied into this
   table: a queue row is a pointer to a film, and every film in it passed through
   the catalogue on its way here. */
const listStmt = db.prepare(`
  SELECT w.*, mc.original_title, mc.english_title
  FROM watchlist w
  LEFT JOIN movies_cache mc ON mc.tmdb_id = w.movie_id
  WHERE w.club_id = ?
  ORDER BY w.position IS NULL, w.position ASC, w.added_at DESC
`);
/* `added_by` é a sessão, como toda escrita neste app, e desde que "quero ver"
   passou a ser de cada um ele é parte da chave — ver a migração em db.js.
   Apertar duas vezes continua sendo uma linha: o gesto é "eu quero ver isto", e
   repetir não muda o que ele diz.

   A posição é a do FILME e não da linha: quem chega depois querendo o mesmo
   filme entra no lugar que ele já tem na fila do clube, senão a mesma obra teria
   duas posições e o arrasto de uma delas não levaria a outra. */
const insertStmt = db.prepare(`
  INSERT INTO watchlist (club_id, movie_id, movie_title, movie_year, movie_genre, movie_poster, position, added_by)
  VALUES (@clubId, @movieId, @movieTitle, @movieYear, @movieGenre, @moviePoster,
          COALESCE(
            (SELECT MIN(position) FROM watchlist WHERE club_id = @clubId AND movie_id = @movieId),
            (SELECT COALESCE(MAX(position), -1) + 1 FROM watchlist WHERE club_id = @clubId)),
          @addedBy)
  ON CONFLICT(club_id, movie_id, added_by) DO NOTHING
`);
const idsStmt = db.prepare('SELECT DISTINCT movie_id FROM watchlist WHERE club_id = ?');
/* Tirar o seu, e — só para o zelador — tirar o filme da fila inteira. */
const deleteMineStmt = db.prepare('DELETE FROM watchlist WHERE club_id = ? AND movie_id = ? AND added_by = ?');
const deleteStmt = db.prepare('DELETE FROM watchlist WHERE club_id = ? AND movie_id = ?');
/* Quem quer ver, com os nomes junto: a recusa precisa dizer de quem é a escolha
   que está sendo protegida, ou vira "não pode" sem sujeito. */
const wantersStmt = db.prepare(`
  SELECT w.movie_id, w.movie_title, w.added_by, r.name AS added_by_name
  FROM watchlist w
  LEFT JOIN reviewers r ON r.id = w.added_by
  WHERE w.club_id = ? AND w.movie_id = ?
  ORDER BY w.added_at ASC
`);

const SET_POSITION = 'UPDATE watchlist SET position = ? WHERE club_id = ? AND movie_id = ?';

function toDTO(row) {
  return {
    id: row.movie_id,
    title: row.movie_title,
    original: row.original_title ?? null,
    english: row.english_title ?? null,
    year: row.movie_year,
    genre: row.movie_genre,
    poster: row.movie_poster,
    addedAt: row.added_at,
    /* Quem quer ver — e são vários, porque a fila é de cada um e o cartaz é um
       só. A coluna existia para o mural, e a fila nunca a mostrava: quarenta
       pôsteres, cada um escolhido por alguém, e nada na tela dizendo por quem.

       Só os ids: o nome, a cor e o retrato são fatos sobre a pessoa e não sobre
       a linha, e o clube inteiro já está carregado no cliente desde o boot. A
       linha sem dono — anterior à coluna, ou de quem saiu do clube — não entra
       na lista: ela é o balde de "sem registro", e um id vazio ali seria uma
       pessoa que não existe. */
    wanters: row.added_by ? [row.added_by] : [],
  };
}

/* ── uma linha por pessoa no banco, um cartaz por filme na tela ───────────
   A fila é uma fila de FILMES — é isso que a ordem dela significa, e é isso que
   se arrasta. Duas pessoas querendo a mesma obra não são dois lugares na fila:
   são o mesmo lugar, querido por duas pessoas.

   Agrupado aqui e não em SQL porque a ordem importa duas vezes: a dos filmes é a
   do clube, e a das pessoas dentro de um filme é a da chegada. `GROUP_CONCAT` não
   promete ordem nenhuma. */
function toQueue(rows) {
  const films = new Map();
  for (const row of rows) {
    const held = films.get(row.movie_id);
    if (!held) films.set(row.movie_id, toDTO(row));
    else if (row.added_by && !held.wanters.includes(row.added_by)) held.wanters.push(row.added_by);
  }
  return [...films.values()];
}

router.get('/', clubs.requireReadable, wrap(async (req, res) => {
  const rows = await listStmt.all(req.club.id);
  res.json({ watchlist: toQueue(rows) });
}));

// The queue is shared, so changing it is a club action and needs a member.
router.post('/', auth.requireSession, clubs.requireMember, throttleQueue, wrap(async (req, res) => {
  /* Mesmo saneamento da ficha: o id vem de quem escreve, e sem teto nos textos a
     fila é um jeito de gravar um megabyte por chamada. */
  const limpo = cleanMovie(req.body?.movie);
  if (limpo.error) return res.status(400).json({ error: limpo.error });
  const movie = limpo.movie;

  await insertStmt.run({
    clubId: req.club.id,
    movieId: movie.id, movieTitle: movie.title, movieYear: movie.year,
    movieGenre: movie.genre, moviePoster: movie.poster,
    addedBy: req.session.reviewer_id
  });
  /* A fila é uma das telas que filtram o banco, então o filme entra nela já
     sabendo por quais nomes pode ser procurado depois. */
  await fillEnglishTitle(movie.id);
  /* A fila é a coleção em que duas pessoas mais tropeçam uma na outra: sem
     isto, dois membros escolhendo o filme da semana ao mesmo tempo veem filas
     diferentes até recarregar. */
  live.emit('watchlist', req.session.reviewer_id, req.club.id);
  res.status(201).json({ ok: true });
}));

/* Reordering the queue. The client sends the whole order it wants, which is
   simpler to reason about than a from/to pair and cannot leave a gap: anything
   the client omits keeps its relative place at the end, so a stale tab cannot
   drop a film somebody else just added. */
router.put('/order', auth.requireSession, clubs.requireMember, wrap(async (req, res) => {
  const ids = req.body?.ids;
  if (!Array.isArray(ids)) return res.status(400).json({ error: 'Ordem inválida.' });

  const rows = await idsStmt.all(req.club.id);
  const known = new Set(rows.map(r => Number(r.movie_id)));
  const wanted = ids.map(Number).filter(id => known.has(id));
  const rest = [...known].filter(id => !wanted.includes(id));

  // batch runs the whole thing in one transaction: either the queue moves or
  // nothing does.
  const ordered = [...wanted, ...rest];
  if (ordered.length) {
    await db.batch(ordered.map((id, i) => ({ sql: SET_POSITION, args: [i, req.club.id, id] })));
  }

  const listed = await listStmt.all(req.club.id);
  live.emit('watchlist', req.session.reviewer_id, req.club.id);
  res.json({ watchlist: toQueue(listed) });
}));

/* ── cada um tira o seu ───────────────────────────────────────────────────
   "Quero ver" é uma frase de uma pessoa, e apagar isso é desdizer alguém — a
   mesma regra que a avaliação já segue. Sem ela, uma limpeza bem-intencionada
   tira quatro filmes que outra pessoa vinha esperando, e a linha da fila é a
   única memória de que aquela escolha existiu.

   Então tirar o seu é sempre seu direito, e o seu é só o seu: o filme sai do
   cartaz da fila quando a última pessoa que o queria desistir. Quem não o quer
   não tem o que tirar — e é por isso que o marcador do catálogo nunca aparece
   aceso num filme que você não pediu.

   O ADM é exceção e é a única: ele tira o cartaz inteiro, que é o único caminho
   para fora da fila das linhas sem dono e das escolhas de quem já saiu do clube.

   Sumir com uma linha que não existe continua sendo 204 e não 404: o pedido
   queria que o filme não estivesse lá, e ele não está. */
router.delete('/:movieId', auth.requireSession, clubs.requireMember, wrap(async (req, res) => {
  const rows = await wantersStmt.all(req.club.id, Number(req.params.movieId));
  if (!rows.length) return res.status(204).end();

  const movieId = rows[0].movie_id;
  const mine = rows.some(r => r.added_by && r.added_by === req.session.reviewer_id);
  /* O zelador é o ADM do CLUBE e não o da instalação: a fila é daquela sala. O
     admin da instalação continua valendo porque `requireClubAdmin` o inclui,
     mas aqui a conta é feita direto contra o papel. */
  if (!mine && !req.club.isClubAdmin && !req.session.is_admin) {
    const names = [...new Set(rows.map(r => r.added_by_name).filter(Boolean))];
    return res.status(403).json({
      error: names.length
        ? `Cada um tira o seu, e ${rows[0].movie_title} está na fila de ${names.join(', ')}.`
        : 'Este filme entrou na fila antes de ela registrar quem põe. Só o administrador do clube pode tirar.'
    });
  }

  if (mine) await deleteMineStmt.run(req.club.id, movieId, req.session.reviewer_id);
  else await deleteStmt.run(req.club.id, movieId);
  live.emit('watchlist', req.session.reviewer_id, req.club.id);
  res.status(204).end();
}));

module.exports = router;
