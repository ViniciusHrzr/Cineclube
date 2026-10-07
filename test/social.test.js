const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const dbPath = path.join(os.tmpdir(), `cineclube-social-${crypto.randomUUID()}.db`);
process.env.CINECLUBE_DB = dbPath;

const app = require('../server');
const db = require('../db');
const kit = require('../testkit');
const { critsFor } = require('../criteria');

let CLUB;
const at = p => `/api/c/${CLUB.slug}${p}`;

let baseUrl;
let server;

test.before(async () => {
  await app.ready;
  server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  CLUB = await kit.makeClub({ name: 'Clube da Conversa', visibility: 'public' });
});

test.after(async () => {
  await new Promise(resolve => server.close(resolve));
  db.close();
  for (const suffix of ['', '-shm', '-wal']) {
    try { fs.rmSync(dbPath + suffix, { force: true }); } catch { }
  }
});

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
  return { status: res.status, body: text ? JSON.parse(text) : null, setCookie: res.headers.get('set-cookie') };
}

const cookieOf = setCookie => (setCookie ? setCookie.split(';')[0] : null);

let seq = 0;
const PIN = '4321';

async function newReviewer(name) {
  const who = await kit.signIn(name || `Sócio ${++seq}`);
  await kit.join(CLUB.id, who.id);
  return who;
}

async function newAdmin() {
  const admin = await kit.signIn(`Chefe ${++seq}`);
  await kit.join(CLUB.id, admin.id, 'admin');
  return admin;
}

const movie = () => ({ id: 700000 + ++seq, title: 'Filme de Teste', year: 2024, genre: 'Terror' });

function scoresFor(genre, value) {
  const o = {};
  critsFor(genre).forEach(c => { o[c.key] = value; });
  return o;
}

async function newTake(who, overrides) {
  const m = movie();
  const res = await req('POST', at('/reviews'), {
    movie: m, scores: { ...scoresFor('Terror', 7), ...(overrides || {}) }
  }, who.cookie);
  assert.equal(res.status, 201);
  return { ...res.body, movie: m };
}

const social = () => req('GET', at('/social'));

test('um comentário fica pendurado na avaliação e volta assinado', async () => {
  const author = await newReviewer();
  const reader = await newReviewer();
  const take = await newTake(author);

  const posted = await req(
    'POST', at(`/social/reviews/${take.id}/comments`), { body: 'discordo do teu 7 em roteiro' }, reader.cookie
  );
  assert.equal(posted.status, 201);
  assert.equal(posted.body.reviewId, take.id);
  assert.equal(posted.body.reviewerId, reader.id);
  assert.equal(posted.body.reviewerName, reader.name);
  assert.equal(posted.body.body, 'discordo do teu 7 em roteiro');

  const all = await social();
  assert.ok(all.body.comments.some(c => c.id === posted.body.id));
});

test('o comentário é assinado pela sessão, não pelo corpo da requisição', async () => {
  const author = await newReviewer();
  const impostor = await newReviewer();
  const take = await newTake(author);

  const posted = await req(
    'POST', at(`/social/reviews/${take.id}/comments`),
    { body: 'não fui eu', reviewerId: author.id }, impostor.cookie
  );
  assert.equal(posted.body.reviewerId, impostor.id);
});

test('comentar na própria avaliação é permitido — é metade de uma conversa', async () => {
  const author = await newReviewer();
  const take = await newTake(author);
  const posted = await req(
    'POST', at(`/social/reviews/${take.id}/comments`), { body: 'respondendo a quem me respondeu' }, author.cookie
  );
  assert.equal(posted.status, 201);
});

test('um comentário vazio ou só de espaços é recusado', async () => {
  const author = await newReviewer();
  const take = await newTake(author);
  for (const body of ['', '   ', '\n\t ']) {
    const posted = await req('POST', at(`/social/reviews/${take.id}/comments`), { body }, author.cookie);
    assert.equal(posted.status, 400, `"${body}" deveria ser recusado`);
  }
});

test('um comentário longo demais é recusado inteiro, não cortado', async () => {
  const author = await newReviewer();
  const take = await newTake(author);
  const posted = await req(
    'POST', at(`/social/reviews/${take.id}/comments`), { body: 'a'.repeat(1001) }, author.cookie
  );
  assert.equal(posted.status, 400);
  assert.equal((await social()).body.comments.filter(c => c.reviewId === take.id).length, 0);
});

