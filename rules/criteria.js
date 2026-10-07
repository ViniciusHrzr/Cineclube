const BASE = [
  ['direcao', 'Direção',
    'A encenação: onde os corpos ficam no espaço, o que entra no quadro e o que fica de fora, e quanto tempo a cena aguenta antes do corte. Dirigir é decidir para onde se olha — e a decisão aparece na tela mesmo quando ninguém a anuncia.'],
  ['roteiro', 'Roteiro',
    'Causa e consequência: se cada cena acontece porque a anterior aconteceu, e não porque estava na hora. Gente querendo coisas, esbarrando em quem quer outra, e pagando. E se o fim fecha o que o começo abriu — ou deixa aberto de propósito.'],
  ['fotografia', 'Fotografia',
    'Luz, lente, cor e enquadramento — e o que a câmera escolhe deixar em foco. Profundidade de campo entrega a cena inteira e deixa você escolher onde olhar; foco seletivo escolhe por você. Bonito não basta: feio de propósito e sustentado pontua alto.'],
  ['montagem', 'Montagem',
    'Onde o corte cai, o que ele junta e o que ele esconde: continuidade, ritmo, elipse e a ordem em que a informação chega. A pergunta prática é se você sempre sabe onde está — e se o filme cortou porque a cena acabou ou para não ter de mostrar.'],
  ['som', 'Som & Trilha',
    'Desenho sonoro, mixagem, fala e silêncio. O som é o que constrói o fora de campo: o que você ouve sem ver. E a trilha — ela sustenta a cena ou faz o trabalho no lugar dela, mandando sentir antes de a cena ter merecido?'],
  ['arte', 'Direção de Arte',
    'Cenário, objeto, figurino e maquiagem construindo um mundo que parece ter existido antes da primeira cena e continuar depois da última — e que conta quem mora nele sem ninguém precisar explicar.'],
  ['atuacoes', 'Atuações',
    'Corpo, voz, escuta. Se o elenco está todo no mesmo filme, se o tom de cada um serve ao que o filme é, e se o rosto aguenta o close quando não há fala para segurar a cena.'],
  ['originalidade', 'Originalidade',
    'O que aqui não veio de outro lugar — ideia, forma ou ponto de vista próprios. Gênero é repertório, não defeito: clichê usado com consciência conta a favor; clichê usado por falta de ideia, contra.'],
  ['aproveitamento', 'Aproveitamento',
    'O seu, e só o seu: o quanto você aproveitou esse filme. Não é o quanto ele é bom — é se você ficou feliz de ter assistido. Aqui vale gostar do que não se defende e não gostar do que é irretocável; é o único critério em que o argumento é você.']
];

const BASE_SWAP = {
  'Animação': {
    atuacoes: ['vozes', 'Vozes',
      'O elenco de voz: entrega, timing e casting, e o quanto a voz e o desenho parecem a mesma criatura. A fala foi gravada antes de o personagem existir, e o movimento foi construído em cima dela — quando dá certo, não dá para imaginar outra voz ali.']
  },
  'Documentário': {
    roteiro: ['roteiro', 'Estrutura',
      'Um documentário também é construído: o recorte, a ordem em que os fatos chegam, o que entra e o que ficou de fora. Não houve roteiro antes — há uma forma, e ela é uma escolha tanto quanto qualquer outra.'],
    arte: ['material', 'Material & arquivo',
      'O que não foi filmado agora: arquivo, imagem de terceiros, documento, gráfico, reconstituição. A qualidade do material e, principalmente, se o filme deixa claro o que é o quê — reconstituição que se disfarça de arquivo é mentira com boa fotografia.'],
    atuacoes: ['acesso', 'Acesso & presença',
      'Até onde o filme conseguiu chegar: a confiança de quem está sendo filmado, o que essas pessoas entregam diante da câmera e as cenas que só existem porque alguém estava lá naquele dia, com a câmera ligada.']
  }
};

