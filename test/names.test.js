const test = require('node:test');
const assert = require('node:assert/strict');

const { englishOf } = require('../tmdb');

/* ── os nomes por que um filme pode ser procurado ─────────────────────────
   Três telas filtram uma lista lida do banco, e o que o banco não guardou é o
   que a busca não acha. A regra que decide o que vale guardar é esta função, e
   ela existe para um caso só — o filme cujo nome em inglês não é nenhum dos
   outros dois — porque guardar um terceiro nome igual aos anteriores é ocupar
   uma coluna para não dizer nada.

   As formas abaixo são as que o TMDB manda de verdade: `translations` é um
   envelope com uma lista dentro, cada item com o código da língua fora e o
   título dentro de `data`. */

const en = title => ({ translations: [{ iso_639_1: 'en', data: { title } }] });
const withOthers = title => ({
  translations: [
    { iso_639_1: 'fr', data: { title: 'Parasite (français)' } },
    { iso_639_1: 'en', data: { title } },
    { iso_639_1: 'de', data: { title: 'Parasite (deutsch)' } }
  ]
});

test('o nome em inglês vale quando não é nenhum dos outros dois', () => {
  const parasita = { title: 'Parasita', original_title: '기생충' };
  assert.equal(englishOf(parasita, en('Parasite')), 'Parasite');
});

test('achado no meio das outras línguas, não só quando é o primeiro', () => {
  const parasita = { title: 'Parasita', original_title: '기생충' };
  assert.equal(englishOf(parasita, withOthers('Parasite')), 'Parasite');
});

test('repetir o título em português não é um nome novo', () => {
  const interstellar = { title: 'Interstellar', original_title: 'Interstellar' };
  assert.equal(englishOf(interstellar, en('Interstellar')), null);
});

test('repetir o título original também não', () => {
  // Knives Out: o original já é o nome em inglês, e ele já está guardado.
  const facas = { title: 'Entre Facas e Segredos', original_title: 'Knives Out' };
  assert.equal(englishOf(facas, en('Knives Out')), null);
});

test('um filme sem tradução para o inglês responde null', () => {
  const filme = { title: 'Bacurau', original_title: 'Bacurau' };
  assert.equal(englishOf(filme, { translations: [{ iso_639_1: 'fr', data: { title: 'Bacurau' } }] }), null);
});

test('uma tradução vazia é o mesmo que não ter tradução', () => {
  const filme = { title: 'Cidade de Deus', original_title: 'Cidade de Deus' };
  assert.equal(englishOf(filme, en('')), null);
});

test('sem o envelope de traduções nada explode', () => {
  const filme = { title: 'Cidade de Deus', original_title: 'Cidade de Deus' };
  // Isto é o que chega quando o append_to_response falha ou é omitido, e a
  // ficha do filme não pode cair por causa de uma coluna de busca.
  assert.equal(englishOf(filme, undefined), null);
  assert.equal(englishOf(filme, {}), null);
});
