const crypto = require('node:crypto');
const db = require('./db');

/* ══════════════════════════════════════════════════════════════════════════
   Quem é você. A identidade é o e-mail, e ela chega por dois caminhos:

   1. **Google.** A porta normal. Não guardamos senha nenhuma nesse caminho, e
      quem cuida de segundo fator e de conta invadida é o Google.
   2. **E-mail e senha.** É o que garante que ninguém fique preso a ele: o dia
      em que a conta Google sumir, o clube continua acessível.

   Três regras seguram este arquivo:

   1. A senha nunca é gravada, logada ou devolvida. Só um hash scrypt e um salt.
   2. Erros seguidos contam, e a conta descansa por um tempo crescente.
   3. O cookie carrega um token aleatório; o banco guarda só o SHA-256 dele. Ler
      a tabela não deixa ninguém se passar por um membro.
   ══════════════════════════════════════════════════════════════════════════ */

const SESSION_COOKIE = 'cc_session';

/* Entrar pelo Google é uma volta inteira ao provedor e de volta, e cobrar isso
   todo dia de quem só quer ver o que o clube avaliou é o produto pedindo
   pedágio para ser aberto. Deslizante: cada uso empurra a validade, então quem
   entra toda semana nunca é deslogado. */
const SESSION_DAYS = 30;
/* Renovar só quando falta menos que isto. Uma renovação é uma escrita, e
   escrever a cada requisição seria um INSERT por clique numa aba que fica
   aberta a noite inteira. Assim é uma escrita a cada quinze dias por sessão. */
const RENEW_UNDER_DAYS = 15;

const MAX_ATTEMPTS = 5;
const LOCK_SECONDS = 60; // multiplicado por quanto a conta já passou do limite

/* Oito é o piso que vale a pena impor: acima disso a força bruta on-line já não
   é o caminho, e exigir símbolo, número e maiúscula produz `Senha123!` em toda
   conta do clube. O teto existe porque scrypt trabalha sobre o que recebe, e um
   megabyte de senha é um jeito de pedir ao servidor que pare de responder. */
const MIN_PASSWORD = 8;
const MAX_PASSWORD = 200;

function isValidPassword(pw) {
  return typeof pw === 'string' && pw.length >= MIN_PASSWORD && pw.length <= MAX_PASSWORD;
}

function hashPassword(pw, salt) {
  return crypto.scryptSync(pw, salt, 64).toString('hex');
}

function makeSalt() {
  return crypto.randomBytes(16).toString('hex');
}

async function setPassword(reviewerId, pw) {
  const salt = makeSalt();
  await db.prepare(
    `UPDATE reviewers
     SET password_hash = ?, password_salt = ?, auth_attempts = 0, locked_until = NULL
     WHERE id = ?`
  ).run(hashPassword(pw, salt), salt, reviewerId);
}

/** Comparação em tempo constante. Devolve 'ok' | 'bad' | 'unset' | 'locked'. */
async function checkPassword(reviewer, pw) {
  if (!reviewer.password_hash || !reviewer.password_salt) return 'unset';
  if (reviewer.locked_until) {
    const row = await db
      .prepare("SELECT datetime('now') < ? AS locked")
      .get(reviewer.locked_until);
    if (row.locked) return 'locked';
  }
  const expected = Buffer.from(reviewer.password_hash, 'hex');
  const actual = Buffer.from(hashPassword(pw, reviewer.password_salt), 'hex');
  const ok = expected.length === actual.length && crypto.timingSafeEqual(expected, actual);

  if (ok) {
    await db.prepare('UPDATE reviewers SET auth_attempts = 0, locked_until = NULL WHERE id = ?').run(reviewer.id);
    return 'ok';
  }

  const attempts = (reviewer.auth_attempts || 0) + 1;
  if (attempts >= MAX_ATTEMPTS) {
    const pause = LOCK_SECONDS * (attempts - MAX_ATTEMPTS + 1);
    await db.prepare(
      `UPDATE reviewers SET auth_attempts = ?, locked_until = datetime('now', '+' || ? || ' seconds') WHERE id = ?`
    ).run(attempts, pause, reviewer.id);
  } else {
    await db.prepare('UPDATE reviewers SET auth_attempts = ? WHERE id = ?').run(attempts, reviewer.id);
  }
  return 'bad';
}

