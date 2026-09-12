try { require('node:process').loadEnvFile('.env'); } catch (e) { /* .env is optional if env vars are set another way */ }

const path = require('node:path');
const express = require('express');
const db = require('./db');

const auth = require('./auth');

const throttle = require('./throttle');

const app = express();

/* O Render termina o TLS na frente do app: sem isto, `req.ip` é o endereço do
   proxy — o MESMO para todo mundo —, e um limite por IP vira um limite global.

   `1` e não `true`: com `true` o Express acredita no `X-Forwarded-For` inteiro,
   que é escrito por quem faz a requisição. Com `1` ele lê só o salto que o
   nosso próprio proxy acrescentou. */
app.set('trust proxy', 1);

/* ── três cabeçalhos ──────────────────────────────────────────────────────
   **nosniff** é o que importa, por causa de uma coisa que este app faz: ele
   serve ARQUIVO DE GENTE do próprio domínio. O tipo é conferido na entrada
   (image.js aceita três), mas sem `nosniff` o navegador pode adivinhar pelo
   conteúdo — e uma adivinhação que dê "HTML" transforma um upload em página do
   nosso domínio, com acesso ao cookie de sessão.

   **DENY** porque um app que pode ser emoldurado pode ter os cliques roubados.

   **Referrer-Policy** para o endereço de uma ficha não viajar no `Referer`
   quando alguém clica num link de trailer para fora. */
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});

/* A política de conteúdo — ver csp.js, onde cada permissão diz de onde veio.
   Nasce em modo AVISO: ela é conferida no navegador das pessoas, e
   `CINECLUBE_CSP=enforce` a liga sem tocar em código. */
app.use(require('./csp').middleware());
app.use('/api/csp-report', require('./routes/csp'));

/* Quem pode falar com esta API de outra origem — ver cors.js. Antes do corpo e
   da sessão, porque um preflight não tem corpo nem sessão: ele pergunta se a
   requisição de verdade pode existir, e a resposta é só de cabeçalho. */
app.use('/api', require('./cors').middleware());

/* De que versão da API veio cada resposta, e o que um aplicativo instalado
   precisa saber antes de confiar nela — ver contract.js. */
app.use('/api', require('./contract').middleware());
app.get('/api/meta', require('./contract').meta);

/* A megabyte, where the default is a tenth of that: a profile picture arrives
   as base64, which costs a third more than the bytes it carries. The picture
   route enforces its own, much lower, ceiling. */
app.use(express.json({ limit: '1mb' }));
// Every request learns who is signed in; individual routes decide if they care.
app.use(auth.attachSession);

/* ── o teto de trás ───────────────────────────────────────────────────────
   As travas que importam são as das rotas. Esta não sabe nada sobre
   significado: existe para o caso que nenhuma outra cobre, alguém MARTELAR a
   API. Trezentos por minuto é muito para uma pessoa e pouco para um laço — o
   mural a cada 120s e o sino a cada 90s somam menos de duas.

   Depois de `attachSession`, para uma pessoa logada ser medida pela conta e não
   pelo endereço: duas pessoas do clube atrás do mesmo roteador são duas.

   Fora daqui ficam os dois canos de eventos: uma conexão SSE fica aberta por
   horas e é uma requisição só, então contá-la não protegeria nada e reconectar
   depois de uma queda esbarraria num limite feito para outra coisa. O teto
   deles é número de conexões simultâneas, em live.js e screening.js. */
const backstop = throttle.limit({
  name: 'api',
  max: 300,
  windowMs: 60_000,
  message: espera => `Muitos pedidos seguidos. Tente de novo em ${espera}.`,
});
app.use('/api', (req, res, next) =>
  req.path.endsWith('/stream') ? next() : backstop(req, res, next)
);

/* ══════════════════════════════════════════════════════════════════════════
   Duas famílias de rota, e a fronteira é uma pergunta: isto depende de QUAL
   CLUBE?

   Fora do escopo: quem é você, o catálogo do TMDB (o mesmo mundo para todos, e
   guardá-lo por clube pagaria a mesma requisição N vezes), a lista de clubes
   (não pode exigir estar dentro de um) e o retrato de uma pessoa, que tem de
   carregar em toda sala em que ela apareça.

   Todo o resto vive sob `/api/c/<slug>/`. O porquê está em clubs.js.
   ══════════════════════════════════════════════════════════════════════════ */
