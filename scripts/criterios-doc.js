/* ══════════════════════════════════════════════════════════════════════════
   Escreve criterios-cineclube.txt a partir de criteria.js.

       npm run doc:criterios

   O documento existia antes deste script e foi escrito à mão, o que só
   funciona enquanto ninguém mexe nos critérios. Ele diz de si mesmo que é
   "extraído de criteria.js, que é a fonte da verdade" — agora é verdade: nada
   aqui é digitado duas vezes, e um critério renomeado no código sai renomeado
   no texto na próxima rodada.

   Sai fora de app/ de propósito. É um documento para a mesa, não para o
   servidor: alguém do clube abre, lê e discorda, e para isso ele tem que estar
   onde as pessoas mexem e não dentro do código.
   ══════════════════════════════════════════════════════════════════════════ */

const fs = require('node:fs');
const path = require('node:path');

const {
  BASE, BASE_SWAP, GENRE_CRIT, GENRES, GENRE_PRIORITY, GENRE_TO_TMDB, TMDB_GENRE_MAP,
  PERSONAL_KEY, critsFor
} = require('../criteria');

const OUT = path.join(__dirname, '..', '..', 'criterios-cineclube.txt');
const RULE = '-'.repeat(78);
const HEAVY = '='.repeat(78);

/* Hard-wrapped rather than left to whatever opens it: this is a .txt, and a
   .txt that relies on the reader's window being wide is a .txt that reads
   differently for everybody. */
function wrap(text, width, indent) {
  const words = text.split(/\s+/);
  const lines = [];
  let line = '';
  for (const word of words) {
    if (line && (line + ' ' + word).length > width) {
      lines.push(line);
      line = word;
    } else {
      line = line ? line + ' ' + word : word;
    }
  }
  if (line) lines.push(line);
  return lines.map(l => indent + l).join('\n');
}

const out = [];
const say = (s = '') => out.push(s);

const today = new Date().toLocaleDateString('pt-BR');

say('CINECLUBE — CRITÉRIOS DE AVALIAÇÃO');
say(HEAVY);
say();
say('Gerado de app/criteria.js, que é a fonte da verdade: o servidor calcula');
say('a nota a partir exatamente destes critérios e destes pesos.');
say();
say(`Gerado em ${today} — não edite à mão, rode "npm run doc:criterios".`);
say();
say();
say('COMO A NOTA É CALCULADA');
say(RULE);
say();
say('    nota = média dos critérios que a ficha responde');
say();
say('    8 critérios de ofício   — como o filme é feito');
say('    2 critérios do gênero   — o que aquele tipo de filme pede');
say('    1 critério pessoal      — o quanto você aproveitou');
say('                             --');
say('    11 perguntas, todas com o mesmo peso');
say();
say('Cada critério vai de 0 a 10, em passos de 0,5. Um card cheio de 10 dá 10,0;');
say('um card cheio de 0 dá 0,0.');
say();
say('Até 25/08/2026 os dois critérios do gênero pesavam o dobro e o divisor era');
say('a constante 12. O peso duplo era uma afirmação que nunca foi medida — que o');
say('que um gênero é PARA vale duas vezes o como o filme é feito — e ele decidia');
say('em silêncio toda discussão do clube. Os pesos foram igualados para ver o');
say('acervo sem ele. Os critérios por gênero continuam: qual par é perguntado');
say('ainda depende do filme, e essa sempre foi a metade mais interessante.');
say();
say('O divisor é contado e não constante. Uma avaliação gravada antes de');
say('Aproveitamento existir tem dez marcas, e a décima primeira não é um zero —');
say('é uma pergunta que ninguém fez. Ela é dividida por dez, uma nova por onze,');
say('e as duas são médias na mesma escala de 0 a 10.');
say();
say();
say('A BASE — as nove perguntas padrão');
say(RULE);
say();
say(wrap(
  'Valem para todo filme, com duas exceções declaradas mais abaixo: animação e ' +
  'documentário trocam alguma destas perguntas por outra, porque a original não ' +
  'tem do que falar naquele gênero. A última é a única que não pergunta sobre o ' +
  'filme, e nenhum gênero pode trocá-la.', 76, ''
));
say();

BASE.forEach(([key, name, hint], i) => {
  const mark = key === PERSONAL_KEY ? '   ← o pessoal, e o último do card' : '';
  say(` ${String(i + 1).padStart(2)}. ${name}${mark}`);
  say(`     [${key}]`);
  say(wrap(hint, 71, '     '));
  say();
});