async function lockedSecondsLeft(reviewer) {
  if (!reviewer?.locked_until) return 0;
  const row = await db
    .prepare("SELECT CAST((julianday(?) - julianday('now')) * 86400 AS INTEGER) AS s")
    .get(reviewer.locked_until);
  return Math.max(0, row.s || 0);
}

/* As mesmas cores que a marquise usa nos rostos. Aqui porque é este arquivo
   que cria uma pessoa vinda do Google, e ela precisa nascer com a sua. */
const DOTS = ['#b5abfc', '#cfd3e5', '#a7a1db', '#e0b1a4', '#9fd0c0', '#d9c07a'];

/* Nem todo mundo tem, ou quer usar, uma conta Google — e um produto cuja única
   porta é a de outra empresa decidiu de quem os seus usuários precisam ser
   clientes.

   O e-mail aqui NÃO é verificado, e a consequência está contida: uma conta
   assim serve para entrar e usar o produto, e não serve para HERDAR nada. Só um
   e-mail verificado pelo Google liga uma conta que já existia, e só ele senta na
   cadeira de administrador da instalação. */
async function register({ name, email, password }) {
  const mail = String(email || '').trim().toLowerCase();
  const quem = String(name || '').trim().slice(0, 60);

  if (!isValidEmail(mail)) return { error: 'E-mail inválido.' };
  if (!quem) return { error: 'Diga como você quer ser chamado.' };
  if (!isValidPassword(password)) {
    return { error: `A senha precisa ter entre ${MIN_PASSWORD} e ${MAX_PASSWORD} caracteres.` };
  }

  const taken = await db
    .prepare('SELECT id FROM reviewers WHERE email = ? COLLATE NOCASE').get(mail);
  if (taken) return { error: 'Já existe uma conta com este e-mail.' };

  const id = 'p' + crypto.randomUUID();
  const dot = DOTS[Math.floor(Math.random() * DOTS.length)];
  await db.prepare('INSERT INTO reviewers (id, name, dot, email) VALUES (?, ?, ?, ?)')
    .run(id, quem, dot, mail);
  await setPassword(id, password);
  /* Nasce dentro do clube principal. Ver joinHomeClub: sem sala nenhuma não há
     tela que o app possa abrir. */
  await db.joinHomeClub(id);
  return { reviewer: await db.prepare('SELECT * FROM reviewers WHERE id = ?').get(id) };
}

/* Deliberadamente frouxo. A validação séria de e-mail é mandar um e para lá:
   isto evita `João` e ` ` virando login, não uma pessoa determinada a escrever
   um endereço que não é dela. */
const EMAIL_RE = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;
const isValidEmail = mail => typeof mail === 'string' && mail.length <= 200 && EMAIL_RE.test(mail);

/* Procurada por `sub` ANTES de por e-mail, e a ordem é a regra de segurança
   inteira: `sub` é o identificador que o Google garante estável para sempre, e
   o e-mail um dia pode trocar de dono. Casar por e-mail primeiro seria aceitar
   que quem herdar um endereço herda a conta.

   O e-mail serve para uma coisa, uma vez só: `CINECLUBE_ADMIN_EMAIL` ligar a
   conta do dono na primeira entrada. Depois de ligada, a conta tem `google_sub`
   e a variável não faz mais diferença.

   `verified` vem do próprio Google: um e-mail não verificado é uma string que
   alguém escreveu. */