const clubs = require('./clubs');
const clubRoutes = require('./routes/clubs');
const reviewerRoutes = require('./routes/reviewers');

app.use('/api/auth', require('./routes/auth'));
app.use('/api/catalog', require('./routes/catalog'));
app.use('/api/reels', require('./routes/reels'));
/* Fora do escopo de clube pelo mesmo motivo do catálogo de filmes: o cache de
   uma série é o mesmo em toda a rede. O que é do clube desce para
   /api/c/<slug>/shows. */
app.use('/api/series', require('./routes/series'));
app.use('/api/clubs', clubRoutes.index);
/* O sino é da REDE e não de uma sala: quem está em três clubes tinha três
   sinos, e nenhum deles contava o que houve nos outros dois. Fora do escopo
   porque a resposta atravessa salas. */
app.use('/api/notices', require('./routes/notices'));
/* O aplicativo instalado perguntando se existe versão nova, e baixando-a. Fora
   de clube e fora de sessão: o que ele recebe é o mesmo JavaScript que qualquer
   pessoa baixa ao abrir o site. Ver ota.js. */
app.use('/api/app', require('./routes/app'));
/* Quem quer ser avisado com o app fechado, e o relógio que dispara os avisos do
   dia. Fora de clube: a inscrição é do APARELHO, e o que ela recebe atravessa
   as salas de quem está nele. Ver push.js. */
app.use('/api/push', require('./routes/push'));
app.use('/api/reviewers', reviewerRoutes.index);

const scoped = express.Router({ mergeParams: true });
scoped.use('/reviewers', reviewerRoutes.scoped);
scoped.use('/reviews', require('./routes/reviews'));
scoped.use('/watchlist', require('./routes/watchlist'));
scoped.use('/shows', require('./routes/shows'));
/* Caminhos próprios e não um parâmetro em `/social` e `/feed`: são outras
   tabelas, outra unidade avaliada e outras consultas. */
scoped.use('/shows-social', require('./routes/showsSocial'));
scoped.use('/shows-feed', require('./routes/showsFeed'));
scoped.use('/screening', require('./routes/screening'));
scoped.use('/social', require('./routes/social'));
scoped.use('/notifications', require('./routes/notifications'));
scoped.use('/feed', require('./routes/feed'));
scoped.use('/live', require('./routes/live'));
/* Por último, porque ele tem uma rota em `/` e casaria antes das de cima. */
scoped.use('/', clubRoutes.scoped);

app.use('/api/c/:club', clubs.resolve, scoped);

/* The build stamps a content hash into every asset's name, so a file under
   /assets can never change without changing its URL — the exact condition under
   which a browser may keep it forever. index.html is deliberately left out: it
   is the one file whose name never changes. */
app.use(
  '/assets',
  express.static(path.join(__dirname, 'public', 'assets'), { immutable: true, maxAge: '1y' })
);
/* index.html above all: revalidate every time. It carries no hash — it is the
   file that names the hashed ones — so a browser holding an old copy is running
   the previous release in full, with no way to find out. `no-cache` does not
   mean "do not store", it means "ask first".

   The service worker gets the same header for a stronger reason: it is the file
   that serves the film, it outlives the tab that installed it, and browsers
   revalidating it on their own is a thing three engines each decided separately
   and have changed before. */
app.use(
  express.static(path.join(__dirname, 'public'), {
    setHeaders: (res, filePath) => {
      if (
        filePath.endsWith('.html') ||
        /* Os dois service workers: o do app e o do WebTorrent que ele importa.
           Eles sobrevivem à aba que os instalou, e um navegador segurando o
           antigo é o release anterior rodando sem ter como descobrir isso. */
        filePath.endsWith('sw.min.js') ||
        filePath.endsWith('app-sw.js')
      ) {
        res.setHeader('Cache-Control', 'no-cache');
      }
    },
  })
);

