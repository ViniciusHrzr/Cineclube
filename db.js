const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { createClient } = require('@libsql/client');

/* libSQL, um fork do SQLite: toda consulta continua sendo SQLite. O que mudou
   contra node:sqlite é a convenção de chamada — tudo aqui é async, porque em
   produção o banco fica do outro lado de uma rede. Sem TURSO_DATABASE_URL o
   cliente abre um arquivo local, que é como testes e desenvolvimento rodam. */

const remoteUrl = process.env.TURSO_DATABASE_URL;
// CINECLUBE_DB lets the tests point at a throwaway file instead of the real one.
const localPath = process.env.CINECLUBE_DB || path.join(__dirname, 'data', 'cineclube.db');
const isLocal = !remoteUrl;

if (isLocal) fs.mkdirSync(path.dirname(localPath), { recursive: true });

const client = createClient({
  url: remoteUrl || 'file:' + localPath,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

/* Um único argumento objeto quer dizer parâmetros nomeados (@id, @title); o
   resto é posicional. Nenhum valor guardado por este app é um objeto, então a
   distinção nunca é ambígua. */
function argsOf(args) {
  const [first] = args;
  if (args.length === 1 && first !== null && typeof first === 'object' && !Array.isArray(first)) {
    return first;
  }
  return args;
}

/* Mantém a forma do node:sqlite — prepare().get()/.all()/.run() —, que é a que
   as rotas já falam. A diferença é que agora todas devolvem promessa. */
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

/** As colunas da chave primária, na ordem dela. Uma migração pode perguntar. */
async function keyOf(table) {
  const { rows } = await client.execute(`PRAGMA table_info(${table})`);
  return rows.filter(c => Number(c.pk) > 0).sort((a, b) => Number(a.pk) - Number(b.pk)).map(c => c.name);
}

/* Nome e slug são únicos por motivos diferentes: o nome porque duas salas
   homônimas na lista de clubes são uma sala que ninguém sabe escolher, o slug
   porque é endereço. Um nome que reduz a nada (só emoji) ganha um slug sorteado. */
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

/* O clube principal: a PRAÇA da rede — aberto, e a sala em que toda conta nova
   nasce. É o que faz o app poder abrir direto numa sala: sem endereço, entra-se
   no primeiro clube da pessoa, e este é o primeiro de todo mundo.

   Idempotente: chamado pela migração e outra vez pelo boot. */
async function ensureHomeClub() {
  const found = await prepare('SELECT id FROM clubs WHERE name = ? COLLATE NOCASE').get(HOME_CLUB);
  if (found) return found.id;
  const id = 'c' + crypto.randomUUID();
  await prepare(
    `INSERT INTO clubs (id, name, slug, visibility) VALUES (?, ?, ?, 'public')`
  ).run(id, HOME_CLUB, slugify(HOME_CLUB));
  return id;
}

/* Chamado por quem cria conta, e por mais ninguém. `ON CONFLICT DO NOTHING`
   porque isto promete um estado, não um evento.

   Falhar aqui não pode derrubar a criação da conta: uma pessoa sem clube funda
   um pelo painel da marquise, uma pessoa sem conta não tem nada. */
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
  // WAL e foreign_keys só valem para arquivo local; no Turso o servidor já
  // cuida dos dois e o PRAGMA é recusado.
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

    /* A conversa em cima de uma avaliação. Pendurada na ficha e não no filme, de
       propósito: a ficha de cada pessoa é a coisa concreta que se discute, e a
       mesma escolha vale para os votos abaixo.

       ON DELETE CASCADE nas duas pontas: uma avaliação apagada leva a conversa
       sobre ela, e quem sai do clube leva o que escreveu. */
    CREATE TABLE IF NOT EXISTS review_comments (
      id TEXT PRIMARY KEY,
      review_id TEXT NOT NULL REFERENCES reviews(id) ON DELETE CASCADE,
      reviewer_id TEXT NOT NULL REFERENCES reviewers(id) ON DELETE CASCADE,
      body TEXT NOT NULL,
      /* Uma resposta, e a profundidade para em um. Ver a migração abaixo. */
      parent_id TEXT REFERENCES review_comments(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS review_comments_review ON review_comments(review_id);

    /* Sem coluna de valor, ao contrário do voto. Um like é uma pessoa dizendo
       "isso" para o que outra escreveu, e o contrário disso, num clube de
       amigos, não é a mesma informação com o sinal trocado — é outra coisa, mais
       pesada, que ninguém pediu. Então existe ou não existe: tirar apaga a
       linha. */
    CREATE TABLE IF NOT EXISTS comment_likes (
      comment_id TEXT NOT NULL REFERENCES review_comments(id) ON DELETE CASCADE,
      reviewer_id TEXT NOT NULL REFERENCES reviewers(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (comment_id, reviewer_id)
    );
    CREATE INDEX IF NOT EXISTS comment_likes_comment ON comment_likes(comment_id);

    /* Concordar com a ficha de alguém. O voto era por critério, e onze polegares
       por ficha por pessoa não é opinião, é formulário: uma noite de discussão
       gerava dezenas de votos sobre a mesma ficha. O que o clube fazia de
       verdade era concordar ou discordar do TAKE.

       Um voto por (ficha, quem votou). A coluna value é +1 ou -1 e nunca 0 —
       tirar apaga a linha, que é a diferença entre "não votei" e "votei neutro"
       — e trocar de ideia é UPDATE, nunca uma segunda linha.

       criterion_votes fica abaixo sem ninguém lendo: é o fóssil do desenho
       anterior, dobrado para cá na migração. Apagar destruiria o único registro
       de quem concordou com o quê, por um espaço que aqui não é problema. */
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

    /* ── a chave longa de um aplicativo ─────────────────────────────────
       O navegador guarda a sessão num cookie HttpOnly, que o JavaScript da
       página não lê — é o que faz um XSS não virar uma sessão roubada. Um
       aplicativo não tem esse cofre: o que ele guardar, ele consegue ler.

       Então a troca é outra: a sessão do app vale um DIA, e esta tabela guarda
       o que a renova por noventa. O que vaza de um aparelho perdido expira
       sozinho em vinte e quatro horas.

       A coluna family é o que transforma roubo em porta fechada. Cada renovação
       GASTA a chave e devolve outra da MESMA família; apresentar uma chave já
       gasta só é possível se duas pessoas têm a mesma — e aí a família inteira
       cai, inclusive a de quem roubou. Ver auth.js.

       Só o SHA-256, como as sessões e os links de e-mail: ler esta tabela não
       entrega nenhuma chave utilizável. */
    CREATE TABLE IF NOT EXISTS refresh_tokens (
      token_hash TEXT PRIMARY KEY,
      family TEXT NOT NULL,
      reviewer_id TEXT NOT NULL REFERENCES reviewers(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      /* Gasta, e não apagada: uma linha apagada não sabe dizer de que família
         era, e é justamente ela que precisa acusar o reuso. Sai no vencimento,
         com as outras. */
      used_at TEXT,
      expires_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS refresh_tokens_family ON refresh_tokens(family);
    CREATE INDEX IF NOT EXISTS refresh_tokens_reviewer ON refresh_tokens(reviewer_id);

    /* ── para onde mandar um aviso quando ninguém está com o app aberto ──
       Uma linha por APARELHO, não por pessoa: o mesmo clube é aberto no
       telefone e no computador, e quem instalou nos dois quer ser avisado nos
       dois. A chave é o endereço que o navegador entrega, que já é único por
       aparelho e por instalação.

       As duas chaves ao lado não são segredo nosso: são a metade pública do
       aparelho e um segredo que ELE sorteou para nós. Com as duas, e só com as
       duas, o conteúdo do aviso é cifrado de tal forma que o serviço que o
       entrega — Google, Mozilla, Apple — carrega sem conseguir ler. Ver push.js.

       Some com a pessoa, e some sozinha quando o navegador diz que aquele
       endereço morreu: uma inscrição de um aparelho que foi formatado responde
       410 para sempre. */
    CREATE TABLE IF NOT EXISTS push_subs (
      id TEXT PRIMARY KEY,
      reviewer_id TEXT NOT NULL REFERENCES reviewers(id) ON DELETE CASCADE,
      endpoint TEXT NOT NULL,
      p256dh TEXT NOT NULL,
      auth TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_ok_at TEXT
    );
    CREATE INDEX IF NOT EXISTS push_subs_reviewer ON push_subs(reviewer_id);

    /* O que já foi avisado, para o aviso não chegar duas vezes. A chave diz
       tudo: pessoa, episódio e dia. O trabalho da noite pode rodar de novo
       depois de uma falha no meio, e a segunda volta não acorda ninguém. */
    CREATE TABLE IF NOT EXISTS push_log (
      id TEXT PRIMARY KEY,
      at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  /* De que porta veio a sessão. Uma do navegador desliza sozinha para a frente
     a cada uso; uma de aplicativo não — ela é curta de propósito, e deslizar
     seria desfazer justamente isso. Ver `readSession`. */
  if (!(await columnsOf('sessions')).includes('kind')) {
    await exec("ALTER TABLE sessions ADD COLUMN kind TEXT NOT NULL DEFAULT 'web'");
  }

  // Migração leve: acrescenta colunas que não existiam em versões anteriores
  // deste esquema, sem apagar o que já está gravado.
  const reviewCols = await columnsOf('reviews');
  if (!reviewCols.includes('comment')) {
    await exec('ALTER TABLE reviews ADD COLUMN comment TEXT');
  }

  /* A credencial: só hash e salt são guardados. `pin_hash` e `pin_salt`
     continuam aqui, mortas, de propósito — tirar uma coluna no SQLite é
     reconstruir a tabela, e reconstruir `reviewers` custaria mexer nas sete
     chaves estrangeiras que apontam para ela. */
  const reviewerCols = await columnsOf('reviewers');
  const addReviewerCol = async (name, ddl) => {
    if (!reviewerCols.includes(name)) await exec(`ALTER TABLE reviewers ADD COLUMN ${ddl}`);
  };
  await addReviewerCol('pin_hash', 'pin_hash TEXT');
  await addReviewerCol('pin_salt', 'pin_salt TEXT');
  // Admin é coluna e não casamento de nome: renomear a conta entregaria o poder.
  await addReviewerCol('is_admin', 'is_admin INTEGER NOT NULL DEFAULT 0');
  /* A coluna se chamava `pin_attempts`; a regra não mudou com a senha, só o
     nome do que se erra. Renomear e não criar outra: duas colunas contando a
     mesma coisa é a que ninguém zera. */
  if (reviewerCols.includes('pin_attempts') && !reviewerCols.includes('auth_attempts')) {
    await exec('ALTER TABLE reviewers RENAME COLUMN pin_attempts TO auth_attempts');
  } else if (!reviewerCols.includes('auth_attempts')) {
    await exec('ALTER TABLE reviewers ADD COLUMN auth_attempts INTEGER NOT NULL DEFAULT 0');
  }
  await addReviewerCol('locked_until', 'locked_until TEXT');

  /* Um filme é avaliado sob UM gênero escolhido entre os vários que carrega,
     então o cache precisa lembrar dos vários. Lista separada por vírgula porque
     nada aqui consulta dentro dela — é lida inteira ou não é lida. */
  const movieCols = await columnsOf('movies_cache');
  if (!movieCols.includes('genres')) {
    await exec('ALTER TABLE movies_cache ADD COLUMN genres TEXT');
  }
  /* O `original_title` do TMDB, gravado só quando difere do português. Em cache
     porque a fila e o acervo leem o filme daqui com o TMDB fora da requisição, e
     porque é a string que alguém copia para ir achar uma cópia. */
  if (!movieCols.includes('original_title')) {
    await exec('ALTER TABLE movies_cache ADD COLUMN original_title TEXT');
  }

  /* O nome em inglês, quando não é nenhum dos dois acima: Parasita não é
     achável por "Parasite" sem esta coluna. Só chega pelo endpoint de UM filme,
     então é preenchido quando o filme vira algo que o clube guarda. O que veio
     antes, `npm run backfill:ingles` cura. */
  if (!movieCols.includes('english_title')) {
    await exec('ALTER TABLE movies_cache ADD COLUMN english_title TEXT');
  }

  /* Duração em minutos. O TMDB só reporta no endpoint de detalhe, então uma
     linha vinda de busca fica nula até alguém abrir o filme — que é exatamente
     quando o número é preciso. */
  if (!movieCols.includes('runtime')) {
    await exec('ALTER TABLE movies_cache ADD COLUMN runtime INTEGER');
  }

  /* A média do TMDB e quanta gente está por trás dela, no mesmo 0–10 do clube.
     Em cache porque o acervo é lido daqui com o TMDB fora da requisição, e "o
     clube deu 6,2 e o TMDB deu 8,1" precisa sobreviver a isso. */
  if (!movieCols.includes('tmdb_score')) {
    await exec('ALTER TABLE movies_cache ADD COLUMN tmdb_score REAL');
    await exec('ALTER TABLE movies_cache ADD COLUMN tmdb_votes INTEGER');
  }

  /* Onde o filme está passando, em JSON, com a hora da pergunta. Em cache não
     porque a resposta é cara, mas porque são vinte por página de catálogo.

     O carimbo de hora é o ponto: um filme sai da Netflix e a linha vira uma
     mentira confiante, pior que uma vazia. Só é lida enquanto fresca. */
  if (!movieCols.includes('providers')) {
    await exec('ALTER TABLE movies_cache ADD COLUMN providers TEXT');
    await exec('ALTER TABLE movies_cache ADD COLUMN providers_at TEXT');
  }

  /* A ficha carrega a própria cópia do filme, para o registro continuar legível
     com o TMDB fora do ar. Fichas antigas caem no cache quando o acervo é
     lido. */
  if (!reviewCols.includes('movie_runtime')) {
    await exec('ALTER TABLE reviews ADD COLUMN movie_runtime INTEGER');
  }

  /* A hora, e não só o dia: `date` é YYYY-MM-DD, e no mural um dia inteiro
     empatado é uma pilha sem ordem, mudando a cada consulta.

     Linhas antigas recebem o `date` que já tinham — comparado como texto,
     '2026-08-20' vem antes de '2026-08-20 10:00:00', então caem no começo do
     próprio dia sem inventar uma hora que ninguém registrou. */
  if (!reviewCols.includes('recorded_at')) {
    await exec('ALTER TABLE reviews ADD COLUMN recorded_at TEXT');
    await prepare('UPDATE reviews SET recorded_at = date WHERE recorded_at IS NULL').run();
  }

  /* A fila nunca precisou saber de quem foi a ideia; o mural precisa. Linhas
     antigas ficam sem autor e não viram evento — melhor faltar uma linha do que
     atribuir a escolha a ninguém. */
  if (!(await columnsOf('watchlist')).includes('added_by')) {
    await exec('ALTER TABLE watchlist ADD COLUMN added_by TEXT');
  }

  /* Um nível de resposta, e só um: uma resposta a uma resposta pertence ao mesmo
     fio. A rota recusa pendurar resposta em resposta, então a profundidade é
     garantida na escrita e não é uma regra que a tela precisa lembrar.

     CASCADE: apagar um comentário leva as respostas — uma resposta órfã é
     metade de um diálogo. */
  const commentCols = await columnsOf('review_comments');
  if (!commentCols.includes('parent_id')) {
    await exec(
      'ALTER TABLE review_comments ADD COLUMN parent_id TEXT REFERENCES review_comments(id) ON DELETE CASCADE'
    );
  }
  /* Depois da coluna existir, nunca junto do CREATE TABLE: num banco antigo o
     bloco lá em cima roda antes desta migração, e um índice sobre coluna que
     ainda não chegou derruba o boot inteiro. */
  await exec('CREATE INDEX IF NOT EXISTS review_comments_parent ON review_comments(parent_id)');

  /* Não existe tabela de notificação: comentário, voto e curtida já são linhas
     com autor e hora, e uma segunda tabela seria um segundo lugar onde a mesma
     verdade pode estar errada. O que sobra para guardar é uma data por pessoa —
     tudo depois dela é novo, sem estado por item. */
  await addReviewerCol('notifications_seen_at', 'notifications_seen_at TEXT');

  /* A outra marca d'água: `seen_at` responde "o que é novo", esta "o que eu
     ainda quero ver na lista". Limpar não apaga nada e não pode — um aviso é a
     projeção de algo que pertence a outra pessoa. */
  await addReviewerCol('notifications_cleared_at', 'notifications_cleared_at TEXT');

  /* Morta, como `pin_hash`: era a resposta gravada de "não sou nenhuma dessas"
     da ponte de reivindicar conta, que foi retirada. Fica porque tirar uma
     coluna no SQLite é reconstruir a tabela. */
  await addReviewerCol('claim_dismissed_at', 'claim_dismissed_at TEXT');

  /* A foto fica na linha, em base64, e não em disco: esta máquina joga fora o
     sistema de arquivos a cada deploy, e um object store seria um segundo
     serviço para estar fora do ar. `avatar_rev` muda a cada envio e viaja na
     URL, que é o que deixa a foto ser cacheada para sempre e ainda assim
     trocar. */
  await addReviewerCol('avatar', 'avatar TEXT');
  await addReviewerCol('avatar_mime', 'avatar_mime TEXT');
  await addReviewerCol('avatar_rev', 'avatar_rev TEXT');

  /* A única coisa neste banco que uma pessoa afirma sobre si mesma; todo o resto
     do perfil é derivado do que ela fez. Existe porque há uma coisa que o
     histórico não diz: o tom de voz. Nula é o estado normal, não defeito. */
  await addReviewerCol('bio', 'bio TEXT');

  // A fila é algo que o clube arruma, então carrega ordem explícita. Linhas
  // antigas são preenchidas por `added_at`, para a lista que as pessoas já têm
  // manter a ordem que já viram.
  // as pessoas já têm manter a ordem que já viram.
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

  /* Os onze polegares viram um: cada pessoa é dobrada por ficha pela soma dos
     votos dela ali. Empate cai fora, e é a única perda honesta — um polegar não
     sabe dizer "metade sim". A linha continua em `criterion_votes`.

     Roda uma vez: com a tabela nova já tendo linha, não há o que dobrar. */
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

  /* ── os clubes ──────────────────────────────────────────────────────────
     Só duas tabelas ganham `club_id`: `reviews` e `watchlist`. Comentário, voto
     e curtida penduram numa ficha, e a ficha já sabe de que clube é — uma coluna
     própria seria uma segunda resposta para a mesma pergunta, livre para
     divergir no primeiro UPDATE mal escrito.

     `movies_cache` fica de fora: o pôster de Stalker é o mesmo em todo clube.
     `reviewers` também — uma pessoa é uma pessoa, e é por ela ser uma só que
     isto vira uma rede em vez de N instalações. Ser ADM é fato sobre a relação
     (`club_members`), nunca sobre a pessoa. */

  await exec(`
    CREATE TABLE IF NOT EXISTS clubs (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      slug TEXT NOT NULL,
      /* Tom de voz na vitrine, não manifesto. */
      tagline TEXT,
      photo TEXT,
      photo_mime TEXT,
      photo_rev TEXT,
      /* 'public' ou 'private'. Privado é o padrão porque o erro caro tem um lado
         só: um clube que nasce fechado e devia estar aberto é um menu; o
         contrário é o acervo de um grupo de amigos exposto sem ninguém pedir. */
      visibility TEXT NOT NULL DEFAULT 'private',
      /* A política de leitura de um clube fechado, em dois interruptores: o que
         um estranho enxerga, as avaliações, os comentários, os dois ou nenhum.
         Com os dois ligados o clube fica fechado só na porta.

         Zero por padrão: nenhum clube que já existe muda de comportamento porque
         uma coluna nova apareceu. Dormentes enquanto o clube é aberto, e voltam
         a valer se ele fechar — a política escolhida não se perde. */
      show_reviews INTEGER NOT NULL DEFAULT 0,
      show_comments INTEGER NOT NULL DEFAULT 0,
      /* MORTA desde que o saguão foi apagado: era o que a sala emprestava às
         contas da rede, e não há mais rede que as leia. Fica na tabela porque
         apagar coluna em SQLite é recriar a tabela, e uma migração destrutiva
         para tirar um inteiro de zero não se paga. */
      show_charts INTEGER NOT NULL DEFAULT 0,
      /* SET NULL e não CASCADE: quem fundou pode sair um dia, e o clube não vai
         junto. Quem manda é o papel em club_members. */
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
      /* As duas marcas d'água do sino. Moravam na tabela de avaliadores, uma por
         pessoa, e estavam certas enquanto existia um clube: agora, abrir o sino
         no clube de terror marcaria como visto o que aconteceu no Cineclube.
         Descem para a relação, que é onde "até onde esta pessoa leu ESTE clube"
         tem resposta. Ver notifications.js. */
      notifications_seen_at TEXT,
      notifications_cleared_at TEXT,
      PRIMARY KEY (club_id, reviewer_id)
    );
    CREATE INDEX IF NOT EXISTS club_members_reviewer ON club_members(reviewer_id);

    /* Um pedido de entrada. Sem coluna de estado: aprovar move a linha para
       club_members e apaga esta, recusar apaga esta. Um estado gravado seria uma
       segunda verdade sobre "a pessoa está dentro", e essa é club_members. */
    CREATE TABLE IF NOT EXISTS club_join_requests (
      club_id TEXT NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
      reviewer_id TEXT NOT NULL REFERENCES reviewers(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (club_id, reviewer_id)
    );
    CREATE INDEX IF NOT EXISTS club_join_requests_club ON club_join_requests(club_id);
  `);

  /* Quase toda migração daqui se guarda sozinha: uma coluna que já existe não é
     adicionada duas vezes. Correção de VALOR não tem essa sorte — corrigir um
     dado e rodar de novo desfaz a escolha que a pessoa fez depois. */
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
  /* Separado dos dois de cima: um banco que já pegou aquela migração não
     passaria por este bloco, e a coluna nova nunca chegaria. */
  if (!clubCols.includes('show_charts')) {
    await exec('ALTER TABLE clubs ADD COLUMN show_charts INTEGER NOT NULL DEFAULT 0');
  }

  /* O Cineclube abre: é a praça da rede, a sala em que toda conta nova cai, e
     uma sala em que se cai não pode ter porteiro.

     Uma vez só, marcada na tabela acima: quem decidir fechar a sala depois não
     pode ter a decisão desfeita no próximo reinício. `created_by IS NULL` mexe
     no clube fundador e nunca num homônimo que alguém tenha criado. */
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
    /* As marcas que a pessoa já tinha viajam para o clube fundador, o único em
       que ela pode ter lido algo antes desta migração. Sem isto, todo aviso de
       sempre voltaria a aparecer como novo. */
    await exec(`
      UPDATE club_members SET
        notifications_seen_at = (SELECT notifications_seen_at FROM reviewers r WHERE r.id = club_members.reviewer_id),
        notifications_cleared_at = (SELECT notifications_cleared_at FROM reviewers r WHERE r.id = club_members.reviewer_id)
    `);
  }

  /* `google_sub` é o identificador estável que o Google devolve: e-mail é o que
     a pessoa digita, `sub` é o que o Google garante — um endereço pode mudar de
     dono, o `sub` não muda nunca.

     Os dois índices são parciais porque as colunas nascem nulas nas contas que
     já existem, e um índice único trata vários nulos como colisão em alguns
     motores e nenhum em outros. */
  await addReviewerCol('email', 'email TEXT');
  await addReviewerCol('google_sub', 'google_sub TEXT');
  await addReviewerCol('password_hash', 'password_hash TEXT');
  await addReviewerCol('password_salt', 'password_salt TEXT');

  /* Um e-mail era só o que alguém digitou, e isso bastava enquanto ele não
     servia para nada além de identificar a conta. Deixou de bastar com "esqueci
     minha senha": mandar o caminho de volta de uma conta para um endereço não
     provado é entregar a conta.

     Zero por padrão, menos para quem entrou pelo Google — `accountForGoogle`
     recusa ligar qualquer coisa a um e-mail não verificado. */
  await addReviewerCol('email_verified', 'email_verified INTEGER NOT NULL DEFAULT 0');
  if (!(await done('google-emails-verified'))) {
    const r = await prepare(
      'UPDATE reviewers SET email_verified = 1 WHERE google_sub IS NOT NULL AND email IS NOT NULL'
    ).run();
    await mark('google-emails-verified');
    if (r?.rowsAffected) console.log(`[db] ${r.rowsAffected} conta(s) do Google já vêm verificadas`);
  }

  /* Confirmar endereço e redefinir senha na mesma tabela porque são a mesma
     coisa com dois usos. Guarda só o SHA-256, como as sessões: um vazamento não
     devolve um link utilizável.

     `email` fica gravado junto porque o token vale para O ENDEREÇO ao qual foi
     mandado — trocar o e-mail entre pedir e clicar invalida o link antigo.

     Uso único por exclusão: uma coluna "já usado" seria uma segunda resposta
     para o que a existência da linha já responde. */
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

  /* A única parte destrutiva deste arquivo, e obrigatória: `UNIQUE(pessoa,
     filme)` e `PRIMARY KEY(filme)` foram declaradas dentro do CREATE TABLE, e o
     SQLite não deixa remover nenhuma — DROP INDEX recusa um
     `sqlite_autoindex_*`. Tabela nova, cópia, troca.

     O perigo não é a cópia, é o DROP: as três filhas apontam para `reviews` com
     ON DELETE CASCADE, e se o enforcement estiver ligado elas vão junto — o que
     depende do motor. Então são lidas para a memória ANTES e reescritas DEPOIS
     com INSERT OR IGNORE: correto nos dois mundos sem precisar saber em qual se
     está. */
  if (!reviewCols.includes('club_id')) {
    const home = await ensureHomeClub();

    /* Roda uma vez só, junto da reconstrução, então ninguém que saiu de todos
       os clubes é readmitido no próximo boot. */
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

  /* ── "quero ver" é de cada um ───────────────────────────────────────────
     A fila era do clube: uma linha por filme, com o nome de quem teve a ideia
     pendurado nela. Quem chegasse depois querendo o mesmo filme não tinha onde
     dizer isso — o `ON CONFLICT DO NOTHING` engolia o gesto, e a fila continuava
     sendo a escolha de quem chegou primeiro.

     Agora o dono entra na CHAVE: uma linha por pessoa por filme. Na tela a fila
     continua sendo uma fila de filmes, com um cartaz por obra — ver `toQueue` em
     routes/watchlist.js —, e o que ela ganhou é saber de quantas pessoas cada
     cartaz é.

     Vazio e não nulo para quem não tem dono registrado: dois nulos são distintos
     numa chave, então nulo ali deixaria a mesma linha entrar duas vezes. O vazio
     cai no balde de "sem registro" que a tela já desenha. */
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

  /* ══ o universo de séries ═══════════════════════════════════════════════
     Não existe coluna de universo na tabela clubs, e isso é a decisão inteira:
     o universo é uma LENTE sobre o clube, escolhida na marquise e carregada no
     endereço, não uma propriedade dele. O que se separa é o acervo — estas
     tabelas são o lado de séries do que reviews e watchlist são do de filmes, e
     nenhuma referencia a outra.

     Sem crase nenhuma daqui para baixo: isto é um template literal. */
  await exec(`
    CREATE TABLE IF NOT EXISTS shows_cache (
      tmdb_id INTEGER PRIMARY KEY,
      title TEXT NOT NULL,
      original_title TEXT,
      english_title TEXT,
      year INTEGER,
      genre TEXT NOT NULL,
      genres TEXT,
      poster TEXT,
      /* Se ainda vem episódio. Acompanhar uma série no ar é outra relação. */
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

    /* Um episódio, em cache pelo mesmo motivo que um filme: o acervo é lido com
       o TMDB fora da requisição, e "S02E05 — Ozymandias" tem de sobreviver a
       isso. A chave é (série, temporada, número), que é como um episódio é
       nomeado por gente. */
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

    /* A fila de séries do clube. Gêmea de watchlist e separada dela: o que se
       põe na fila aqui é uma SÉRIE, e uma série não tem nota — ela tem
       episódios que têm.

       O dono na chave, como na fila de filmes: acompanhar é de cada um. Ver a
       migração logo abaixo da criação. */
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

    /* ── a linha que é ao mesmo tempo "vi" e "achei" ────────────────────
       A tabela central do universo de séries, e a forma dela é a decisão de
       desenho principal: **a linha existir significa que a pessoa viu**.

       Não há tabela de "assistido" ao lado desta. Ter uma seria um segundo
       lugar onde a mesma verdade pode estar errada — a mesma razão pela qual
       este banco não tem tabela de notificação e o pedido de entrada não tem
       coluna de estado. Marcar visto insere a linha; desmarcar apaga.

       A UNIDADE DA NOTA É A TEMPORADA, e a do visto é o episódio. Uma linha de
       episódio (episode >= 1) carrega só a marca; a ficha com nota é a linha de
       episode = 0, que é a temporada — ver SEASON_ROW em show.js, onde está o
       porquê de ela morar aqui e não numa tabela própria.

       Uma linha de episódio tem as colunas de nota vazias, sempre: a rota
       recusa nota no episódio, e as que existiam foram apagadas — ver a
       migração nota-por-temporada adiante.

       A linha da temporada nasce com uma nota, e ela é de um dos dois tipos:
       · quick preenchido — a nota objetiva de 0 a 10, num gesto.
       · scores preenchido — a avaliação criteriosa, os nove critérios de ofício
         (BASE, em criteria.js), sem os dois de gênero.

       A criteriosa SUBSTITUI a rápida, e é por isso que as duas colunas
       convivem em vez de uma só: quick guarda o que foi dito à mão, final
       guarda o que vale. Gravar a criteriosa zera quick — senão a linha
       carregaria duas respostas para a mesma pergunta.

       A coluna final é nula na linha de um episódio, e nulo é diferente de
       zero: um episódio visto não entra em média nenhuma.

       O id próprio, com a unicidade num índice à parte, é o mesmo arranjo de
       reviews: é o id que um endereço aponta e o que sobrevive a uma
       regravação, porque o upsert casa pela chave natural e não toca nele. */
    CREATE TABLE IF NOT EXISTS episode_takes (
      id TEXT PRIMARY KEY,
      club_id TEXT NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
      reviewer_id TEXT NOT NULL REFERENCES reviewers(id) ON DELETE CASCADE,
      show_id INTEGER NOT NULL,
      show_title TEXT NOT NULL,
      show_poster TEXT,
      /* O gênero com que a ficha foi preenchida, gravado na linha como
         reviews.movie_genre já é. Ele não acrescenta pergunta nenhuma — decide
         só o vocabulário dos nove (vozes numa animação, estrutura num
         documentário) —, e sem ele uma ficha antiga seria relida com as chaves
         erradas e perderia critérios em silêncio. */
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

    /* ── e a conversa em cima dela ──────────────────────────────────────
       As três tabelas sociais do universo de filmes, de novo, penduradas na
       ficha de episódio em vez de na de filme. São cópias na FORMA e não no
       código: um comentário, um voto e uma curtida têm exatamente as mesmas
       regras nos dois lados — profundidade um, um voto por pessoa por ficha,
       curtida que existe ou não existe —, e as regras moram uma vez só, em
       routes/showsSocial.js, que é o irmão de routes/social.js.

       Separadas de review_comments e review_votes, e não uma coluna a mais
       nelas apontando para dois tipos de alvo: uma chave estrangeira que às
       vezes aponta para reviews e às vezes para episode_takes não é uma
       chave estrangeira, e o banco deixaria de garantir a única coisa que
       essas tabelas precisam garantir — que a conversa morre com a ficha.

       ON DELETE CASCADE nas duas pontas, como lá: desmarcar um episódio apaga
       a linha, e a linha é onde a conversa pendura. */
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

  /* ── acompanhar é de cada um ────────────────────────────────────────────
     A mesma mudança que a fila de filmes, pelas mesmas razões, e o porquê está
     escrito na migração dela lá acima. As duas filas são gêmeas: uma divergência
     aqui seria "quero ver" significando duas coisas conforme a aba. */
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
  /* ── a ficha é da pessoa, e o clube é uma etiqueta ──────────────────────
     A unicidade era `(club_id, reviewer_id, movie_id)`, e o acervo de uma sala
     era só o que tinha sido gravado ali dentro: quem entrasse num clube novo
     chegava com a estante vazia. Agora é uma ficha por pessoa por filme, no
     produto inteiro, e o `club_id` vira a etiqueta de ONDE foi avaliado.

     Um índice único NOVO em vez de reconstruir a tabela: a restrição antiga é
     mais frouxa, então continua declarada e nunca mais decide nada.
     Reconstruir `reviews` moveria conversa, voto e curtida em cascata, e ela já
     foi reconstruída uma vez neste arquivo.

     A limpeza antes é a condição para o índice existir, e é marcada na tabela
     `meta` porque APAGA — uma correção de valor não pode rodar duas vezes. */
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

  /* ── o que um reel precisa e uma grade não ────────────────────────────
     O trailer só existe no endpoint de UMA obra, e um reel são vinte delas por
     página: sem estas colunas, folhear o feed custaria vinte requisições ao
     TMDB por rolagem, toda vez. O carimbo é o de sempre — um trailer removido
     do YouTube tem de poder ser reperguntado.

     `backdrop` porque um pôster 2:3 atrás de um vídeo 16:9 é uma tarja de dois
     lados, e `overview` porque a sinopse embaixo do trailer é a única linha que
     decide se alguém fica. As duas viajam nas rotas de lista do TMDB, então
     custam zero requisições — só não estavam sendo lidas. */
  for (const table of ['movies_cache', 'shows_cache']) {
    const cols = await columnsOf(table);
    if (!cols.includes('backdrop')) await exec(`ALTER TABLE ${table} ADD COLUMN backdrop TEXT`);
    if (!cols.includes('overview')) await exec(`ALTER TABLE ${table} ADD COLUMN overview TEXT`);
    if (!cols.includes('trailer')) {
      await exec(`ALTER TABLE ${table} ADD COLUMN trailer TEXT`);
      await exec(`ALTER TABLE ${table} ADD COLUMN trailer_at TEXT`);
    }
  }

  /* ── o inventário de uma série ──────────────────────────────────────────
     Quantas temporadas, quantos episódios em cada uma, e qual é o próximo a
     estrear. É o que responde "o que eu vejo a seguir" sem abrir a série: a
     coluna `seasons` guarda só o NÚMERO de temporadas, e com ele não dá para
     saber que falta o T3E07 a alguém.

     Num JSON e não numa tabela de temporadas: nada aqui é consultado por
     temporada, é sempre a lista inteira de uma série de uma vez — e uma tabela
     nova seria uma terceira coisa para manter fresca. O carimbo é o de sempre,
     porque uma série no ar ganha episódio toda semana. Ver upnext.js. */
  {
    const cols = await columnsOf('shows_cache');
    if (!cols.includes('shape')) {
      await exec('ALTER TABLE shows_cache ADD COLUMN shape TEXT');
      await exec('ALTER TABLE shows_cache ADD COLUMN shape_at TEXT');
    }
  }

  /* ── a nota saiu do episódio ────────────────────────────────────────────
     A unidade da nota é a TEMPORADA. As fichas de episódio de antes não são
     lidas por tela nenhuma, e uma nota que existe no banco e não existe no
     produto é uma verdade guardada em dois lugares — a média de uma série
     sairia de um veredito que ninguém consegue mais abrir nem mudar.

     A linha fica: ela é o "eu vi", e isso continua sendo verdade. O que sai é
     a opinião pendurada nela.

     Marcada no `meta` porque APAGA: rodar de novo em cima de dados novos não
     faria mal — a rota do episódio recusa nota —, mas uma correção de valor
     não se repete por hábito. */
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

  // Sessão vencida é peso morto e risco; some no boot.
  await prepare("DELETE FROM sessions WHERE expires_at <= datetime('now')").run();
  // E a chave de renovação que já não renova nada.
  await prepare("DELETE FROM refresh_tokens WHERE expires_at <= datetime('now')").run();
  /* O registro de quem já foi avisado só serve para o dia dele. Um mês é folga
     para uma execução atrasada; passado isso é papel velho. */
  await prepare("DELETE FROM push_log WHERE at <= datetime('now', '-30 days')").run();
  // E pelo mesmo motivo, os links de e-mail que já não abrem nada.
  await prepare("DELETE FROM email_tokens WHERE expires_at <= datetime('now')").run();
}

// Quem precisa do esquema espera isto. As rotas só chamam prepare() na carga, o
// que não toca em nada, então nada roda na frente.
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
  joinHomeClub,
  close: () => client.close(),
};
