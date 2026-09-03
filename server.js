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

/* ══════════════════════════════════════════════════════════════════════════
   Duas famílias de rota, e a fronteira entre elas é uma pergunta só: isto
   depende de QUAL CLUBE?

   Fora do escopo ficam quatro coisas, cada uma por um motivo próprio. Quem é
   você não depende de sala nenhuma. O catálogo do TMDB é o mesmo mundo para
   todo mundo, e guardá-lo por clube seria pagar a mesma requisição N vezes. A
   lista de clubes não pode exigir estar dentro de um. E o retrato de uma pessoa
   é dela, não da sala — a mesma URL tem de carregar em toda sala em que ela
   apareça.

   Todo o resto vive sob `/api/c/<slug>/`, atrás de `clubs.resolve`. O clube na
   URL e não na sessão: um link de ficha colado no Discord tem de significar a
   mesma coisa para quem clicar, e o `EventSource` da sala ao vivo não sabe
   mandar cabeçalho. O porquê inteiro está em clubs.js.
   ══════════════════════════════════════════════════════════════════════════ */
const clubs = require('./clubs');
const clubRoutes = require('./routes/clubs');
const reviewerRoutes = require('./routes/reviewers');

app.use('/api/auth', require('./routes/auth'));
app.use('/api/catalog', require('./routes/catalog'));
app.use('/api/clubs', clubRoutes.index);
app.use('/api/reviewers', reviewerRoutes.index);

const scoped = express.Router({ mergeParams: true });
scoped.use('/reviewers', reviewerRoutes.scoped);
scoped.use('/reviews', require('./routes/reviews'));
scoped.use('/watchlist', require('./routes/watchlist'));
scoped.use('/screening', require('./routes/screening'));
scoped.use('/social', require('./routes/social'));
scoped.use('/notifications', require('./routes/notifications'));
scoped.use('/feed', require('./routes/feed'));
scoped.use('/live', require('./routes/live'));
/* Por último, porque ele tem uma rota em `/` e casaria antes das de cima. */
scoped.use('/', clubRoutes.scoped);

app.use('/api/c/:club', clubs.resolve, scoped);

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

/* O administrador da instalação. Roda uma vez: só age enquanto ninguém está na
   cadeira, então nunca promove nem rebaixa alguém num boot posterior.

   ── e o PIN inicial não existe mais ────────────────────────────────────────
   Havia aqui um bloco que gravava um PIN de partida para esta conta, com um
   fallback no código para a máquina local. Ele sumiu junto com o PIN: a
   credencial agora chega pelo Google, e a ligação com a conta que já existia é
   feita por CINECLUBE_ADMIN_EMAIL na primeira entrada (ver accountForGoogle).
   Não há mais nenhum segredo neste arquivo, o que também tira do repositório a
   única razão que ele tinha para precisar ser privado. */
const CLUB_ADMIN = process.env.CINECLUBE_ADMIN || 'Vinicius';

/* The database is remote now, so everything the app needs before its first
   request — the schema, the seeds, the admin — is a promise. Nothing listens
   until it settles, and the tests await the same promise. */
async function boot() {
  await db.ready;

  // Seed a few reviewers on first run so the app isn't empty. They come with no
  // PIN, which the sign-in screen shows as "PIN pendente" — a seeded account is
  // a placeholder, and handing it a known PIN would be a back door.
  /* O clube fundador. A migração o cria e povoa quando existem dados de antes
     dos clubes; num banco vazio ela roda antes de existir alguém, então é aqui
     que ele passa a existir — e as contas de exemplo logo abaixo já nascem
     dentro dele. Uma pessoa numa rede de clubes sem sala nenhuma para entrar
     não tem tela em que aparecer. */
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

    /* E ADM do clube fundador, que é outra coisa: `is_admin` é a instalação,
       `role` é a sala. Só quando a sala não tem nenhum — pela mesma razão da
       cadeira acima, um clube que já tem ADM nunca é reassentado por código, ou
       sair do próprio clube seria desfeito no reinício seguinte. */
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
