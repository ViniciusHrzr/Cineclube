const crypto = require('node:crypto');
const db = require('./db');

/* ══════════════════════════════════════════════════════════════════════════
   Quem é você.

   Isto era um PIN de quatro dígitos, e o PIN estava certo enquanto entrar
   significava escolher o próprio rosto numa lista de quatro pessoas: a
   identidade já estava na tela, e o que faltava era só provar que era você. Num
   produto com muitos clubes essa lista é todo mundo que existe, e um mural com
   todos os usuários da plataforma não é uma tela de entrada — é um vazamento
   com um formulário em cima.

   Então a identidade passa a ser o e-mail, e ela chega por dois caminhos:

   1. **Google.** A porta normal. Não guardamos senha nenhuma nesse caminho, e
      quem cuida de segundo fator, de conta invadida e de recuperação é o Google.
   2. **E-mail e senha.** Cadastrada na primeira entrada pelo Google, e é o que
      garante que ninguém fique preso a ele: o dia em que a conta Google sumir,
      o clube continua acessível.

   Três regras seguram este arquivo, e são as mesmas de antes:

   1. A senha nunca é gravada, logada ou devolvida. Só um hash scrypt e um salt
      por conta vão para o banco.
   2. Erros seguidos contam, e a conta descansa por um tempo crescente.
   3. O cookie carrega um token aleatório; o banco guarda só o SHA-256 dele. Ler
      a tabela não deixa ninguém se passar por um membro.
   ══════════════════════════════════════════════════════════════════════════ */

const SESSION_COOKIE = 'cc_session';

/* ── trinta dias, e não um ────────────────────────────────────────────────
   Vinte e quatro horas fazia sentido para um PIN de quatro dígitos digitado em
   dois segundos: o custo de reentrar era nada. Entrar pelo Google é uma volta
   inteira ao provedor e de volta, e cobrar isso todo dia de quem só quer ver o
   que o clube avaliou é o produto pedindo pedágio para ser aberto.

   Deslizante: cada uso empurra a validade para frente, então quem entra toda
   semana nunca é deslogado, e quem sumiu por um mês entra de novo. */
const SESSION_DAYS = 30;
/* Renovar só quando falta menos que isto. Uma renovação é uma escrita, e
   escrever a cada requisição seria um INSERT por clique numa aba que fica
   aberta a noite inteira. Assim é uma escrita a cada quinze dias por sessão. */
const RENEW_UNDER_DAYS = 15;

const MAX_ATTEMPTS = 5;
const LOCK_SECONDS = 60; // multiplicado por quanto a conta já passou do limite

/* Oito é o piso que vale a pena impor. Acima disso a força bruta on-line já não
   é o caminho — a trava por tentativas cuida dela —, e exigir símbolo, número e
   maiúscula produz `Senha123!` em toda conta do clube. O teto existe porque
   scrypt trabalha sobre o que recebe, e um megabyte de senha é um jeito de
   pedir ao servidor que pare de responder. */
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

/* ── uma conta criada à mão ───────────────────────────────────────────────
   Nem todo mundo tem, ou quer usar, uma conta Google. Isso não é um caso de
   borda — é metade das pessoas —, e um produto cuja única porta é a de outra
   empresa é um produto que decidiu de quem os seus usuários precisam ser
   clientes.

   O e-mail aqui NÃO é verificado, e é honesto dizer isso em vez de fingir: não
   há serviço de e-mail neste app, então não há como mandar um link de
   confirmação. A consequência é concreta e está contida: uma conta assim serve
   para entrar e para usar o produto, e não serve para HERDAR nada. Só um e-mail
   verificado pelo Google liga uma conta que já existia, e só ele senta na
   cadeira de administrador da instalação — ver `accountForGoogle` e server.js.

   O dia em que existir envio de e-mail, o que muda é uma coluna `email_verified`
   e um link; nada do que está escrito acima deixa de valer. */
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
  return { reviewer: await db.prepare('SELECT * FROM reviewers WHERE id = ?').get(id) };
}

/* Deliberadamente frouxo. A validação séria de e-mail é mandar um e para lá, e
   isto não manda; o que esta regra evita é `João` e ` ` virando login, não uma
   pessoa determinada a escrever um endereço que não é dela. */
const EMAIL_RE = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;
const isValidEmail = mail => typeof mail === 'string' && mail.length <= 200 && EMAIL_RE.test(mail);

