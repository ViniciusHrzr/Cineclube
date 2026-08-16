try { require('node:process').loadEnvFile('.env'); } catch (e) { /* .env is optional if env vars are set another way */ }

const path = require('node:path');
const express = require('express');
const db = require('./db');

const auth = require('./auth');

const app = express();
app.use(express.json());
// Every request learns who is signed in; individual routes decide if they care.
app.use(auth.attachSession);

// Seed a few reviewers on first run so the app isn't empty. They come with no
// PIN, which the sign-in screen shows as "PIN pendente" — a seeded account is
// a placeholder, and handing it a known PIN would be a back door.
const reviewerCount = db.prepare('SELECT COUNT(*) AS n FROM reviewers').get().n;
if (reviewerCount === 0) {
  const seed = db.prepare('INSERT INTO reviewers (id, name, dot) VALUES (?, ?, ?)');
  seed.run('p1', 'Ana Reis', '#b5abfc');
  seed.run('p2', 'Bruno Sá', '#cfd3e5');
  seed.run('p3', 'Clara Lima', '#a7a1db');
  console.log('[server] avaliadores iniciais criados: Ana Reis, Bruno Sá, Clara Lima');
}

// The club's administrator. Runs once: it only acts on an account that has no
// PIN yet, so it can never overwrite a PIN Vinicius has since chosen, and it
// never demotes or promotes anyone on later boots.
const CLUB_ADMIN = process.env.CINECLUBE_ADMIN || 'Vinicius';
const CLUB_ADMIN_PIN = process.env.CINECLUBE_ADMIN_PIN || '1646';
const adminRow = db.prepare('SELECT * FROM reviewers WHERE name = ? COLLATE NOCASE').get(CLUB_ADMIN);
if (adminRow) {
  if (!adminRow.is_admin) {
    db.prepare('UPDATE reviewers SET is_admin = 1 WHERE id = ?').run(adminRow.id);
    console.log(`[server] ${adminRow.name} definido como administrador do clube`);
  }
  if (!adminRow.pin_hash) {
    auth.setPin(adminRow.id, CLUB_ADMIN_PIN);
    console.log(`[server] PIN inicial definido para ${adminRow.name}. Troque-o pelo app.`);
  }
}

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

// Only bind a port when started directly — the tests import this file and
// listen on an ephemeral port of their own.
if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`Cineclube rodando em http://localhost:${PORT}`);
  });
}

module.exports = app;
