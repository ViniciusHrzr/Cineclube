const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

// Point the app at a throwaway database *before* requiring it — db.js opens
// the file the moment it is loaded.
const dbPath = path.join(os.tmpdir(), `cineclube-test-${crypto.randomUUID()}.db`);
process.env.CINECLUBE_DB = dbPath;

const app = require('../server');
const db = require('../db');
const kit = require('../testkit');

/* A sala em que este arquivo inteiro acontece, e o prefixo das rotas dela.
   Antes dos clubes toda rota era `/api/algo`; agora as que falam de um acervo
   falam de UM acervo.

   Pública, e isso é assunto de alguns destes testes: ler um clube aberto não
   exige sessão nenhuma — a versão por sala do "leitura é aberta" que este
   produto sempre teve. O que o clube fechado faz está provado em clubs.test.js. */
let CLUB;
const at = p => `/api/c/${CLUB.slug}${p}`;

let baseUrl;
let server;

test.before(async () => {
  // The schema, the seeds and the admin are async now; nothing may hit the API
  // before they land.
  await app.ready;
  server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  CLUB = await kit.makeClub({ name: 'Clube de Teste', visibility: 'public' });
});

test.after(async () => {
  await new Promise(resolve => server.close(resolve));
  // Windows keeps the file locked while the connection is open.
  db.close();
  // WAL mode leaves -shm/-wal siblings behind. Windows can still hold the
  // handle for a moment after close(), and a temp file we failed to delete is
  // not a reason to fail a green run.
  for (const suffix of ['', '-shm', '-wal']) {
    try { fs.rmSync(dbPath + suffix, { force: true }); } catch { /* it is a temp file */ }
  }
});

