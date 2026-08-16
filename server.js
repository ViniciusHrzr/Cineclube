try { require('node:process').loadEnvFile('.env'); } catch (e) { /* .env is optional if env vars are set another way */ }

const path = require('node:path');
const express = require('express');
const db = require('./db');

const auth = require('./auth');

const app = express();
app.use(express.json());
// Every request learns who is signed in; individual routes decide if they care.
app.use(auth.attachSession);

app.use('/api/auth', require('./routes/auth'));
app.use('/api/catalog', require('./routes/catalog'));
app.use('/api/reviewers', require('./routes/reviewers'));
app.use('/api/reviews', require('./routes/reviews'));
app.use('/api/watchlist', require('./routes/watchlist'));

app.use(express.static(path.join(__dirname, 'public')));

app.use((err, req, res, next) => {
  console.error('[server] erro não tratado:', err);
  res.status(500).json({ error: 'Erro interno.' });
});

// The club's administrator. Runs once: it only acts on an account that has no
// PIN yet, so it can never overwrite a PIN Vinicius has since chosen, and it
// never demotes or promotes anyone on later boots.
const CLUB_ADMIN = process.env.CINECLUBE_ADMIN || 'Vinicius';
const CLUB_ADMIN_PIN = process.env.CINECLUBE_ADMIN_PIN || '1646';

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

  const adminRow = await db.prepare('SELECT * FROM reviewers WHERE name = ? COLLATE NOCASE').get(CLUB_ADMIN);
  if (adminRow) {
    if (!adminRow.is_admin) {
      await db.prepare('UPDATE reviewers SET is_admin = 1 WHERE id = ?').run(adminRow.id);
      console.log(`[server] ${adminRow.name} definido como administrador do clube`);
    }
    if (!adminRow.pin_hash) {
      await auth.setPin(adminRow.id, CLUB_ADMIN_PIN);
      console.log(`[server] PIN inicial definido para ${adminRow.name}. Troque-o pelo app.`);
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
