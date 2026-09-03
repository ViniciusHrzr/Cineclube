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

/* ══════════════════════════════════════════════════════════════════════════
   O ADMINISTRADOR DA INSTALAÇÃO, e por que ele é UM só.

   São duas coisas diferentes com o mesmo nome em português, e confundir as duas
   é como um produto assim vaza poder:

   · **ADM de um clube** (`club_members.role`) manda na sala dele. Aprova quem
     entra, muda a foto, modera a conversa. Qualquer pessoa que funde um clube
     vira um, e não alcança absolutamente nada fora daquela sala.

   · **ADM geral** (`reviewers.is_admin`) cuida de CONTAS — apagar uma pessoa da
     plataforma inteira, com as fichas dela em todos os clubes. É um só, e é
     quem hospeda isto.

   ── a cadeira é do e-mail, e do e-mail verificado ─────────────────────────
   Era do NOME: a conta chamada "Vinicius" ganhava a cadeira no boot. Isso estava
   errado desde que existe cadastro aberto — qualquer pessoa criava uma conta com
   esse nome e esperava um reinício.

   Agora é `CINECLUBE_ADMIN_EMAIL`, e só vale para uma conta ligada ao Google. Um
   cadastro por senha não verifica e-mail nenhum (não há como: este app não manda
   e-mail), então aceitar a cadeira por e-mail auto-declarado seria a mesma porta
   dos fundos com outra fechadura. Um `google_sub` é a prova de que o Google
   confirmou aquele endereço, e é isso que a checagem exige.
   ══════════════════════════════════════════════════════════════════════════ */
const OWNER_EMAIL = (process.env.CINECLUBE_ADMIN_EMAIL || '').trim().toLowerCase();

/* The database is remote now, so everything the app needs before its first
   request — the schema, the seeds, the admin — is a promise. Nothing listens
   until it settles, and the tests await the same promise. */
async function boot() {
  await db.ready;

  /* As contas de exemplo nascem sem credencial nenhuma: são lugares na lista,
     não pessoas, e dar a elas uma senha conhecida seria porta dos fundos.

     O clube fundador. A migração o cria e povoa quando existem dados de antes
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

  if (!OWNER_EMAIL) {
    console.warn(
      '[server] CINECLUBE_ADMIN_EMAIL não está definida. Ninguém administra a ' +
        'instalação até ela existir — e é assim mesmo: uma cadeira que se ocupa por ' +
        'omissão é uma cadeira que qualquer um ocupa.'
    );
  }

  /* A cadeira é do e-mail configurado, e só de uma conta ligada ao Google —
     porque só ela teve o e-mail verificado por alguém. Ver o bloco no topo.

     Roda a cada boot, e é de propósito: se um dia o e-mail da variável mudar, a
     cadeira acompanha, e ninguém fica com ela por ter chegado primeiro. Também
     TIRA de quem não é mais — é a metade que faz disto uma regra e não uma
     concessão inicial. */
  const adminRow = OWNER_EMAIL
    ? await db
        .prepare('SELECT * FROM reviewers WHERE email = ? COLLATE NOCASE AND google_sub IS NOT NULL')
        .get(OWNER_EMAIL)
    : null;

  /* ── a exceção da conta adormecida ─────────────────────────────────────
     A limpeza pula quem não tem NENHUMA credencial — nem Google, nem senha.
     Essas contas são as de antes dos clubes, esperando ser reivindicadas, e é
     justamente `is_admin` que `accountForGoogle` usa para achar qual delas é a
     do dono na primeira entrada. Rebaixá-la aqui quebraria a migração: a conta
     perderia a marca antes de existir alguém para herdá-la, e as fichas antigas
     ficariam num avaliador que ninguém mais alcança.

     Não é uma brecha: uma conta sem credencial nenhuma é uma conta em que
     ninguém consegue entrar. Ela deixa de ser exceção no instante em que alguém
     a reivindica, porque aí passa a ter `google_sub`. */
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
