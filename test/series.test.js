const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const dbPath = path.join(os.tmpdir(), `cineclube-series-${crypto.randomUUID()}.db`);
process.env.CINECLUBE_DB = dbPath;

const app = require('../server');
const db = require('../lib/db');
const live = require('../lib/live');
const screening = require('../lib/screening');
const kit = require('../lib/testkit');
const { seasonCritsFor, seasonFinalOf, GENRE, CRAFT, PERSONAL } = require('../rules/criteria');
const { genresFromTvIds, signedBy } = require('../tmdb/series');
const upnext = require('../tmdb/upnext');

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
  const closed = new Promise(resolve => server.close(resolve));
  server.closeAllConnections?.();
  await closed;
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
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let parsed = null;
  try { parsed = text ? JSON.parse(text) : null; } catch { parsed = null; }
  return { status: res.status, body: parsed };
}

let seq = 0;
const at = (club, p) => `/api/c/${club.slug}${p}`;
const show = title => ({
  id: 800000 + ++seq,
  title: title || `Série ${seq}`,
  year: 2023,
  genre: 'Drama',
  poster: `/s/${seq}.jpg`,
});

function scoresFor(genre, value) {
  const o = {};
  seasonCritsFor(genre).forEach(c => { o[c.key] = value; });
  return o;
}

test('a ficha de uma temporada tem nove critérios e nenhum é do gênero', () => {
  for (const genre of ['Drama', 'Terror', 'Comédia', 'Animação', 'Documentário']) {
    const crits = seasonCritsFor(genre);
    assert.equal(crits.length, 9, `${genre} deveria perguntar nove`);
    assert.equal(
      crits.filter(c => c.group === GENRE).length, 0,
      `${genre} vazou um critério de gênero para a ficha de temporada`
    );
  }
});

test('o gênero troca o objeto de uma pergunta, nunca acrescenta uma', () => {
  const drama = seasonCritsFor('Drama').map(c => c.key);
  const anima = seasonCritsFor('Animação').map(c => c.key);
  const doc = seasonCritsFor('Documentário').map(c => c.key);

  assert.ok(drama.includes('atuacoes'));
  assert.ok(anima.includes('vozes'));
  assert.ok(!anima.includes('atuacoes'));
  assert.ok(doc.includes('material'));
  assert.ok(doc.includes('acesso'));
  assert.equal(anima.length, 9);
  assert.equal(doc.length, 9);
});

test('o Aproveitamento é o último, e é o único pessoal', () => {
  const crits = seasonCritsFor('Drama');
  assert.equal(crits[crits.length - 1].key, 'aproveitamento');
  assert.equal(crits[crits.length - 1].group, PERSONAL);
  assert.equal(crits.filter(c => c.group === CRAFT).length, 8);
});

test('o divisor é contado, então uma ficha parcial não é punida', () => {
  assert.equal(seasonFinalOf('Drama', scoresFor('Drama', 8)), 8);
  assert.equal(seasonFinalOf('Drama', { direcao: 8, roteiro: 8 }), 8);
  assert.equal(seasonFinalOf('Drama', { direcao: 0, roteiro: 10 }), 5);
  assert.equal(seasonFinalOf('Drama', {}), 0);
});

const temporadas = [{ season: 1, episodes: 3 }, { season: 2, episodes: 2 }];
const epsDe = (season, ...datas) =>
  datas.map((airDate, i) => ({ season, episode: i + 1, title: `E${i + 1}`, airDate }));
const vistos = (...chaves) => new Set(chaves);

test('o próximo é o primeiro que falta, e ele tem nome', () => {
  const shape = { seasons: temporadas, nextAir: null };
  const eps = epsDe(1, '2020-01-01', '2020-01-08', '2020-01-15');

  const zerado = upnext.decide(shape, vistos(), eps, '2026-09-12');
  assert.equal(zerado.next.episode, 1);
  assert.equal(zerado.next.title, 'E1');
  assert.equal(zerado.caughtUp, false);

  const meio = upnext.decide(shape, vistos('1x1', '1x2'), eps, '2026-09-12');
  assert.equal(meio.next.episode, 3, 'o buraco é no terceiro');
});