/* ══════════════════════════════════════════════════════════════════════════
   O ÚLTIMO TRATADOR, e por que ele não imprime o erro inteiro.

   Quando o corpo de uma requisição não é JSON válido, o `body-parser` levanta
   um erro e PENDURA O CORPO CRU NELE, em `err.body`. Um `console.error(err)`
   escrevia esse corpo no log da instância — e o caso caro é
   `/api/auth/login`: um corpo quase-válido com uma senha dentro, em texto puro
   no painel do Render. Então nada de corpo, nunca.

   E um JSON torto não é 500: 500 quer dizer "eu quebrei", e um corpo malformado
   é o cliente dizendo algo que não dá para ler, o que é 400.
   ══════════════════════════════════════════════════════════════════════════ */
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
  /* Mensagem e pilha, e nada mais do objeto: um erro carregado de qualquer
     lugar pode ter trazido junto um campo que não é para sair daqui. */
  console.error(`[server] erro não tratado em ${req.method} ${req.path}: ${err?.message}`);
  if (err?.stack) console.error(err.stack);
  res.status(500).json({ error: 'Erro interno.' });
});

/* ══════════════════════════════════════════════════════════════════════════
   O ADMINISTRADOR DA INSTALAÇÃO, e por que ele é UM só. São duas coisas com o
   mesmo nome em português:

   · **ADM de um clube** (`club_members.role`) manda na sala dele e não alcança
     nada fora dela. Qualquer pessoa que funde um clube vira um.
   · **ADM geral** (`reviewers.is_admin`) cuida de CONTAS — apagar uma pessoa da
     plataforma inteira. É um só, e é quem hospeda isto.

   A cadeira é de `CINECLUBE_ADMIN_EMAIL` e só vale para conta ligada ao Google.
   Era do NOME, e isso estava errado desde que existe cadastro aberto. Um
   cadastro por senha não verifica e-mail nenhum, então aceitar a cadeira por
   e-mail auto-declarado seria a mesma porta dos fundos com outra fechadura; um
   `google_sub` é a prova de que o Google confirmou aquele endereço.
   ══════════════════════════════════════════════════════════════════════════ */
const OWNER_EMAIL = (process.env.CINECLUBE_ADMIN_EMAIL || '').trim().toLowerCase();

/* The database is remote now, so everything the app needs before its first
   request — the schema, the seeds, the admin — is a promise. Nothing listens
   until it settles, and the tests await the same promise. */
async function boot() {
  await db.ready;

  /* As contas de exemplo nascem sem credencial nenhuma: são lugares na lista,
     não pessoas, e dar a elas uma senha conhecida seria porta dos fundos.

     O clube principal é criado aqui porque num banco vazio a migração roda
     antes de existir alguém — e as contas de exemplo já nascem dentro dele. */
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

  /* Roda a cada boot, de propósito: se o e-mail da variável mudar, a cadeira
     acompanha. E TIRA de quem não é mais — é a metade que faz disto uma regra e
     não uma concessão inicial. */
  const adminRow = OWNER_EMAIL
    ? await db
        .prepare('SELECT * FROM reviewers WHERE email = ? COLLATE NOCASE AND google_sub IS NOT NULL')
        .get(OWNER_EMAIL)
    : null;

  /* A limpeza pula quem não tem NENHUMA credencial — nem Google, nem senha.
     São as contas de exemplo e as de antes do cadastro, e é `is_admin` que
     `accountForGoogle` usa para achar a do dono na primeira entrada pelo
     e-mail configurado. Rebaixá-las aqui tiraria a marca antes de existir
     alguém para herdá-la.

     Não é brecha: uma conta sem credencial nenhuma é uma conta em que ninguém
     consegue entrar. */
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

    /* `is_admin` é a instalação, `role` é a sala. Só quando a sala não tem
       nenhum: um clube que já tem ADM nunca é reassentado por código, ou sair
       do próprio clube seria desfeito no reinício seguinte. */
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
  // Explicitly every interface: a process listening only on loopback is
  // invisible to the proxy in front of it, which then answers as if the service
  // were down.
  // route a request to and answers as if the service were down.
  const HOST = process.env.HOST || '0.0.0.0';

  // These keep the default behaviour — the process still exits — but name the
  // cause on the way out.
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
        // The bound address, not the one we hoped for: the difference between
        // guessing and knowing when routing misbehaves.
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
