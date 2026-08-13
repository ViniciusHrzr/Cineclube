try { require('node:process').loadEnvFile('.env'); } catch (e) { /* .env is optional if env vars are set another way */ }

const path = require('node:path');
const express = require('express');
const db = require('./db');

const app = express();
app.use(express.json());

// Seed a few reviewers on first run so the app isn't empty.
const reviewerCount = db.prepare('SELECT COUNT(*) AS n FROM reviewers').get().n;
if (reviewerCount === 0) {
  const seed = db.prepare('INSERT INTO reviewers (id, name, dot) VALUES (?, ?, ?)');
  seed.run('p1', 'Ana Reis', '#b5abfc');
  seed.run('p2', 'Bruno Sá', '#cfd3e5');
  seed.run('p3', 'Clara Lima', '#a7a1db');
  console.log('[server] avaliadores iniciais criados: Ana Reis, Bruno Sá, Clara Lima');
}

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