const GENRE_CRIT = {
  'Terror': [
    ['atmosfera', 'Atmosfera',
      'O clima que o filme sustenta quando nada está acontecendo: o espaço, o silêncio, a sensação de que aquele lugar não quer você ali. Metade disso é o que está fora do quadro e ainda não foi mostrado. É o que continua depois que o susto passa.'],
    ['terror', 'A ameaça',
      'A eficácia do que o filme põe contra a normalidade, e se aquilo é perigoso e perturbador ao mesmo tempo — as duas coisas, não só uma. Susto é reflexo e qualquer filme arranca; medo é o que fica depois de acender a luz.']
  ],
  'Suspense': [
    ['informacao', 'Dosagem da informação',
      'Quem sabe o quê, e quando: o público na frente do personagem, atrás dele ou junto. Mostre a bomba debaixo da mesa e uma conversa banal vira quinze minutos de tensão; esconda e são quinze segundos de susto. Vale para a revelação também — as peças estavam na tela?'],
    ['tensao', 'Tensão',
      'A corda esticada e por quanto tempo ela aguenta: expectativa, adiamento, o silêncio antes e o alívio na hora certa. Um filme tenso não é o que assusta, é o que não deixa relaxar.']
  ],
  'Drama': [
    ['densidade', 'Verdade dos conflitos',
      'O peso real das escolhas: gente querendo coisas incompatíveis por motivos que se sustentam, e pagando o preço. O contrário é o drama que acontece porque o roteiro precisava dele — dá para flagrar na cena em que bastava alguém dizer a verdade, e não diz.'],
    ['impacto', 'Impacto emocional',
      'O quanto o filme mobiliza de fato — comoção, incômodo, empatia — e o quanto disso foi conquistado em cena, em vez de extorquido por trilha e câmera lenta.']
  ],
  'Comédia': [
    ['ritmo', 'Timing & escalada',
      'Construção, pausa e pagamento. Se a situação escala em vez de repetir, e se o corte cai no tempo da piada: em comédia a montagem é metade da graça, e um segundo a mais mata a melhor fala do filme.'],
    ['humor', 'Graça',
      'O filme faz rir, no tom que ele mesmo propôs? E a piada é sobre alguém sendo humano — despreparado, teimoso, sem saída — ou é só sobre alguém sendo humilhado?']
  ],
  'Ficção científica': [
    ['mundo', 'Construção de mundo',
      'Regras, textura e consequência: o mundo se comporta igual na cena 10 e na cena 80, e alguém pensou no que aquela mudança faria com as pessoas que moram nele. Mundo é o que continua funcionando fora do quadro.'],
    ['ideia', 'A ideia',
      'A força do "e se" e o que o filme faz de pensamento com ele. Boa ficção científica devolve o nosso mundo estranho: a novidade é uma lente, não um enfeite.']
  ],
  'Ação': [
    ['coreografia', 'Legibilidade da ação',
      'Dá para saber quem está onde, indo para onde e querendo o quê. Geografia, encenação e corte a serviço do golpe — corte picado que esconde a luta em vez de mostrá-la conta contra, e o plano que aguenta o movimento inteiro conta a favor.'],
    ['adrenalina', 'Peso & risco',
      'O impacto físico e o que está em jogo: porrada que dói, perseguição que custa, escalada que faz a cena seguinte parecer pior que a anterior. Se nada pode dar errado, nada está acontecendo.']
  ],
  'Animação': [
    ['expressividade', 'Animação',
      'O movimento em si: timing e espaçamento, peso, antecipação, arcos e o que continua se mexendo depois que o corpo para. Se o personagem tem massa e intenção, ou se é um desenho sendo arrastado pela tela.'],
    ['encanto', 'Encanto',
      'Appeal, no sentido técnico do ofício: o que faz querer olhar. Desenho que se lê na silhueta, expressão e carisma — e isso vale para o vilão tanto quanto para o herói.']
  ],
  'Documentário': [
    ['argumento', 'Argumento & ponto de vista',
      'O que o filme está defendendo, e com o quê: pesquisa, evidência, contraditório e a honestidade da montagem em construir isso. Todo documentário tem uma tese, inclusive quando finge não ter — e fingir já é uma posição.'],
    ['etica', 'Ética',
      'A relação com quem foi filmado: consentimento, exposição, o que a câmera cobra das pessoas na frente dela, e se o filme é justo inclusive com quem discorda dele.']
  ],
  'Romance': [
    ['quimica', 'Química',
      'A relação valendo em cena: desejo, atrito e o que os dois não conseguem dizer. Se dá para acreditar que essas duas pessoas querem estar no mesmo cômodo — e o que as mantém fora dele.'],
    ['impacto', 'Impacto emocional',
      'O quanto o filme mobiliza de fato — arrebatamento, aperto, saudade — e o quanto disso foi conquistado em cena, em vez de extorquido por trilha e câmera lenta.']
  ]
};

