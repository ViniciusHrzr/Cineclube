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