test('visitante deslogado lê a conversa mas não escreve nela', async () => {
  const author = await newReviewer();
  const take = await newTake(author);
  await req('POST', at(`/social/reviews/${take.id}/comments`), { body: 'oi' }, author.cookie);

  assert.equal((await social()).status, 200);
  assert.equal((await req('POST', at(`/social/reviews/${take.id}/comments`), { body: 'sou ninguém' })).status, 401);
});

test('você apaga o seu comentário e não o dos outros', async () => {
  const author = await newReviewer();
  const reader = await newReviewer();
  const take = await newTake(author);
  const mine = await req('POST', at(`/social/reviews/${take.id}/comments`), { body: 'meu' }, reader.cookie);

  assert.equal((await req('DELETE', at(`/social/comments/${mine.body.id}`), null, author.cookie)).status, 403);
  assert.equal((await req('DELETE', at(`/social/comments/${mine.body.id}`), null, reader.cookie)).status, 204);
  assert.ok(!(await social()).body.comments.some(c => c.id === mine.body.id));
});

test('o admin apaga o comentário de qualquer um — apagar é moderar', async () => {
  const admin = await newAdmin();
  const member = await newReviewer();
  const take = await newTake(member);
  const theirs = await req('POST', at(`/social/reviews/${take.id}/comments`), { body: 'algo' }, member.cookie);

  assert.equal((await req('DELETE', at(`/social/comments/${theirs.body.id}`), null, admin.cookie)).status, 204);
});

test('apagar a avaliação leva a conversa sobre ela junto', async () => {
  const author = await newReviewer();
  const reader = await newReviewer();
  const take = await newTake(author);
  await req('POST', at(`/social/reviews/${take.id}/comments`), { body: 'some comigo' }, reader.cookie);

  assert.equal((await req('DELETE', at(`/reviews/${take.id}`), null, author.cookie)).status, 204);
  assert.equal((await social()).body.comments.filter(c => c.reviewId === take.id).length, 0);
});

const comment = (take, body, who) =>
  req('POST', at(`/social/reviews/${take.id}/comments`), { body }, who.cookie);
const reply = (take, parentId, body, who) =>
  req('POST', at(`/social/reviews/${take.id}/comments`), { body, parentId }, who.cookie);

test('uma resposta se pendura no comentário e sabe de quem', async () => {
  const author = await newReviewer();
  const a = await newReviewer();
  const b = await newReviewer();
  const take = await newTake(author);
  const parent = (await comment(take, 'o roteiro cai no terceiro ato', a)).body;

  const posted = await reply(take, parent.id, 'discordo, o corte salva', b);
  assert.equal(posted.status, 201);
  assert.equal(posted.body.parentId, parent.id);
  assert.equal(posted.body.reviewId, take.id);

  const all = (await social()).body.comments;
  assert.equal(all.find(c => c.id === parent.id).parentId, null, 'o pai virou resposta');
});

test('uma resposta não recebe resposta — a profundidade é um', async () => {
  const author = await newReviewer();
  const a = await newReviewer();
  const b = await newReviewer();
  const take = await newTake(author);
  const parent = (await comment(take, 'primeiro', a)).body;
  const child = (await reply(take, parent.id, 'segundo', b)).body;

  const refused = await reply(take, child.id, 'terceiro', a);
  assert.equal(refused.status, 400);
});

test('não dá para responder um comentário de outra ficha', async () => {
  const author = await newReviewer();
  const reader = await newReviewer();
  const here = await newTake(author);
  const elsewhere = await newTake(author);
  const parent = (await comment(elsewhere, 'lá', reader)).body;

  const refused = await reply(here, parent.id, 'aqui', reader);
  assert.equal(refused.status, 400, 'costurou um fio entre duas fichas');
});

test('responder um comentário que não existe é recusado', async () => {
  const author = await newReviewer();
  const reader = await newReviewer();
  const take = await newTake(author);
  assert.equal((await reply(take, 'cnaoexiste', 'oi', reader)).status, 400);
});

test('apagar o comentário leva as respostas dele junto', async () => {
  const author = await newReviewer();
  const a = await newReviewer();
  const b = await newReviewer();
  const take = await newTake(author);
  const parent = (await comment(take, 'pai', a)).body;
  await reply(take, parent.id, 'filha', b);
  await reply(take, parent.id, 'outra filha', author);

  assert.equal((await req('DELETE', at(`/social/comments/${parent.id}`), null, a.cookie)).status, 204);
  const left = (await social()).body.comments.filter(c => c.reviewId === take.id);
  assert.equal(left.length, 0, 'sobrou resposta sem o que ela responde');
});

