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
    try { fs.rmSync(dbPath + suffix, { force: true }); } catch { }
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
async function porSenha(senha = 'umasenhaboa') {
  const email = `p${++seq}-${crypto.randomUUID().slice(0, 8)}@exemplo.com`;
  const res = await req('POST', '/api/auth/register', { name: `Pessoa ${seq}`, email, password: senha });
  assert.equal(res.status, 201, 'a conta tinha de ser criada');
  return { email, senha, id: res.body.reviewer.id, cookie: res.setCookie.split(';')[0] };
}

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
  const quem = await kit.signIn();
  const row = await db.prepare('SELECT email_verified, email FROM reviewers WHERE id = ?').get(quem.id);
  assert.ok(row.email, 'a conta de teste tem e-mail');
  assert.equal(Number(row.email_verified), 1);
});

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
  await db.prepare(
    "UPDATE email_tokens SET expires_at = datetime('now', '-1 hour') WHERE reviewer_id = ?"
  ).run(quem.id);

  assert.equal((await req('POST', '/api/auth/verify', { token })).status, 400);
});

test('trocar o e-mail da conta invalida o link antigo', async () => {
  const quem = await porSenha();
  const token = await auth.createEmailToken(quem.id, 'verify', quem.email);
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

test('redefinir troca a senha, entra, e derruba as outras sessões', async () => {
  const quem = await porSenha();
  await db.prepare('UPDATE reviewers SET email_verified = 1 WHERE id = ?').run(quem.id);

  const outra = await req('POST', '/api/auth/login', { email: quem.email, password: quem.senha });
  const outroCookie = outra.setCookie.split(';')[0];
  assert.equal((await req('GET', '/api/auth/me', null, outroCookie)).body.reviewer.id, quem.id);

  const token = await auth.createEmailToken(quem.id, 'reset', quem.email);
  const feito = await req('POST', '/api/auth/reset', { token, password: 'senhanovaboa' });
  assert.equal(feito.status, 200);
  assert.ok(feito.setCookie, 'quem redefiniu já entra — não é mandado à tela de entrada');

  assert.equal((await req('POST', '/api/auth/login', { email: quem.email, password: 'senhanovaboa' })).status, 200);
  assert.equal((await req('POST', '/api/auth/login', { email: quem.email, password: quem.senha })).status, 401);

  assert.equal((await req('GET', '/api/auth/me', null, outroCookie)).body.reviewer, null);
});

test('redefinir recusa senha curta antes de gastar o token', async () => {
  const quem = await porSenha();
  await db.prepare('UPDATE reviewers SET email_verified = 1 WHERE id = ?').run(quem.id);
  const token = await auth.createEmailToken(quem.id, 'reset', quem.email);

  assert.equal((await req('POST', '/api/auth/reset', { token, password: 'curta' })).status, 400);
  assert.equal((await req('POST', '/api/auth/reset', { token, password: 'agorasimboa' })).status, 200);
});

test('pedir redefinição responde igual exista a conta ou não', async () => {
  const quem = await porSenha();
  const existe = await req('POST', '/api/auth/reset/request', { email: quem.email });
  const naoExiste = await req('POST', '/api/auth/reset/request', {
    email: `fantasma-${crypto.randomUUID().slice(0, 8)}@exemplo.com`,
  });

  assert.equal(existe.status, naoExiste.status);
  assert.deepEqual(existe.body, naoExiste.body);
});

test('pedido sem e-mail nenhum também não quebra nem conta nada', async () => {
  assert.equal((await req('POST', '/api/auth/reset/request', {})).status, 200);
  assert.equal((await req('POST', '/api/auth/reset/request', { email: 'nao-e-email' })).status, 200);
});

test('sem o endereço provado, não se funda clube', async () => {
  const quem = await porSenha();
  const negado = await req('POST', '/api/clubs', { name: `Sala ${crypto.randomUUID().slice(0, 8)}` }, quem.cookie);
  assert.equal(negado.status, 403);
  assert.equal(negado.body.needsVerifiedEmail, true);

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
  assert.deepEqual(kinds, ['verify']);
});

test('uma conta do Google sem e-mail nenhum não fica trancada', async () => {
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

test('a dica de chave diz qual é o erro sem contar a chave', () => {
  const antes = process.env.BREVO_API_KEY;
  try {
    process.env.BREVO_API_KEY = 'senha-de-smtp-que-nao-e-chave';
    const errada = mail.keyHint();
    assert.match(errada, /xkeysib/, 'diz qual é o formato certo');
    assert.match(errada, /API Keys/, 'e onde achá-lo');
    assert.ok(!errada.includes('senha-de-smtp-que-nao-e-chave'), 'sem a chave dentro');

    process.env.BREVO_API_KEY = 'xkeysib-' + 'a'.repeat(60);
    const certa = mail.keyHint();
    assert.match(certa, /revogada|outra conta|incompleta/, 'com a forma certa, a causa é outra');
    assert.ok(!certa.includes('a'.repeat(60)), 'e continua sem a chave dentro');
  } finally {
    if (antes === undefined) delete process.env.BREVO_API_KEY;
    else process.env.BREVO_API_KEY = antes;
  }
});

test('juntar contas leva o e-mail confirmado junto da credencial', async () => {
  const nova = await kit.signIn('Quem Entrou Pelo Google');
  const velhaId = 'p' + crypto.randomUUID();
  await db.prepare('INSERT INTO reviewers (id, name, dot) VALUES (?, ?, ?)')
    .run(velhaId, 'Quem Já Estava Aqui', '#e0362c');

  const antes = await db.prepare('SELECT email_verified FROM reviewers WHERE id = ?').get(velhaId);
  assert.equal(Number(antes.email_verified), 0, 'a conta adormecida não tem endereço provado');

  const out = await auth.claimAccount(nova.id, velhaId);
  assert.ok(!out.error, out.error);

  const depois = await db
    .prepare('SELECT email, email_verified, google_sub FROM reviewers WHERE id = ?')
    .get(velhaId);
  assert.ok(depois.email, 'o endereço veio');
  assert.ok(depois.google_sub, 'e a porta do Google também');
  assert.equal(Number(depois.email_verified), 1, 'e o fato de ele estar provado veio junto');

  assert.equal(await db.prepare('SELECT id FROM reviewers WHERE id = ?').get(nova.id), undefined);
});

test('a tela de entrada consegue saber se há envio, estando deslogada', async () => {
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
  const linhas = await db.prepare('SELECT kind FROM email_tokens WHERE reviewer_id = ?').all(quem.id);
  assert.deepEqual(linhas.map(r => r.kind), ['verify']);
});