test('uma temporada inteira marcada não é o lugar de procurar', () => {
  const shape = { seasons: temporadas, nextAir: null };
  const pend = upnext.pendingSeason(temporadas, vistos('1x1', '1x2', '1x3'));
  assert.equal(pend.season, 2);

  const eps = epsDe(2, '2021-01-01', '2021-01-08');
  const got = upnext.decide(shape, vistos('1x1', '1x2', '1x3'), eps, '2026-09-12');
  assert.equal(got.next.season, 2);
  assert.equal(got.next.episode, 1);
});

test('o que ainda não foi ao ar vira estreia, e não pendência', () => {
  const shape = { seasons: [{ season: 1, episodes: 2 }], nextAir: null };
  const eps = epsDe(1, '2020-01-01', '2030-01-01');

  const got = upnext.decide(shape, vistos('1x1'), eps, '2026-09-12');
  assert.equal(got.next, null);
  assert.equal(got.upcoming.episode, 2);
  assert.equal(got.caughtUp, true, 'quem viu tudo o que estreou está em dia');
});

test('em dia numa série no ar, a resposta é quando vem o próximo', () => {
  const nextAir = { season: 3, episode: 1, title: 'Volta', airDate: '2026-10-01' };
  const shape = { seasons: temporadas, nextAir };
  const tudo = vistos('1x1', '1x2', '1x3', '2x1', '2x2');

  const got = upnext.decide(shape, tudo, [], '2026-09-12');
  assert.equal(got.next, null);
  assert.deepEqual(got.upcoming, nextAir);
  assert.equal(got.caughtUp, true);
});

test('em dia numa série que acabou, não há nada a dizer', () => {
  const shape = { seasons: temporadas, nextAir: null };
  const got = upnext.decide(shape, vistos('1x1', '1x2', '1x3', '2x1', '2x2'), [], '2026-09-12');
  assert.equal(got.next, null);
  assert.equal(got.upcoming, null);
  assert.equal(got.caughtUp, true);
});

test('sem a lista da temporada, o número responde e a estreia corrige', () => {
  const shape = { seasons: [{ season: 1, episodes: 3 }], nextAir: null };
  const cego = upnext.decide(shape, vistos('1x1'), [], '2026-09-12');
  assert.equal(cego.next.episode, 2);
  assert.equal(cego.next.title, null);

  const nextAir = { season: 1, episode: 2, title: 'Ainda vem', airDate: '2026-12-01' };
  const corrigido = upnext.decide({ ...shape, nextAir }, vistos('1x1'), [], '2026-09-12');
  assert.equal(corrigido.next, null, 'o que ainda não estreou não pode ser pendência');
  assert.deepEqual(corrigido.upcoming, nextAir);
});

test('sem inventário, o produto cala em vez de chutar', () => {
  const got = upnext.decide(null, vistos(), [], '2026-09-12');
  assert.equal(got.next, null);
  assert.equal(got.upcoming, null);
  assert.equal(got.caughtUp, false);
});

test('os gêneros de TV não são os de cinema', () => {
  assert.deepEqual(genresFromTvIds([10765]), ['Ficção científica']);
  assert.deepEqual(genresFromTvIds([10759]), ['Ação']);
  assert.deepEqual(genresFromTvIds([28]), ['Drama'], 'id de filme deveria cair no balde');
});

test('Drama só ganha quando nada mais específico foi oferecido', () => {
  assert.equal(genresFromTvIds([18, 10765])[0], 'Ficção científica');
  assert.equal(genresFromTvIds([18, 99])[0], 'Documentário');
  assert.deepEqual(genresFromTvIds([]), ['Drama']);
  assert.deepEqual(genresFromTvIds(undefined), ['Drama']);
});