async function accountForGoogle({ sub, email, name, verified }) {
  const byGoogle = await db.prepare('SELECT * FROM reviewers WHERE google_sub = ?').get(sub);
  if (byGoogle) return { reviewer: byGoogle, created: false };

  const adminEmail = (process.env.CINECLUBE_ADMIN_EMAIL || '').trim().toLowerCase();
  const mail = (email || '').trim().toLowerCase();

  if (mail && verified) {
    /* Nos dois casos só serve quem AINDA NÃO tem `google_sub`: uma conta já
       ligada pertence a outro `sub`, e sobrescrever a ligação seria entregar a
       conta de alguém a quem chegou depois. */
    const byMail = await db
      .prepare('SELECT * FROM reviewers WHERE email = ? COLLATE NOCASE AND google_sub IS NULL')
      .get(mail);
    const heir =
      byMail ||
      (adminEmail && mail === adminEmail
        ? await db.prepare('SELECT * FROM reviewers WHERE is_admin = 1 AND google_sub IS NULL ORDER BY created_at LIMIT 1').get()
        : null);
    if (heir) {
      /* Chegar aqui exige `verified` do próprio Google, que é a prova que este
         produto não tem como produzir sozinho. */
      await db.prepare(
        `UPDATE reviewers SET google_sub = ?, email = COALESCE(email, ?), email_verified = 1
         WHERE id = ?`
      ).run(sub, mail, heir.id);
      const linked = await db.prepare('SELECT * FROM reviewers WHERE id = ?').get(heir.id);
      return { reviewer: linked, created: false };
    }
  }

  /* Um endereço não verificado não é gravado, e nulo é melhor que ele de duas
     formas: gravado, ele viraria a identidade de login por senha de uma conta
     que ninguém provou ser sua; e se já for de outra pessoa, a escrita bate no
     índice único e a entrada inteira morre num 500 do lado de fora.

     A conta existe e é identificada pelo `sub`. A rota de senha já sabe recusar
     cadastrar senha numa conta sem e-mail, com uma frase que diz o porquê. */
  const trusted = mail && verified ? mail : null;
  const free = trusted
    ? !(await db.prepare('SELECT 1 AS x FROM reviewers WHERE email = ? COLLATE NOCASE').get(trusted))
    : false;

  /* O nome vem do Google só como ponto de partida — a pessoa troca no próprio
     perfil como sempre pôde. */
  const id = 'p' + crypto.randomUUID();
  const dot = DOTS[Math.floor(Math.random() * DOTS.length)];
  /* `email_verified` acompanha o endereço e nunca o precede: uma conta que
     nasce sem e-mail nasce não verificada, porque não há endereço a verificar. */
  const verificado = free && trusted ? 1 : 0;
  await db.prepare(
    'INSERT INTO reviewers (id, name, dot, email, google_sub, email_verified) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(id, (name || mail || 'Alguém').slice(0, 60), dot, free ? trusted : null, sub, verificado);
  /* A mesma sala de quem entra por e-mail e senha: a porta muda, o lugar onde
     se chega não. */
  await db.joinHomeClub(id);
  const created = await db.prepare('SELECT * FROM reviewers WHERE id = ?').get(id);
  return { reviewer: created, created: true };
}

/* ══════════════════════════════════════════════════════════════════════════
   FUNDIR DUAS CONTAS DA MESMA PESSOA — uma situação que um produto com duas
   portas de entrada produz sozinho, para sempre.

   Sem rota: quem chama é `scripts/merge-accounts.js`, rodado à mão com os dois
   ids na frente. Uma fusão é irreversível e escolhe qual das duas pessoas
   sobrevive, o que não é decisão para um botão num telefone.

   A conta ANTIGA sobrevive e a nova é dissolvida nela: mover as credenciais é
   mexer em quatro colunas de uma linha, e mover o histórico seria reescrever a
   chave estrangeira em sete tabelas com restrições de unicidade em cada uma.

   Tudo num lote, que no libSQL é uma transação: se qualquer passo falhar, a
   conta nova não pode ficar sem as credenciais que já foram tiradas dela —
   isso trancaria a pessoa para fora das duas.
   ══════════════════════════════════════════════════════════════════════════ */
async function claimAccount(newId, oldId) {
  const nova = await db.prepare('SELECT * FROM reviewers WHERE id = ?').get(newId);
  if (!nova) return { error: 'Sessão inválida.' };

  const passos = [
    /* Primeiro liberar os índices únicos de e-mail e de google_sub: as duas
       linhas não podem carregar o mesmo valor nem por um instante. */
    { sql: 'UPDATE reviewers SET email = NULL, google_sub = NULL WHERE id = ?', args: [newId] },
    {
      /* `email_verified` acompanha o e-mail e tem de acompanhar: sem isso a
         conta antiga herda um endereço provado pelo Google e continua marcada
         como não confirmada, então a pessoa vê o aviso de confirmar e não
         consegue fundar clube por um endereço que ela já provou. */
      sql: `UPDATE reviewers
            SET email = ?, google_sub = ?, password_hash = ?, password_salt = ?,
                email_verified = ?, auth_attempts = 0, locked_until = NULL
            WHERE id = ?`,
      args: [
        nova.email ?? null,
        nova.google_sub ?? null,
        nova.password_hash ?? null,
        nova.password_salt ?? null,
        nova.email_verified ? 1 : 0,
        oldId,
      ],
    },
  ];

  /* O que a conta nova possa ter acumulado antes da fusão. `OR IGNORE` porque a
     antiga pode já ter a mesma linha — a mesma pessoa no mesmo clube, a mesma
     ficha do mesmo filme —, e nesse caso vale o que ela já tinha. */
  for (const [tabela, coluna] of [
    ['club_members', 'reviewer_id'],
    ['reviews', 'reviewer_id'],
    ['review_comments', 'reviewer_id'],
    ['review_votes', 'reviewer_id'],
    ['criterion_votes', 'reviewer_id'],
    ['comment_likes', 'reviewer_id'],
  ]) {
    passos.push({
      sql: `UPDATE OR IGNORE ${tabela} SET ${coluna} = ? WHERE ${coluna} = ?`,
      args: [oldId, newId],
    });
  }
  /* A fila é de cada um desde que o dono entrou na chave dela, então as duas
     contas podem querer o mesmo filme: o `OR IGNORE` guarda o que a antiga já
     tinha, e a linha da nova que ficou para trás sai na mão — não há cascade
     atrás de `added_by`. */
  passos.push({ sql: 'UPDATE OR IGNORE watchlist SET added_by = ? WHERE added_by = ?', args: [oldId, newId] });
  passos.push({ sql: 'DELETE FROM watchlist WHERE added_by = ?', args: [newId] });
  // Esta não tem restrição nenhuma, então nunca colide.
  passos.push({ sql: 'UPDATE clubs SET created_by = ? WHERE created_by = ?', args: [oldId, newId] });

  // E a linha nova sai, levando em cascata o que o OR IGNORE deixou para trás.
  passos.push({ sql: 'DELETE FROM reviewers WHERE id = ?', args: [newId] });

  await db.batch(passos);
  return { reviewer: await db.prepare('SELECT * FROM reviewers WHERE id = ?').get(oldId) };
}

/* ── sessions ─────────────────────────────────────────────────────────── */

const sha = t => crypto.createHash('sha256').update(t).digest('hex');

async function createSession(reviewerId) {
  const token = crypto.randomBytes(32).toString('base64url');
  await db.prepare(
    `INSERT INTO sessions (token_hash, reviewer_id, expires_at)
     VALUES (?, ?, datetime('now', '+${SESSION_DAYS} days'))`
  ).run(sha(token), reviewerId);
  return token;
}

/* Devolve a sessão e diz se ela foi empurrada para frente, porque quem chamou
   precisa saber: renovar no banco sem reenviar o cookie deixaria o navegador
   esquecendo a sessão antes de o servidor esquecer. */
async function readSession(token) {
  if (!token) return null;
  const row = await db
    .prepare(
      `SELECT s.reviewer_id, s.expires_at, r.name, r.dot, r.is_admin, r.avatar_rev, r.email, r.bio,
              r.email_verified,
              (r.password_hash IS NOT NULL) AS has_password
       FROM sessions s JOIN reviewers r ON r.id = s.reviewer_id
       WHERE s.token_hash = ? AND s.expires_at > datetime('now')`
    )
    .get(sha(token));
  if (!row) return null;

  const near = await db
    .prepare(`SELECT julianday(?) - julianday('now') < ? AS soon`)
    .get(row.expires_at, RENEW_UNDER_DAYS);
  if (near?.soon) {
    await db.prepare(
      `UPDATE sessions SET expires_at = datetime('now', '+${SESSION_DAYS} days') WHERE token_hash = ?`
    ).run(sha(token));
    row.renewed = true;
  }
  return row;
}

/* ══════════════════════════════════════════════════════════════════════════
   OS LINKS QUE CHEGAM POR E-MAIL: um segredo de vida curta que só chega a quem
   lê aquela caixa, e cuja apresentação é a prova de que o endereço é dela.

   1. **256 bits de acaso**, não um código de seis dígitos: um código curto pede
      trava por tentativa e relógio; um token deste tamanho não é adivinhado.
   2. **O banco guarda só o SHA-256.** Um vazamento de banco não devolve um
      único link utilizável. Sem salt, e é correto: salt existe para atrasar
      quem adivinha senha humana, e aqui não há nada humano a adivinhar.
   3. **Uso único, por exclusão.** Uma coluna "já usado" seria uma segunda
      resposta, livre para discordar da primeira.

   As validades diferem pelo que cada link pode fazer: confirmar um endereço não
   dá acesso a nada; redefinir uma senha É o acesso.
   ══════════════════════════════════════════════════════════════════════════ */

const TOKEN_HOURS = { verify: 24, reset: 1 };

/** Cria um link novo e apaga os anteriores do mesmo tipo para a mesma pessoa. */
async function createEmailToken(reviewerId, kind, email) {
  const token = crypto.randomBytes(32).toString('base64url');
  /* Pedir um link novo invalida o anterior: quem pede duas vezes é quase sempre
     alguém que não recebeu o primeiro, não alguém que queira dois. */
  await db.prepare('DELETE FROM email_tokens WHERE reviewer_id = ? AND kind = ?')
    .run(reviewerId, kind);
  await db.prepare(
    `INSERT INTO email_tokens (token_hash, reviewer_id, kind, email, expires_at)
     VALUES (?, ?, ?, ?, datetime('now', '+' || ? || ' hours'))`
  ).run(sha(token), reviewerId, kind, email, TOKEN_HOURS[kind]);
  return token;
}

/* Lê e CONSOME. Um null só quer dizer uma coisa para quem chama: o link não
   vale. Distinguir "não existe" de "expirou" contaria a quem apresenta um token
   errado alguma coisa sobre os certos.

   `email` é comparado com o da conta AGORA: se a pessoa trocou o endereço entre
   pedir e clicar, o link antigo confirmaria um endereço que ninguém pediu. */
async function useEmailToken(token, kind) {
  if (!token || typeof token !== 'string') return null;
  const hash = sha(token);
  const row = await db.prepare(
    `SELECT t.reviewer_id, t.email, r.name, r.email AS conta_email
     FROM email_tokens t JOIN reviewers r ON r.id = t.reviewer_id
     WHERE t.token_hash = ? AND t.kind = ? AND t.expires_at > datetime('now')`
  ).get(hash, kind);

  /* Apagado mesmo quando não serve: um token apresentado é um token gasto, e
     deixá-lo vivo depois de uma tentativa daria infinitas tentativas a quem
     esteja variando alguma outra coisa. */
  await db.prepare('DELETE FROM email_tokens WHERE token_hash = ?').run(hash);

  if (!row) return null;
  if (!row.conta_email || row.conta_email.toLowerCase() !== String(row.email).toLowerCase()) {
    return null;
  }
  return { id: row.reviewer_id, name: row.name, email: row.conta_email };
}

/** Marca o endereço como provado. Idempotente: confirmar duas vezes não muda nada. */
async function markVerified(reviewerId) {
  await db.prepare('UPDATE reviewers SET email_verified = 1 WHERE id = ?').run(reviewerId);
}

/** A conta de um endereço, para o pedido de redefinição. Null é silêncio. */
async function accountByEmail(email) {
  const mail = String(email || '').trim().toLowerCase();
  if (!mail) return null;
  return (
    (await db.prepare('SELECT * FROM reviewers WHERE email = ? COLLATE NOCASE').get(mail)) || null
  );
}

async function destroySession(token) {
  if (token) await db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha(token));
}

