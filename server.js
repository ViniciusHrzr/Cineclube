try { require('node:process').loadEnvFile('.env'); } catch (e) { /* .env is optional if env vars are set another way */ }

const path = require('node:path');
const express = require('express');
const db = require('./db');

const auth = require('./auth');

const app = express();
/* A megabyte, where the default is a tenth of that. The one thing this app
   accepts that is not a handful of fields is a profile picture, which arrives
   as base64 — already shrunk to a small square by the browser, but base64 costs
   a third more than the bytes it carries, and a member on a phone deserves some
   slack. The picture route enforces its own, much lower, ceiling. */
app.use(express.json({ limit: '1mb' }));
// Every request learns who is signed in; individual routes decide if they care.
app.use(auth.attachSession);

app.use('/api/auth', require('./routes/auth'));
app.use('/api/catalog', require('./routes/catalog'));
app.use('/api/reviewers', require('./routes/reviewers'));
app.use('/api/reviews', require('./routes/reviews'));
app.use('/api/watchlist', require('./routes/watchlist'));
app.use('/api/screening', require('./routes/screening'));
app.use('/api/social', require('./routes/social'));
app.use('/api/notifications', require('./routes/notifications'));
app.use('/api/feed', require('./routes/feed'));

/* The build stamps a content hash into every asset's name, so a file under
   /assets can never change without changing its URL — which is exactly the
   condition under which a browser may keep it forever and stop asking. Without
   this, every visit revalidated a 350kB bundle that had not moved since the
   last deploy. index.html is deliberately left out: it is the one file whose
   name never changes, and it is what points at the hashed ones. */
app.use(
  '/assets',
  express.static(path.join(__dirname, 'public', 'assets'), { immutable: true, maxAge: '1y' })
);
/* Everything else, and index.html above all: revalidate every time.

   It carries no hash in its name — it is the file that names the hashed ones —
   so a browser holding an old copy is a browser running the previous release
   in full, and it has no way to find out otherwise. Without a Cache-Control
   header a browser is free to invent a freshness lifetime of its own, and it
   does. `no-cache` does not mean "do not store": it means "ask first", which
   costs one conditional request and answers 304 the moment nothing changed.

   The service worker gets the same header for a stronger reason. It has no hash
   either, and it is the file that serves the film: a browser still running the
   previous one is a browser with the previous one's bugs, and a service worker
   outlives the tab that installed it. Browsers do revalidate a worker script on
   their own, but "do" is a thing three engines each decided separately and have
   changed before, and one member stuck on an old worker is one member whose
   picture stops mid-film for reasons nobody in the room can see. */
app.use(
  express.static(path.join(__dirname, 'public'), {
    setHeaders: (res, filePath) => {
      if (filePath.endsWith('.html') || filePath.endsWith('sw.min.js')) {
        res.setHeader('Cache-Control', 'no-cache');
      }
    },
  })
);

app.use((err, req, res, next) => {
  console.error('[server] erro não tratado:', err);
  res.status(500).json({ error: 'Erro interno.' });
});

// The club's administrator. Runs once: it only acts on an account that has no
// PIN yet, so it can never overwrite a PIN the owner has since chosen, and it
// never demotes or promotes anyone on later boots.
const CLUB_ADMIN = process.env.CINECLUBE_ADMIN || 'Vinicius';

/* ── the first PIN is never written down ──────────────────────────────────
   A PIN in the source is a PIN for everyone who can read the source, and this
   source is public. It used to carry one as a fallback, which meant the
   repository documented a way into the club for anyone who found the address.

   The convenience it bought was real, though, and only local: a machine
   running this against its own throwaway database wants to get in without
   being configured first. So the fallback survives exactly there. Anywhere the
   club could actually be reached — which is anywhere the session cookie is
   marked Secure, so anywhere behind HTTPS — there is no fallback: the
   environment supplies the PIN or no PIN is set at all, and an account with no
   PIN is an account nobody can sign in to.

   Deployment is unaffected: CINECLUBE_ADMIN_PIN is already required there. */