test('a assinatura é do episódio, e não do elenco fixo da série', () => {
  const crew = [
    { job: 'Director', name: 'Rian Johnson' },
    { job: 'Writer', name: 'Moira Walley-Beckett' },
    { job: 'Director of Photography', name: 'Michael Slovis' },
  ];
  const assinado = signedBy(crew, [{ name: 'Convidada' }]);
  assert.deepEqual(assinado.direcao, ['Rian Johnson']);
  assert.deepEqual(assinado.roteiro, ['Moira Walley-Beckett']);
  assert.deepEqual(assinado.atuacoes, ['Convidada']);
  assert.equal(assinado.fotografia, undefined);
});

test('um episódio sem convidado não recebe a chave, em vez de recebê-la vazia', () => {
  const assinado = signedBy([{ job: 'Director', name: 'Alguém' }], []);
  assert.equal(assinado.atuacoes, undefined);
});

test('pôr uma série na fila e tirá-la', async () => {
  const dono = await kit.signIn();
  const club = await kit.makeClub({ owner: dono.id });
  const s = show('Severance');

  const posto = await req('POST', at(club, '/shows'), { show: s }, dono.cookie);
  assert.equal(posto.status, 201);

  const lista = await req('GET', at(club, '/shows'), null, dono.cookie);
  assert.equal(lista.body.shows.length, 1);
  assert.equal(lista.body.shows[0].title, 'Severance');
  assert.equal(lista.body.shows[0].seen, 0);
  assert.deepEqual(lista.body.shows[0].wanters, [dono.id]);

  const tirado = await req('DELETE', at(club, `/shows/${s.id}`), null, dono.cookie);
  assert.equal(tirado.status, 204);
  const vazia = await req('GET', at(club, '/shows'), null, dono.cookie);
  assert.equal(vazia.body.shows.length, 0);
});

test('tirar da fila é de quem pôs', async () => {
  const dono = await kit.signIn();
  const outra = await kit.signIn();
  const club = await kit.makeClub({ owner: dono.id });
  await kit.join(club.id, outra.id);
  const s = show();

  await req('POST', at(club, '/shows'), { show: s }, outra.cookie);
  const pelaOutra = await req('DELETE', at(club, `/shows/${s.id}`), null, dono.cookie);
  assert.equal(pelaOutra.status, 204);
});

test('duas pessoas acompanham a mesma série sem duplicar o cartaz', async () => {
  const dono = await kit.signIn();
  const outra = await kit.signIn();
  const club = await kit.makeClub({ owner: dono.id });
  await kit.join(club.id, outra.id);
  const s = show();

  await req('POST', at(club, '/shows'), { show: s }, dono.cookie);
  await req('POST', at(club, '/shows'), { show: s }, outra.cookie);

  const { body } = await req('GET', at(club, '/shows'), null, dono.cookie);
  assert.equal(body.shows.length, 1, 'a mesma série apareceu duas vezes na lista');
  assert.deepEqual(body.shows[0].wanters.slice().sort(), [dono.id, outra.id].sort());
});

test('pôr a mesma série duas vezes é uma linha só', async () => {
  const dono = await kit.signIn();
  const club = await kit.makeClub({ owner: dono.id });
  const s = show();

  await req('POST', at(club, '/shows'), { show: s }, dono.cookie);
  await req('POST', at(club, '/shows'), { show: s }, dono.cookie);

  const { body } = await req('GET', at(club, '/shows'), null, dono.cookie);
  assert.equal(body.shows.length, 1);
  assert.deepEqual(body.shows[0].wanters, [dono.id]);
});

test('quem desiste de uma série leva só o próprio acompanhar', async () => {
  const dono = await kit.signIn();
  const outra = await kit.signIn();
  const club = await kit.makeClub({ owner: dono.id });
  await kit.join(club.id, outra.id);
  const s = show();

  await req('POST', at(club, '/shows'), { show: s }, dono.cookie);
  await req('POST', at(club, '/shows'), { show: s }, outra.cookie);

  assert.equal((await req('DELETE', at(club, `/shows/${s.id}`), null, outra.cookie)).status, 204);

  const { body } = await req('GET', at(club, '/shows'), null, dono.cookie);
  assert.equal(body.shows.length, 1, 'a série saiu da lista de quem ainda a acompanhava');
  assert.deepEqual(body.shows[0].wanters, [dono.id]);

  assert.equal((await req('DELETE', at(club, `/shows/${s.id}`), null, dono.cookie)).status, 204);
  const depois = await req('GET', at(club, '/shows'), null, dono.cookie);
  assert.equal(depois.body.shows.length, 0, 'o cartaz ficou sem ninguém o acompanhando');
});