async function destroyAllSessions(reviewerId) {
  await db.prepare('DELETE FROM sessions WHERE reviewer_id = ?').run(reviewerId);
}

/* ── cookie plumbing ──────────────────────────────────────────────────────
   Express 4 ships no cookie parser and this needs exactly one cookie. */

function readCookie(req, name) {
  const raw = req.headers.cookie;
  if (!raw) return null;
  for (const part of raw.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() === name) return decodeURIComponent(part.slice(eq + 1).trim());
  }
  return null;
}

function sendSessionCookie(res, token) {
  // `secure` only behind TLS: in development this runs over plain http, and a
  // Secure cookie there would simply never be sent back.
  const secure = process.env.CINECLUBE_HTTPS === '1' ? '; Secure' : '';
  res.setHeader(
    'Set-Cookie',
    `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_DAYS * 86400}${secure}`
  );
}

function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`);
}

/* ── middleware ───────────────────────────────────────────────────────── */

/** Attaches req.session when a valid cookie is present. Never rejects. */
async function attachSession(req, res, next) {
  try {
    req.sessionToken = readCookie(req, SESSION_COOKIE);
    req.session = await readSession(req.sessionToken);
    // A sessão deslizou no banco; o cookie tem de deslizar junto.
    if (req.session?.renewed) sendSessionCookie(res, req.sessionToken);
    next();
  } catch (e) {
    // A database failure here is a server error, not a signed-out visitor.
    next(e);
  }
}

const SIGN_IN = 'Entre para continuar.';

function requireSession(req, res, next) {
  if (!req.session) return res.status(401).json({ error: SIGN_IN });
  next();
}

/* O administrador da INSTALAÇÃO cuida de contas. Quem manda dentro de uma sala
   é o `role` em club_members, cobrado pelo middleware de clube. */
function requireAdmin(req, res, next) {
  if (!req.session) return res.status(401).json({ error: SIGN_IN });
  if (!req.session.is_admin) return res.status(403).json({ error: 'Só o administrador pode fazer isso.' });
  next();
}

module.exports = {
  SESSION_COOKIE,
  SESSION_DAYS,
  MAX_ATTEMPTS,
  MIN_PASSWORD,
  MAX_PASSWORD,
  isValidPassword,
  isValidEmail,
  setPassword,
  checkPassword,
  lockedSecondsLeft,
  register,
  accountForGoogle,
  claimAccount,
  createEmailToken,
  useEmailToken,
  markVerified,
  accountByEmail,
  TOKEN_HOURS,
  createSession,
  readSession,
  destroySession,
  destroyAllSessions,
  sendSessionCookie,
  clearSessionCookie,
  attachSession,
  requireSession,
  requireAdmin,
};