const GENRES = Object.keys(GENRE_CRIT);

const TMDB_GENRE_MAP = {
  27: 'Terror',
  53: 'Suspense',
  9648: 'Suspense',
  18: 'Drama',
  35: 'Comédia',
  878: 'Ficção científica',
  28: 'Ação',
  16: 'Animação',
  99: 'Documentário',
  10749: 'Romance'
};

const GENRE_PRIORITY = [
  'Documentário',
  'Animação',
  'Terror',
  'Ficção científica',
  'Ação',
  'Comédia',
  'Romance',
  'Suspense',
  'Drama'
];

function genresFromTmdbIds(ids) {
  const carried = new Set();
  for (const id of ids || []) {
    const genre = TMDB_GENRE_MAP[id];
    if (genre) carried.add(genre);
  }
  const found = GENRE_PRIORITY.filter(genre => carried.has(genre));
  return found.length ? found : ['Drama'];
}

function genreFromTmdbIds(ids) {
  return genresFromTmdbIds(ids)[0];
}

const GENRE_TO_TMDB = {
  'Terror': '27',
  'Suspense': '53|9648',
  'Drama': '18',
  'Comédia': '35',
  'Ficção científica': '878',
  'Ação': '28',
  'Animação': '16',
  'Documentário': '99',
  'Romance': '10749'
};

function baseFor(genre) {
  const swap = BASE_SWAP[genre] || {};
  return BASE.map(slot => swap[slot[0]] || slot);
}

const CRAFT = 'oficio';
const GENRE = 'genero';
const PERSONAL = 'pessoal';

const PERSONAL_KEY = 'aproveitamento';

const spell = (t, group) => ({ key: t[0], name: t[1], hint: t[2], w: 1, group });

function critsFor(genre) {
  const named = GENRE_CRIT[genre] ? genre : 'Drama';
  const base = baseFor(named);
  return base
    .filter(t => t[0] !== PERSONAL_KEY)
    .map(t => spell(t, CRAFT))
    .concat(GENRE_CRIT[named].map(t => spell(t, GENRE)))
    .concat(base.filter(t => t[0] === PERSONAL_KEY).map(t => spell(t, PERSONAL)));
}

function finalOf(genre, scores) {
  let sum = 0;
  let weight = 0;
  for (const c of critsFor(genre)) {
    const value = scores?.[c.key];
    if (typeof value !== 'number' || !Number.isFinite(value)) continue;
    sum += value * c.w;
    weight += c.w;
  }
  return weight ? sum / weight : 0;
}

function answeredIn(genre, scores) {
  return critsFor(genre).filter(c => typeof scores?.[c.key] === 'number');
}

function seasonCritsFor(genre) {
  const base = baseFor(GENRE_CRIT[genre] ? genre : 'Drama');
  return base
    .filter(t => t[0] !== PERSONAL_KEY)
    .map(t => spell(t, CRAFT))
    .concat(base.filter(t => t[0] === PERSONAL_KEY).map(t => spell(t, PERSONAL)));
}

function seasonFinalOf(genre, scores) {
  let sum = 0;
  let weight = 0;
  for (const c of seasonCritsFor(genre)) {
    const value = scores?.[c.key];
    if (typeof value !== 'number' || !Number.isFinite(value)) continue;
    sum += value * c.w;
    weight += c.w;
  }
  return weight ? sum / weight : 0;
}

function seasonAnsweredIn(genre, scores) {
  return seasonCritsFor(genre).filter(c => typeof scores?.[c.key] === 'number');
}

module.exports = {
  BASE, BASE_SWAP, GENRE_CRIT, GENRES, GENRE_PRIORITY, TMDB_GENRE_MAP, GENRE_TO_TMDB,
  CRAFT, GENRE, PERSONAL, PERSONAL_KEY,
  genreFromTmdbIds, genresFromTmdbIds, baseFor, critsFor, finalOf, answeredIn,
  seasonCritsFor, seasonFinalOf, seasonAnsweredIn
};