/* ── a conta que o Google aponta ──────────────────────────────────────────
   Procurada por `sub` antes de por e-mail, e a ordem é a regra de segurança
   inteira: `sub` é o identificador que o Google garante estável para sempre,
   e o e-mail é o que a pessoa digita e o que um dia pode trocar de dono. Casar
   por e-mail primeiro seria aceitar que quem herdar um endereço herda a conta.

   O e-mail ainda serve para uma coisa, uma vez só: ligar a conta que já existia
   antes de os clubes existirem. É o que CINECLUBE_ADMIN_EMAIL faz — sem isso, a
   primeira entrada pelo Google criaria uma pessoa nova e as fichas antigas
   ficariam num avaliador que ninguém consegue mais acessar. Depois de ligada, a
   conta tem `google_sub` e esta variável não faz mais diferença nenhuma.

   `verified` vem do próprio Google: um e-mail não verificado é uma string que
   alguém escreveu, e ligar uma conta existente por ela seria a porta dos fundos
   que este bloco existe para não abrir. */
async function accountForGoogle({ sub, email, name, verified }) {
  const byGoogle = await db.prepare('SELECT * FROM reviewers WHERE google_sub = ?').get(sub);
  if (byGoogle) return { reviewer: byGoogle, created: false };

  const adminEmail = (process.env.CINECLUBE_ADMIN_EMAIL || '').trim().toLowerCase();
  const mail = (email || '').trim().toLowerCase();

  if (mail && verified) {
    /* A conta que já existe com este e-mail, ou a conta de admin herdada. Nos
       dois casos só serve quem AINDA NÃO tem `google_sub`: uma conta já ligada
       pertence a outro `sub`, e sobrescrever a ligação seria entregar a conta de
       alguém a quem chegou depois. */
    const byMail = await db
      .prepare('SELECT * FROM reviewers WHERE email = ? COLLATE NOCASE AND google_sub IS NULL')
      .get(mail);
    const heir =
      byMail ||
      (adminEmail && mail === adminEmail
        ? await db.prepare('SELECT * FROM reviewers WHERE is_admin = 1 AND google_sub IS NULL ORDER BY created_at LIMIT 1').get()
        : null);
    if (heir) {
      /* E o endereço passa a estar provado: chegar aqui exige `verified` do
         próprio Google (ver a guarda algumas linhas acima), que é a prova que
         este produto não tem como produzir sozinho. */
      await db.prepare(
        `UPDATE reviewers SET google_sub = ?, email = COALESCE(email, ?), email_verified = 1
         WHERE id = ?`
      ).run(sub, mail, heir.id);
      const linked = await db.prepare('SELECT * FROM reviewers WHERE id = ?').get(heir.id);
      return { reviewer: linked, created: false };
    }
  }

  /* ── e o e-mail só é gravado se for confiável ───────────────────────────
     Um endereço não verificado é uma string que alguém escreveu, e gravá-lo
     seria pior do que inútil de duas formas: ele viraria a identidade de login
     por senha de uma conta que ninguém provou ser sua, e — se aquele endereço já
     for de outra pessoa — a escrita bate no índice único e a entrada inteira
     morre num 500, do lado de fora, sem nada que o visitante possa fazer.

     Nulo, então. A conta existe e é identificada pelo `sub`, que é o que o
     Google garante; a rota de senha já sabe recusar cadastrar senha numa conta
     sem e-mail, com uma frase que diz o porquê. Mesmo tratamento para o caso de
     corrida em que o endereço verificado foi tomado entre a consulta acima e
     esta escrita: melhor uma conta sem e-mail do que uma entrada quebrada. */
  const trusted = mail && verified ? mail : null;
  const free = trusted
    ? !(await db.prepare('SELECT 1 AS x FROM reviewers WHERE email = ? COLLATE NOCASE').get(trusted))
    : false;

  /* Uma pessoa nova. A cor é sorteada da mesma paleta que o resto do produto
     usa para distinguir gente numa lista, e o nome vem do Google só como ponto
     de partida — a pessoa troca no próprio perfil como sempre pôde. */
  const id = 'p' + crypto.randomUUID();
  const dot = DOTS[Math.floor(Math.random() * DOTS.length)];
  /* `email_verified` acompanha o endereço e nunca o precede: ele só vale 1
     quando o endereço gravado é o `trusted` acima — o que o Google marcou como
     verificado. Uma conta que nasce sem e-mail nasce não verificada, porque não
     há endereço nenhum a verificar, e o dia em que ela ganhar um pela tela de
     conta é o dia em que ele terá de ser provado como o de qualquer outra. */
  const verificado = free && trusted ? 1 : 0;
  await db.prepare(
    'INSERT INTO reviewers (id, name, dot, email, google_sub, email_verified) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(id, (name || mail || 'Alguém').slice(0, 60), dot, free ? trusted : null, sub, verificado);
  const created = await db.prepare('SELECT * FROM reviewers WHERE id = ?').get(id);
  return { reviewer: created, created: true };
}

/* ══════════════════════════════════════════════════════════════════════════
   REIVINDICAR A CONTA DE ANTES

   Dez pessoas tinham conta neste produto quando entrar era um PIN de quatro
   dígitos. O PIN acabou; as fichas delas, não. Sem um caminho de volta, cada uma
   entra pelo Google, ganha uma conta nova e vazia, e o histórico fica num
   avaliador que ninguém mais alcança.

   ── por que o PIN, e não o navegador ──────────────────────────────────────
   A ideia óbvia é ligar automaticamente: se este navegador ainda está logado
   como alguém, gruda a conta Google nele. Ela é ruim por duas razões. O alcance
   é quase nada — a sessão antiga durava 24 horas e já venceu para praticamente
   todo mundo. E o que ela faz é "ligar quem está neste navegador a quem acabou
   de autenticar", que num computador compartilhado é tomada de conta.

   O PIN é melhor justamente por ser o que já existia: ele nunca saiu do banco,
   ele prova quem é a pessoa, e ela o conhece. Quatro dígitos são dez mil
   combinações, então a mesma trava por tentativas que protegia o login protege
   isto — é o único lugar do produto onde um PIN ainda vale alguma coisa.

   ── e por que o PIN sozinho não bastaria ──────────────────────────────────
   Porque num clube de amigos os PINs se repetem. Se metade das pessoas usava
   `1234`, escolher o rosto de alguém e chutar é prova fraca: a trava por
   tentativas não serve de nada quando o palpite acerta de primeira.

   Daí a segunda condição, que é a que faz o trabalho: **só aparece na lista de
   quem divide um clube com a conta órfã**. As contas de antes estão todas no
   clube fundador, que é fechado — então ver a lista exige que o ADM já tenha
   deixado a pessoa entrar. O aval dele é o primeiro fator; o PIN é o segundo, e
   um estranho não chega nem a ver os nomes.

   O efeito colateral é a ordem certa das coisas: entra, pede para entrar no
   clube, é aceito, e só então reivindica. Quem chega de fora não tem o que
   reivindicar mesmo.

   ── e por que isto não fica aberto para sempre ────────────────────────────
   Não precisa fechar por prazo: fecha sozinho. Uma conta reivindicada ganha
   `google_sub` e sai da lista; nenhuma conta nova nasce com PIN, porque não há
   mais como criar uma. O dia em que a última for reclamada, esta rota deixa de
   ter o que oferecer e vira código morto — que é o destino certo dela.
   ══════════════════════════════════════════════════════════════════════════ */

const hashPin = (pin, salt) => crypto.scryptSync(pin, salt, 64).toString('hex');

/* As contas de antes que ninguém reivindicou — e só as que dividem um clube com
   quem está perguntando. Ver o bloco acima: é esta condição, e não o PIN, que
   impede um estranho de sequer ver a lista. */
const CLAIMABLE = `
  SELECT DISTINCT r.id, r.name, r.dot, r.avatar_rev
  FROM reviewers r
  JOIN club_members orfa ON orfa.reviewer_id = r.id
  JOIN club_members minha ON minha.club_id = orfa.club_id AND minha.reviewer_id = ?
  WHERE r.pin_hash IS NOT NULL AND r.google_sub IS NULL AND r.password_hash IS NULL
    AND r.id <> ?
  ORDER BY r.name ASC
`;

/* ── e para QUEM a lista existe ────────────────────────────────────────────
   Duas condições sobre quem pergunta, e as duas nasceram do mesmo defeito: a
   tela reaparecia para todo mundo, toda vez, para sempre.

   O motivo é que a lista é "contas órfãs no seu clube", e ela continua cheia
   depois de você reclamar a sua — sobram as das outras nove pessoas. Quem já
   reivindicou era perguntado de novo no login seguinte, e quem nunca teve conta
   aqui era perguntado eternamente.

   1. **Quem já é uma conta antiga não pergunta nada.** Reivindicar move as
      credenciais para a linha velha, que carrega `pin_hash`; então ter
      `pin_hash` é exatamente a marca de "esta conta já é a de antes". Serve para
      quem reivindicou e para quem nunca deixou de ser.

   2. **Quem dispensou, dispensou.** `claim_dismissed_at` é a resposta gravada
      de "não é nenhuma dessas", e ela vale em qualquer navegador.

   As duas moram aqui, num lugar só, e não na tela: uma regra de quando oferecer
   que vive no cliente é uma regra que o próximo cliente esquece. */
async function claimable(reviewerId) {
  const quem = await db
    .prepare('SELECT pin_hash, claim_dismissed_at FROM reviewers WHERE id = ?')
    .get(reviewerId);
  if (!quem || quem.pin_hash || quem.claim_dismissed_at) return [];
  return db.prepare(CLAIMABLE).all(reviewerId, reviewerId);
}

/** "Não é nenhuma dessas." Grava, e a tela não volta. */
const dismissClaim = reviewerId =>
  db
    .prepare("UPDATE reviewers SET claim_dismissed_at = datetime('now') WHERE id = ?")
    .run(reviewerId);

/* A mesma condição, para uma conta só. É ela que a rota de reivindicar cobra
   antes de conferir PIN nenhum — sem isto, a lista seria uma sugestão e o id
   viajaria no corpo do pedido, que é o mesmo que não ter regra. */
async function canClaim(reviewerId, targetId) {
  const row = await db.prepare(`
    SELECT 1 AS x
    FROM club_members orfa
    JOIN club_members minha ON minha.club_id = orfa.club_id AND minha.reviewer_id = ?
    WHERE orfa.reviewer_id = ?
  `).get(reviewerId, targetId);
  return !!row;
}

/* Confere o PIN de uma conta adormecida, com a mesma contagem de erros do
   login. Devolve 'ok' | 'bad' | 'locked' | 'gone'. */
async function checkClaimPin(reviewerId, pin) {
  const row = await db
    .prepare(
      `SELECT * FROM reviewers
       WHERE id = ? AND pin_hash IS NOT NULL AND google_sub IS NULL AND password_hash IS NULL`
    )
    .get(reviewerId);
  if (!row) return 'gone';

  if (row.locked_until) {
    const still = await db.prepare("SELECT datetime('now') < ? AS locked").get(row.locked_until);
    if (still.locked) return 'locked';
  }

  const expected = Buffer.from(row.pin_hash, 'hex');
  const actual = Buffer.from(hashPin(String(pin ?? ''), row.pin_salt), 'hex');
  const ok = expected.length === actual.length && crypto.timingSafeEqual(expected, actual);

  if (ok) {
    await db.prepare('UPDATE reviewers SET auth_attempts = 0, locked_until = NULL WHERE id = ?').run(row.id);
    return 'ok';
  }

  const attempts = (row.auth_attempts || 0) + 1;
  if (attempts >= MAX_ATTEMPTS) {
    const pause = LOCK_SECONDS * (attempts - MAX_ATTEMPTS + 1);
    await db.prepare(
      `UPDATE reviewers SET auth_attempts = ?, locked_until = datetime('now', '+' || ? || ' seconds') WHERE id = ?`
    ).run(attempts, pause, row.id);
  } else {
    await db.prepare('UPDATE reviewers SET auth_attempts = ? WHERE id = ?').run(attempts, row.id);
  }
  return 'bad';
}

/* ── a fusão ──────────────────────────────────────────────────────────────
   A conta ANTIGA sobrevive, e a nova é dissolvida nela. É a direção certa e não
   é arbitrária: mover as credenciais é mexer em quatro colunas de uma linha,
   e mover o histórico seria reescrever a chave estrangeira em sete tabelas com
   restrições de unicidade em cada uma. O que se preserva também é o que
   importa: o nome, o retrato, a bio e as fichas são a pessoa aqui dentro; o
   e-mail e o `google_sub` são só como ela abre a porta agora.

   Tudo num lote, que no libSQL é uma transação: se qualquer passo falhar, a
   conta nova não pode ficar sem as credenciais que já foram tiradas dela — isso
   trancaria a pessoa para fora das duas. */
async function claimAccount(newId, oldId) {
  const nova = await db.prepare('SELECT * FROM reviewers WHERE id = ?').get(newId);
  if (!nova) return { error: 'Sessão inválida.' };

  const passos = [
    /* Primeiro liberar os índices únicos de e-mail e de google_sub: as duas
       linhas não podem carregar o mesmo valor nem por um instante. */
    { sql: 'UPDATE reviewers SET email = NULL, google_sub = NULL WHERE id = ?', args: [newId] },
    {
      /* `email_verified` acompanha o e-mail, e tem de acompanhar: a coluna
         nasceu depois desta fusão e ficou de fora dela. O efeito era silencioso
         e caro — a conta antiga herdava um endereço provado pelo Google e
         continuava marcada como não confirmada, então a pessoa passava a ver o
         aviso de confirmar e não conseguia fundar clube, por um endereço que
         ela já tinha provado. Uma credencial que se move sem o fato que a
         qualifica é meia credencial. */
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

  /* O que a conta nova possa ter acumulado entre entrar e reivindicar. Espera-se
     que seja nada, mas "espera-se" não é uma garantia que se possa escrever numa
     migração. `OR IGNORE` porque a antiga pode já ter a mesma linha — a mesma
     pessoa no mesmo clube, a mesma ficha do mesmo filme —, e nesse caso o que
     vale é o que ela já tinha; o resto some junto com a linha dela. */
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
  // Estas duas não têm restrição nenhuma, então nunca colidem.
  passos.push({ sql: 'UPDATE watchlist SET added_by = ? WHERE added_by = ?', args: [oldId, newId] });
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
   OS LINKS QUE CHEGAM POR E-MAIL.

   Dois usos, uma mecânica: um segredo de vida curta que só chega a quem lê
   aquela caixa de entrada, e cuja apresentação é a prova de que o endereço é
   dela. Confirmar um e-mail e redefinir uma senha são a mesma frase com dois
   fins.

   Três decisões, e as três são as das sessões, pelos mesmos motivos:

   1. **256 bits de acaso**, não um código de seis dígitos. Um código curto pede
      uma trava por tentativa e um relógio; um token deste tamanho não é
      adivinhado, e a trava vira uma segunda linha de defesa em vez da primeira.
   2. **O banco guarda só o SHA-256.** O token vive no e-mail e no endereço que
      a pessoa abre. Um vazamento de banco não devolve um único link utilizável.
      Não há salt, e é correto: um salt existe para atrasar quem adivinha uma
      senha humana, e aqui não há nada de humano para adivinhar.
   3. **Uso único, por exclusão.** Usar apaga a linha. Uma coluna "já usado"
      seria uma segunda resposta, livre para discordar da primeira, para a
      pergunta que a existência da linha já responde.

   As validades são diferentes e a diferença é o que cada link pode fazer.
   Confirmar um endereço não dá acesso a nada, então 24 horas é conveniência
   sem custo. Redefinir uma senha É o acesso, e uma hora é o tempo de ir ao
   e-mail e voltar.
   ══════════════════════════════════════════════════════════════════════════ */

const TOKEN_HOURS = { verify: 24, reset: 1 };

/** Cria um link novo e apaga os anteriores do mesmo tipo para a mesma pessoa. */
async function createEmailToken(reviewerId, kind, email) {
  const token = crypto.randomBytes(32).toString('base64url');
  /* Pedir um link novo invalida o anterior. Sem isto, cada pedido deixaria mais
     um segredo válido circulando por e-mail — e quem pede duas vezes é quase
     sempre alguém que não recebeu o primeiro, não alguém que queira dois. */
  await db.prepare('DELETE FROM email_tokens WHERE reviewer_id = ? AND kind = ?')
    .run(reviewerId, kind);
  await db.prepare(
    `INSERT INTO email_tokens (token_hash, reviewer_id, kind, email, expires_at)
     VALUES (?, ?, ?, ?, datetime('now', '+' || ? || ' hours'))`
  ).run(sha(token), reviewerId, kind, email, TOKEN_HOURS[kind]);
  return token;
}

/* Lê e CONSOME. Devolve a conta, ou null — e um null só quer dizer uma coisa
   para quem chama: o link não vale. Distinguir "não existe" de "expirou" de
   "era de outro endereço" seria contar a quem apresenta um token errado alguma
   coisa sobre os tokens certos.

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
   Express 4 ships no cookie parser and this needs exactly one cookie, so
   pulling a dependency in for it would be the expensive way to read a string. */

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

/* O administrador da INSTALAÇÃO, que é outra coisa do que o ADM de um clube.
   Este aqui cuida de contas; quem manda dentro de uma sala é o `role` em
   club_members, e quem cobra isso é o middleware de clube. */
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
  claimable,
  dismissClaim,
  canClaim,
  checkClaimPin,
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