say();
say('O QUE CADA GÊNERO TROCA NA BASE');
say(RULE);
say();
say(wrap(
  'Uma troca substitui um slot no lugar: a base continua com oito perguntas, na ' +
  'mesma ordem. Onde só o nome muda, a chave é a mesma e o histórico continua ' +
  'valendo; onde a chave muda, o registro antigo precisa da migração ' +
  '(npm run migrate:criterios).', 76, ''
));
say();

for (const [genre, swap] of Object.entries(BASE_SWAP)) {
  say(genre.toUpperCase());
  for (const [slot, [key, name, hint]] of Object.entries(swap)) {
    const from = BASE.find(t => t[0] === slot);
    const how = key === slot ? 'mesma chave, outro enunciado' : `chave nova — era [${slot}]`;
    say(`  · ${from[1]}  ⇒  ${name}   (${how})`);
    say(`    [${key}]`);
    say(wrap(hint, 72, '    '));
    say();
  }
}

say();
say('POR GÊNERO — os dois critérios que o filme escolhe');
say(RULE);
say();
say(wrap(
  `São ${GENRES.length} gêneros. O gênero vem do TMDB e é confirmado por quem avalia; ` +
  'ele decide qual destes pares entra no fim do card.', 76, ''
));
say();

for (const genre of GENRES) {
  say(genre.toUpperCase());
  GENRE_CRIT[genre].forEach(([key, name, hint], i) => {
    say(`  ${9 + i}. ${name}`);
    say(`     [${key}]`);
    say(wrap(hint, 71, '     '));
  });
  say();
}

say();
say('APÊNDICE — COMO O GÊNERO DE UM FILME É DECIDIDO');
say(RULE);
say();
say(wrap(
  'Um filme quase sempre chega do TMDB com vários gêneros. A ordem abaixo é a ' +
  'prioridade do clube: o primeiro gênero desta lista que o filme carregar é o ' +
  'que o card abre. Quem avalia pode trocar. Drama é o último de propósito — é ' +
  'a palavra mais larga e também o destino de tudo que não é reconhecido.', 76, ''
));
say();
GENRE_PRIORITY.forEach((genre, i) => {
  const ids = Object.entries(TMDB_GENRE_MAP)
    .filter(([, g]) => g === genre)
    .map(([id]) => id)
    .join(', ');
  say(`   ${String(i + 1).padStart(2)}. ${genre.padEnd(20)} ids TMDB: ${ids}`);
});
say();
say('E para o botão de cada gênero no catálogo (o "descobrir" do TMDB):');
say();
for (const [genre, ids] of Object.entries(GENRE_TO_TMDB)) {
  say(`     ${genre.padEnd(20)} ${ids}`);
}
say();
say();
say('PARA A REVISÃO');
say(RULE);
say();
say('Três coisas mexem no resultado se forem alteradas:');
say();
say('  · O NOME de um critério é só rótulo — trocar não afeta nada já gravado.');
say('  · A DESCRIÇÃO idem: é o que a pessoa lê antes de dar a nota.');
say('  · A CHAVE entre colchetes é o que fica guardado no banco. Trocar uma');
say('    chave faz as avaliações antigas perderem aquele critério, a menos que');
say('    a renomeação entre em scripts/migrate-criteria-keys.js. Existe um teste');
say('    que trava uma troca de chave sem a migração correspondente.');
say();
say(wrap(
  'E o número de critérios: são 8 de ofício, 2 do gênero e 1 pessoal, em todo ' +
  'gênero. O divisor não é constante — é a soma dos pesos que a ficha responde — ' +
  'então acrescentar um critério não muda a escala das notas antigas, mas muda a ' +
  'das novas. Um teste trava a contagem e os grupos, inclusive a regra de que uma ' +
  'troca na base substitui um slot em vez de somar um.', 76, ''
));
say();

/* One last check against the thing the document is about, in case the shape
   ever drifts from what the prose above claims. */
for (const genre of GENRES) {
  const cs = critsFor(genre);
  const total = cs.reduce((sum, c) => sum + c.w, 0);
  if (total !== 11) throw new Error(`${genre} soma ${total} pesos — o texto diria uma mentira`);
}

/* With a BOM, and CRLF. The file the club opens is opened on Windows, by
   double-clicking it, and a UTF-8 .txt with neither is a file full of Ã‡ in
   half the editors that exist. Nothing reads this programmatically, so the
   only audience is the one that needs it spelled out. */
fs.writeFileSync(OUT, '﻿' + out.join('\r\n'), 'utf8');
console.log(`[critérios] escrito em ${OUT}`);
