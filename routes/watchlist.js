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
   table, the same way the archive reads the TMDB score: the queue row is a
   pointer to a film, and every film in it passed through the catalogue on its
   way here, so the cache knows the name. Null on the film the cache somehow
   never saw, which the card draws as simply not having a second line. */
const listStmt = db.prepare(`
  SELECT w.*, mc.original_title, mc.english_title
  FROM watchlist w
  LEFT JOIN movies_cache mc ON mc.tmdb_id = w.movie_id
  WHERE w.club_id = ?
  ORDER BY w.position IS NULL, w.position ASC, w.added_at DESC
`);
/* `added_by` é a sessão, como toda escrita neste app. Nasceu para o mural ter o
   que contar e hoje é também quem pode tirar — ver o DELETE lá embaixo. */
const insertStmt = db.prepare(`
  INSERT INTO watchlist (club_id, movie_id, movie_title, movie_year, movie_genre, movie_poster, position, added_by)
  VALUES (@clubId, @movieId, @movieTitle, @movieYear, @movieGenre, @moviePoster,
          (SELECT COALESCE(MAX(position), -1) + 1 FROM watchlist WHERE club_id = @clubId), @addedBy)
  ON CONFLICT(club_id, movie_id) DO NOTHING
`);
const idsStmt = db.prepare('SELECT movie_id FROM watchlist WHERE club_id = ?');
const deleteStmt = db.prepare('DELETE FROM watchlist WHERE club_id = ? AND movie_id = ?');
/* Quem pôs, com o nome junto: a recusa precisa dizer de quem é a escolha que
   está sendo protegida, ou vira "não pode" sem sujeito. */
const ownerStmt = db.prepare(`
  SELECT w.movie_id, w.movie_title, w.added_by, r.name AS added_by_name
  FROM watchlist w
  LEFT JOIN reviewers r ON r.id = w.added_by
  WHERE w.club_id = ? AND w.movie_id = ?
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
    /* Quem teve a ideia. A coluna existia só para o feed ter o que contar, e a
       fila em si nunca a mostrava: quarenta pôsteres numa grade, cada um
       escolhido por alguém, e nada na tela dizendo por quem — a pergunta "quem
       foi que pôs esse aí" só tinha resposta no mural, rolando para trás.

       Só o id. O nome, a cor e o retrato são fatos sobre a pessoa e não sobre a
       linha da fila, e o clube inteiro já está carregado no cliente desde o
       boot — mandá-los aqui repetiria os mesmos seis nomes quarenta vezes na
       mesma resposta. Nulo nas linhas anteriores à coluna. */
    addedBy: row.added_by || null
  };
}

router.get('/', clubs.requireReadable, wrap(async (req, res) => {
  const rows = await listStmt.all(req.club.id);
  res.json({ watchlist: rows.map(toDTO) });
}));

// The queue is shared, so changing it is a club action and needs a member.
router.post('/', auth.requireSession, clubs.requireMember, throttleQueue, wrap(async (req, res) => {
  /* Mesmo saneamento da ficha, e pelo mesmo motivo: o id vem de quem escreve, e
     sem teto nos textos a fila é um jeito de gravar um megabyte por chamada. */
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
  /* A fila é do clube inteiro, e é a coleção em que duas pessoas mais tropeçam
     uma na outra: sem isto, dois membros escolhendo o filme da semana ao mesmo
     tempo põem o mesmo título duas vezes porque nenhum dos dois viu o do
     outro. */
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
  res.json({ watchlist: listed.map(toDTO) });
}));

/* ── tirar é de quem pôs ──────────────────────────────────────────────────
   A fila é do clube e continua sendo: qualquer um põe, a ordem é uma só e vale
   para todo mundo, e o filme sai sozinho quando alguém o avalia. O que deixou
   de ser de todos é a tesoura.

   Uma escolha na fila é alguém dizendo "quero ver isto com vocês", e apagar
   isso é desdizer uma pessoa — a mesma regra que a avaliação já segue: ninguém
   apaga a nota de ninguém. Sem isto, uma limpeza bem-intencionada às onze da
   noite tira quatro filmes que outra pessoa vinha esperando há um mês, e não
   sobra registro de que estiveram lá: a linha da fila é a única memória de que
   aquela escolha existiu.

   O administrador é exceção, e é a única. Aqui ele é mesmo o zelador: linhas
   antigas sem dono e escolhas de quem já saiu do clube não podem ficar
   entaladas na fila para sempre, e não há outro caminho para tirá-las.

   Sumir com uma linha que não existe continua sendo 204 e não 404. Duas
   pessoas tirando o mesmo filme ao mesmo tempo — o que agora acontece de
   verdade, com a fila ao vivo — não é erro de ninguém: o pedido queria que o
   filme não estivesse lá, e ele não está. */
router.delete('/:movieId', auth.requireSession, clubs.requireMember, wrap(async (req, res) => {
  const row = await ownerStmt.get(req.club.id, Number(req.params.movieId));
  if (!row) return res.status(204).end();

  /* O zelador agora é o ADM do CLUBE, e não o da instalação: a fila é daquela
     sala, e quem cuida das linhas presas nela é quem cuida da sala. O admin da
     instalação continua valendo porque `requireClubAdmin` o inclui, mas aqui a
     conta é feita direto contra o papel. */
  const mine = !!row.added_by && row.added_by === req.session.reviewer_id;
  if (!mine && !req.club.isClubAdmin && !req.session.is_admin) {
    return res.status(403).json({
      error: row.added_by_name
        ? `Só quem pôs o filme na fila pode tirar, e ${row.movie_title} foi escolha de ${row.added_by_name}.`
        : 'Este filme entrou na fila antes de ela registrar quem põe. Só o administrador do clube pode tirar.'
    });
  }

  await deleteStmt.run(req.club.id, row.movie_id);
  live.emit('watchlist', req.session.reviewer_id, req.club.id);
  res.status(204).end();
}));

module.exports = router;
