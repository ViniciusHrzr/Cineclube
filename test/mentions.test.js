const test = require('node:test');
const assert = require('node:assert/strict');

const { handlesFor, mentionedIn } = require('../handles');

/* ══════════════════════════════════════════════════════════════════════════
   O apelido de menção.

   Duas propriedades sustentam a feature inteira, e as duas são sobre o CLUBE e
   não sobre a pessoa: o apelido tem de ser único, e tem de ser o que alguém
   digitaria com pressa no meio de uma frase.

   O resto destes testes é sobre não chamar quem não foi chamado. Um `@` num
   e-mail colado, um apelido que é prefixo de outro, um nome grudado em
   pontuação — cada um deles é uma forma de o sino tocar para a pessoa errada,
   que é o defeito que faz alguém desligar a notificação inteira.
   ══════════════════════════════════════════════════════════════════════════ */

const club = names => names.map((name, i) => ({ id: `p${i + 1}`, name }));
const handlesOf = names => Object.values(handlesFor(club(names)));

/* ── o apelido ───────────────────────────────────────────────────────── */

test('o apelido é o primeiro nome, sem acento e em minúsculas', () => {
  assert.deepEqual(handlesOf(['Beren Costa']), ['beren']);
  assert.deepEqual(handlesOf(['Sônia Braga']), ['sonia']);
  assert.deepEqual(handlesOf(['Gipico']), ['gipico']);
});

test('dois primeiros nomes iguais crescem até se separarem', () => {
  const h = handlesFor(club(['Bruno Sá', 'Bruno Lima']));
  assert.deepEqual(Object.values(h).sort(), ['brunolima', 'brunosa']);
});

test('quem não empata não cresce junto com quem empatou', () => {
  const h = handlesFor(club(['Bruno Sá', 'Bruno Lima', 'Ana Reis']));
  assert.equal(h.p3, 'ana', 'a Ana pagou o preço do empate dos Brunos');
});

test('um nome que é prefixo do outro não rouba o apelido dele', () => {
  // "Ana" sozinha e "Ana Reis" produzem "ana" nas duas rodadas se ninguém
  // olhar o que já foi entregue.
  const h = handlesFor(club(['Ana', 'Ana Reis']));
  const all = Object.values(h);
  assert.equal(new Set(all).size, 2, `apelidos repetidos: ${all}`);
});

test('nomes idênticos são separados pelo id, feio e sem colidir', () => {
  const h = handlesFor(club(['Bruno Sá', 'Bruno Sá']));
  const all = Object.values(h);
  assert.equal(new Set(all).size, 2, `apelidos repetidos: ${all}`);
});

test('o apelido é sempre digitável de um fôlego', () => {
  for (const handle of handlesOf(['Jean-Luc Godard', "Ana D'Ávila", 'José  da  Silva'])) {
    assert.match(handle, /^[a-z0-9]+$/, `"${handle}" tem caractere que atrapalha digitar`);
  }
});

test('um clube inteiro nunca tem dois apelidos iguais', () => {
  const nomes = ['Ana Reis', 'Ana Rita', 'Bruno Sá', 'Bruno Sá', 'Beren', 'Beren Costa', 'Gipico'];
  const all = Object.values(handlesFor(club(nomes)));
  assert.equal(new Set(all).size, nomes.length, `apelidos repetidos em ${all}`);
});

/* ── quem foi chamado ────────────────────────────────────────────────── */

const roster = handlesFor(club(['Ana Reis', 'Bruno Sá', 'Bruno Lima', 'Beren Costa']));
const called = text => mentionedIn(text, roster).sort();

test('chama quem foi escrito, no começo e no meio da frase', () => {
  assert.deepEqual(called('@beren o terceiro ato desmonta'), ['p4']);
  assert.deepEqual(called('acho que a @ana tem razão'), ['p1']);
});

test('chama duas pessoas na mesma frase', () => {
  assert.deepEqual(called('@beren e @ana, olhem isso'), ['p1', 'p4']);
});

test('não chama ninguém sem @', () => {
  assert.deepEqual(called('a beren falou isso ontem'), []);
});

test('um e-mail colado não chama ninguém', () => {
  // O caso que faz alguém desligar a notificação: um endereço no meio de um
  // comentário tocando o sino de quem não foi chamado.
  assert.deepEqual(called('manda pro ana@gmail.com'), []);
  assert.deepEqual(called('meu contato é bruno.sa@clube.com'), []);
});

test('o apelido maior ganha do menor que é prefixo dele', () => {
  // Sem isso "@brunosa" seria lido como "@bruno" — que nem existe — ou pior,
  // casaria com o Bruno errado.
  assert.deepEqual(called('@brunosa fechou'), ['p2']);
  assert.deepEqual(called('@brunolima discordo'), ['p3']);
});

test('o nome grudado em pontuação ainda conta', () => {
  assert.deepEqual(called('@beren, isso'), ['p4']);
  assert.deepEqual(called('(@beren)'), ['p4']);
  assert.deepEqual(called('foi isso, @beren.'), ['p4']);
});

test('acento e caixa não impedem de chamar', () => {
  const acentuado = handlesFor(club(['Sônia Braga']));
  assert.deepEqual(mentionedIn('@SONIA olha', acentuado), ['p1']);
  assert.deepEqual(mentionedIn('@sônia olha', acentuado), ['p1']);
});

test('um nome que só começa igual não é chamado', () => {
  assert.deepEqual(called('@anabela nem existe aqui'), []);
});

test('a mesma pessoa chamada duas vezes conta uma', () => {
  assert.deepEqual(called('@beren @beren @beren'), ['p4']);
});

test('texto sem @ nenhum sai cedo e responde vazio', () => {
  assert.deepEqual(called('um comentário comum, sem chamar ninguém'), []);
  assert.deepEqual(called(''), []);
  assert.deepEqual(mentionedIn(null, roster), []);
});
