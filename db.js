const path = require('node:path');
const fs = require('node:fs');
const { DatabaseSync } = require('node:sqlite');

// CINECLUBE_DB lets the tests point at a throwaway file instead of the real one.
const dbPath = process.env.CINECLUBE_DB || path.join(__dirname, 'data', 'cineclube.db');
fs.mkdirSync(path.dirname(dbPath), { recursive: true });

const db = new DatabaseSync(dbPath);

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

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
`);

// Lightweight migration: add columns that didn't exist in earlier versions
// of this schema, without wiping existing data.
const reviewCols = db.prepare("PRAGMA table_info(reviews)").all().map(c => c.name);
if (!reviewCols.includes('comment')) {
  db.exec('ALTER TABLE reviews ADD COLUMN comment TEXT');
}

// PIN sign-in. The club moved from one shared device to one browser each, so a
// reviewer is now an account rather than a signature. Only the hash and the
// salt are stored — the PIN itself never touches the database, the logs, or
// any response body.
const reviewerCols = db.prepare('PRAGMA table_info(reviewers)').all().map(c => c.name);
const addReviewerCol = (name, ddl) => {
  if (!reviewerCols.includes(name)) db.exec(`ALTER TABLE reviewers ADD COLUMN ${ddl}`);
};
addReviewerCol('pin_hash', 'pin_hash TEXT');
addReviewerCol('pin_salt', 'pin_salt TEXT');
// Admin is a column, not a name match: renaming the account would otherwise
// hand the power away, and a second person called Vinicius would inherit it.
addReviewerCol('is_admin', 'is_admin INTEGER NOT NULL DEFAULT 0');
// Four digits is ten thousand guesses, which a script exhausts in seconds, so
// failures are counted and the account is put on ice for a while.
addReviewerCol('pin_attempts', 'pin_attempts INTEGER NOT NULL DEFAULT 0');
addReviewerCol('locked_until', 'locked_until TEXT');

// The queue is something the club arranges, not just a bag of films, so it
// carries an explicit order. Existing rows are backfilled from added_at so the
// list people already have keeps the order they already saw.
const watchCols = db.prepare('PRAGMA table_info(watchlist)').all().map(c => c.name);
if (!watchCols.includes('position')) {
  db.exec('ALTER TABLE watchlist ADD COLUMN position INTEGER');
  const existing = db.prepare('SELECT movie_id FROM watchlist ORDER BY added_at DESC').all();
  const setPos = db.prepare('UPDATE watchlist SET position = ? WHERE movie_id = ?');
  existing.forEach((row, i) => setPos.run(i, row.movie_id));
}

db.exec(`
  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    reviewer_id TEXT NOT NULL REFERENCES reviewers(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    expires_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS sessions_reviewer ON sessions(reviewer_id);
`);

// Expired sessions are dead weight and a liability; clear them at boot.
db.prepare("DELETE FROM sessions WHERE expires_at <= datetime('now')").run();

module.exports = db;
