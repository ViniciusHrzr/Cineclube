try { require('node:process').loadEnvFile('.env'); } catch (e) { }

const path = require('node:path');
const express = require('express');
const db = require('./lib/db');

const auth = require('./lib/auth');

const throttle = require('./lib/throttle');

const app = express();

app.set('trust proxy', 1);

app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});

app.use(require('./lib/csp').middleware());
app.use('/api/csp-report', require('./routes/csp'));

app.use('/api', require('./lib/cors').middleware());

app.use('/api', require('./lib/contract').middleware());
app.get('/api/meta', require('./lib/contract').meta);

app.use(express.json({ limit: '1mb' }));
app.use(auth.attachSession);
app.use(auth.attachTicket);

const backstop = throttle.limit({
  name: 'api',
  max: 300,
  windowMs: 60_000,
  message: espera => `Muitos pedidos seguidos. Tente de novo em ${espera}.`,
});
app.use('/api', (req, res, next) =>
  req.path.endsWith('/stream') ? next() : backstop(req, res, next)
);

const clubs = require('./lib/clubs');
const clubRoutes = require('./routes/clubs');
const reviewerRoutes = require('./routes/reviewers');

app.use('/api/auth', require('./routes/auth'));
app.use('/api/catalog', require('./routes/catalog'));
app.use('/api/reels', require('./routes/reels'));
app.use('/api/series', require('./routes/series'));
app.use('/api/clubs', clubRoutes.index);
app.use('/api/notices', require('./routes/notices'));
app.use('/api/app', require('./routes/app'));
app.use('/api/push', require('./routes/push'));
app.use('/api/reviewers', reviewerRoutes.index);

const scoped = express.Router({ mergeParams: true });
scoped.use('/reviewers', reviewerRoutes.scoped);
scoped.use('/reviews', require('./routes/reviews'));
scoped.use('/watchlist', require('./routes/watchlist'));
scoped.use('/shows', require('./routes/shows'));
scoped.use('/shows-social', require('./routes/showsSocial'));
scoped.use('/shows-feed', require('./routes/showsFeed'));
scoped.use('/screening', require('./routes/screening'));
scoped.use('/social', require('./routes/social'));
scoped.use('/notifications', require('./routes/notifications'));
scoped.use('/feed', require('./routes/feed'));
scoped.use('/live', require('./routes/live'));
scoped.use('/', clubRoutes.scoped);

app.use('/api/c/:club', clubs.resolve, scoped);

app.use(
  '/assets',
  express.static(path.join(__dirname, 'public', 'assets'), { immutable: true, maxAge: '1y' })
);
app.use(
  express.static(path.join(__dirname, 'public'), {
    setHeaders: (res, filePath) => {
      if (
        filePath.endsWith('.html') ||
        filePath.endsWith('sw.min.js') ||
        filePath.endsWith('app-sw.js')
      ) {
        res.setHeader('Cache-Control', 'no-cache');
      }
    },
  })
);

app.get('/.well-known/assetlinks.json', (req, res) => {
  const digital = (process.env.ANDROID_FINGERPRINT || '').trim().toUpperCase();
  if (!digital) return res.status(404).json({ error: 'Sem aplicativo registrado.' });
  const pacote = (process.env.ANDROID_PACKAGE || 'com.cineclube.app').trim();

  res.json([
    {
      relation: ['delegate_permission/common.handle_all_urls'],
      target: {
        namespace: 'android_app',
        package_name: pacote,
        sha256_cert_fingerprints: digital.split(',').map(d => d.trim()).filter(Boolean),
      },
    },
  ]);
});

const CLIENT_FAULTS = {
  'entity.parse.failed': [400, 'O corpo do pedido não é JSON válido.'],
  'entity.too.large': [413, 'O conteúdo é grande demais.'],
  'request.aborted': [400, 'O pedido foi interrompido.'],
  'encoding.unsupported': [415, 'Codificação não suportada.'],
  'charset.unsupported': [415, 'Codificação não suportada.'],
};

app.use((err, req, res, _next) => {
  const known = CLIENT_FAULTS[err?.type];
  if (known) {
    const [status, mensagem] = known;
    console.warn(`[server] ${err.type} em ${req.method} ${req.path}`);
    return res.status(status).json({ error: mensagem });
  }
  console.error(`[server] erro não tratado em ${req.method} ${req.path}: ${err?.message}`);
  if (err?.stack) console.error(err.stack);
  res.status(500).json({ error: 'Erro interno.' });
});

const OWNER_EMAIL = (process.env.CINECLUBE_ADMIN_EMAIL || '').trim().toLowerCase();

async function boot() {
  await db.ready;

  const home = await db.ensureHomeClub();

  const { n } = await db.prepare('SELECT COUNT(*) AS n FROM reviewers').get();
  if (n === 0) {
    const seed = db.prepare('INSERT INTO reviewers (id, name, dot) VALUES (?, ?, ?)');
    await seed.run('p1', 'Ana Reis', '#b5abfc');
    await seed.run('p2', 'Bruno Sá', '#cfd3e5');
    await seed.run('p3', 'Clara Lima', '#a7a1db');
    const join = db.prepare(
      'INSERT INTO club_members (club_id, reviewer_id) VALUES (?, ?) ON CONFLICT DO NOTHING'
    );
    for (const id of ['p1', 'p2', 'p3']) await join.run(home, id);
    console.log('[server] avaliadores iniciais criados: Ana Reis, Bruno Sá, Clara Lima');
  }

  if (!OWNER_EMAIL) {
    console.warn(
      '[server] CINECLUBE_ADMIN_EMAIL não está definida. Ninguém administra a ' +
        'instalação até ela existir — e é assim mesmo: uma cadeira que se ocupa por ' +
        'omissão é uma cadeira que qualquer um ocupa.'
    );
  }

  const adminRow = OWNER_EMAIL
    ? await db
        .prepare('SELECT * FROM reviewers WHERE email = ? COLLATE NOCASE AND google_sub IS NOT NULL')
        .get(OWNER_EMAIL)
    : null;

  await db.prepare(
    `UPDATE reviewers SET is_admin = 0
     WHERE is_admin = 1 AND id <> ?
       AND (google_sub IS NOT NULL OR password_hash IS NOT NULL)`
  ).run(adminRow?.id ?? '');

  if (adminRow) {
    if (!adminRow.is_admin) {
      await db.prepare('UPDATE reviewers SET is_admin = 1 WHERE id = ?').run(adminRow.id);
      console.log(`[server] ${adminRow.name} <${OWNER_EMAIL}> é o administrador da instalação`);
    }

    const { n: chaired } = await db
      .prepare(`SELECT COUNT(*) AS n FROM club_members WHERE club_id = ? AND role = 'admin'`)
      .get(home);
    if (!chaired) {
      await db.prepare(
        `INSERT INTO club_members (club_id, reviewer_id, role) VALUES (?, ?, 'admin')
         ON CONFLICT (club_id, reviewer_id) DO UPDATE SET role = 'admin'`
      ).run(home, adminRow.id);
      console.log(`[server] ${adminRow.name} é ADM do clube ${db.HOME_CLUB}`);
    }
  }
}

const ready = boot();
app.ready = ready;

if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  const HOST = process.env.HOST || '0.0.0.0';

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
