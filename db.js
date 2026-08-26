const path = require('node:path');
const fs = require('node:fs');
const { createClient } = require('@libsql/client');

/* ══════════════════════════════════════════════════════════════════════════
   The database.

   This is libSQL — a fork of SQLite — so every query in this app is still
   SQLite: datetime('now'), julianday(), COLLATE NOCASE, PRAGMA. What changed
   against node:sqlite is only the calling convention: everything here is
   async, because in production the database sits across a network.

   Without TURSO_DATABASE_URL the client opens a local file instead, which is
   how the tests and development on this machine run — no network, no account,
   no token.
   ══════════════════════════════════════════════════════════════════════════ */

const remoteUrl = process.env.TURSO_DATABASE_URL;
// CINECLUBE_DB lets the tests point at a throwaway file instead of the real one.
const localPath = process.env.CINECLUBE_DB || path.join(__dirname, 'data', 'cineclube.db');
const isLocal = !remoteUrl;

if (isLocal) fs.mkdirSync(path.dirname(localPath), { recursive: true });

const client = createClient({
  url: remoteUrl || 'file:' + localPath,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

/* A single object argument means named parameters (@id, @title); anything
   else is positional. No value this app stores is an object, so the
   distinction is never ambiguous. */
function argsOf(args) {
  const [first] = args;
  if (args.length === 1 && first !== null && typeof first === 'object' && !Array.isArray(first)) {
    return first;
  }
  return args;
}

/* Keeps the shape node:sqlite had — prepare().get()/.all()/.run() — because
   that is the shape the routes already speak. The difference is that every one
   of them now returns a promise. */
function prepare(sql) {
  return {
    async get(...args) {
      const { rows } = await client.execute({ sql, args: argsOf(args) });
      return rows[0];
    },
    async all(...args) {
      const { rows } = await client.execute({ sql, args: argsOf(args) });
      return rows;
    },
    async run(...args) {
      return client.execute({ sql, args: argsOf(args) });
    },
  };
}

/** Several statements at once, no parameters. For DDL. */
function exec(sql) {
  return client.executeMultiple(sql);
}

/** A list of statements in one transaction. Replaces the manual BEGIN/COMMIT. */
function batch(statements) {
  return client.batch(statements, 'write');
}

async function columnsOf(table) {
  const { rows } = await client.execute(`PRAGMA table_info(${table})`);
  return rows.map(c => c.name);
}

async function migrate() {
  // WAL and foreign_keys only mean something for a local file; on Turso the
  // server already handles both and the PRAGMA is refused.
  if (isLocal) {
    await exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  }

  await exec(`
    CREATE TABLE IF NOT EXISTS reviewers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      dot TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS reviews (
      id TEXT PRIMARY KEY,
      reviewer_id TEXT NOT NULL REFERENCES reviewers(id) ON DELETE CASCADE,
      movie_id INTEGER NOT NULL,
      movie_title TEXT NOT NULL,
      movie_year INTEGER,
      movie_genre TEXT NOT NULL,
      movie_poster TEXT,
      movie_director TEXT,
      scores TEXT NOT NULL,
      final REAL NOT NULL,
      date TEXT NOT NULL,
      comment TEXT,
      UNIQUE(reviewer_id, movie_id)
    );

    CREATE TABLE IF NOT EXISTS movies_cache (
      tmdb_id INTEGER PRIMARY KEY,
      title TEXT NOT NULL,
      year INTEGER,
      genre TEXT NOT NULL,
      poster TEXT,
      director TEXT,
      cached_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS watchlist (
      movie_id INTEGER PRIMARY KEY,
      movie_title TEXT NOT NULL,
      movie_year INTEGER,
      movie_genre TEXT NOT NULL,
      movie_poster TEXT,
      added_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    /* ── a conversa em cima de uma avaliação ─────────────────────────────
       The club argues on a Discord call and the argument evaporates with it.
       This is the first thing in the product that keeps any of it: a thread
       hanging off one person's take, so "discordo do teu 9 em fotografia" has
       somewhere to live that is not a voice channel nobody recorded.

       Pendurado na avaliação e não no filme, de propósito. A ficha de cada
       pessoa é a coisa concreta que se discute, e a mesma escolha vale para os
       votos abaixo — os dois respondem a um take específico.

       ON DELETE CASCADE nas duas pontas: uma avaliação apagada leva a conversa
       sobre ela, e alguém que sai do clube leva o que escreveu. */
    CREATE TABLE IF NOT EXISTS review_comments (
      id TEXT PRIMARY KEY,
      review_id TEXT NOT NULL REFERENCES reviews(id) ON DELETE CASCADE,
      reviewer_id TEXT NOT NULL REFERENCES reviewers(id) ON DELETE CASCADE,
      body TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS review_comments_review ON review_comments(review_id);

    /* ── e o like no comentário ───────────────────────────────────────────
       Sem coluna de valor, ao contrário do voto em critério. Lá o par existe
       porque se concorda ou se discorda de um número; aqui é uma pessoa
       dizendo "isso" para o que outra escreveu, e o contrário disso, num clube
       de amigos, não é a mesma informação com o sinal trocado — é outra coisa,
       mais pesada, que ninguém pediu.

       Então o like existe ou não existe. Tirar apaga a linha, do mesmo jeito
       que tirar um voto apaga a dele. */
    CREATE TABLE IF NOT EXISTS comment_likes (
      comment_id TEXT NOT NULL REFERENCES review_comments(id) ON DELETE CASCADE,
      reviewer_id TEXT NOT NULL REFERENCES reviewers(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (comment_id, reviewer_id)
    );
    CREATE INDEX IF NOT EXISTS comment_likes_comment ON comment_likes(comment_id);

    /* ── e o voto em uma nota isolada ─────────────────────────────────────
       Concordar com uma pessoa inteira é raro; concordar com o 9 dela em
       fotografia e achar o 4 em roteiro absurdo é o que acontece de verdade. O
       voto é por critério por isso.

       A chave primária é (avaliação, critério, quem votou), então uma pessoa
       tem no máximo um voto em cada nota e trocar de ideia é um UPDATE, nunca
       uma segunda linha. A coluna value é +1 ou -1 e nunca 0 — tirar o voto
       apaga a linha, que é a diferença entre "não votei" e "votei neutro". */
    CREATE TABLE IF NOT EXISTS criterion_votes (
      review_id TEXT NOT NULL REFERENCES reviews(id) ON DELETE CASCADE,
      criterion_key TEXT NOT NULL,
      reviewer_id TEXT NOT NULL REFERENCES reviewers(id) ON DELETE CASCADE,
      value INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (review_id, criterion_key, reviewer_id)
    );
    CREATE INDEX IF NOT EXISTS criterion_votes_review ON criterion_votes(review_id);

    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      reviewer_id TEXT NOT NULL REFERENCES reviewers(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      expires_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS sessions_reviewer ON sessions(reviewer_id);
  `);

  // Lightweight migration: add columns that didn't exist in earlier versions
  // of this schema, without wiping existing data.
  const reviewCols = await columnsOf('reviews');
  if (!reviewCols.includes('comment')) {
    await exec('ALTER TABLE reviews ADD COLUMN comment TEXT');
  }

  // PIN sign-in. Only the hash and the salt are stored — the PIN itself never
  // touches the database, the logs, or any response body.
  const reviewerCols = await columnsOf('reviewers');
  const addReviewerCol = async (name, ddl) => {
    if (!reviewerCols.includes(name)) await exec(`ALTER TABLE reviewers ADD COLUMN ${ddl}`);
  };
  await addReviewerCol('pin_hash', 'pin_hash TEXT');
  await addReviewerCol('pin_salt', 'pin_salt TEXT');
  // Admin is a column, not a name match: renaming the account would otherwise
  // hand the power away, and a second person called Vinicius would inherit it.
  await addReviewerCol('is_admin', 'is_admin INTEGER NOT NULL DEFAULT 0');
  // Four digits is ten thousand guesses, which a script exhausts in seconds, so
  // failures are counted and the account is put on ice for a while.
  await addReviewerCol('pin_attempts', 'pin_attempts INTEGER NOT NULL DEFAULT 0');
  await addReviewerCol('locked_until', 'locked_until TEXT');

  /* ── the portrait ───────────────────────────────────────────────────────
     Kept in the row, as base64, and not on disk: the machine this runs on
     throws its filesystem away at every deploy, so a file written there is a
     file that exists until the next push. An object store would be the answer
     at another scale; at four members and a picture each it would be a second
     service, a second set of credentials and a second thing to be down.

     The client shrinks every image to a small square before sending, so what
     lands here is tens of kilobytes, not the four megabytes a phone camera
     produces. The route refuses anything larger regardless — the client is
     convenience, not enforcement.

     `avatar_rev` changes with every upload and rides in the URL, which is what
     lets the picture be cached forever and still change the moment it does. */
  /* A film is rated under one genre chosen from the several it carries, so the
     cache has to remember the several. Stored as a comma-joined list because
     none of these names contains a comma and nothing here ever queries inside
     it — it is read whole or not at all. Rows cached before this column existed
     have it empty, and the reader falls back to the single genre they do have. */
  const movieCols = await columnsOf('movies_cache');
  if (!movieCols.includes('genres')) {
    await exec('ALTER TABLE movies_cache ADD COLUMN genres TEXT');
  }
  /* O nome com que o filme circula lá fora — TMDB's `original_title`, stored
     only when it differs from the Portuguese one. Cached because the queue and
     the archive read the film from here with TMDB nowhere in the request, and
     because it is the string somebody copies to go find a copy. Rows written
     before this column existed have it null and fill in the next time the film
     is seen, which every list endpoint does. */
  if (!movieCols.includes('original_title')) {
    await exec('ALTER TABLE movies_cache ADD COLUMN original_title TEXT');
  }

  /* E o nome em inglês, quando ele não é nenhum dos dois acima. Existe para as
     buscas: a fila, a sessão e o acervo filtram o que está no banco, e Parasita
     não é achável por "Parasite" sem esta coluna.

     Só chega por filme, nunca por lista — TMDB carrega tradução no endpoint de
     um filme e em nenhum outro — então é preenchido quando o filme vira algo
     que o clube guarda: ficha aberta, entrou na fila, foi avaliado. O que já
     estava no banco antes disso é o que `npm run backfill:ingles` cura. */
  if (!movieCols.includes('english_title')) {
    await exec('ALTER TABLE movies_cache ADD COLUMN english_title TEXT');
  }

  /* How long the film runs, in minutes. TMDB only reports it on the details
     endpoint, so a row cached from a search or a popular page has it null until
     somebody opens the film — which is exactly when the number is needed. */
  if (!movieCols.includes('runtime')) {
    await exec('ALTER TABLE movies_cache ADD COLUMN runtime INTEGER');
  }

  /* ── o que o TMDB achou ─────────────────────────────────────────────────
     Their average and how many people are behind it, on the same 0–10 the club
     uses. Cached because the archive needs it: a take is read from this
     database with TMDB nowhere in the request, and "o clube deu 6,2 e o TMDB
     deu 8,1" has to survive that. Every list endpoint carries both fields, so
     a film has them from the first time anybody searched for it. */
  if (!movieCols.includes('tmdb_score')) {
    await exec('ALTER TABLE movies_cache ADD COLUMN tmdb_score REAL');
    await exec('ALTER TABLE movies_cache ADD COLUMN tmdb_votes INTEGER');
  }

  /* ── onde está passando ─────────────────────────────────────────────────
     The streaming services carrying the film, as JSON, with the moment it was
     asked. Cached for a different reason than everything else here: not because
     the answer is expensive — it is one small request — but because it is
     twenty of them for one page of the catalogue, every time anybody scrolls.

     The timestamp is the point. A catalogue moves: a film leaves Netflix and
     the row here becomes a confident lie, which is worse than an empty one. It
     is read only while it is fresh (see PROVIDERS_TTL in routes/catalog.js) and
     refetched after that, so being wrong has a ceiling measured in days. */
  if (!movieCols.includes('providers')) {
    await exec('ALTER TABLE movies_cache ADD COLUMN providers TEXT');
    await exec('ALTER TABLE movies_cache ADD COLUMN providers_at TEXT');
  }

  /* A take carries its own copy of the film, so the record still reads as a
     record with TMDB unreachable. Takes recorded before this column existed
     fall back to the cache when the archive is read. */
  if (!reviewCols.includes('movie_runtime')) {
    await exec('ALTER TABLE reviews ADD COLUMN movie_runtime INTEGER');
  }

  await addReviewerCol('avatar', 'avatar TEXT');
  await addReviewerCol('avatar_mime', 'avatar_mime TEXT');
  await addReviewerCol('avatar_rev', 'avatar_rev TEXT');

  // The queue is something the club arranges, not just a bag of films, so it
  // carries an explicit order. Existing rows are backfilled from added_at so the
  // list people already have keeps the order they already saw.
  const watchCols = await columnsOf('watchlist');
  if (!watchCols.includes('position')) {
    await exec('ALTER TABLE watchlist ADD COLUMN position INTEGER');
    const existing = await prepare('SELECT movie_id FROM watchlist ORDER BY added_at DESC').all();
    if (existing.length) {
      await batch(existing.map((row, i) => ({
        sql: 'UPDATE watchlist SET position = ? WHERE movie_id = ?',
        args: [i, row.movie_id],
      })));
    }
  }

  // Expired sessions are dead weight and a liability; clear them at boot.
  await prepare("DELETE FROM sessions WHERE expires_at <= datetime('now')").run();
}

// Whatever needs the schema awaits this. The routes only call prepare() at
// load time, which touches nothing, so nothing runs ahead of it.
const ready = migrate();

module.exports = {
  prepare,
  exec,
  batch,
  ready,
  close: () => client.close(),
};
