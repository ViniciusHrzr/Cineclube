const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const dbPath = path.join(os.tmpdir(), `cineclube-email-${crypto.randomUUID()}.db`);
process.env.CINECLUBE_DB = dbPath;

const app = require('../server');
const db = require('../db');
const live = require('../live');
const screening = require('../screening');
const throttle = require('../throttle');
const auth = require('../auth');
const mail = require('../mail');
const kit = require('../testkit');

/* ══════════════════════════════════════════════════════════════════════════
   CONFIRMAR O ENDEREÇO, E VOLTAR PARA DENTRO SEM A SENHA.

   Este arquivo protege o caminho mais perigoso que o produto tem: uma rota que,
   apresentado o segredo certo, entrega uma conta. Tudo aqui é sobre o que ela
   NÃO pode fazer.

   O que os testes fixam, e cada um é uma forma de o recurso virar uma porta:

   1. O banco nunca guarda um token utilizável — só o SHA-256 dele.
   2. Um token serve uma vez. Apresentar de novo não devolve nada.
   3. Um token expirado não vale, e o relógio é do servidor.
   4. O token de confirmar não redefine senha, e vice-versa.
   5. Pedir uma redefinição responde igual exista a conta ou não — senão a rota
      vira uma lista de quem tem conta aqui.
   6. Redefinir derruba as outras sessões: trocar a fechadura sem recolher as
      cópias da chave não é trocar a fechadura.
   7. Conta sem endereço provado não recupera senha nem funda clube.

   ── e por que não há um servidor de e-mail falso aqui ─────────────────────
   `mail.send` sem `BREVO_API_KEY` devolve `sent: false` e não manda nada, que é
   o estado destes testes. Isso é de propósito: o que precisa ser verificado é o
   TOKEN — quem ele deixa entrar, quantas vezes, por quanto tempo — e essa é a
   metade que fica no banco. O envio é um POST para outro serviço, e um dublê
   dele testaria o dublê.
   ══════════════════════════════════════════════════════════════════════════ */

let baseUrl;
let server;

test.before(async () => {
  await app.ready;
  server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  live.stopTimers();
  screening.stopTimers();
  throttle.stopTimers();
  const closed = new Promise(resolve => server.close(resolve));
  server.closeAllConnections?.();
  await closed;
  db.close();
  for (const suffix of ['', '-shm', '-wal']) {
    try { fs.rmSync(dbPath + suffix, { force: true }); } catch { /* it is a temp file */ }
  }
});

test.beforeEach(() => throttle.reset());