/** `cookie` carries a session; omit it to act as a signed-out visitor. */
async function req(method, pathname, body, cookie) {
  const headers = {};
  if (body) headers['Content-Type'] = 'application/json';
  if (cookie) headers.Cookie = cookie;
  const res = await fetch(baseUrl + pathname, {
    method,
    headers: Object.keys(headers).length ? headers : undefined,
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await res.text();
  return {
    status: res.status,
    body: text ? JSON.parse(text) : null,
    setCookie: res.headers.get('set-cookie')
  };
}

function sessionCookie(setCookie) {
  return setCookie ? setCookie.split(';')[0] : null;
}

let seq = 0;

/** Uma conta com sessão, já dentro da sala deste arquivo. */
async function newReviewer(name) {
  const who = await kit.signIn(name || `Avaliador ${++seq}`);
  await kit.join(CLUB.id, who.id);
  return who;
}

/** O ADM da sala — quem aprova entrada e quem varre o que não devia estar nela. */
async function newAdmin(name) {
  const admin = await kit.signIn(name || `Chefe ${++seq}`);
  await kit.join(CLUB.id, admin.id, 'admin');
  return admin;
}

/** E o administrador da INSTALAÇÃO, que é outra coisa: ele cuida de contas. */
async function newSiteAdmin(name) {
  const admin = await kit.signInAdmin(name || `Dono ${++seq}`);
  await kit.join(CLUB.id, admin.id, 'admin');
  return admin;
}

function movie(overrides) {
  return { id: 100000 + ++seq, title: 'Filme de Teste', year: 2024, genre: 'Terror', ...overrides };
}

function scoresFor(genre, value) {
  const { critsFor } = require('../criteria');
  const o = {};
  critsFor(genre).forEach(c => { o[c.key] = value; });
  return o;
}

/* ── reviewers ───────────────────────────────────────────────────────── */

/* ── o elenco de UMA sala ────────────────────────────────────────────────
   Isto listava a plataforma inteira, porque a plataforma inteira era um clube.
   Agora lista quem está numa sala — e é essa a diferença que estes testes
   protegem: uma rede que devolvesse todos os seus usuários a qualquer visitante
   não seria uma lista, seria um vazamento com paginação. */

test('as contas de exemplo nascem no clube fundador', async () => {
  const home = await db.prepare('SELECT slug FROM clubs WHERE name = ? COLLATE NOCASE').get('Cineclube');
  const { status, body } = await req('GET', `/api/c/${home.slug}/reviewers`);
  assert.equal(status, 200);
  const names = body.reviewers.map(r => r.name);
  for (const quem of ['Ana Reis', 'Bruno Sá', 'Clara Lima']) {
    assert.ok(names.includes(quem), `${quem} deveria estar no clube fundador`);
  }
});

test('o elenco de um clube é só de quem está nele', async () => {
  const dentro = await newReviewer('Está Dentro');
  const fora = await kit.signIn('Está Fora');

  const list = await req('GET', at('/reviewers'));
  const ids = list.body.reviewers.map(r => r.id);
  assert.ok(ids.includes(dentro.id));
  assert.ok(!ids.includes(fora.id), 'quem não é da sala não aparece no elenco dela');
});

test('a lista nunca expõe o hash nem o salt da senha', async () => {
  await newReviewer();
  const list = await req('GET', at('/reviewers'));
  const serialized = JSON.stringify(list.body);
  assert.ok(!serialized.includes('password_hash'), 'a listagem vazou password_hash');
  assert.ok(!serialized.includes('password_salt'), 'a listagem vazou password_salt');
  assert.ok(!serialized.includes('google_sub'), 'a listagem vazou o identificador do Google');
});

test('cada pessoa carrega o papel que tem NESTA sala', async () => {
  const chefe = await newAdmin('Manda Aqui');
  const gente = await newReviewer('Não Manda');
  const list = await req('GET', at('/reviewers'));
  assert.equal(list.body.reviewers.find(r => r.id === chefe.id).role, 'admin');
  assert.equal(list.body.reviewers.find(r => r.id === gente.id).role, 'member');
});

/* ── e não existe mais rota de cadastro ──────────────────────────────────
   Havia um POST aberto que criava avaliador com nome e PIN. Ele estava certo
   enquanto o produto era uma sala de amigos com um endereço que só eles
   conheciam. Numa rede, um endpoint público que cria contas sem verificar
   e-mail nenhum é cadastro sem dono — conta agora nasce de um lugar só, a volta
   do Google. */
test('a rota pública de cadastro de avaliador não existe mais', async () => {
  /* Sem passar por `req`: uma rota que não existe cai no 404 do Express, que é
     HTML, e `req` só sabe ler JSON. O que importa aqui é o número. */
  const res = await fetch(baseUrl + '/api/reviewers', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Intruso', pin: '1234' }),
  });
  await res.text();
  assert.equal(res.status, 404);
});

/* ── apagar uma CONTA ────────────────────────────────────────────────────
   Que é a pessoa deixando a plataforma, e não deixando uma sala: sair de um
   clube é `DELETE /api/c/<slug>/members/<id>`, e tem os próprios testes. Aqui as
   fichas dela vão junto, em todos os clubes de uma vez — e é por isso que só o
   administrador da instalação alcança esta rota. */

test('apagar uma conta não é coisa de qualquer um', async () => {
  const alvo = await newReviewer();
  const outro = await newReviewer();
  const adm = await newAdmin();

  assert.equal((await req('DELETE', `/api/reviewers/${alvo.id}`, null, outro.cookie)).status, 403);
  assert.equal(
    (await req('DELETE', `/api/reviewers/${alvo.id}`, null, adm.cookie)).status,
    403,
    'nem o ADM de uma sala apaga a conta de alguém — a sala não é a plataforma'
  );

  const dono = await newSiteAdmin();
  assert.equal((await req('DELETE', `/api/reviewers/${alvo.id}`, null, dono.cookie)).status, 204);
});

test('apagar uma conta desconhecida é 404', async () => {
  const dono = await newSiteAdmin();
  assert.equal((await req('DELETE', '/api/reviewers/nao-existe', null, dono.cookie)).status, 404);
});

test('o administrador da instalação não é removível, nem por ele mesmo', async () => {
  const dono = await newSiteAdmin();
  assert.equal((await req('DELETE', `/api/reviewers/${dono.id}`, null, dono.cookie)).status, 403);
});

test('apagar uma conta leva as avaliações dela junto', async () => {
  const alvo = await newReviewer();
  const dono = await newSiteAdmin();
  await req('POST', at('/reviews'), { movie: movie(), scores: scoresFor('Terror', 7) }, alvo.cookie);

  const antes = await req('GET', at('/reviews'));
  assert.ok(antes.body.reviews.some(r => r.reviewerId === alvo.id));

  assert.equal((await req('DELETE', `/api/reviewers/${alvo.id}`, null, dono.cookie)).status, 204);

  const depois = await req('GET', at('/reviews'));
  assert.ok(!depois.body.reviews.some(r => r.reviewerId === alvo.id));
});

test('removing a reviewer needs a session at all', async () => {
  const member = await newReviewer();
  assert.equal((await req('DELETE', `/api/reviewers/${member.id}`)).status, 401);
});

test('review_count reflects saved reviews', async () => {
  const reviewer = await newReviewer();
  await req('POST', at('/reviews'), { movie: movie(), scores: scoresFor('Terror', 6) }, reviewer.cookie);
  await req('POST', at('/reviews'), { movie: movie(), scores: scoresFor('Terror', 8) }, reviewer.cookie);

  const list = await req('GET', at('/reviewers'));
  const found = list.body.reviewers.find(r => r.id === reviewer.id);
  assert.equal(found.review_count, 2);
});

/* ── a bio ────────────────────────────────────────────────────────────────
   A única coisa deste banco que uma pessoa afirma sobre si mesma. Todo o resto
   que o perfil desenha é derivado do que ela fez, e por isso as regras aqui são
   as mesmas do nome e do retrato: é dela, e a rota não recebe id nenhum. */

async function rosterRow(id) {
  const list = await req('GET', at('/reviewers'));
  return list.body.reviewers.find(r => r.id === id);
}

test('uma pessoa nasce sem bio, e sem bio é null e não string vazia', async () => {
  const reviewer = await newReviewer('Sem Bio');
  const row = await rosterRow(reviewer.id);
  assert.equal(row.bio, null);
});

test('escreve a própria bio, e ela sai na lista do clube', async () => {
  const reviewer = await newReviewer('Com Bio');
  const res = await req('PATCH', '/api/reviewers/me', { bio: '  Só vim pelo terror.  ' }, reviewer.cookie);
  assert.equal(res.status, 200);
  // Aparada na gravação: o espaço que sobra de um campo de texto não é conteúdo.
  assert.equal(res.body.reviewer.bio, 'Só vim pelo terror.');
  assert.equal((await rosterRow(reviewer.id)).bio, 'Só vim pelo terror.');
});

test('uma bio em branco apaga, e o que fica é null', async () => {
  const reviewer = await newReviewer('Apaga Bio');
  await req('PATCH', '/api/reviewers/me', { bio: 'algo' }, reviewer.cookie);
  // Os dois gestos que significam "limpei o campo" chegam pelo mesmo caminho.
  for (const empty of ['   ', null]) {
    await req('PATCH', '/api/reviewers/me', { bio: 'algo' }, reviewer.cookie);
    const res = await req('PATCH', '/api/reviewers/me', { bio: empty }, reviewer.cookie);
    assert.equal(res.status, 200);
    assert.equal(res.body.reviewer.bio, null);
    assert.equal((await rosterRow(reviewer.id)).bio, null);
  }
});

test('recusa uma bio maior que o teto, e não grava nada', async () => {
  const reviewer = await newReviewer('Bio Longa');
  await req('PATCH', '/api/reviewers/me', { bio: 'curta' }, reviewer.cookie);
  const res = await req('PATCH', '/api/reviewers/me', { bio: 'x'.repeat(141) }, reviewer.cookie);
  assert.equal(res.status, 400);
  assert.match(res.body.error, /140/);
  assert.equal((await rosterRow(reviewer.id)).bio, 'curta');
});

test('exatamente no teto passa', async () => {
  const reviewer = await newReviewer('Bio No Limite');
  const res = await req('PATCH', '/api/reviewers/me', { bio: 'x'.repeat(140) }, reviewer.cookie);
  assert.equal(res.status, 200);
  assert.equal(res.body.reviewer.bio.length, 140);
});

test('ninguém escreve a bio de outra pessoa — nem o admin', async () => {
  const admin = await newAdmin('Chefe Sem Voz');
  const alvo = await newReviewer('Alvo');
  /* A rota não recebe id: escrever pela pessoa não é algo a proibir, é algo que
     não há como pedir. O admin manda o patch e ele pousa na conta DELE. */
  const res = await req('PATCH', '/api/reviewers/me', { bio: 'falei por você' }, admin.cookie);
  assert.equal(res.status, 200);
  assert.equal((await rosterRow(alvo.id)).bio, null);
  assert.equal((await rosterRow(admin.id)).bio, 'falei por você');
});

test('um visitante sem sessão não escreve bio nenhuma', async () => {
  const reviewer = await newReviewer('Bio Protegida');
  const res = await req('PATCH', '/api/reviewers/me', { bio: 'invasor' });
  assert.equal(res.status, 401);
  assert.equal((await rosterRow(reviewer.id)).bio, null);
});

test('a lista do clube diz desde quando cada pessoa está aqui', async () => {
  const reviewer = await newReviewer('Membro Datado');
  const row = await rosterRow(reviewer.id);
  // O formato do banco: 'YYYY-MM-DD HH:MM:SS'. O perfil lê o mês e o ano dele.
  assert.match(row.createdAt, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
});

test('mexer na bio não mexe no nome nem no retrato', async () => {
  const reviewer = await newReviewer('Intacto');
  const res = await req('PATCH', '/api/reviewers/me', { bio: 'nova bio' }, reviewer.cookie);
  assert.equal(res.body.reviewer.name, 'Intacto');
  assert.equal(res.body.reviewer.avatar, null);
});

/* ── sign-in ─────────────────────────────────────────────────────────── */

/* ── entrar ──────────────────────────────────────────────────────────────
   O PIN de quatro dígitos era a credencial enquanto entrar significava escolher
   o próprio rosto numa lista de quatro pessoas. Numa rede essa lista é todo
   mundo, então a identidade passou a ser o e-mail e a credencial, uma senha.

   O que estes testes protegem não mudou de natureza: que a credencial nunca sai
   do servidor, que errar tem custo crescente, e que a rota de entrada não vira
   um jeito de descobrir quem tem conta aqui. */

test('a sessão diz quem eu sou', async () => {
  const reviewer = await newReviewer('Login OK');
  const me = await req('GET', '/api/auth/me', null, reviewer.cookie);
  assert.equal(me.status, 200);
  assert.equal(me.body.reviewer.id, reviewer.id);
  assert.equal(me.body.reviewer.isAdmin, false);
});

test('a visitor with no session is nobody, not an error', async () => {
  const me = await req('GET', '/api/auth/me');
  assert.equal(me.status, 200);
  assert.equal(me.body.reviewer, null);
});

test('uma conta que só entrou pelo Google ainda precisa cadastrar senha', async () => {
  const reviewer = await newReviewer();
  const me = await req('GET', '/api/auth/me', null, reviewer.cookie);
  assert.equal(me.body.needsPassword, true);
});

test('cadastra a senha, e aí não precisa mais', async () => {
  const reviewer = await newReviewer();
  const set = await req('POST', '/api/auth/password', { password: 'umasenhaboa' }, reviewer.cookie);
  assert.equal(set.status, 200);

  /* Cadastrar senha derruba as outras sessões da conta — inclusive a que fez o
     pedido, que recebe uma nova no mesmo response. */
  const cookie = sessionCookie(set.setCookie);
  const me = await req('GET', '/api/auth/me', null, cookie);
  assert.equal(me.body.needsPassword, false);
});

test('a senha tem um piso, e ele é imposto no servidor', async () => {
  const reviewer = await newReviewer();
  assert.equal(
    (await req('POST', '/api/auth/password', { password: 'curta' }, reviewer.cookie)).status,
    400
  );
});

test('entra com e-mail e senha, em qualquer caixa', async () => {
  const reviewer = await newReviewer();
  await req('POST', '/api/auth/password', { password: 'umasenhaboa' }, reviewer.cookie);

  const login = await req('POST', '/api/auth/login', {
    email: reviewer.email.toUpperCase(),
    password: 'umasenhaboa',
  });
  assert.equal(login.status, 200);
  assert.equal(login.body.reviewer.id, reviewer.id);
});

test('senha errada e e-mail inexistente respondem a MESMA coisa', async () => {
  const reviewer = await newReviewer();
  await req('POST', '/api/auth/password', { password: 'umasenhaboa' }, reviewer.cookie);

  const ruim = await req('POST', '/api/auth/login', { email: reviewer.email, password: 'errada!!!' });
  const ninguem = await req('POST', '/api/auth/login', { email: 'nao-existe@x.com', password: 'errada!!!' });
  assert.equal(ruim.status, 401);
  assert.equal(ninguem.status, 401);
  assert.equal(
    ruim.body.error,
    ninguem.body.error,
    'duas frases diferentes fariam desta rota um jeito de descobrir quem tem conta'
  );
});

test('a conta descansa depois de erros seguidos', async () => {
  const reviewer = await newReviewer();
  await req('POST', '/api/auth/password', { password: 'umasenhaboa' }, reviewer.cookie);

  let last;
  for (let i = 0; i < 6; i++) {
    last = await req('POST', '/api/auth/login', { email: reviewer.email, password: 'errada!!!' });
  }
  assert.equal(last.status, 429, 'seis tentativas erradas deveriam ter trancado a conta');

  /* E a senha certa também é recusada enquanto a trava vale — senão a trava
     seria só um aviso. */
  const certa = await req('POST', '/api/auth/login', { email: reviewer.email, password: 'umasenhaboa' });
  assert.equal(certa.status, 429);
});

test('signing out invalidates the session', async () => {
  const reviewer = await newReviewer();
  assert.equal((await req('POST', '/api/auth/logout', {}, reviewer.cookie)).status, 204);
  const me = await req('GET', '/api/auth/me', null, reviewer.cookie);
  assert.equal(me.body.reviewer, null);
});

test('trocar a senha exige a atual', async () => {
  const reviewer = await newReviewer();
  const first = await req('POST', '/api/auth/password', { password: 'umasenhaboa' }, reviewer.cookie);
  const cookie = sessionCookie(first.setCookie);

  const semAtual = await req('POST', '/api/auth/password', { password: 'outrasenha1' }, cookie);
  assert.equal(semAtual.status, 401, 'quem acha um navegador destrancado não tranca o dono fora');

  const comAtual = await req(
    'POST', '/api/auth/password', { current: 'umasenhaboa', password: 'outrasenha1' }, cookie
  );
  assert.equal(comAtual.status, 200);
});

test('trocar a senha derruba as outras sessões da conta', async () => {
  const reviewer = await newReviewer();
  const first = await req('POST', '/api/auth/password', { password: 'umasenhaboa' }, reviewer.cookie);
  const antiga = sessionCookie(first.setCookie);

  /* Uma segunda aba da mesma pessoa. */
  const outra = await req('POST', '/api/auth/login', { email: reviewer.email, password: 'umasenhaboa' });
  const nova = sessionCookie(outra.setCookie);

  await req('POST', '/api/auth/password', { current: 'umasenhaboa', password: 'outrasenha1' }, nova);

  const velha = await req('GET', '/api/auth/me', null, antiga);
  assert.equal(velha.body.reviewer, null, 'a aba antiga deveria ter sido deslogada');
});

test('a senha nunca volta numa resposta', async () => {
  const reviewer = await newReviewer();
  const set = await req('POST', '/api/auth/password', { password: 'umasenhaboa' }, reviewer.cookie);
  const me = await req('GET', '/api/auth/me', null, sessionCookie(set.setCookie));
  const serialized = JSON.stringify(me.body) + JSON.stringify(set.body);
  assert.ok(!serialized.includes('umasenhaboa'), 'a senha vazou numa resposta');
  assert.ok(!/password_hash|password_salt/.test(serialized));
});

test('a instalação diz se a porta do Google existe', async () => {
  const me = await req('GET', '/api/auth/me');
  assert.equal(typeof me.body.google, 'boolean');
});

/* ── reviews ─────────────────────────────────────────────────────────── */

test('saves a review and computes the final score server-side', async () => {
  const reviewer = await newReviewer();
  const m = movie();
  const { status, body } = await req('POST', at('/reviews'), {
    movie: m, scores: scoresFor('Terror', 10), comment: 'Excelente.'
  }, reviewer.cookie);

  assert.equal(status, 201);
  assert.equal(body.final, 10);
  assert.equal(body.movieId, m.id);
  assert.equal(body.movieGenre, 'Terror');
  assert.equal(body.reviewerName, reviewer.name);
  assert.equal(body.comment, 'Excelente.');
  assert.equal(body.breakdown.length, 11);
  assert.deepEqual([...new Set(body.breakdown.map(b => b.w))], [1], 'os pesos deixaram de ser iguais');
});

test('a review is signed by the session, not by the request body', async () => {
  const a = await newReviewer('Dono');
  const b = await newReviewer('Impostor');
  const { body } = await req('POST', at('/reviews'), {
    reviewerId: a.id, movie: movie(), scores: scoresFor('Terror', 5)
  }, b.cookie);
  assert.equal(body.reviewerId, b.id, 'o corpo da requisição não pode escolher quem assina');
});

test('ignores a client-sent final score and recomputes from the criteria', async () => {
  const reviewer = await newReviewer();
  const { body } = await req('POST', at('/reviews'), {
    movie: movie(), scores: scoresFor('Terror', 5), final: 10
  }, reviewer.cookie);
  assert.equal(body.final, 5);
});

test('clamps out-of-range and non-numeric scores', async () => {
  const reviewer = await newReviewer();
  const scores = { ...scoresFor('Terror', 5), direcao: 99, roteiro: -20, fotografia: 'dez' };
  const { body } = await req('POST', at('/reviews'), { movie: movie(), scores }, reviewer.cookie);

  assert.equal(body.scores.direcao, 10);
  assert.equal(body.scores.roteiro, 0);
  assert.equal(body.scores.fotografia, 0);
  assert.ok(Number.isFinite(body.final));
});

test('drops criteria that do not belong to the genre', async () => {
  const reviewer = await newReviewer();
  const scores = { ...scoresFor('Terror', 5), naoExiste: 10 };
  const { body } = await req('POST', at('/reviews'), { movie: movie(), scores }, reviewer.cookie);

  assert.equal(body.scores.naoExiste, undefined);
  assert.equal(body.final, 5);
});

test('falls back to Drama for an unknown movie genre', async () => {
  const reviewer = await newReviewer();
  const { body } = await req('POST', at('/reviews'), {
    movie: movie({ genre: 'Faroeste' }), scores: scoresFor('Drama', 7)
  }, reviewer.cookie);
  assert.equal(body.movieGenre, 'Drama');
  assert.equal(body.final, 7);
});

test('re-rating the same movie updates the review instead of duplicating it', async () => {
  const reviewer = await newReviewer();
  const m = movie();

  const first = await req('POST', at('/reviews'), { movie: m, scores: scoresFor('Terror', 4) }, reviewer.cookie);
  const second = await req('POST', at('/reviews'), { movie: m, scores: scoresFor('Terror', 9) }, reviewer.cookie);

  assert.equal(first.body.id, second.body.id, 'o upsert deveria manter o mesmo id');
  assert.equal(second.body.final, 9);

  const all = await req('GET', at('/reviews'));
  const mine = all.body.reviews.filter(r => r.reviewerId === reviewer.id && r.movieId === m.id);
  assert.equal(mine.length, 1);
  assert.equal(mine[0].final, 9);
});

test('a take keeps how long the film runs', async () => {
  const reviewer = await newReviewer();
  const m = movie({ runtime: 112 });

  const { body } = await req('POST', at('/reviews'), { movie: m, scores: scoresFor('Terror', 7) }, reviewer.cookie);
  assert.equal(body.movieRuntime, 112);

  const all = await req('GET', at('/reviews'));
  const mine = all.body.reviews.find(r => r.reviewerId === reviewer.id && r.movieId === m.id);
  assert.equal(mine.movieRuntime, 112);
});

test('a film with no runtime on record is null, never zero', async () => {
  const reviewer = await newReviewer();
  const { body } = await req('POST', at('/reviews'), { movie: movie({ runtime: 0 }), scores: scoresFor('Terror', 5) }, reviewer.cookie);
  assert.equal(body.movieRuntime, null);
});

/* Re-rating goes through the same upsert as rating, and the client sends
   whatever the catalogue handed it — which, on a stale sheet served from a
   cache written before durations existed, is nothing. A second take must not
   erase a runtime the first one recorded. */
test('re-rating without a runtime does not erase the one already recorded', async () => {
  const reviewer = await newReviewer();
  const m = movie({ runtime: 96 });

  await req('POST', at('/reviews'), { movie: m, scores: scoresFor('Terror', 4) }, reviewer.cookie);
  const again = await req('POST', at('/reviews'), {
    movie: { ...m, runtime: undefined }, scores: scoresFor('Terror', 8)
  }, reviewer.cookie);

  assert.equal(again.body.final, 8);
  assert.equal(again.body.movieRuntime, 96);
});

test('two reviewers can rate the same movie independently', async () => {
  const a = await newReviewer();
  const b = await newReviewer();
  const m = movie();

  await req('POST', at('/reviews'), { movie: m, scores: scoresFor('Terror', 6) }, a.cookie);
  await req('POST', at('/reviews'), { movie: m, scores: scoresFor('Terror', 8) }, b.cookie);

  const averages = await req('GET', at('/reviews/averages'));
  assert.equal(averages.body.averages[m.id].count, 2);
  assert.equal(averages.body.averages[m.id].avg, 7);
});

test('rejects a review from a visitor with no session', async () => {
  const { status } = await req('POST', at('/reviews'), {
    movie: movie(), scores: scoresFor('Terror', 5)
  });
  assert.equal(status, 401);
});

test('rejects a review with a malformed movie or missing scores', async () => {
  const reviewer = await newReviewer();
  const cases = [
    { movie: null, scores: scoresFor('Terror', 5) },
    { movie: { title: 'Sem id' }, scores: scoresFor('Terror', 5) },
    { movie: { id: 1 }, scores: scoresFor('Terror', 5) },
    { movie: movie(), scores: null },
    { movie: movie(), scores: 'dez' }
  ];
  for (const payload of cases) {
    const { status } = await req('POST', at('/reviews'), payload, reviewer.cookie);
    assert.equal(status, 400, `payload aceito indevidamente: ${JSON.stringify(payload)}`);
  }
});

test('truncates an overlong comment instead of failing', async () => {
  const reviewer = await newReviewer();
  const { status, body } = await req('POST', at('/reviews'), {
    movie: movie(), scores: scoresFor('Terror', 5), comment: 'a'.repeat(5000)
  }, reviewer.cookie);
  assert.equal(status, 201);
  assert.equal(body.comment.length, 2000);
});

test('deletes a review and reports 404 afterwards', async () => {
  const reviewer = await newReviewer();
  const { body } = await req('POST', at('/reviews'), {
    movie: movie(), scores: scoresFor('Terror', 5)
  }, reviewer.cookie);

  assert.equal((await req('DELETE', at(`/reviews/${body.id}`), null, reviewer.cookie)).status, 204);
  assert.equal((await req('DELETE', at(`/reviews/${body.id}`), null, reviewer.cookie)).status, 404);

  const all = await req('GET', at('/reviews'));
  assert.ok(!all.body.reviews.some(r => r.id === body.id));
});

test('a take is only ever deleted by the person who gave it, admin included', async () => {
  const owner = await newReviewer('Dono da Nota');
  const other = await newReviewer('Xereta');
  const admin = await newAdmin();

  const { body } = await req('POST', at('/reviews'), {
    movie: movie(), scores: scoresFor('Terror', 5)
  }, owner.cookie);

  assert.equal((await req('DELETE', at(`/reviews/${body.id}`), null, other.cookie)).status, 403);
  // The admin removes accounts, not opinions.
  assert.equal((await req('DELETE', at(`/reviews/${body.id}`), null, admin.cookie)).status, 403);
  assert.ok((await req('GET', at('/reviews'))).body.reviews.some(r => r.id === body.id));

  assert.equal((await req('DELETE', at(`/reviews/${body.id}`), null, owner.cookie)).status, 204);
});

test('rating a film someone else rated adds a take, it does not touch theirs', async () => {
  const owner = await newReviewer('Primeiro');
  const other = await newReviewer('Segundo');
  const m = movie({ title: 'O Mesmo Filme' });

  const first = await req('POST', at('/reviews'), { movie: m, scores: scoresFor('Terror', 4) }, owner.cookie);
  const second = await req('POST', at('/reviews'), { movie: m, scores: scoresFor('Terror', 9) }, other.cookie);

  assert.notEqual(first.body.id, second.body.id);
  const mine = (await req('GET', at('/reviews'))).body.reviews.filter(r => r.movieId === m.id);
  assert.equal(mine.length, 2);
  assert.equal(mine.find(r => r.reviewerId === owner.id).final, first.body.final);
});

/* ── watchlist ───────────────────────────────────────────────────────── */

test('adds a movie to the watchlist and lists it back', async () => {
  const member = await newReviewer();
  const m = movie({ title: 'Para Assistir' });
  assert.equal((await req('POST', at('/watchlist'), { movie: m }, member.cookie)).status, 201);

  const { body } = await req('GET', at('/watchlist'));
  const found = body.watchlist.find(w => w.id === m.id);
  assert.ok(found, 'filme não apareceu na watchlist');
  assert.equal(found.title, 'Para Assistir');
  assert.equal(found.genre, 'Terror');
});

/* A fila mostra de quem foi a ideia, e o id é a única parte disso que sai do
   servidor: o nome, a cor e o retrato são fatos sobre a pessoa e o clube
   inteiro já está carregado no cliente. Sem este campo a tela volta a ser
   quarenta pôsteres sem autor nenhum. */
test('a fila diz quem pôs cada filme', async () => {
  const member = await newReviewer();
  const m = movie();
  await req('POST', at('/watchlist'), { movie: m }, member.cookie);

  const { body } = await req('GET', at('/watchlist'));
  assert.equal(body.watchlist.find(w => w.id === m.id).addedBy, member.id);
});

test('adding the same movie twice keeps a single entry', async () => {
  const member = await newReviewer();
  const m = movie();
  await req('POST', at('/watchlist'), { movie: m }, member.cookie);
  await req('POST', at('/watchlist'), { movie: m }, member.cookie);

  const { body } = await req('GET', at('/watchlist'));
  assert.equal(body.watchlist.filter(w => w.id === m.id).length, 1);
});

test('rejects a malformed movie on the watchlist', async () => {
  const member = await newReviewer();
  for (const payload of [{}, { movie: null }, { movie: { title: 'Sem id' } }, { movie: { id: 5 } }]) {
    const { status } = await req('POST', at('/watchlist'), payload, member.cookie);
    assert.equal(status, 400, `payload aceito indevidamente: ${JSON.stringify(payload)}`);
  }
});

test('a signed-out visitor cannot touch the watchlist', async () => {
  const m = movie();
  assert.equal((await req('POST', at('/watchlist'), { movie: m })).status, 401);
  assert.equal((await req('DELETE', at(`/watchlist/${m.id}`))).status, 401);
});

test('rating a movie removes it from the watchlist', async () => {
  const reviewer = await newReviewer();
  const m = movie();
  await req('POST', at('/watchlist'), { movie: m }, reviewer.cookie);

  await req('POST', at('/reviews'), { movie: m, scores: scoresFor('Terror', 7) }, reviewer.cookie);

  const { body } = await req('GET', at('/watchlist'));
  assert.ok(!body.watchlist.some(w => w.id === m.id), 'filme avaliado continuou na watchlist');
});

test('keeps the watchlist in the order the club arranged', async () => {
  const member = await newReviewer();
  const a = movie({ title: 'Primeiro' });
  const b = movie({ title: 'Segundo' });
  const c = movie({ title: 'Terceiro' });
  for (const m of [a, b, c]) await req('POST', at('/watchlist'), { movie: m }, member.cookie);

  const before = await req('GET', at('/watchlist'));
  const mine = before.body.watchlist.filter(w => [a.id, b.id, c.id].includes(w.id));
  assert.deepEqual(mine.map(w => w.id), [a.id, b.id, c.id], 'novos entram no fim da fila');

  const reordered = await req('PUT', at('/watchlist/order'), { ids: [c.id, a.id, b.id] }, member.cookie);
  assert.equal(reordered.status, 200);

  const after = await req('GET', at('/watchlist'));
  const now = after.body.watchlist.filter(w => [a.id, b.id, c.id].includes(w.id));
  assert.deepEqual(now.map(w => w.id), [c.id, a.id, b.id]);
});

test('a reorder that omits an entry does not lose it', async () => {
  const member = await newReviewer();
  const a = movie({ title: 'Fica' });
  const b = movie({ title: 'Tambem fica' });
  for (const m of [a, b]) await req('POST', at('/watchlist'), { movie: m }, member.cookie);

  // A stale tab reorders without knowing about `b`.
  await req('PUT', at('/watchlist/order'), { ids: [a.id] }, member.cookie);

  const { body } = await req('GET', at('/watchlist'));
  assert.ok(body.watchlist.some(w => w.id === b.id), 'a fila perdeu um filme que ninguém removeu');
});

test('rejects a reorder from a visitor with no session, or a malformed one', async () => {
  const member = await newReviewer();
  assert.equal((await req('PUT', at('/watchlist/order'), { ids: [] })).status, 401);
  assert.equal((await req('PUT', at('/watchlist/order'), { ids: 'nao' }, member.cookie)).status, 400);
});

test('removes a movie from the watchlist', async () => {
  const member = await newReviewer();
  const m = movie();
  await req('POST', at('/watchlist'), { movie: m }, member.cookie);

  assert.equal((await req('DELETE', at(`/watchlist/${m.id}`), null, member.cookie)).status, 204);

  const { body } = await req('GET', at('/watchlist'));
  assert.ok(!body.watchlist.some(w => w.id === m.id));
});

/* ── tirar é de quem pôs ─────────────────────────────────────────────────
   Uma escolha na fila é alguém dizendo "quero ver isto com vocês", e a linha é
   a única memória de que aquilo foi escolhido. Uma limpeza bem-intencionada
   apagando o mês de espera de outra pessoa é o que estes testes existem para
   impedir — e a recusa tem de dizer de quem é a escolha, ou é um "não pode" sem
   sujeito. */
test('ninguém tira da fila o filme que outra pessoa pôs', async () => {
  const dono = await newReviewer('Quem Pos');
  const outro = await newReviewer();
  const m = movie();
  await req('POST', at('/watchlist'), { movie: m }, dono.cookie);

  const refused = await req('DELETE', at(`/watchlist/${m.id}`), null, outro.cookie);
  assert.equal(refused.status, 403);
  assert.match(refused.body.error, /Quem Pos/);

  const { body } = await req('GET', at('/watchlist'));
  assert.ok(body.watchlist.some(w => w.id === m.id), 'a fila perdeu um filme que ninguém tinha direito de tirar');
});

/* O zelador do clube. É a única exceção, e ela existe porque as linhas antigas
   sem dono e as escolhas de quem saiu do clube não têm outro caminho para fora
   da fila. */
test('o administrador tira o que for', async () => {
  const dono = await newReviewer();
  const admin = await newAdmin();
  const m = movie();
  await req('POST', at('/watchlist'), { movie: m }, dono.cookie);

  assert.equal((await req('DELETE', at(`/watchlist/${m.id}`), null, admin.cookie)).status, 204);
});

/* Sumir com uma linha que já não existe não é erro de ninguém: o pedido queria
   que o filme não estivesse na fila, e ele não está. Com a fila ao vivo, duas
   pessoas tirando o mesmo filme ao mesmo tempo passou a acontecer de verdade. */
test('tirar um filme que já saiu não é erro', async () => {
  const member = await newReviewer();
  const m = movie();
  await req('POST', at('/watchlist'), { movie: m }, member.cookie);
  await req('DELETE', at(`/watchlist/${m.id}`), null, member.cookie);

  assert.equal((await req('DELETE', at(`/watchlist/${m.id}`), null, member.cookie)).status, 204);
});

/* Avaliar continua tirando o filme da fila seja de quem for a escolha: quem pôs
   pediu para o clube ver, e o clube viu. Isso não é desdizer ninguém — é a
   escolha tendo dado certo. */
test('avaliar tira da fila mesmo o filme que outra pessoa pôs', async () => {
  const dono = await newReviewer();
  const outro = await newReviewer();
  const m = movie();
  await req('POST', at('/watchlist'), { movie: m }, dono.cookie);

  const rated = await req('POST', at('/reviews'), { movie: m, scores: scoresFor('Terror', 7) }, outro.cookie);
  assert.equal(rated.status, 201);

  const { body } = await req('GET', at('/watchlist'));
  assert.ok(!body.watchlist.some(w => w.id === m.id), 'o filme avaliado continuou na fila');
});
