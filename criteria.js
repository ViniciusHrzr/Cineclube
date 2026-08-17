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

/* ── which genre wins when a film carries several ─────────────────────────
   Almost every film does. TMDB gave Frewaka [18, 14, 27] — drama, fantasy,
   horror — and this used to answer with whichever it recognised first, which
   made it Drama: an Irish folk horror filed under the criteria for a family
   saga, rated on densidade dramática and impacto emocional while atmosfera and
   terror, the two things it was actually built to do, were never asked about.

   The bug is not that Drama was chosen. It is that TMDB's order was treated as
   a ranking. It is not one — it is roughly the order the ids were added — and
   Drama in particular is both a real genre here and the bucket everything
   unrecognised falls into, so letting it win a tie means it wins constantly.

   So the order below is the club's, and it is read as a priority: the first
   one a film has is the one it is rated as. What sorts it is how much a genre
   determines the questions worth asking of a film. A documentary is judged as
   a documentary whatever it is about. Animation brings its own craft with it.
   Horror and science fiction name what a film is trying to do to you, action
   and comedy name what it is made of, and romance and suspense are more often
   worn alongside something else than alone.

   Drama is last, and that is the whole fix. It is the widest word here and the
   default for anything unrecognised, so it should only be reached when nothing
   more specific was on offer. */
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

/**
 * Every genre in this taxonomy that a film carries, most specific first.
 *
 * A film is rarely one thing, and the club knows which one it just watched
 * better than a priority list does. So the list is what gets offered: the
 * person rating picks, and the two ×2 criteria follow the pick. What the order
 * below is for is deciding which one is offered first — a default, not a
 * verdict.
 *
 * Never empty: a film carrying nothing this taxonomy recognises still has to
 * be rateable, and Drama is where that lands.
 */
function genresFromTmdbIds(ids) {
  const carried = new Set();
  for (const id of ids || []) {
    const genre = TMDB_GENRE_MAP[id];
    if (genre) carried.add(genre);
  }
  const found = GENRE_PRIORITY.filter(genre => carried.has(genre));
  return found.length ? found : ['Drama'];
}

/** The one a film opens on when nobody has chosen yet. */
function genreFromTmdbIds(ids) {
  return genresFromTmdbIds(ids)[0];
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

module.exports = { TECH, GENRE_CRIT, GENRES, GENRE_PRIORITY, TMDB_GENRE_MAP, GENRE_TO_TMDB, genreFromTmdbIds, genresFromTmdbIds, critsFor, finalOf };
