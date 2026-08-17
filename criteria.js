const TECH = [
  ['direcao', 'Direção', 'Encenação, condução dos atores, escolha dos planos, movimentos de câmera e ritmo das cenas.'],
  ['roteiro', 'Roteiro', 'Enredo, estrutura narrativa, personagens, diálogos, conflitos, progressão dramática e resolução.'],
  ['fotografia', 'Fotografia', 'Iluminação, composição, enquadramento, cores, lentes, exposição e profundidade.'],
  ['montagem', 'Montagem', 'Ritmo, cortes, continuidade, elipses e a ordem em que a informação chega.'],
  ['som', 'Som & Trilha', 'Trilha, sound design, diálogos, ruídos, silêncio e a relação entre som e imagem.'],
  ['arte', 'Direção de Arte', 'Cenários, objetos, figurinos, maquiagem e construção visual do mundo.'],
  ['atuacoes', 'Atuações', 'Interpretação, expressividade, naturalidade, presença e adequação ao tom do filme.'],
  ['originalidade', 'Originalidade', 'Ideias novas, subversão de clichês e identidade própria.']
];

const GENRE_CRIT = {
  'Terror': [['atmosfera', 'Atmosfera', 'A sensação contínua que o filme sustenta: claustrofobia, estranheza, isolamento, tensão.'], ['terror', 'Terror', 'A eficiência em provocar medo, ansiedade ou sensação de ameaça. Isso funciona como terror?']],
  'Suspense': [['atmosfera', 'Atmosfera', 'A sensação contínua de instabilidade e ameaça latente que o filme sustenta.'], ['tensao', 'Tensão', 'A capacidade de segurar o espectador na dúvida — informação dosada, expectativa, alívio.']],
  'Drama': [['densidade', 'Densidade dramática', 'A verdade dos conflitos e o peso das escolhas dos personagens ao longo do filme.'], ['impacto', 'Impacto emocional', 'O quanto o filme mobiliza de fato — comoção, incômodo, empatia, permanência.']],
  'Comédia': [['ritmo', 'Ritmo cômico', 'Timing, construção e pagamento das piadas, escalada das situações.'], ['humor', 'Humor', 'O filme faz rir? A graça funciona no tom que ele mesmo propõe?']],
  'Ficção científica': [['mundo', 'Construção de mundo', 'Coerência interna, regras, textura e credibilidade do universo apresentado.'], ['ideia', 'Ideia central', 'A força do conceito e o que o filme faz de pensamento com ele.']],
  'Ação': [['coreografia', 'Coreografia & ação', 'Legibilidade espacial, encenação das lutas e perseguições, impacto físico.'], ['adrenalina', 'Adrenalina', 'A escalada de risco e o quanto as sequências realmente empolgam.']],
  'Animação': [['expressividade', 'Expressividade visual', 'Design, movimento, timing de animação e invenção plástica.'], ['encanto', 'Encanto', 'A capacidade de encantar e sustentar afeto pelo mundo e pelos personagens.']],
  'Documentário': [['argumento', 'Construção do argumento', 'Pesquisa, uso de material, clareza e honestidade da montagem do ponto de vista.'], ['relevancia', 'Relevância', 'O que o filme acrescenta ao assunto e por que ele importa.']],
  'Romance': [['quimica', 'Química', 'A relação entre os personagens: desejo, atrito, credibilidade do vínculo.'], ['impacto', 'Impacto emocional', 'O quanto o filme mobiliza de fato — comoção, arrebatamento, permanência.']]
};

const GENRES = Object.keys(GENRE_CRIT);

// TMDB genre ids -> our internal taxonomy. Movies whose genres don't hit any
// of these fall back to 'Drama', same as an unrecognized genre string would.
const TMDB_GENRE_MAP = {
  27: 'Terror',
  53: 'Suspense',
  9648: 'Suspense', // Mystery
  18: 'Drama',
  35: 'Comédia',
  878: 'Ficção científica',
  28: 'Ação',
  16: 'Animação',
  99: 'Documentário',
  10749: 'Romance'
};

function genreFromTmdbIds(ids) {
  for (const id of ids || []) {
    if (TMDB_GENRE_MAP[id]) return TMDB_GENRE_MAP[id];
  }
  return 'Drama';
}

// Reverse of TMDB_GENRE_MAP, for server-side discovery ("filmes de Terror").
// Pipe-joined ids mean OR in TMDB's /discover/movie with_genres param.
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

function critsFor(genre) {
  const g = GENRE_CRIT[genre] || GENRE_CRIT['Drama'];
  return TECH.map(t => ({ key: t[0], name: t[1], hint: t[2], w: 1 }))
    .concat(g.map(t => ({ key: t[0], name: t[1], hint: t[2], w: 2 })));
}

function finalOf(genre, scores) {
  const cs = critsFor(genre);
  let sum = 0;
  cs.forEach(c => { sum += (scores[c.key] ?? 0) * c.w; });
  return sum / 12;
}

module.exports = { TECH, GENRE_CRIT, GENRES, TMDB_GENRE_MAP, GENRE_TO_TMDB, genreFromTmdbIds, critsFor, finalOf };