const CLUB_ADMIN_PIN =
  process.env.CINECLUBE_ADMIN_PIN || (process.env.CINECLUBE_HTTPS ? null : '1646');

/* The database is remote now, so everything the app needs before its first
   request — the schema, the seeds, the admin — is a promise. Nothing listens
   until it settles, and the tests await the same promise. */
async function boot() {
  await db.ready;

  // Seed a few reviewers on first run so the app isn't empty. They come with no
  // PIN, which the sign-in screen shows as "PIN pendente" — a seeded account is
  // a placeholder, and handing it a known PIN would be a back door.
  const { n } = await db.prepare('SELECT COUNT(*) AS n FROM reviewers').get();
  if (n === 0) {
    const seed = db.prepare('INSERT INTO reviewers (id, name, dot) VALUES (?, ?, ?)');
    await seed.run('p1', 'Ana Reis', '#b5abfc');
    await seed.run('p2', 'Bruno Sá', '#cfd3e5');
    await seed.run('p3', 'Clara Lima', '#a7a1db');
    console.log('[server] avaliadores iniciais criados: Ana Reis, Bruno Sá, Clara Lima');
  }

  /* The seat is granted by name, once, and only while the club has nobody in
     it. Members can rename themselves now, and without this the grant would be
     a door left open: whoever took the old name would be handed the club at the
     next restart. A club that already has an administrator is never re-seated
     by this code — the flag is a column, and the only way to move it is here. */
  const seated = await db.prepare('SELECT COUNT(*) AS n FROM reviewers WHERE is_admin = 1').get();
  const adminRow = await db.prepare('SELECT * FROM reviewers WHERE name = ? COLLATE NOCASE').get(CLUB_ADMIN);
  if (adminRow) {
    if (!adminRow.is_admin && !seated.n) {
      await db.prepare('UPDATE reviewers SET is_admin = 1 WHERE id = ?').run(adminRow.id);
      console.log(`[server] ${adminRow.name} definido como administrador do clube`);
    }
    if (!adminRow.pin_hash) {
      if (CLUB_ADMIN_PIN) {
        await auth.setPin(adminRow.id, CLUB_ADMIN_PIN);
        console.log(`[server] PIN inicial definido para ${adminRow.name}. Troque-o pelo app.`);
      } else {
        console.warn(
          `[server] ${adminRow.name} está sem PIN e CINECLUBE_ADMIN_PIN não foi definido. ` +
            'Defina a variável e reinicie — nenhum PIN é inventado em produção.'
        );
      }
    }
  }
}

const ready = boot();
app.ready = ready;

// Only bind a port when started directly — the tests import this file and
// listen on an ephemeral port of their own.
if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  // Explicitly every interface. A process listening only on loopback is
  // invisible to the proxy sitting in front of it, which then has nothing to
  // route a request to and answers as if the service were down.
  const HOST = process.env.HOST || '0.0.0.0';

  // A process that dies without saying why turns a five minute fix into an
  // afternoon. These keep the default behaviour — the process still exits —
  // but name the cause on the way out.
  process.on('unhandledRejection', err => {
    console.error('[server] promessa rejeitada sem tratamento:', err);
    process.exit(1);
  });
  process.on('uncaughtException', err => {
    console.error('[server] exceção não capturada:', err);
    process.exit(1);
  });

  ready.then(
    () => {
      const server = app.listen(PORT, HOST, () => {
        // The bound address, not the one we hoped for: this line is the whole
        // difference between guessing and knowing when routing misbehaves.
        const { address, port } = server.address();
        console.log(`Cineclube ouvindo em ${address}:${port}`);
      });
    },
    err => {
      console.error('[server] falha ao preparar o banco:', err);
      process.exit(1);
    }
  );
}

module.exports = app;