test('ninguém tira da lista a série que só outra pessoa acompanha', async () => {
  const dono = await kit.signIn();
  const quemPos = await kit.signIn('Quem Pos');
  const terceira = await kit.signIn();
  const club = await kit.makeClub({ owner: dono.id });
  await kit.join(club.id, quemPos.id);
  await kit.join(club.id, terceira.id);
  const s = show();

  await req('POST', at(club, '/shows'), { show: s }, quemPos.cookie);

  const recusado = await req('DELETE', at(club, `/shows/${s.id}`), null, terceira.cookie);
  assert.equal(recusado.status, 403);
  assert.match(recusado.body.error, /Quem Pos/);

  const { body } = await req('GET', at(club, '/shows'), null, dono.cookie);
  assert.equal(body.shows.length, 1, 'a lista perdeu uma série que ninguém tinha direito de tirar');
});

test('marcar visto grava a linha sem nota nenhuma', async () => {
  const p = await kit.signIn();
  const club = await kit.makeClub({ owner: p.id });
  const s = show();

  const marcado = await req(
    'PUT', at(club, `/shows/${s.id}/2/5`),
    { showTitle: s.title, showPoster: s.poster, genre: 'Drama', episodeTitle: 'Ozymandias' },
    p.cookie
  );
  assert.equal(marcado.status, 201);
  assert.equal(marcado.body.take.kind, 'episode');
  assert.equal(marcado.body.take.final, null, 'visto não é uma nota');
  assert.equal(marcado.body.take.quick, null);
  assert.equal(marcado.body.take.scores, null);
  assert.equal(marcado.body.take.episodeTitle, 'Ozymandias');
});

test('um episódio não recebe nota', async () => {
  const p = await kit.signIn();
  const club = await kit.makeClub({ owner: p.id });
  const s = show();
  const url = at(club, `/shows/${s.id}/1/1`);
  const base = { showTitle: s.title, genre: 'Drama' };

  assert.equal((await req('PUT', url, { ...base, quick: 8 }, p.cookie)).status, 400);
  assert.equal(
    (await req('PUT', url, { ...base, scores: scoresFor('Drama', 8) }, p.cookie)).status, 400
  );

  const acervo = await req('GET', at(club, '/shows/takes'), null, p.cookie);
  assert.equal(acervo.body.takes.length, 0, 'a recusa não podia deixar linha nenhuma');
});

test('a nota rápida é uma nota, e a criteriosa a substitui', async () => {
  const p = await kit.signIn();
  const club = await kit.makeClub({ owner: p.id });
  const s = show();
  const url = at(club, `/shows/${s.id}/1`);
  const base = { showTitle: s.title, genre: 'Drama' };

  const rapida = await req('PUT', url, { ...base, quick: 7.5 }, p.cookie);
  assert.equal(rapida.body.take.kind, 'season');
  assert.equal(rapida.body.take.episode, null, 'uma ficha de temporada não fala de um episódio');
  assert.equal(rapida.body.take.quick, 7.5);
  assert.equal(rapida.body.take.final, 7.5);
  assert.equal(rapida.body.take.scores, null);

  const criteriosa = await req(
    'PUT', url, { ...base, scores: scoresFor('Drama', 9) }, p.cookie
  );
  assert.equal(criteriosa.status, 200, 'regravar não cria uma segunda linha');
  assert.equal(criteriosa.body.take.final, 9);
  assert.equal(
    criteriosa.body.take.quick, null,
    'a rápida tem de sumir: a linha não pode carregar duas respostas'
  );
  assert.equal(Object.keys(criteriosa.body.take.scores).length, 9);
});

