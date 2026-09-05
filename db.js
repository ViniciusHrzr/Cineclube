const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { createClient } = require('@libsql/client');

/* ══════════════════════════════════════════════════════════════════════════
   The database.

   This is libSQL — a fork of SQLite — so every query in this app is still
   SQLite: datetime('now'), julianday(), COLLATE NOCASE, PRAGMA. What changed
   against node:sqlite is only the calling convention: everything here is
   async, because in production the database sits across a network.

   Without TURSO_DATABASE_URL the client opens a local file instead, which is
   how the tests and development on this machine run — no network, no account,
   no token.
   ══════════════════════════════════════════════════════════════════════════ */

const remoteUrl = process.env.TURSO_DATABASE_URL;
// CINECLUBE_DB lets the tests point at a throwaway file instead of the real one.
const localPath = process.env.CINECLUBE_DB || path.join(__dirname, 'data', 'cineclube.db');
const isLocal = !remoteUrl;

if (isLocal) fs.mkdirSync(path.dirname(localPath), { recursive: true });

const client = createClient({
  url: remoteUrl || 'file:' + localPath,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

/* A single object argument means named parameters (@id, @title); anything
   else is positional. No value this app stores is an object, so the
   distinction is never ambiguous. */
function argsOf(args) {
  const [first] = args;
  if (args.length === 1 && first !== null && typeof first === 'object' && !Array.isArray(first)) {
    return first;
  }
  return args;
}

/* Keeps the shape node:sqlite had — prepare().get()/.all()/.run() — because
   that is the shape the routes already speak. The difference is that every one
   of them now returns a promise. */
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

/** Several statements at once, no parameters. For DDL. */
function exec(sql) {
  return client.executeMultiple(sql);
}

/** A list of statements in one transaction. Replaces the manual BEGIN/COMMIT. */
function batch(statements) {
  return client.batch(statements, 'write');
}

async function columnsOf(table) {
  const { rows } = await client.execute(`PRAGMA table_info(${table})`);
  return rows.map(c => c.name);
}

/* ── o endereço de um clube ───────────────────────────────────────────────
   O nome é o que a pessoa escreve e vê; o slug é o que cabe numa URL e o que
   ela cola no Discord. Sem acento, sem maiúscula, sem pontuação — `Clube do
   Terror` vira `clube-do-terror`.

   Os dois são únicos, e por motivos diferentes: o nome porque duas salas com o
   mesmo nome no saguão são uma sala que ninguém sabe escolher, o slug porque
   ele é um endereço. Um nome que reduz a nada (só emoji, só pontuação) recebe
   um slug sorteado em vez de uma string vazia — o clube ainda tem nome, só não
   tem nome escrevível em URL. */
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

/** Um slug livre, acrescentando -2, -3… quando o desejado já é de outro clube. */
async function freeSlug(name, exceptId = null) {
  const wanted = slugify(name);
  for (let n = 1; ; n++) {
    const slug = n === 1 ? wanted : `${wanted}-${n}`;
    const taken = await prepare('SELECT id FROM clubs WHERE slug = ?').get(slug);
    if (!taken || taken.id === exceptId) return slug;
  }
}

/* O clube fundador. Existe porque este produto teve um clube antes de ter o
   conceito de clube, e tudo que foi gravado até aqui é dele. Idempotente: é
   chamado pela migração e outra vez pelo boot, depois das contas de exemplo
   serem criadas — num banco vazio a migração roda antes de existir alguém. */
async function ensureHomeClub() {
  const found = await prepare('SELECT id FROM clubs WHERE name = ? COLLATE NOCASE').get(HOME_CLUB);
  if (found) return found.id;
  const id = 'c' + crypto.randomUUID();
  /* Fechado. É o clube de um grupo de amigos que já existia antes de haver rede,
     e o acervo deles não passa a ser público porque o produto cresceu. Aparece
     na vitrine com nome e foto, como todo clube; entrar depende do ADM. */
  await prepare(
    `INSERT INTO clubs (id, name, slug, visibility) VALUES (?, ?, ?, 'private')`
  ).run(id, HOME_CLUB, slugify(HOME_CLUB));
  return id;
}

async function migrate() {
  // WAL and foreign_keys only mean something for a local file; on Turso the
  // server already handles both and the PRAGMA is refused.
  if (isLocal) {
    await exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  }

  await exec(`
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

    /* ── a conversa em cima de uma avaliação ─────────────────────────────
       The club argues on a Discord call and the argument evaporates with it.
       This is the first thing in the product that keeps any of it: a thread
       hanging off one person's take, so "discordo do teu 9 em fotografia" has
       somewhere to live that is not a voice channel nobody recorded.

       Pendurado na avaliação e não no filme, de propósito. A ficha de cada
       pessoa é a coisa concreta que se discute, e a mesma escolha vale para os
       votos abaixo — os dois respondem a um take específico.

       ON DELETE CASCADE nas duas pontas: uma avaliação apagada leva a conversa
       sobre ela, e alguém que sai do clube leva o que escreveu. */
    CREATE TABLE IF NOT EXISTS review_comments (
      id TEXT PRIMARY KEY,
      review_id TEXT NOT NULL REFERENCES reviews(id) ON DELETE CASCADE,
      reviewer_id TEXT NOT NULL REFERENCES reviewers(id) ON DELETE CASCADE,
      body TEXT NOT NULL,
      /* Uma resposta, e a profundidade para em um — ver a migração abaixo, que
         é o que dá esta coluna aos bancos criados antes dela existir. */
      parent_id TEXT REFERENCES review_comments(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS review_comments_review ON review_comments(review_id);

    /* ── e o like no comentário ───────────────────────────────────────────
       Sem coluna de valor, ao contrário do voto em critério. Lá o par existe
       porque se concorda ou se discorda de um número; aqui é uma pessoa
       dizendo "isso" para o que outra escreveu, e o contrário disso, num clube
       de amigos, não é a mesma informação com o sinal trocado — é outra coisa,
       mais pesada, que ninguém pediu.

       Então o like existe ou não existe. Tirar apaga a linha, do mesmo jeito
       que tirar um voto apaga a dele. */
    CREATE TABLE IF NOT EXISTS comment_likes (
      comment_id TEXT NOT NULL REFERENCES review_comments(id) ON DELETE CASCADE,
      reviewer_id TEXT NOT NULL REFERENCES reviewers(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (comment_id, reviewer_id)
    );
    CREATE INDEX IF NOT EXISTS comment_likes_comment ON comment_likes(comment_id);

    /* ── concordar com a ficha de alguém ──────────────────────────────────
       O voto era por critério, e o argumento era bom no papel: concordar com
       uma pessoa inteira é raro, concordar com o 9 dela em fotografia e achar o
       4 em roteiro absurdo é o que acontece de verdade.

       Só que onze polegares por ficha por pessoa não é uma opinião, é um
       formulário. Com seis membros, uma noite de discussão gerava dezenas de
       votos sobre a mesma ficha — o mural teve de expulsá-los para não afogar a
       avaliação que os originou — e o detalhamento virou uma grade com uma
       coluna de controles ao lado de cada nota. O que o clube fazia de verdade
       era concordar ou discordar do TAKE: "boa avaliação", "achei alto demais".

       Então é um voto por (ficha, quem votou). A coluna value é +1 ou -1 e
       nunca 0 — tirar o voto apaga a linha, que é a diferença entre "não votei"
       e "votei neutro" —, e trocar de ideia é um UPDATE e nunca uma segunda
       linha.

       criterion_votes fica abaixo, sem ninguém lendo. É o fóssil do desenho
       anterior: as linhas foram dobradas para cá na migração, e apagar a tabela
       destruiria o único registro de quem concordou com o quê, por um espaço
       que num banco deste tamanho não existe como problema. */
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
  `);

  // Lightweight migration: add columns that didn't exist in earlier versions
  // of this schema, without wiping existing data.
  const reviewCols = await columnsOf('reviews');
  if (!reviewCols.includes('comment')) {
    await exec('ALTER TABLE reviews ADD COLUMN comment TEXT');
  }

  /* A credencial. Só o hash e o salt são guardados — nem o PIN de antes nem a
     senha de agora tocam o banco, o log ou um corpo de resposta.

     `pin_hash` e `pin_salt` continuam aqui, mortas, e é de propósito: tirar uma
     coluna no SQLite é reconstruir a tabela, e reconstruir `reviewers` custaria
     mexer nas sete chaves estrangeiras que apontam para ela. Duas colunas nulas
     são mais baratas do que isso e não são lidas em lugar nenhum. */
  const reviewerCols = await columnsOf('reviewers');
  const addReviewerCol = async (name, ddl) => {
    if (!reviewerCols.includes(name)) await exec(`ALTER TABLE reviewers ADD COLUMN ${ddl}`);
  };
  await addReviewerCol('pin_hash', 'pin_hash TEXT');
  await addReviewerCol('pin_salt', 'pin_salt TEXT');
  // Admin is a column, not a name match: renaming the account would otherwise
  // hand the power away, and a second person called Vinicius would inherit it.
  await addReviewerCol('is_admin', 'is_admin INTEGER NOT NULL DEFAULT 0');
  /* Entradas erradas seguidas põem a conta no gelo por um tempo crescente. A
     coluna se chamava `pin_attempts` enquanto a credencial era um PIN; a regra
     não mudou com a senha, só o nome do que se erra. Renomear e não criar uma
     segunda: duas colunas contando a mesma coisa é a que ninguém zera. */
  if (reviewerCols.includes('pin_attempts') && !reviewerCols.includes('auth_attempts')) {
    await exec('ALTER TABLE reviewers RENAME COLUMN pin_attempts TO auth_attempts');
  } else if (!reviewerCols.includes('auth_attempts')) {
    await exec('ALTER TABLE reviewers ADD COLUMN auth_attempts INTEGER NOT NULL DEFAULT 0');
  }
  await addReviewerCol('locked_until', 'locked_until TEXT');

  /* ── the portrait ───────────────────────────────────────────────────────
     Kept in the row, as base64, and not on disk: the machine this runs on
     throws its filesystem away at every deploy, so a file written there is a
     file that exists until the next push. An object store would be the answer
     at another scale; at four members and a picture each it would be a second
     service, a second set of credentials and a second thing to be down.

     The client shrinks every image to a small square before sending, so what
     lands here is tens of kilobytes, not the four megabytes a phone camera
     produces. The route refuses anything larger regardless — the client is
     convenience, not enforcement.

     `avatar_rev` changes with every upload and rides in the URL, which is what
     lets the picture be cached forever and still change the moment it does. */
  /* A film is rated under one genre chosen from the several it carries, so the
     cache has to remember the several. Stored as a comma-joined list because
     none of these names contains a comma and nothing here ever queries inside
     it — it is read whole or not at all. Rows cached before this column existed
     have it empty, and the reader falls back to the single genre they do have. */
  const movieCols = await columnsOf('movies_cache');
  if (!movieCols.includes('genres')) {
    await exec('ALTER TABLE movies_cache ADD COLUMN genres TEXT');
  }
  /* O nome com que o filme circula lá fora — TMDB's `original_title`, stored
     only when it differs from the Portuguese one. Cached because the queue and
     the archive read the film from here with TMDB nowhere in the request, and
     because it is the string somebody copies to go find a copy. Rows written
     before this column existed have it null and fill in the next time the film
     is seen, which every list endpoint does. */
  if (!movieCols.includes('original_title')) {
    await exec('ALTER TABLE movies_cache ADD COLUMN original_title TEXT');
  }

  /* E o nome em inglês, quando ele não é nenhum dos dois acima. Existe para as
     buscas: a fila, a sessão e o acervo filtram o que está no banco, e Parasita
     não é achável por "Parasite" sem esta coluna.

     Só chega por filme, nunca por lista — TMDB carrega tradução no endpoint de
     um filme e em nenhum outro — então é preenchido quando o filme vira algo
     que o clube guarda: ficha aberta, entrou na fila, foi avaliado. O que já
     estava no banco antes disso é o que `npm run backfill:ingles` cura. */
  if (!movieCols.includes('english_title')) {
    await exec('ALTER TABLE movies_cache ADD COLUMN english_title TEXT');
  }

  /* How long the film runs, in minutes. TMDB only reports it on the details
     endpoint, so a row cached from a search or a popular page has it null until
     somebody opens the film — which is exactly when the number is needed. */
  if (!movieCols.includes('runtime')) {
    await exec('ALTER TABLE movies_cache ADD COLUMN runtime INTEGER');
  }

  /* ── o que o TMDB achou ─────────────────────────────────────────────────
     Their average and how many people are behind it, on the same 0–10 the club
     uses. Cached because the archive needs it: a take is read from this
     database with TMDB nowhere in the request, and "o clube deu 6,2 e o TMDB
     deu 8,1" has to survive that. Every list endpoint carries both fields, so
     a film has them from the first time anybody searched for it. */
  if (!movieCols.includes('tmdb_score')) {
    await exec('ALTER TABLE movies_cache ADD COLUMN tmdb_score REAL');
    await exec('ALTER TABLE movies_cache ADD COLUMN tmdb_votes INTEGER');
  }

  /* ── onde está passando ─────────────────────────────────────────────────
     The streaming services carrying the film, as JSON, with the moment it was
     asked. Cached for a different reason than everything else here: not because
     the answer is expensive — it is one small request — but because it is
     twenty of them for one page of the catalogue, every time anybody scrolls.

     The timestamp is the point. A catalogue moves: a film leaves Netflix and
     the row here becomes a confident lie, which is worse than an empty one. It
     is read only while it is fresh (see PROVIDERS_TTL in routes/catalog.js) and
     refetched after that, so being wrong has a ceiling measured in days. */
  if (!movieCols.includes('providers')) {
    await exec('ALTER TABLE movies_cache ADD COLUMN providers TEXT');
    await exec('ALTER TABLE movies_cache ADD COLUMN providers_at TEXT');
  }

  /* A take carries its own copy of the film, so the record still reads as a
     record with TMDB unreachable. Takes recorded before this column existed
     fall back to the cache when the archive is read. */
  if (!reviewCols.includes('movie_runtime')) {
    await exec('ALTER TABLE reviews ADD COLUMN movie_runtime INTEGER');
  }

  /* ── a hora, e não só o dia ────────────────────────────────────────────
     `date` é YYYY-MM-DD e sempre bastou: o arquivo é lido como ranking, e o dia
     em que alguém preencheu a ficha não diz nada sobre o filme.

     O mural é a primeira tela lida em ordem de tempo, e ali um dia inteiro
     empatado é uma pilha sem ordem — quatro pessoas avaliando no mesmo domingo
     apareceriam em ordem arbitrária, mudando a cada consulta.

     Escrito a cada gravação, inclusive numa regravação: mexer na própria nota é
     um acontecimento, e o mural mostrar isso é mais honesto do que esconder.

     As linhas antigas recebem o `date` que já tinham. Comparado como texto,
     '2026-08-20' vem antes de '2026-08-20 10:00:00', então elas caem no começo
     do próprio dia — que é o mais próximo da verdade que existe sem inventar
     uma hora que ninguém registrou. */
  if (!reviewCols.includes('recorded_at')) {
    await exec('ALTER TABLE reviews ADD COLUMN recorded_at TEXT');
    await prepare('UPDATE reviews SET recorded_at = date WHERE recorded_at IS NULL').run();
  }

  /* ── quem pôs o filme na fila ──────────────────────────────────────────
     A fila é do clube e nunca precisou saber de quem foi a ideia. O mural
     precisa: "alguém pôs Fréamhacha na fila" não é um acontecimento, é um
     boletim. Linhas anteriores a esta coluna ficam sem autor e simplesmente não
     viram evento — melhor faltar uma linha do que atribuir a escolha a
     ninguém. */
  if (!(await columnsOf('watchlist')).includes('added_by')) {
    await exec('ALTER TABLE watchlist ADD COLUMN added_by TEXT');
  }

  /* ── até onde esta pessoa já viu ──────────────────────────────────────
     A marca d'água das notificações, e a única coisa que este produto grava
     sobre elas.

     Não existe tabela de notificação, de propósito. Um comentário, um voto e
     uma curtida já são linhas com autor e hora; uma segunda tabela repetindo
     isso seria um segundo lugar onde a mesma verdade pode estar errada — e
     apagar um comentário teria de lembrar de apagar o aviso sobre ele. O feed é
     derivado das três tabelas que já existem, então ele nunca discorda delas e
     um evento desfeito desaparece sozinho.

     O que sobra para guardar é uma data por pessoa: tudo depois dela é novo.
     Isso custa não ter estado por item — não dá para marcar uma notificação
     como lida e as outras não — que é exatamente o que um contador de não-lidas
     precisa e nada mais. */
  /* ── responder um comentário ───────────────────────────────────────────
     Um nível, e só um. O Instagram e o Facebook chegaram no mesmo lugar por um
     motivo que vale aqui também: uma árvore de respostas dentro de uma gaveta
     dentro de uma carta é uma escada que ninguém consegue ler numa coluna de
     760px. Uma resposta a uma resposta pertence ao mesmo fio.

     A rota recusa pendurar uma resposta em outra resposta (ver routes/social),
     então a profundidade é uma propriedade garantida na escrita e não uma regra
     que a tela precisa lembrar de respeitar ao desenhar.

     CASCADE: apagar um comentário leva as respostas dele. Uma resposta órfã é
     metade de um diálogo, e ninguém consegue ler o que ela responde. */
  const commentCols = await columnsOf('review_comments');
  if (!commentCols.includes('parent_id')) {
    await exec(
      'ALTER TABLE review_comments ADD COLUMN parent_id TEXT REFERENCES review_comments(id) ON DELETE CASCADE'
    );
  }
  /* Depois da coluna existir, e nunca junto do CREATE TABLE: num banco antigo o
     bloco lá em cima roda antes desta migração, e um índice sobre uma coluna
     que ainda não chegou derruba o boot inteiro. */
  await exec('CREATE INDEX IF NOT EXISTS review_comments_parent ON review_comments(parent_id)');

  await addReviewerCol('notifications_seen_at', 'notifications_seen_at TEXT');

  /* ── e até onde esta pessoa já dispensou ──────────────────────────────
     A outra marca d'água. `seen_at` responde "o que é novo"; esta responde "o
     que eu ainda quero ver na lista".

     Limpar não apaga nada — não pode. Um aviso é a projeção de um comentário,
     de um voto ou de uma curtida que pertencem a outra pessoa, e o botão de
     limpar o seu sino não tem o direito de apagar o que alguém escreveu. O que
     ele move é esta data, e o feed passa a mostrar só o que veio depois dela.

     Por pessoa, então limpar o próprio sino não mexe no de ninguém. */
  await addReviewerCol('notifications_cleared_at', 'notifications_cleared_at TEXT');

  /* "Não é nenhuma dessas." A tela de reivindicar conta antiga é oferecida a
     quem tem contas órfãs no clube, e quem chegou agora e nunca teve conta aqui
     precisa poder dispensá-la PARA SEMPRE — não até o próximo F5, e não só neste
     navegador. Por isso é uma coluna e não `localStorage`. */
  await addReviewerCol('claim_dismissed_at', 'claim_dismissed_at TEXT');

  await addReviewerCol('avatar', 'avatar TEXT');
  await addReviewerCol('avatar_mime', 'avatar_mime TEXT');
  await addReviewerCol('avatar_rev', 'avatar_rev TEXT');

  /* ── a linha que a pessoa escreve sobre si ────────────────────────────────
     A única coisa neste banco que uma pessoa afirma sobre si mesma. Todo o
     resto que o perfil mostra é derivado do que ela fez — as onze médias, os
     extremos, com quem ela concorda —, e derivado é mais honesto: ninguém
     escreve "sou o cara da fotografia", isso se prova avaliando.

     Existe mesmo assim porque há uma coisa que o histórico não sabe dizer, e é
     o tom de voz. "Só vim pelo terror" é uma frase que nenhuma média produz.

     Nula é o estado normal, não um defeito: um perfil sem bio não mostra uma
     linha vazia, mostra o que a pessoa avaliou — que era para ser o assunto de
     qualquer jeito. */
  await addReviewerCol('bio', 'bio TEXT');

  // The queue is something the club arranges, not just a bag of films, so it
  // carries an explicit order. Existing rows are backfilled from added_at so the
  // list people already have keeps the order they already saw.
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

  /* ── os onze polegares viram um ──────────────────────────────────────────
     O voto deixou de ser por critério e passou a ser pela ficha inteira, e o
     que já estava gravado não pode simplesmente sumir: são as únicas
     concordâncias que o clube já registrou.

     Cada pessoa é dobrada por ficha pela soma dos votos dela ali. Quem
     concordou com cinco critérios e discordou de dois concordou com a ficha;
     quem fez o contrário, discordou. Empate cai fora, e essa é a única perda
     honesta desta migração: um polegar não sabe dizer "metade sim, metade não",
     e inventar um lado para quem estava dividido seria pior do que não ter o
     voto. A linha continua em criterion_votes de qualquer forma.

     Roda uma vez: com a tabela nova já tendo qualquer linha, não há o que
     dobrar. Um clube que nunca votou em critério nenhum também não paga nada
     por isto além de dois SELECTs no boot. */
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

  /* ══════════════════════════════════════════════════════════════════════════
     Os clubes.

     Até aqui este banco descrevia UM clube e nunca disse isso em lugar nenhum.
     A fila era `movie_id PRIMARY KEY` — uma fila no mundo. Uma nota era única
     por (pessoa, filme). E "o clube" era simplesmente todo mundo na tabela de
     avaliadores. Nada disso era falso enquanto existia uma sala; tudo isso fica
     falso no instante em que existem duas.

     ── o que ganha club_id e o que não ganha ────────────────────────────────
     Duas tabelas, e só: `reviews` e `watchlist`. Comentário, voto de ficha,
     voto de critério e curtida penduram numa ficha, e a ficha já sabe de que
     clube é — dar a eles uma coluna própria seria uma segunda resposta para a
     mesma pergunta, livre para divergir da primeira no primeiro UPDATE mal
     escrito. É esta escolha que faz o recorte caber em duas reconstruções em
     vez de seis.

     `movies_cache` fica de fora de propósito: é o TMDB em cache, e o pôster de
     Stalker é o mesmo pôster em todo clube. Por clube seria pagar a mesma
     requisição N vezes para gravar N cópias do mesmo byte.

     `reviewers` também fica: uma pessoa é uma pessoa, e é por ela ser uma só
     que isto vira uma rede em vez de N instalações do mesmo app. Em quais
     clubes ela está mora em `club_members`, junto com o papel dela em cada um —
     ser ADM é um fato sobre a relação, nunca sobre a pessoa.
     ══════════════════════════════════════════════════════════════════════════ */

  await exec(`
    CREATE TABLE IF NOT EXISTS clubs (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      slug TEXT NOT NULL,
      /* Uma linha sobre o clube, do tamanho da bio de uma pessoa e pelo mesmo
         motivo: é tom de voz na vitrine, não manifesto. */
      tagline TEXT,
      photo TEXT,
      photo_mime TEXT,
      photo_rev TEXT,
      /* 'public' ou 'private'. Público é lido por qualquer um e a entrada
         depende do ADM aprovar; privado não aparece para quem não é membro.
         Privado é o padrão porque o erro caro tem um lado só: um clube que
         nasce fechado e devia estar aberto é um menu; o contrário é o acervo
         de um grupo de amigos exposto sem ninguém ter pedido. */
      visibility TEXT NOT NULL DEFAULT 'private',
      /* ── a política de leitura de um clube fechado ────────────────────
         Fechado deixou de ser uma coisa só. O ADM decide, em dois interruptores,
         o que um estranho enxerga: as avaliações, os comentários, os dois ou
         nenhum. Com os dois ligados o clube fica fechado apenas na porta — ler é
         livre, entrar e avaliar não.

         Zero por padrão, e isso é deliberado: nenhum clube que já existe pode
         mudar de comportamento porque uma coluna nova apareceu. Abrir a leitura
         é sempre um gesto de alguém.

         Dormentes enquanto o clube é aberto — lá tudo é legível de qualquer
         jeito. Voltam a valer se ele fechar de novo, o que é a coisa certa: a
         política que o ADM escolheu não se perde por ele ter aberto um mês. */
      show_reviews INTEGER NOT NULL DEFAULT 0,
      show_comments INTEGER NOT NULL DEFAULT 0,
      /* ── e o que a sala empresta para o saguão ────────────────────────
         Um terceiro interruptor, e ele responde uma pergunta que os dois de
         cima não respondem. Aqueles decidem se um estranho consegue LER esta
         sala; este decide se o que ela avaliou entra nas contas da rede — o
         pódio de filmes, a parede de pôsteres, as salas em atividade.

         São coisas diferentes o bastante para não caberem num interruptor só.
         Uma média de rede não diz quem deu a nota nem em que sala; ela diz que
         alguém, em algum lugar, achou aquilo bom. Um clube pode querer emprestar
         isso e continuar com o acervo fechado, e o contrário também: mostrar as
         fichas para quem chega pelo link e não aparecer em ranking nenhum.

         Zero por padrão, como os outros dois e pelo mesmo motivo: nenhum clube
         que já existe muda de comportamento porque uma coluna nova apareceu.
         Emprestar é sempre um gesto de alguém.

         Dormente enquanto o clube é aberto — um clube aberto já está na rede. */
      show_charts INTEGER NOT NULL DEFAULT 0,
      /* SET NULL e não CASCADE: quem fundou o clube pode sair dele um dia, e o
         clube não vai junto. Quem manda é o papel em club_members. */
      created_by TEXT REFERENCES reviewers(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE UNIQUE INDEX IF NOT EXISTS clubs_name ON clubs(name COLLATE NOCASE);
    CREATE UNIQUE INDEX IF NOT EXISTS clubs_slug ON clubs(slug);

    CREATE TABLE IF NOT EXISTS club_members (
      club_id TEXT NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
      reviewer_id TEXT NOT NULL REFERENCES reviewers(id) ON DELETE CASCADE,
      /* 'admin' ou 'member'. Quem cria nasce admin. */
      role TEXT NOT NULL DEFAULT 'member',
      joined_at TEXT NOT NULL DEFAULT (datetime('now')),
      /* ── as duas marcas d'água do sino ────────────────────────────────
         Moravam na tabela de avaliadores, uma por pessoa, e ali estavam certas
         enquanto existia um clube. Agora um aviso é sobre uma ficha, e uma
         ficha é de uma sala: com a marca na pessoa, abrir o sino no clube de
         terror marcaria como visto o que aconteceu no Cineclube — avisos que a
         pessoa nem teve chance de ler, porque a tela em que eles aparecem era
         outra.

         Então elas descem para a relação, que é onde a pergunta "até onde esta
         pessoa leu ESTE clube" tem resposta. Ver notifications.js. */
      notifications_seen_at TEXT,
      notifications_cleared_at TEXT,
      PRIMARY KEY (club_id, reviewer_id)
    );
    CREATE INDEX IF NOT EXISTS club_members_reviewer ON club_members(reviewer_id);

    /* Um pedido de entrada, que só clube público aceita. Sem coluna de estado:
       aprovar move a linha para club_members e apaga esta, recusar apaga esta.
       Um estado gravado seria uma terceira verdade sobre a mesma pergunta — se
       a pessoa está dentro — e a resposta a essa pergunta é club_members. */
    CREATE TABLE IF NOT EXISTS club_join_requests (
      club_id TEXT NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
      reviewer_id TEXT NOT NULL REFERENCES reviewers(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (club_id, reviewer_id)
    );
    CREATE INDEX IF NOT EXISTS club_join_requests_club ON club_join_requests(club_id);
  `);

  /* ── um lugar para dizer o que já foi feito ────────────────────────────
     Quase toda migração deste arquivo se guarda sozinha: uma coluna que já
     existe não é adicionada duas vezes. Uma correção de VALOR não tem essa
     sorte — corrigir um dado e rodar de novo desfaz a escolha que a pessoa fez
     depois. Daí esta tabela: uma linha por correção, posta quando ela roda. */
  await exec('CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT)');

  const done = async key => !!(await prepare('SELECT 1 AS x FROM meta WHERE key = ?').get(key));
  const mark = key =>
    prepare("INSERT OR IGNORE INTO meta (key, value) VALUES (?, datetime('now'))").run(key);

  // Para um banco que já criou estas tabelas antes destas colunas existirem.
  const clubCols = await columnsOf('clubs');
  if (!clubCols.includes('tagline')) {
    await exec('ALTER TABLE clubs ADD COLUMN tagline TEXT');
  }
  if (!clubCols.includes('show_reviews')) {
    await exec('ALTER TABLE clubs ADD COLUMN show_reviews INTEGER NOT NULL DEFAULT 0');
    await exec('ALTER TABLE clubs ADD COLUMN show_comments INTEGER NOT NULL DEFAULT 0');
  }
  /* Separado dos dois de cima e não junto deles: um banco que já pegou aquela
     migração não passaria por este bloco, e a coluna nova nunca chegaria. */
  if (!clubCols.includes('show_charts')) {
    await exec('ALTER TABLE clubs ADD COLUMN show_charts INTEGER NOT NULL DEFAULT 0');
  }

  /* ── o clube fundador nasceu aberto, e não devia ───────────────────────
     A primeira versão dos clubes criou o Cineclube como `public`, e naquela
     versão `public` queria dizer "qualquer um lê o acervo". O clube de um grupo
     de amigos que já existia antes de haver rede não vira público porque o
     produto cresceu — e o acervo deles esteve legível para quem tivesse a URL
     entre um deploy e o outro.

     Isto conserta os bancos que pegaram aquela versão. Uma vez só, marcada na
     tabela acima: quem decidir abrir o clube depois não pode ter essa decisão
     desfeita no próximo reinício. */
  if (!(await done('home-club-private'))) {
    const r = await prepare(
      `UPDATE clubs SET visibility = 'private'
       WHERE name = ? COLLATE NOCASE AND visibility = 'public' AND created_by IS NULL`
    ).run(HOME_CLUB);
    await mark('home-club-private');
    if (r?.rowsAffected) console.log(`[db] ${HOME_CLUB} voltou a ser um clube fechado`);
  }
  const memberCols = await columnsOf('club_members');
  if (!memberCols.includes('notifications_seen_at')) {
    await exec('ALTER TABLE club_members ADD COLUMN notifications_seen_at TEXT');
    await exec('ALTER TABLE club_members ADD COLUMN notifications_cleared_at TEXT');
    /* As marcas que a pessoa já tinha viajam para o clube fundador, que é o
       único em que ela pode ter lido alguma coisa antes desta migração. Sem
       isto, todo aviso de sempre voltaria a aparecer como novo no primeiro boot
       depois dos clubes. */
    await exec(`
      UPDATE club_members SET
        notifications_seen_at = (SELECT notifications_seen_at FROM reviewers r WHERE r.id = club_members.reviewer_id),
        notifications_cleared_at = (SELECT notifications_cleared_at FROM reviewers r WHERE r.id = club_members.reviewer_id)
    `);
  }

  /* ── a conta ──────────────────────────────────────────────────────────────
     O PIN de quatro dígitos serviu enquanto entrar era escolher o próprio rosto
     numa lista de quatro pessoas. Numa rede essa lista é todo mundo, então a
     identidade passa a ser o e-mail, e a credencial é uma senha.

     `google_sub` é o identificador estável que o Google devolve. Guardado além
     do e-mail porque e-mail é o que a pessoa digita e `sub` é o que o Google
     garante: um endereço pode mudar de dono, o `sub` não muda nunca.

     Os dois índices são parciais porque as duas colunas nascem nulas em todas
     as contas que já existem — sem o WHERE, um índice único trataria vários
     nulos como colisão em alguns motores e nenhum em outros, e essa é uma
     diferença que não se quer descobrir em produção. */
  await addReviewerCol('email', 'email TEXT');
  await addReviewerCol('google_sub', 'google_sub TEXT');
  await addReviewerCol('password_hash', 'password_hash TEXT');
  await addReviewerCol('password_salt', 'password_salt TEXT');
  await exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS reviewers_email
      ON reviewers(email COLLATE NOCASE) WHERE email IS NOT NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS reviewers_google
      ON reviewers(google_sub) WHERE google_sub IS NOT NULL;
  `);

  /* ── e a reconstrução ─────────────────────────────────────────────────────
     A única parte destrutiva deste arquivo, e ela é obrigatória: `UNIQUE(pessoa,
     filme)` e `PRIMARY KEY(filme)` foram declaradas dentro do CREATE TABLE, e
     o SQLite não deixa remover nenhuma das duas — o índice que as sustenta é
     `sqlite_autoindex_*`, e DROP INDEX o recusa. Tabela nova, cópia, troca.

     O perigo real não é a cópia, é o DROP. Comentário, voto e curtida apontam
     para `reviews` com ON DELETE CASCADE, e um DROP com chave estrangeira
     ligada leva os três junto. Se esse enforcement está ligado depende do
     motor — local é um PRAGMA, no Turso é decisão do servidor — e isso não é
     uma coisa que se descobre em produção com os dados dentro.

     Então as quatro tabelas filhas são lidas para a memória ANTES e reescritas
     DEPOIS com INSERT OR IGNORE. Se o cascade levou, elas voltam; se não levou,
     o IGNORE não faz nada. Correto nos dois mundos sem precisar saber em qual
     se está. Cabe na memória porque cabe: é um clube de amigos, e a coisa toda
     são dezenas de linhas. */
  if (!reviewCols.includes('club_id')) {
    const home = await ensureHomeClub();

    /* Todo mundo que existe hoje é do clube fundador, e quem já era admin da
       instalação vira ADM dele. Roda uma vez só, junto da reconstrução, e por
       isso não existe o risco de alguém que saiu de todos os clubes ser
       readmitido sozinho no próximo boot. */
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

    // O que o cascade pode ter levado junto. Ver o comentário acima.
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

  // Expired sessions are dead weight and a liability; clear them at boot.
  await prepare("DELETE FROM sessions WHERE expires_at <= datetime('now')").run();
}

// Whatever needs the schema awaits this. The routes only call prepare() at
// load time, which touches nothing, so nothing runs ahead of it.
const ready = migrate();

module.exports = {
  prepare,
  exec,
  batch,
  ready,
  HOME_CLUB,
  slugify,
  freeSlug,
  ensureHomeClub,
  close: () => client.close(),
};