async function req(method, pathname, body, cookie) {
  const headers = {};
  if (body) headers['Content-Type'] = 'application/json';
  if (cookie) headers.Cookie = cookie;
  const res = await fetch(baseUrl + pathname, {
    method,
    headers: Object.keys(headers).length ? headers : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let parsed = null;
  try { parsed = text ? JSON.parse(text) : null; } catch { parsed = null; }
  return { status: res.status, body: parsed, setCookie: res.headers.get('set-cookie') };
}

let seq = 0;
/** Uma conta por senha: nasce com endereço NÃO confirmado, que é o caso todo. */
async function porSenha(senha = 'umasenhaboa') {
  const email = `p${++seq}-${crypto.randomUUID().slice(0, 8)}@exemplo.com`;
  const res = await req('POST', '/api/auth/register', { name: `Pessoa ${seq}`, email, password: senha });
  assert.equal(res.status, 201, 'a conta tinha de ser criada');
  return { email, senha, id: res.body.reviewer.id, cookie: res.setCookie.split(';')[0] };
}

/* ══════════════════════════════════════════════════════════════════════════
   1. O QUE O BANCO GUARDA
   ══════════════════════════════════════════════════════════════════════════ */

test('o banco guarda o hash do link, nunca o link', async () => {
  const quem = await porSenha();
  const token = await auth.createEmailToken(quem.id, 'verify', quem.email);

  const linhas = await db.prepare('SELECT * FROM email_tokens WHERE reviewer_id = ?').all(quem.id);
  assert.equal(linhas.length, 1);
  const guardado = JSON.stringify(linhas[0]);
  assert.ok(!guardado.includes(token), 'o token apareceu no banco');
  assert.equal(
    linhas[0].token_hash,
    crypto.createHash('sha256').update(token).digest('hex'),
    'o que está lá é o SHA-256 dele'
  );
});

test('uma conta por senha nasce sem o endereço provado', async () => {
  const quem = await porSenha();
  const row = await db.prepare('SELECT email_verified FROM reviewers WHERE id = ?').get(quem.id);
  assert.equal(Number(row.email_verified), 0);
});

test('uma conta do Google nasce com ele provado', async () => {
  /* `accountForGoogle` só grava o e-mail quando o Google o marcou verificado, e
     é essa prova — que este produto não sabe produzir sozinho — que a coluna
     registra. */
  const quem = await kit.signIn();
  const row = await db.prepare('SELECT email_verified, email FROM reviewers WHERE id = ?').get(quem.id);
  assert.ok(row.email, 'a conta de teste tem e-mail');
  assert.equal(Number(row.email_verified), 1);
});

/* ══════════════════════════════════════════════════════════════════════════
   2. O QUE UM TOKEN PODE FAZER, E QUANTAS VEZES
   ══════════════════════════════════════════════════════════════════════════ */

test('confirmar funciona uma vez, e só uma', async () => {
  const quem = await porSenha();
  const token = await auth.createEmailToken(quem.id, 'verify', quem.email);

  const um = await req('POST', '/api/auth/verify', { token });
  assert.equal(um.status, 200);
  const row = await db.prepare('SELECT email_verified FROM reviewers WHERE id = ?').get(quem.id);
  assert.equal(Number(row.email_verified), 1);

  const dois = await req('POST', '/api/auth/verify', { token });
  assert.equal(dois.status, 400, 'o segundo uso não vale');
});

test('um token de confirmar não redefine senha, e o de redefinir não confirma', async () => {
  const quem = await porSenha();
  const confirmar = await auth.createEmailToken(quem.id, 'verify', quem.email);
  const redefinir = await auth.createEmailToken(quem.id, 'reset', quem.email);

  assert.equal(
    (await req('POST', '/api/auth/reset', { token: confirmar, password: 'outrasenhaboa' })).status,
    400,
    'o de confirmar não serve para redefinir'
  );
  assert.equal(
    (await req('POST', '/api/auth/verify', { token: redefinir })).status,
    400,
    'nem o contrário'
  );
});

test('um token vencido não vale', async () => {
  const quem = await porSenha();
  const token = await auth.createEmailToken(quem.id, 'verify', quem.email);
  /* Empurrado para trás no banco, e não esperando 24 horas. O relógio que
     decide é o do servidor (`datetime('now')`), então mexer na coluna é
     exatamente o que o tempo faria. */
  await db.prepare(
    "UPDATE email_tokens SET expires_at = datetime('now', '-1 hour') WHERE reviewer_id = ?"
  ).run(quem.id);

  assert.equal((await req('POST', '/api/auth/verify', { token })).status, 400);
});

test('trocar o e-mail da conta invalida o link antigo', async () => {
  const quem = await porSenha();
  const token = await auth.createEmailToken(quem.id, 'verify', quem.email);
  /* O token vale para O ENDEREÇO ao qual foi mandado. Sem esta regra, um link
     pedido para um endereço confirmaria outro — o que é exatamente o que alguém
     faria para provar um endereço que não é dele. */
  await db.prepare('UPDATE reviewers SET email = ? WHERE id = ?')
    .run(`outro-${crypto.randomUUID().slice(0, 8)}@exemplo.com`, quem.id);

  assert.equal((await req('POST', '/api/auth/verify', { token })).status, 400);
});

test('pedir um link novo mata o anterior', async () => {
  const quem = await porSenha();
  const velho = await auth.createEmailToken(quem.id, 'verify', quem.email);
  await auth.createEmailToken(quem.id, 'verify', quem.email);
  assert.equal(
    (await req('POST', '/api/auth/verify', { token: velho })).status,
    400,
    'dois segredos válidos circulando é um a mais do que o necessário'
  );
});

/* ══════════════════════════════════════════════════════════════════════════
   3. REDEFINIR
   ══════════════════════════════════════════════════════════════════════════ */

test('redefinir troca a senha, entra, e derruba as outras sessões', async () => {
  const quem = await porSenha();
  await db.prepare('UPDATE reviewers SET email_verified = 1 WHERE id = ?').run(quem.id);

  // Uma segunda sessão, para conferir que ela cai.
  const outra = await req('POST', '/api/auth/login', { email: quem.email, password: quem.senha });
  const outroCookie = outra.setCookie.split(';')[0];
  assert.equal((await req('GET', '/api/auth/me', null, outroCookie)).body.reviewer.id, quem.id);

  const token = await auth.createEmailToken(quem.id, 'reset', quem.email);
  const feito = await req('POST', '/api/auth/reset', { token, password: 'senhanovaboa' });
  assert.equal(feito.status, 200);
  assert.ok(feito.setCookie, 'quem redefiniu já entra — não é mandado à tela de entrada');

  // A senha nova vale, a velha não.
  assert.equal((await req('POST', '/api/auth/login', { email: quem.email, password: 'senhanovaboa' })).status, 200);
  assert.equal((await req('POST', '/api/auth/login', { email: quem.email, password: quem.senha })).status, 401);

  /* E a sessão que já estava aberta caiu. Redefinir é o que se faz quando se
     suspeita que alguém entrou; deixar as sessões abertas seria trocar a
     fechadura e não recolher as cópias da chave. */
  assert.equal((await req('GET', '/api/auth/me', null, outroCookie)).body.reviewer, null);
});

test('redefinir recusa senha curta antes de gastar o token', async () => {
  const quem = await porSenha();
  await db.prepare('UPDATE reviewers SET email_verified = 1 WHERE id = ?').run(quem.id);
  const token = await auth.createEmailToken(quem.id, 'reset', quem.email);

  assert.equal((await req('POST', '/api/auth/reset', { token, password: 'curta' })).status, 400);
  /* E o token sobreviveu: queimar o único uso por causa de uma senha curta
     mandaria a pessoa pedir outro link por um erro de digitação. */
  assert.equal((await req('POST', '/api/auth/reset', { token, password: 'agorasimboa' })).status, 200);
});

/* ══════════════════════════════════════════════════════════════════════════
   4. O QUE A ROTA DE PEDIDO NÃO CONTA
   ══════════════════════════════════════════════════════════════════════════ */

test('pedir redefinição responde igual exista a conta ou não', async () => {
  const quem = await porSenha();
  const existe = await req('POST', '/api/auth/reset/request', { email: quem.email });
  const naoExiste = await req('POST', '/api/auth/reset/request', {
    email: `fantasma-${crypto.randomUUID().slice(0, 8)}@exemplo.com`,
  });

  assert.equal(existe.status, naoExiste.status);
  assert.deepEqual(existe.body, naoExiste.body);
  /* Se as duas respostas diferissem em qualquer coisa, esta rota seria uma
     forma de descobrir quem tem conta aqui, um endereço por vez. */
});

test('pedido sem e-mail nenhum também não quebra nem conta nada', async () => {
  assert.equal((await req('POST', '/api/auth/reset/request', {})).status, 200);
  assert.equal((await req('POST', '/api/auth/reset/request', { email: 'nao-e-email' })).status, 200);
});

/* ══════════════════════════════════════════════════════════════════════════
   5. O QUE UMA CONTA NÃO CONFIRMADA NÃO FAZ
   ══════════════════════════════════════════════════════════════════════════ */

test('sem o endereço provado, não se funda clube', async () => {
  const quem = await porSenha();
  const negado = await req('POST', '/api/clubs', { name: `Sala ${crypto.randomUUID().slice(0, 8)}` }, quem.cookie);
  assert.equal(negado.status, 403);
  assert.equal(negado.body.needsVerifiedEmail, true);

  // Confirmado, funda.
  const token = await auth.createEmailToken(quem.id, 'verify', quem.email);
  await req('POST', '/api/auth/verify', { token });
  const feito = await req('POST', '/api/clubs', { name: `Sala ${crypto.randomUUID().slice(0, 8)}` }, quem.cookie);
  assert.equal(feito.status, 201);
});

test('sem o endereço provado, o pedido de redefinição não gera token de redefinição', async () => {
  const quem = await porSenha();
  await req('POST', '/api/auth/reset/request', { email: quem.email });

  const kinds = (await db.prepare('SELECT kind FROM email_tokens WHERE reviewer_id = ?').all(quem.id))
    .map(r => r.kind);
  /* O que chega é o link de CONFIRMAR, e não o de redefinir. Aplicar a regra ao
     pé da letra — recusar em silêncio — trancaria a pessoa para sempre, porque
     confirmar exige estar dentro e quem pede isto está fora. */
  assert.deepEqual(kinds, ['verify']);
});

test('uma conta do Google sem e-mail nenhum não fica trancada', async () => {
  /* Ela existe: `accountForGoogle` grava o endereço como nulo quando ele já é
     de outra conta, para a entrada não morrer num 500. Essa pessoa não tem o
     que confirmar, e a regra aplicada a ela não pediria uma prova — trancaria
     uma porta para sempre. */
  const quem = await kit.signIn();
  await db.prepare('UPDATE reviewers SET email = NULL, email_verified = 0 WHERE id = ?').run(quem.id);

  const feito = await req(
    'POST', '/api/clubs', { name: `Sala ${crypto.randomUUID().slice(0, 8)}` }, quem.cookie
  );
  assert.equal(feito.status, 201);
});

test('avaliar e participar continuam livres sem confirmação', async () => {
  const quem = await porSenha();
  const dono = await kit.signIn();
  const sala = await kit.makeClub({ owner: dono.id, visibility: 'public' });

  assert.equal((await req('POST', `/api/c/${sala.slug}/join`, {}, quem.cookie)).status, 201);
  const ficha = await req(
    'POST', `/api/c/${sala.slug}/reviews`,
    { movie: { id: 991001, title: 'Um Filme', year: 2024, genre: 'Terror' }, scores: {} },
    quem.cookie
  );
  assert.equal(ficha.status, 201, 'a regra encarece FUNDAR, não participar');
});

/* ══════════════════════════════════════════════════════════════════════════
   6. AS TRAVAS
   ══════════════════════════════════════════════════════════════════════════ */

test('pedir confirmação em rajada bate na porta', async () => {
  const quem = await porSenha();
  const feitos = [];
  for (let i = 0; i < 5; i++) feitos.push(await req('POST', '/api/auth/verify/send', {}, quem.cookie));
  assert.equal(feitos.filter(r => r.status === 200).length, 3);
  assert.equal(feitos.filter(r => r.status === 429).length, 2);
});

test('apresentar tokens em rajada bate na porta', async () => {
  const codes = [];
  for (let i = 0; i < 24; i++) {
    codes.push((await req('POST', '/api/auth/verify', { token: `chute-${i}` })).status);
  }
  assert.ok(codes.includes(429), 'adivinhar não é caminho, mas tem de ser barulhento');
});

test('a tela de entrada consegue saber se há envio, estando deslogada', async () => {
  /* O defeito que este teste trava: `mail` estava só no ramo de quem TEM
     sessão, e a única tela que precisa da resposta — a de entrada — é a única
     que não tem. "Esqueci minha senha" nunca aparecia.

     Um fato sobre a instalação, e não sobre uma pessoa: do mesmo tipo que já se
     descobre olhando se o botão do Google está na tela. */
  const deslogado = await req('GET', '/api/auth/me');
  assert.equal(deslogado.body.reviewer, null, 'sem cookie, sem pessoa');
  assert.equal(typeof deslogado.body.mail, 'boolean', 'e mesmo assim a capacidade vem');
  assert.equal(typeof deslogado.body.google, 'boolean');
});

test('sem provedor configurado o app não quebra — ele diz que não mandou', async () => {
  assert.equal(mail.configured(), false, 'os testes rodam sem chave, de propósito');
  const quem = await porSenha();
  const res = await req('POST', '/api/auth/verify/send', {}, quem.cookie);
  assert.equal(res.status, 200);
  assert.equal(res.body.sent, false, 'a tela precisa da diferença entre "mandamos" e "não deu"');
  /* E o token foi criado mesmo assim: o link existe do lado de cá, e o que
     falhou foi a entrega. */
  const linhas = await db.prepare('SELECT kind FROM email_tokens WHERE reviewer_id = ?').all(quem.id);
  assert.deepEqual(linhas.map(r => r.kind), ['verify']);
});