test('uma avaliação de temporada sem nota é recusada', async () => {
  const p = await kit.signIn();
  const club = await kit.makeClub({ owner: p.id });
  const s = show();

  const vazia = await req(
    'PUT', at(club, `/shows/${s.id}/1`),
    { showTitle: s.title, genre: 'Drama', comment: 'só passando' },
    p.cookie
  );
  assert.equal(vazia.status, 400);
});

test('o id da linha sobrevive a uma regravação', async () => {
  const p = await kit.signIn();
  const club = await kit.makeClub({ owner: p.id });
  const s = show();
  const url = at(club, `/shows/${s.id}/2`);
  const base = { showTitle: s.title, genre: 'Drama' };

  const primeiro = await req('PUT', url, { ...base, quick: 5 }, p.cookie);
  const segundo = await req('PUT', url, { ...base, quick: 9 }, p.cookie);
  assert.equal(primeiro.body.take.id, segundo.body.take.id);
});

test('uma chave que este gênero não pergunta não entra na linha', async () => {
  const p = await kit.signIn();
  const club = await kit.makeClub({ owner: p.id });
  const s = show();

  const gravado = await req(
    'PUT', at(club, `/shows/${s.id}/3`),
    {
      showTitle: s.title,
      genre: 'Drama',
      scores: { direcao: 8, atmosfera: 10, inventado: 3 },
    },
    p.cookie
  );
  assert.deepEqual(Object.keys(gravado.body.take.scores), ['direcao']);
  assert.equal(gravado.body.take.final, 8);
});

test('uma nota fora da régua é recusada', async () => {
  const p = await kit.signIn();
  const club = await kit.makeClub({ owner: p.id });
  const s = show();
  const url = at(club, `/shows/${s.id}/4`);
  const base = { showTitle: s.title, genre: 'Drama' };

  assert.equal((await req('PUT', url, { ...base, quick: 11 }, p.cookie)).status, 400);
  assert.equal((await req('PUT', url, { ...base, quick: -1 }, p.cookie)).status, 400);
  assert.equal((await req('PUT', url, { ...base, scores: { direcao: 99 } }, p.cookie)).status, 400);
});

test('desmarcar apaga a linha, porque a linha é o "eu vi"', async () => {
  const p = await kit.signIn();
  const club = await kit.makeClub({ owner: p.id });
  const s = show();
  const url = at(club, `/shows/${s.id}/3/7`);

  await req('PUT', url, { showTitle: s.title, genre: 'Drama' }, p.cookie);
  assert.equal((await req('DELETE', url, null, p.cookie)).status, 204);

  const acervo = await req('GET', at(club, '/shows/takes'), null, p.cookie);
  assert.equal(acervo.body.takes.length, 0);
});

test('apagar a nota da temporada não desmarca episódio nenhum', async () => {
  const p = await kit.signIn();
  const club = await kit.makeClub({ owner: p.id });
  const s = show();
  const base = { showTitle: s.title, genre: 'Drama' };

  await req('PUT', at(club, `/shows/${s.id}/1/1`), base, p.cookie);
  await req('PUT', at(club, `/shows/${s.id}/1`), { ...base, quick: 9 }, p.cookie);

  assert.equal((await req('DELETE', at(club, `/shows/${s.id}/1`), null, p.cookie)).status, 204);

  const acervo = await req('GET', at(club, '/shows/takes'), null, p.cookie);
  assert.equal(acervo.body.takes.length, 1);
  assert.equal(acervo.body.takes[0].kind, 'episode');
  assert.equal(acervo.body.takes[0].episode, 1);
});

