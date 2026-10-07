const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { createClient } = require('@libsql/client');

const remoteUrl = process.env.TURSO_DATABASE_URL;
const localPath = process.env.CINECLUBE_DB || path.join(__dirname, '..', 'data', 'cineclube.db');
const isLocal = !remoteUrl;

if (isLocal) fs.mkdirSync(path.dirname(localPath), { recursive: true });

const client = createClient({
  url: remoteUrl || 'file:' + localPath,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

function argsOf(args) {
  const [first] = args;
  if (args.length === 1 && first !== null && typeof first === 'object' && !Array.isArray(first)) {
    return first;
  }
  return args;
}

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

function exec(sql) {
  return client.executeMultiple(sql);
}

function batch(statements) {
  return client.batch(statements, 'write');
}

async function columnsOf(table) {
  const { rows } = await client.execute(`PRAGMA table_info(${table})`);
  return rows.map(c => c.name);
}

async function keyOf(table) {
  const { rows } = await client.execute(`PRAGMA table_info(${table})`);
  return rows.filter(c => Number(c.pk) > 0).sort((a, b) => Number(a.pk) - Number(b.pk)).map(c => c.name);
}

const HOME_CLUB = 'Cineclube';

function slugify(name) {
  const base = String(name || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return base || 'clube-' + crypto.randomUUID().slice(0, 8);
}

async function freeSlug(name, exceptId = null) {
  const wanted = slugify(name);
  for (let n = 1; ; n++) {
    const slug = n === 1 ? wanted : `${wanted}-${n}`;
    const taken = await prepare('SELECT id FROM clubs WHERE slug = ?').get(slug);
    if (!taken || taken.id === exceptId) return slug;
  }
}

async function ensureHomeClub() {
  const found = await prepare('SELECT id FROM clubs WHERE name = ? COLLATE NOCASE').get(HOME_CLUB);
  if (found) return found.id;
  const id = 'c' + crypto.randomUUID();
  await prepare(
    `INSERT INTO clubs (id, name, slug, visibility) VALUES (?, ?, ?, 'public')`
  ).run(id, HOME_CLUB, slugify(HOME_CLUB));
  return id;
}

async function joinHomeClub(reviewerId) {
  try {
    const home = await ensureHomeClub();
    await prepare(
      `INSERT INTO club_members (club_id, reviewer_id, role) VALUES (?, ?, 'member')
       ON CONFLICT DO NOTHING`
    ).run(home, reviewerId);
    return home;
  } catch (e) {
    console.error('[db] não deu para pôr a conta nova no clube principal:', e.message);
    return null;
  }
}

async function migrate() {
  if (isLocal) {
    await exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  }

  await exec(`    CREATE TABLE IF NOT EXISTS reviewers (
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

    CREATE TABLE IF NOT EXISTS review_comments (
      id TEXT PRIMARY KEY,
      review_id TEXT NOT NULL REFERENCES reviews(id) ON DELETE CASCADE,
      reviewer_id TEXT NOT NULL REFERENCES reviewers(id) ON DELETE CASCADE,
      body TEXT NOT NULL,

      parent_id TEXT REFERENCES review_comments(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS review_comments_review ON review_comments(review_id);

    CREATE TABLE IF NOT EXISTS comment_likes (
      comment_id TEXT NOT NULL REFERENCES review_comments(id) ON DELETE CASCADE,
      reviewer_id TEXT NOT NULL REFERENCES reviewers(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (comment_id, reviewer_id)
    );
    CREATE INDEX IF NOT EXISTS comment_likes_comment ON comment_likes(comment_id);

    CREATE TABLE IF NOT EXISTS review_votes (
      review_id TEXT NOT NULL REFERENCES reviews(id) ON DELETE CASCADE,
      reviewer_id TEXT NOT NULL REFERENCES reviewers(id) ON DELETE CASCADE,
      value INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (review_id, reviewer_id)
    );
    CREATE INDEX IF NOT EXISTS review_votes_review ON review_votes(review_id);

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

    CREATE TABLE IF NOT EXISTS refresh_tokens (
      token_hash TEXT PRIMARY KEY,
      family TEXT NOT NULL,
      reviewer_id TEXT NOT NULL REFERENCES reviewers(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),

      used_at TEXT,
      expires_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS refresh_tokens_family ON refresh_tokens(family);
    CREATE INDEX IF NOT EXISTS refresh_tokens_reviewer ON refresh_tokens(reviewer_id);

    CREATE TABLE IF NOT EXISTS push_subs (
      id TEXT PRIMARY KEY,
      reviewer_id TEXT NOT NULL REFERENCES reviewers(id) ON DELETE CASCADE,

      kind TEXT NOT NULL DEFAULT 'web',

      endpoint TEXT NOT NULL,

      p256dh TEXT NOT NULL,
      auth TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_ok_at TEXT
    );
    CREATE INDEX IF NOT EXISTS push_subs_reviewer ON push_subs(reviewer_id);

    CREATE TABLE IF NOT EXISTS tickets (
      token_hash TEXT PRIMARY KEY,
      reviewer_id TEXT NOT NULL REFERENCES reviewers(id) ON DELETE CASCADE,
      kind TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      expires_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS tickets_reviewer ON tickets(reviewer_id);

    CREATE TABLE IF NOT EXISTS push_log (
      id TEXT PRIMARY KEY,
      at TEXT NOT NULL DEFAULT (datetime('now'))
    );
`);

  if (!(await columnsOf('sessions')).includes('kind')) {
    await exec("ALTER TABLE sessions ADD COLUMN kind TEXT NOT NULL DEFAULT 'web'");
  }

  const reviewCols = await columnsOf('reviews');
  if (!reviewCols.includes('comment')) {
    await exec('ALTER TABLE reviews ADD COLUMN comment TEXT');
  }

  const reviewerCols = await columnsOf('reviewers');
  const addReviewerCol = async (name, ddl) => {
    if (!reviewerCols.includes(name)) await exec(`ALTER TABLE reviewers ADD COLUMN ${ddl}`);
  };
  await addReviewerCol('pin_hash', 'pin_hash TEXT');
  await addReviewerCol('pin_salt', 'pin_salt TEXT');
  await addReviewerCol('is_admin', 'is_admin INTEGER NOT NULL DEFAULT 0');
  if (reviewerCols.includes('pin_attempts') && !reviewerCols.includes('auth_attempts')) {
    await exec('ALTER TABLE reviewers RENAME COLUMN pin_attempts TO auth_attempts');
  } else if (!reviewerCols.includes('auth_attempts')) {
    await exec('ALTER TABLE reviewers ADD COLUMN auth_attempts INTEGER NOT NULL DEFAULT 0');
  }
  await addReviewerCol('locked_until', 'locked_until TEXT');

  const movieCols = await columnsOf('movies_cache');
  if (!movieCols.includes('genres')) {
    await exec('ALTER TABLE movies_cache ADD COLUMN genres TEXT');
  }
  if (!movieCols.includes('original_title')) {
    await exec('ALTER TABLE movies_cache ADD COLUMN original_title TEXT');
  }

  if (!movieCols.includes('english_title')) {
    await exec('ALTER TABLE movies_cache ADD COLUMN english_title TEXT');
  }

  if (!movieCols.includes('runtime')) {
    await exec('ALTER TABLE movies_cache ADD COLUMN runtime INTEGER');
  }

  if (!movieCols.includes('tmdb_score')) {
    await exec('ALTER TABLE movies_cache ADD COLUMN tmdb_score REAL');
    await exec('ALTER TABLE movies_cache ADD COLUMN tmdb_votes INTEGER');
  }

  if (!movieCols.includes('providers')) {
    await exec('ALTER TABLE movies_cache ADD COLUMN providers TEXT');
    await exec('ALTER TABLE movies_cache ADD COLUMN providers_at TEXT');
  }

  if (!reviewCols.includes('movie_runtime')) {
    await exec('ALTER TABLE reviews ADD COLUMN movie_runtime INTEGER');
  }

  if (!reviewCols.includes('recorded_at')) {
    await exec('ALTER TABLE reviews ADD COLUMN recorded_at TEXT');
    await prepare('UPDATE reviews SET recorded_at = date WHERE recorded_at IS NULL').run();
  }

  if (!(await columnsOf('watchlist')).includes('added_by')) {
    await exec('ALTER TABLE watchlist ADD COLUMN added_by TEXT');
  }

  const commentCols = await columnsOf('review_comments');
  if (!commentCols.includes('parent_id')) {
    await exec(
      'ALTER TABLE review_comments ADD COLUMN parent_id TEXT REFERENCES review_comments(id) ON DELETE CASCADE'
    );
  }
  await exec('CREATE INDEX IF NOT EXISTS review_comments_parent ON review_comments(parent_id)');

  await addReviewerCol('notifications_seen_at', 'notifications_seen_at TEXT');

  await addReviewerCol('notifications_cleared_at', 'notifications_cleared_at TEXT');

  await addReviewerCol('claim_dismissed_at', 'claim_dismissed_at TEXT');

  await addReviewerCol('avatar', 'avatar TEXT');
  await addReviewerCol('avatar_mime', 'avatar_mime TEXT');
  await addReviewerCol('avatar_rev', 'avatar_rev TEXT');

  await addReviewerCol('bio', 'bio TEXT');

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

  const { n: folded } = await prepare('SELECT COUNT(*) AS n FROM review_votes').get();
  if (!folded) {
    const rolled = await prepare(`
      SELECT review_id, reviewer_id, SUM(value) AS total, MIN(created_at) AS since
      FROM criterion_votes
      GROUP BY review_id, reviewer_id
      HAVING SUM(value) <> 0
    `).all();
    if (rolled.length) {
      await batch(rolled.map(row => ({
        sql: `INSERT INTO review_votes (review_id, reviewer_id, value, created_at)
              VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING`,
        args: [row.review_id, row.reviewer_id, row.total > 0 ? 1 : -1, row.since],
      })));
      console.log(`[db] ${rolled.length} voto(s) em critério dobrados em voto de ficha`);
    }
  }

  await exec(`    CREATE TABLE IF NOT EXISTS clubs (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      slug TEXT NOT NULL,

      tagline TEXT,
      photo TEXT,
      photo_mime TEXT,
      photo_rev TEXT,

      visibility TEXT NOT NULL DEFAULT 'private',

      show_reviews INTEGER NOT NULL DEFAULT 0,
      show_comments INTEGER NOT NULL DEFAULT 0,

      show_charts INTEGER NOT NULL DEFAULT 0,

      created_by TEXT REFERENCES reviewers(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE UNIQUE INDEX IF NOT EXISTS clubs_name ON clubs(name COLLATE NOCASE);
    CREATE UNIQUE INDEX IF NOT EXISTS clubs_slug ON clubs(slug);

    CREATE TABLE IF NOT EXISTS club_members (
      club_id TEXT NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
      reviewer_id TEXT NOT NULL REFERENCES reviewers(id) ON DELETE CASCADE,

      role TEXT NOT NULL DEFAULT 'member',
      joined_at TEXT NOT NULL DEFAULT (datetime('now')),

      notifications_seen_at TEXT,
      notifications_cleared_at TEXT,
      PRIMARY KEY (club_id, reviewer_id)
    );
    CREATE INDEX IF NOT EXISTS club_members_reviewer ON club_members(reviewer_id);

    CREATE TABLE IF NOT EXISTS club_join_requests (
      club_id TEXT NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
      reviewer_id TEXT NOT NULL REFERENCES reviewers(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (club_id, reviewer_id)
    );
    CREATE INDEX IF NOT EXISTS club_join_requests_club ON club_join_requests(club_id);
`);

  await exec('CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT)');

  const done = async key => !!(await prepare('SELECT 1 AS x FROM meta WHERE key = ?').get(key));
  const mark = key =>
    prepare("INSERT OR IGNORE INTO meta (key, value) VALUES (?, datetime('now'))").run(key);

  const clubCols = await columnsOf('clubs');
  if (!clubCols.includes('tagline')) {
    await exec('ALTER TABLE clubs ADD COLUMN tagline TEXT');
  }
  if (!clubCols.includes('show_reviews')) {
    await exec('ALTER TABLE clubs ADD COLUMN show_reviews INTEGER NOT NULL DEFAULT 0');
    await exec('ALTER TABLE clubs ADD COLUMN show_comments INTEGER NOT NULL DEFAULT 0');
  }
  if (!clubCols.includes('show_charts')) {
    await exec('ALTER TABLE clubs ADD COLUMN show_charts INTEGER NOT NULL DEFAULT 0');
  }

  if (!(await done('home-club-public'))) {
    const r = await prepare(
      `UPDATE clubs SET visibility = 'public'
       WHERE name = ? COLLATE NOCASE AND visibility = 'private' AND created_by IS NULL`
    ).run(HOME_CLUB);
    await mark('home-club-public');
    if (r?.rowsAffected) console.log(`[db] ${HOME_CLUB} agora é um clube aberto`);
  }
  const memberCols = await columnsOf('club_members');
  if (!memberCols.includes('notifications_seen_at')) {
    await exec('ALTER TABLE club_members ADD COLUMN notifications_seen_at TEXT');
    await exec('ALTER TABLE club_members ADD COLUMN notifications_cleared_at TEXT');
    await exec(`
      UPDATE club_members SET
        notifications_seen_at = (SELECT notifications_seen_at FROM reviewers r WHERE r.id = club_members.reviewer_id),
        notifications_cleared_at = (SELECT notifications_cleared_at FROM reviewers r WHERE r.id = club_members.reviewer_id)
    `);
  }

  await addReviewerCol('email', 'email TEXT');
  await addReviewerCol('google_sub', 'google_sub TEXT');
  await addReviewerCol('password_hash', 'password_hash TEXT');
  await addReviewerCol('password_salt', 'password_salt TEXT');

  await addReviewerCol('email_verified', 'email_verified INTEGER NOT NULL DEFAULT 0');
  if (!(await done('google-emails-verified'))) {
    const r = await prepare(
      'UPDATE reviewers SET email_verified = 1 WHERE google_sub IS NOT NULL AND email IS NOT NULL'
    ).run();
    await mark('google-emails-verified');
    if (r?.rowsAffected) console.log(`[db] ${r.rowsAffected} conta(s) do Google já vêm verificadas`);
  }

  await exec(`
    CREATE TABLE IF NOT EXISTS email_tokens (
      token_hash TEXT PRIMARY KEY,
      reviewer_id TEXT NOT NULL REFERENCES reviewers(id) ON DELETE CASCADE,
      kind TEXT NOT NULL,
      email TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      expires_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS email_tokens_reviewer ON email_tokens(reviewer_id, kind);
  `);
  await exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS reviewers_email
      ON reviewers(email COLLATE NOCASE) WHERE email IS NOT NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS reviewers_google
      ON reviewers(google_sub) WHERE google_sub IS NOT NULL;
  `);

  if (!reviewCols.includes('club_id')) {
    const home = await ensureHomeClub();

    const everyone = await prepare('SELECT id, is_admin FROM reviewers').all();
    if (everyone.length) {
      await batch(everyone.map(p => ({
        sql: `INSERT INTO club_members (club_id, reviewer_id, role)
              VALUES (?, ?, ?) ON CONFLICT DO NOTHING`,
        args: [home, p.id, p.is_admin ? 'admin' : 'member'],
      })));
    }

    const takes = await prepare('SELECT * FROM reviews').all();
    const comments = await prepare('SELECT * FROM review_comments').all();
    const rvotes = await prepare('SELECT * FROM review_votes').all();
    const cvotes = await prepare('SELECT * FROM criterion_votes').all();
    const likes = await prepare('SELECT * FROM comment_likes').all();

    await exec(`
      DROP TABLE IF EXISTS reviews_rebuild;
      CREATE TABLE reviews_rebuild (
        id TEXT PRIMARY KEY,
        club_id TEXT NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
        reviewer_id TEXT NOT NULL REFERENCES reviewers(id) ON DELETE CASCADE,
        movie_id INTEGER NOT NULL,
        movie_title TEXT NOT NULL,
        movie_year INTEGER,
        movie_genre TEXT NOT NULL,
        movie_poster TEXT,
        movie_director TEXT,
        movie_runtime INTEGER,
        scores TEXT NOT NULL,
        final REAL NOT NULL,
        date TEXT NOT NULL,
        recorded_at TEXT,
        comment TEXT,
        UNIQUE(club_id, reviewer_id, movie_id)
      );
    `);

    if (takes.length) {
      await batch(takes.map(t => ({
        sql: `INSERT INTO reviews_rebuild
                (id, club_id, reviewer_id, movie_id, movie_title, movie_year, movie_genre,
                 movie_poster, movie_director, movie_runtime, scores, final, date,
                 recorded_at, comment)
              VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        args: [
          t.id, home, t.reviewer_id, t.movie_id, t.movie_title, t.movie_year ?? null,
          t.movie_genre, t.movie_poster ?? null, t.movie_director ?? null,
          t.movie_runtime ?? null, t.scores, t.final, t.date,
          t.recorded_at ?? t.date, t.comment ?? null,
        ],
      })));
    }

    await exec(`
      DROP TABLE reviews;
      ALTER TABLE reviews_rebuild RENAME TO reviews;
      CREATE INDEX IF NOT EXISTS reviews_club ON reviews(club_id);
    `);

    const restore = [
      ...comments.map(c => ({
        sql: `INSERT OR IGNORE INTO review_comments
                (id, review_id, reviewer_id, body, parent_id, created_at)
              VALUES (?,?,?,?,?,?)`,
        args: [c.id, c.review_id, c.reviewer_id, c.body, c.parent_id ?? null, c.created_at],
      })),
      ...rvotes.map(v => ({
        sql: `INSERT OR IGNORE INTO review_votes (review_id, reviewer_id, value, created_at)
              VALUES (?,?,?,?)`,
        args: [v.review_id, v.reviewer_id, v.value, v.created_at],
      })),
      ...cvotes.map(v => ({
        sql: `INSERT OR IGNORE INTO criterion_votes
                (review_id, criterion_key, reviewer_id, value, created_at)
              VALUES (?,?,?,?,?)`,
        args: [v.review_id, v.criterion_key, v.reviewer_id, v.value, v.created_at],
      })),
      ...likes.map(l => ({
        sql: `INSERT OR IGNORE INTO comment_likes (comment_id, reviewer_id, created_at)
              VALUES (?,?,?)`,
        args: [l.comment_id, l.reviewer_id, l.created_at],
      })),
    ];
    if (restore.length) await batch(restore);

    console.log(
      `[db] clubes: ${takes.length} ficha(s) e ${everyone.length} pessoa(s) movidas para ${HOME_CLUB}`
    );
  }

  if (!(await columnsOf('watchlist')).includes('club_id')) {
    const home = await ensureHomeClub();
    const queue = await prepare('SELECT * FROM watchlist').all();

    await exec(`
      DROP TABLE IF EXISTS watchlist_rebuild;
      CREATE TABLE watchlist_rebuild (
        club_id TEXT NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
        movie_id INTEGER NOT NULL,
        movie_title TEXT NOT NULL,
        movie_year INTEGER,
        movie_genre TEXT NOT NULL,
        movie_poster TEXT,
        added_at TEXT NOT NULL DEFAULT (datetime('now')),
        added_by TEXT,
        position INTEGER,
        PRIMARY KEY (club_id, movie_id)
      );
    `);

    if (queue.length) {
      await batch(queue.map(w => ({
        sql: `INSERT INTO watchlist_rebuild
                (club_id, movie_id, movie_title, movie_year, movie_genre, movie_poster,
                 added_at, added_by, position)
              VALUES (?,?,?,?,?,?,?,?,?)`,
        args: [
          home, w.movie_id, w.movie_title, w.movie_year ?? null, w.movie_genre,
          w.movie_poster ?? null, w.added_at, w.added_by ?? null, w.position ?? null,
        ],
      })));
    }

    await exec(`
      DROP TABLE watchlist;
      ALTER TABLE watchlist_rebuild RENAME TO watchlist;
    `);
    console.log(`[db] clubes: ${queue.length} filme(s) da fila movidos para ${HOME_CLUB}`);
  }

  if (!(await keyOf('watchlist')).includes('added_by')) {
    const queue = await prepare('SELECT * FROM watchlist').all();

    await exec(`
      DROP TABLE IF EXISTS watchlist_rebuild;
      CREATE TABLE watchlist_rebuild (
        club_id TEXT NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
        movie_id INTEGER NOT NULL,
        movie_title TEXT NOT NULL,
        movie_year INTEGER,
        movie_genre TEXT NOT NULL,
        movie_poster TEXT,
        added_at TEXT NOT NULL DEFAULT (datetime('now')),
        added_by TEXT NOT NULL DEFAULT '',
        position INTEGER,
        PRIMARY KEY (club_id, movie_id, added_by)
      );
    `);

    if (queue.length) {
      await batch(queue.map(w => ({
        sql: `INSERT OR IGNORE INTO watchlist_rebuild
                (club_id, movie_id, movie_title, movie_year, movie_genre, movie_poster,
                 added_at, added_by, position)
              VALUES (?,?,?,?,?,?,?,?,?)`,
        args: [
          w.club_id, w.movie_id, w.movie_title, w.movie_year ?? null, w.movie_genre,
          w.movie_poster ?? null, w.added_at, w.added_by ?? '', w.position ?? null,
        ],
      })));
    }

    await exec(`
      DROP TABLE watchlist;
      ALTER TABLE watchlist_rebuild RENAME TO watchlist;
    `);
    console.log(`[db] fila: ${queue.length} linha(s) com dono na chave`);
  }

  await exec(`    CREATE TABLE IF NOT EXISTS shows_cache (
      tmdb_id INTEGER PRIMARY KEY,
      title TEXT NOT NULL,
      original_title TEXT,
      english_title TEXT,
      year INTEGER,
      genre TEXT NOT NULL,
      genres TEXT,
      poster TEXT,

      status TEXT,
      seasons INTEGER,
      episodes INTEGER,
      runtime INTEGER,
      tmdb_score REAL,
      tmdb_votes INTEGER,
      providers TEXT,
      providers_at TEXT,
      cached_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS episodes_cache (
      show_id INTEGER NOT NULL,
      season INTEGER NOT NULL,
      episode INTEGER NOT NULL,
      title TEXT NOT NULL,
      overview TEXT,
      still TEXT,
      air_date TEXT,
      runtime INTEGER,
      kind TEXT,
      cached_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (show_id, season, episode)
    );

    CREATE TABLE IF NOT EXISTS show_queue (
      club_id TEXT NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
      show_id INTEGER NOT NULL,
      show_title TEXT NOT NULL,
      show_year INTEGER,
      show_genre TEXT NOT NULL,
      show_poster TEXT,
      added_at TEXT NOT NULL DEFAULT (datetime('now')),
      added_by TEXT NOT NULL DEFAULT '',
      position INTEGER,
      PRIMARY KEY (club_id, show_id, added_by)
    );

    CREATE TABLE IF NOT EXISTS episode_takes (
      id TEXT PRIMARY KEY,
      club_id TEXT NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
      reviewer_id TEXT NOT NULL REFERENCES reviewers(id) ON DELETE CASCADE,
      show_id INTEGER NOT NULL,
      show_title TEXT NOT NULL,
      show_poster TEXT,

      show_genre TEXT NOT NULL DEFAULT 'Drama',
      season INTEGER NOT NULL,
      episode INTEGER NOT NULL,
      episode_title TEXT,
      scores TEXT,
      quick REAL,
      final REAL,
      comment TEXT,
      watched_at TEXT NOT NULL DEFAULT (datetime('now')),
      rated_at TEXT,
      UNIQUE(club_id, reviewer_id, show_id, season, episode)
    );
    CREATE INDEX IF NOT EXISTS episode_takes_club ON episode_takes(club_id, show_id);
    CREATE INDEX IF NOT EXISTS episode_takes_reviewer ON episode_takes(reviewer_id);

    CREATE TABLE IF NOT EXISTS take_comments (
      id TEXT PRIMARY KEY,
      take_id TEXT NOT NULL REFERENCES episode_takes(id) ON DELETE CASCADE,
      reviewer_id TEXT NOT NULL REFERENCES reviewers(id) ON DELETE CASCADE,
      body TEXT NOT NULL,
      parent_id TEXT REFERENCES take_comments(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS take_comments_take ON take_comments(take_id);
    CREATE INDEX IF NOT EXISTS take_comments_parent ON take_comments(parent_id);

    CREATE TABLE IF NOT EXISTS take_votes (
      take_id TEXT NOT NULL REFERENCES episode_takes(id) ON DELETE CASCADE,
      reviewer_id TEXT NOT NULL REFERENCES reviewers(id) ON DELETE CASCADE,
      value INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (take_id, reviewer_id)
    );
    CREATE INDEX IF NOT EXISTS take_votes_take ON take_votes(take_id);

    CREATE TABLE IF NOT EXISTS take_comment_likes (
      comment_id TEXT NOT NULL REFERENCES take_comments(id) ON DELETE CASCADE,
      reviewer_id TEXT NOT NULL REFERENCES reviewers(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (comment_id, reviewer_id)
    );
    CREATE INDEX IF NOT EXISTS take_comment_likes_comment ON take_comment_likes(comment_id);
`);

  if (!(await keyOf('show_queue')).includes('added_by')) {
    const queue = await prepare('SELECT * FROM show_queue').all();

    await exec(`
      DROP TABLE IF EXISTS show_queue_rebuild;
      CREATE TABLE show_queue_rebuild (
        club_id TEXT NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
        show_id INTEGER NOT NULL,
        show_title TEXT NOT NULL,
        show_year INTEGER,
        show_genre TEXT NOT NULL,
        show_poster TEXT,
        added_at TEXT NOT NULL DEFAULT (datetime('now')),
        added_by TEXT NOT NULL DEFAULT '',
        position INTEGER,
        PRIMARY KEY (club_id, show_id, added_by)
      );
    `);

    if (queue.length) {
      await batch(queue.map(q => ({
        sql: `INSERT OR IGNORE INTO show_queue_rebuild
                (club_id, show_id, show_title, show_year, show_genre, show_poster,
                 added_at, added_by, position)
              VALUES (?,?,?,?,?,?,?,?,?)`,
        args: [
          q.club_id, q.show_id, q.show_title, q.show_year ?? null, q.show_genre,
          q.show_poster ?? null, q.added_at, q.added_by ?? '', q.position ?? null,
        ],
      })));
    }

    await exec(`
      DROP TABLE show_queue;
      ALTER TABLE show_queue_rebuild RENAME TO show_queue;
    `);
    console.log(`[db] séries: ${queue.length} linha(s) com dono na chave`);
  }
  if (!(await done('fichas-por-pessoa'))) {
    const sobrando = await prepare(`
      SELECT COUNT(*) AS n FROM (
        SELECT id, ROW_NUMBER() OVER (
          PARTITION BY reviewer_id, movie_id
          ORDER BY COALESCE(recorded_at, date) DESC, id DESC
        ) AS pos FROM reviews
      ) WHERE pos > 1
    `).get();
    if (sobrando?.n) {
      await exec(`
        DELETE FROM reviews WHERE id IN (
          SELECT id FROM (
            SELECT id, ROW_NUMBER() OVER (
              PARTITION BY reviewer_id, movie_id
              ORDER BY COALESCE(recorded_at, date) DESC, id DESC
            ) AS pos FROM reviews
          ) WHERE pos > 1
        )
      `);
      console.log(`[db] fichas: ${sobrando.n} repetida(s) da mesma pessoa no mesmo filme, ficou a mais recente`);
    }
    await mark('fichas-por-pessoa');
  }
  await exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS reviews_person_movie ON reviews(reviewer_id, movie_id);
    CREATE INDEX IF NOT EXISTS reviews_reviewer ON reviews(reviewer_id);
  `);

  for (const table of ['movies_cache', 'shows_cache']) {
    const cols = await columnsOf(table);
    if (!cols.includes('backdrop')) await exec(`ALTER TABLE ${table} ADD COLUMN backdrop TEXT`);
    if (!cols.includes('overview')) await exec(`ALTER TABLE ${table} ADD COLUMN overview TEXT`);
    if (!cols.includes('trailer')) {
      await exec(`ALTER TABLE ${table} ADD COLUMN trailer TEXT`);
      await exec(`ALTER TABLE ${table} ADD COLUMN trailer_at TEXT`);
    }
  }

  {
    const cols = await columnsOf('shows_cache');
    if (!cols.includes('shape')) {
      await exec('ALTER TABLE shows_cache ADD COLUMN shape TEXT');
      await exec('ALTER TABLE shows_cache ADD COLUMN shape_at TEXT');
    }
  }

  if (!(await done('nota-por-temporada'))) {
    const tinham = await prepare(`
      SELECT COUNT(*) AS n FROM episode_takes WHERE episode <> 0 AND final IS NOT NULL
    `).get();
    await exec(`
      UPDATE episode_takes
         SET scores = NULL, quick = NULL, final = NULL, comment = NULL, rated_at = NULL
       WHERE episode <> 0
    `);
    if (tinham?.n) console.log(`[db] séries: ${tinham.n} nota(s) de episódio apagada(s); o visto ficou`);
    await mark('nota-por-temporada');
  }

  await prepare("DELETE FROM sessions WHERE expires_at <= datetime('now')").run();
  await prepare("DELETE FROM refresh_tokens WHERE expires_at <= datetime('now')").run();
  if (!(await columnsOf('push_subs')).includes('kind')) {
    await exec("ALTER TABLE push_subs ADD COLUMN kind TEXT NOT NULL DEFAULT 'web'");
  }

  await prepare("DELETE FROM tickets WHERE expires_at <= datetime('now')").run();
  await prepare("DELETE FROM push_log WHERE at <= datetime('now', '-30 days')").run();
  await prepare("DELETE FROM email_tokens WHERE expires_at <= datetime('now')").run();
}

const ready = migrate();

module.exports = {
  prepare,
  exec,
  batch,
  ready,
  HOME_CLUB,
  freeSlug,
  ensureHomeClub,
  joinHomeClub,
  close: () => client.close(),
};