test('apagar uma resposta não mexe no comentário', async () => {
  const author = await newReviewer();
  const a = await newReviewer();
  const b = await newReviewer();
  const take = await newTake(author);
  const parent = (await comment(take, 'pai', a)).body;
  const child = (await reply(take, parent.id, 'filha', b)).body;

  await req('DELETE', at(`/social/comments/${child.id}`), null, b.cookie);
  const left = (await social()).body.comments.filter(c => c.reviewId === take.id);
  assert.deepEqual(left.map(c => c.id), [parent.id]);
});

test('uma resposta é curtível como qualquer comentário', async () => {
  const author = await newReviewer();
  const a = await newReviewer();
  const b = await newReviewer();
  const take = await newTake(author);
  const parent = (await comment(take, 'pai', a)).body;
  const child = (await reply(take, parent.id, 'filha', b)).body;

  assert.equal((await req('PUT', at(`/social/comments/${child.id}/like`), { liked: true }, a.cookie)).status, 200);
});

const like = (comment, liked, who) =>
  req('PUT', at(`/social/comments/${comment.id}/like`), { liked }, who.cookie);

async function newComment(author, who, body) {
  const take = await newTake(author);
  const posted = await req(
    'POST', at(`/social/reviews/${take.id}/comments`), { body: body || 'algo a dizer' }, who.cookie
  );
  assert.equal(posted.status, 201);
  return posted.body;
}

test('curtir e descurtir um comentário, sem virar duas linhas', async () => {
  const author = await newReviewer();
  const writer = await newReviewer();
  const reader = await newReviewer();
  const comment = await newComment(author, writer);

  assert.equal((await like(comment, true, reader)).status, 200);
  assert.equal((await like(comment, true, reader)).status, 200, 'curtir de novo não pode falhar');

  let mine = (await social()).body.commentLikes.filter(l => l.commentId === comment.id);
  assert.equal(mine.length, 1, 'curtir duas vezes criou duas linhas');

  assert.equal((await like(comment, false, reader)).status, 200);
  mine = (await social()).body.commentLikes.filter(l => l.commentId === comment.id);
  assert.equal(mine.length, 0, 'descurtir deveria apagar a linha');
});

test('duas pessoas curtem o mesmo comentário sem se sobrescrever', async () => {
  const author = await newReviewer();
  const writer = await newReviewer();
  const a = await newReviewer();
  const b = await newReviewer();
  const comment = await newComment(author, writer);

  await like(comment, true, a);
  await like(comment, true, b);
  assert.equal((await social()).body.commentLikes.filter(l => l.commentId === comment.id).length, 2);
});

test('ninguém curte o próprio comentário', async () => {
  const author = await newReviewer();
  const writer = await newReviewer();
  const comment = await newComment(author, writer);

  const refused = await like(comment, true, writer);
  assert.equal(refused.status, 403);
  assert.equal((await social()).body.commentLikes.filter(l => l.commentId === comment.id).length, 0);
});

test('o dono da ficha pode curtir um comentário na ficha dele', async () => {
  const author = await newReviewer();
  const writer = await newReviewer();
  const comment = await newComment(author, writer);
  assert.equal((await like(comment, true, author)).status, 200);
});

test('curtida que não é booleana é recusada', async () => {
  const author = await newReviewer();
  const writer = await newReviewer();
  const reader = await newReviewer();
  const comment = await newComment(author, writer);

  for (const value of [1, 0, 'sim', null, undefined]) {
    assert.equal((await like(comment, value, reader)).status, 400, `aceitou ${value}`);
  }
});

test('visitante deslogado lê as curtidas mas não curte', async () => {
  const author = await newReviewer();
  const writer = await newReviewer();
  const comment = await newComment(author, writer);

  assert.equal((await social()).status, 200);
  assert.equal(
    (await req('PUT', at(`/social/comments/${comment.id}/like`), { liked: true })).status, 401
  );
});

test('apagar o comentário leva as curtidas dele junto', async () => {
  const author = await newReviewer();
  const writer = await newReviewer();
  const reader = await newReviewer();
  const comment = await newComment(author, writer);
  await like(comment, true, reader);

  assert.equal((await req('DELETE', at(`/social/comments/${comment.id}`), null, writer.cookie)).status, 204);
  assert.equal((await social()).body.commentLikes.filter(l => l.commentId === comment.id).length, 0);
});

