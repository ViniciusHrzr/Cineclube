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

module.exports = db;