test('o progresso do clube conta episódio distinto, não linha', async () => {
  const a = await kit.signIn();
  const b = await kit.signIn();
  const club = await kit.makeClub({ owner: a.id });
  await kit.join(club.id, b.id);
  const s = show();

  await req('POST', at(club, '/shows'), { show: s }, a.cookie);
  const body = { showTitle: s.title, genre: 'Drama' };
  await req('PUT', at(club, `/shows/${s.id}/1/1`), body, a.cookie);
  await req('PUT', at(club, `/shows/${s.id}/1/1`), body, b.cookie);
  await req('PUT', at(club, `/shows/${s.id}/1/2`), body, a.cookie);
  await req('PUT', at(club, `/shows/${s.id}/1`), { ...body, quick: 10 }, a.cookie);
  await req('PUT', at(club, `/shows/${s.id}/1`), { ...body, quick: 8 }, b.cookie);

  const fila = await req('GET', at(club, '/shows'), null, a.cookie);
  assert.equal(fila.body.shows[0].seen, 2, 'a ficha da temporada não é um episódio visto');
  assert.equal(fila.body.shows[0].rated, 1, 'só uma temporada ganhou nota');
  assert.equal(fila.body.shows[0].average, 9);
});

test('o acervo de séries de um clube fechado não existe para quem não é dele', async () => {
  const dono = await kit.signIn();
  const estranho = await kit.signIn();
  const club = await kit.makeClub({ owner: dono.id, visibility: 'private' });
  const s = show();

  await req('POST', at(club, '/shows'), { show: s }, dono.cookie);
  await req('PUT', at(club, `/shows/${s.id}/1`), { showTitle: s.title, genre: 'Drama', quick: 9 }, dono.cookie);

  const lido = await req('GET', at(club, '/shows/takes'), null, estranho.cookie);
  assert.equal(lido.status, 403);

  const escrito = await req(
    'PUT', at(club, `/shows/${s.id}/2`),
    { showTitle: s.title, genre: 'Drama', quick: 1 }, estranho.cookie
  );
  assert.ok(escrito.status >= 400, 'quem não é do clube não escreve nele');
});

test('a mesma pessoa acompanha a mesma série em dois clubes, separadamente', async () => {
  const p = await kit.signIn();
  const um = await kit.makeClub({ owner: p.id });
  const outro = await kit.makeClub({ owner: p.id });
  const s = show();
  const body = { showTitle: s.title, genre: 'Drama' };

  await req('PUT', at(um, `/shows/${s.id}/1`), { ...body, quick: 10 }, p.cookie);
  await req('PUT', at(outro, `/shows/${s.id}/1`), { ...body, quick: 4 }, p.cookie);

  const noUm = await req('GET', at(um, '/shows/takes'), null, p.cookie);
  const noOutro = await req('GET', at(outro, '/shows/takes'), null, p.cookie);
  assert.equal(noUm.body.takes.length, 1);
  assert.equal(noOutro.body.takes.length, 1);
  assert.equal(noUm.body.takes[0].final, 10);
  assert.equal(noOutro.body.takes[0].final, 4);
});

test('a rota de critérios entrega nove por gênero', async () => {
  const { status, body } = await req('GET', '/api/series/criteria');
  assert.equal(status, 200);
  for (const genre of body.genres) {
    assert.equal(body.criteria[genre].length, 9, `${genre} deveria vir com nove`);
  }
});

test('a linha de "viu" aponta a marca mais nova da sessão', async () => {
  const p = await kit.signIn();
  const club = await kit.makeClub({ owner: p.id });
  const s = show();
  const base = { showTitle: s.title, genre: 'Drama' };

  await req('PUT', at(club, `/shows/${s.id}/1/1`), base, p.cookie);
  await req('PUT', at(club, `/shows/${s.id}/1/2`), base, p.cookie);

  const mural = await req('GET', at(club, '/shows-feed'), null, p.cookie);
  const vistos = mural.body.items.filter(i => i.kind === 'seen');
  assert.equal(vistos.length, 1);
  assert.equal(vistos[0].count, 2);

  const acervo = await req('GET', at(club, '/shows/takes'), null, p.cookie);
  const segundo = acervo.body.takes.find(t => t.episode === 2);
  assert.equal(vistos[0].takeId, segundo.id);
});