test('curtir um comentário que não existe responde 404', async () => {
  const reader = await newReviewer();
  assert.equal(
    (await req('PUT', at('/social/comments/cnaoexiste/like'), { liked: true }, reader.cookie)).status, 404
  );
});

const vote = (take, value, who) =>
  req('PUT', at(`/social/reviews/${take.id}/vote`), { value }, who.cookie);

test('um voto vale por ficha, e trocar de ideia não vira uma segunda linha', async () => {
  const author = await newReviewer();
  const reader = await newReviewer();
  const take = await newTake(author);

  assert.equal((await vote(take, 1, reader)).status, 200);
  assert.equal((await vote(take, -1, reader)).status, 200);

  const mine = (await social()).body.votes.filter(
    v => v.reviewId === take.id && v.reviewerId === reader.id
  );
  assert.equal(mine.length, 1, 'trocar o voto criou uma linha nova');
  assert.equal(mine[0].value, -1);
});

test('votar zero tira o voto em vez de gravar um neutro', async () => {
  const author = await newReviewer();
  const reader = await newReviewer();
  const take = await newTake(author);

  await vote(take, 1, reader);
  const cleared = await vote(take, 0, reader);
  assert.equal(cleared.status, 200);
  assert.equal(cleared.body.vote, null);
  assert.equal((await social()).body.votes.filter(v => v.reviewId === take.id).length, 0);
});

test('duas pessoas votam na mesma ficha sem se sobrescrever', async () => {
  const author = await newReviewer();
  const a = await newReviewer();
  const b = await newReviewer();
  const take = await newTake(author);

  await vote(take, 1, a);
  await vote(take, -1, b);

  const cast = (await social()).body.votes.filter(v => v.reviewId === take.id);
  assert.equal(cast.length, 2);
  assert.equal(cast.reduce((sum, v) => sum + v.value, 0), 0);
});

test('ninguém vota na própria avaliação', async () => {
  const author = await newReviewer();
  const take = await newTake(author);
  const refused = await vote(take, 1, author);
  assert.equal(refused.status, 403);
  assert.equal((await social()).body.votes.filter(v => v.reviewId === take.id).length, 0);
});

test('um voto que não é 1, -1 ou 0 é recusado', async () => {
  const author = await newReviewer();
  const reader = await newReviewer();
  const take = await newTake(author);
  for (const value of [2, -5, 0.5, 'sim', null]) {
    assert.equal((await vote(take, value, reader)).status, 400, `aceitou ${value}`);
  }
});

test('visitante deslogado não vota', async () => {
  const author = await newReviewer();
  const take = await newTake(author);
  const refused = await req('PUT', at(`/social/reviews/${take.id}/vote`), { value: 1 });
  assert.equal(refused.status, 401);
});

test('regravar uma nota não derruba a concordância com a ficha', async () => {
  const author = await newReviewer();
  const reader = await newReviewer();
  const take = await newTake(author);

  await vote(take, 1, reader);

  const again = await req('POST', at('/reviews'), {
    movie: take.movie, scores: { ...scoresFor('Terror', 7), direcao: 3 }
  }, author.cookie);
  assert.equal(again.status, 201);
  assert.equal(again.body.id, take.id, 'a regravação deveria manter a mesma avaliação');

  const left = (await social()).body.votes.filter(v => v.reviewId === take.id);
  assert.equal(left.length, 1);
  assert.equal(left[0].value, 1);
});

test('a conversa sobrevive a uma regravação — foi para isso que a nota mudou', async () => {
  const author = await newReviewer();
  const reader = await newReviewer();
  const take = await newTake(author);
  await req('POST', at(`/social/reviews/${take.id}/comments`), { body: 'teu 7 em direção é generoso' }, reader.cookie);

  await req('POST', at('/reviews'), {
    movie: take.movie, scores: { ...scoresFor('Terror', 7), direcao: 3 }
  }, author.cookie);

  assert.equal((await social()).body.comments.filter(c => c.reviewId === take.id).length, 1);
});

test('comentar ou votar numa avaliação que não existe responde 404', async () => {
  const reader = await newReviewer();
  assert.equal(
    (await req('POST', at('/social/reviews/rnaoexiste/comments'), { body: 'oi' }, reader.cookie)).status, 404
  );
  assert.equal(
    (await req('PUT', at('/social/reviews/rnaoexiste/vote'), { value: 1 }, reader.cookie)).status, 404
  );
});
