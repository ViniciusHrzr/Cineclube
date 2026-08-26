/* ══════════════════════════════════════════════════════════════════════════
   O que o clube pergunta de um filme.

   Eleven criteria per film, and every one of them weighs the same. A card full
   of tens is a ten, which is the only property of this arithmetic that is
   actually load-bearing.

   ── por que os pesos sumiram (25/08/2026) ───────────────────────────────
   Eight criteria used to weigh 1 and the two the genre supplies weighed 2, for
   a divisor of 12. The doubling was a claim: that what a genre is *for* counts
   twice as much as how it is made. Defensible, never measured, and it quietly
   decided every argument the club has ever had — a film with a great score and
   flat atmosphere could not win a horror night no matter what anybody said.

   The owner asked to see the record without it. So the weights are equal and
   the divisor is now the number of questions answered, not a constant. The
   genre criteria did not go anywhere: which two questions get asked still
   depends on the film, and that was always the more interesting half.

   `w` survives on every criterion, at 1. It is the arithmetic's own field, the
   archive prints it, and a future weight is a value change rather than a
   schema change.

   ── por que o divisor conta, em vez de ser uma constante ────────────────
   A take recorded before 25/08/2026 answered ten questions and has no mark for
   Aproveitamento — it was not asked. Dividing those by eleven would read that
   silence as a zero and drop every historical score by roughly a point, which
   is the archive lying about what people said. So finalOf() divides by what the
   take actually answers: ten for an old one, eleven for a new one, both means on
   the same 0–10. The alternative — asking four people to re-rate forty films —
   is not one.

   ── de onde vem o conjunto ──────────────────────────────────────────────
   Nine criteria are asked of every film, two come from its genre.

   ── why the base moves ──────────────────────────────────────────────────
   It used to be called TECH and it was fixed: the same eight questions asked of
   every film, with only the last pair following the genre. That is defensible
   right up until the card asks for "Atuações" on a Pixar film. Nobody acted in
   it. Whatever number gets typed there is a number about something else —
   usually the voice cast, sometimes the animation, sometimes just five because
   the slider had to be moved — and it lands in the average as if it had been
   measured.

   A criterion that cannot be answered is worse than a missing one. It does not
   go blank; it fills with noise, at full weight, and the noise is
   indistinguishable from a score afterwards.

   So a genre may replace a slot in the base. Replace, not add: the count never
   moves, which is what keeps every film on one scale. Two genres do it today
   and the rest inherit the default nine unchanged.

   ── where these questions come from ─────────────────────────────────────
   The base is Bordwell & Thompson's division of film form in *Film Art* —
   narrative form plus the four stylistic systems (mise-en-scène,
   cinematography, editing, sound) — with performance and invention added,
   because a club rates films rather than analyses them.

   The pairs are each genre's own literature, and each one is trying to name the
   thing that genre is FOR:

   · Terror — Noël Carroll, *The Philosophy of Horror*: art-horror needs a
     threat that is also impure, and needs evaluating on both. Hence a criterion
     that asks for the two together instead of counting jump scares.
   · Suspense — Hitchcock to Truffaut, the bomb under the table: suspense is
     information management, not surprise. Fifteen minutes of tension against
     fifteen seconds of shock, and the difference is only who was told.
   · Ficção científica — Darko Suvin: the novum and cognitive estrangement. The
     new thing is a lens on this world, which is why "a ideia" is scored on what
     the film thinks with it and not on how clever it sounds.
   · Ação — Bordwell on intensified continuity, and the "chaos cinema" argument
     against it: cutting faster is a style, losing the geography is a failure.
   · Comédia — Steve Kaplan, *The Hidden Tools of Comedy*: comedy is the truth
     about being human, and its engine is the non-hero. A joke about somebody
     being out of their depth and a joke about somebody being humiliated are not
     the same craft.
   · Animação — the Disney principles (timing, weight, anticipation, arcs) and
     appeal, which is a technical term there and not a compliment.
   · Documentário — Bill Nichols, *Introduction to Documentary*: the film has a
     voice and an argument whether or not it admits to one, and ethics is the
     question the form cannot avoid.

   ── the keys ────────────────────────────────────────────────────────────
   The string in position 0 is what goes in the database. A name and a hint can
   be rewritten freely; a key cannot, because every take ever recorded is a JSON
   object keyed by these. Where a genre needed the same question in different
   words the key is kept and only the wording moves. Where it needed a genuinely
   different question, the key changes — and scripts/migrate-criteria-keys.js
   renames it in the archive, which is exact here because every rename below
   lands on a slot of the same weight.
   ══════════════════════════════════════════════════════════════════════════ */

/** The nine a film is asked about unless its genre says otherwise. */
const BASE = [
  ['direcao', 'Direção',
    'A encenação: o que a câmera escolhe olhar, como o espaço da cena é organizado, o que fica de fora e o ritmo que o filme impõe. É onde se vê se alguém decidiu alguma coisa.'],
  ['roteiro', 'Roteiro',
    'Estrutura e causalidade: se uma cena puxa a próxima por necessidade ou por conveniência, se os personagens querem coisas e pagam por elas, e se o final é o que esta história pedia.'],
  ['fotografia', 'Fotografia',
    'Luz, composição, lente e cor — e se essas escolhas dizem alguma coisa e se sustentam do começo ao fim. Bonito não basta: um filme feio de propósito pontua alto aqui.'],
  ['montagem', 'Montagem',
    'Onde o corte cai e o que ele esconde: ritmo, elipse, continuidade e a ordem em que a informação chega. A pergunta prática é se você sempre sabe onde está.'],
  ['som', 'Som & Trilha',
    'Desenho sonoro, mixagem, diálogo e silêncio. Se o som constrói o que está fora do quadro, e se a trilha sustenta a cena ou faz o trabalho no lugar dela.'],
  ['arte', 'Direção de Arte',
    'Cenário, objeto, figurino e maquiagem construindo um mundo que parece ter existido antes da primeira cena e continuar depois da última.'],
  ['atuacoes', 'Atuações',
    'Interpretação e presença: corpo, voz, escuta. Se o elenco está todo no mesmo filme e se o tom de cada um serve ao que o filme é.'],
  ['originalidade', 'Originalidade',
    'O que aqui não veio de outro lugar — ideia, forma ou ponto de vista próprios. Clichê usado com consciência conta a favor; clichê usado por falta de ideia, contra.'],
  /* ── e o único que não é sobre o filme ─────────────────────────────────
     Everything above asks what the film does. This one asks what it did to
     *you*, and it is deliberately the last thing on the card: you answer it
     after you have taken the thing apart, not before.

     It exists because the other ten were quietly getting it anyway. A film
     somebody loved and could not defend came out of this card at 6,4, and the
     gap between that number and what they actually said out loud on the call
     had nowhere to go — so it leaked into whichever criterion was closest to
     hand, usually roteiro or originalidade. A criterion that is honestly
     personal is what stops the other ten from being dishonestly personal.

     It carries the same weight as the rest, which is the club saying taste is
     one voice at the table rather than the verdict or a footnote. */
  ['aproveitamento', 'Aproveitamento',
    'O seu, e só o seu: o quanto você aproveitou esse filme. Não é o quanto ele é bom — é se você ficou feliz de ter assistido. Aqui vale gostar do que não se defende e não gostar do que é irretocável; é o único critério em que o argumento é você.']
];

/* ── o que cada gênero troca na base ──────────────────────────────────────
   Keyed by the slot being taken over, so the eight keep their order and their
   number no matter how many a genre rewrites. A slot may be rewritten in place
   (same key, new words) or genuinely replaced (new key).

   Only two genres need this, and both need it for the same reason: they are the
   two where a slot of the default eight has no referent. Animation has no
   performances in front of a camera. Documentary has neither a production
   design nor, usually, anybody performing at all. */
const BASE_SWAP = {
  'Animação': {
    // Nobody acted. What there is, and what the Annies award, is a voice cast.
    atuacoes: ['vozes', 'Vozes',
      'O elenco de voz: entrega, timing e casting, e o quanto a voz e o desenho do personagem parecem a mesma criatura. Voz que só lê a fala é o equivalente a atuação sem presença.']
  },
  'Documentário': {
    // Same question, different object: there was no script, but there is a form.
    roteiro: ['roteiro', 'Estrutura',
      'Um documentário também é construído: o recorte, a ordem em que os fatos chegam, o que entra e o que ficou de fora. Não houve roteiro antes, mas há uma forma — e ela é uma escolha.'],
    arte: ['material', 'Material & arquivo',
      'O que não foi filmado agora: arquivo, imagens de terceiros, documentos, gráficos, reconstituição. A qualidade do material e, principalmente, se o filme deixa claro o que é o quê.'],
    atuacoes: ['acesso', 'Acesso & presença',
      'Até onde o filme conseguiu chegar: a confiança de quem está sendo filmado, o que essas pessoas entregam diante da câmera e as cenas que só existem porque alguém estava lá naquele momento.']
  }
};

/* ── os dois que o gênero traz ────────────────────────────────────────────
   What each genre is actually for. These used to weigh double; now they weigh
   the same as everything else and their whole distinction is that the film
   decides which two they are. Atmosfera is asked of a horror film and never of
   a comedy, which is a sharper statement than any multiplier was. */
const GENRE_CRIT = {
  'Terror': [
    ['atmosfera', 'Atmosfera',
      'O clima que o filme sustenta quando nada está acontecendo: o espaço, o silêncio, a sensação de que aquele lugar não quer você ali. É o que continua depois que o susto passa.'],
    ['terror', 'Terror',
      'A eficácia da ameaça. O que o filme põe contra a normalidade, e se aquilo é ao mesmo tempo perigoso e perturbador — as duas coisas, não só uma. Susto é reflexo; medo é o que fica.']
  ],
  'Suspense': [
    ['informacao', 'Dosagem da informação',
      'Quem sabe o quê, e quando. Se o público vê a bomba ser colocada debaixo da mesa, uma conversa banal vira quinze minutos de tensão; se não vê, são quinze segundos de susto. Aqui se avalia essa escolha.'],
    ['tensao', 'Tensão',
      'A corda esticada e por quanto tempo ela aguenta: expectativa, adiamento e alívio na hora certa. Um filme tenso não é o que assusta, é o que não deixa relaxar.']
  ],
  'Drama': [
    ['densidade', 'Verdade dos conflitos',
      'O peso real das escolhas: personagens querendo coisas incompatíveis por motivos que se sustentam, e pagando o preço. O contrário disso é o drama que acontece porque o roteiro precisava dele.'],
    ['impacto', 'Impacto emocional',
      'O quanto o filme mobiliza de fato — comoção, incômodo, empatia — e o quanto disso foi conquistado em cena, em vez de extorquido por trilha e câmera lenta.']
  ],
  'Comédia': [
    ['ritmo', 'Timing & escalada',
      'Construção, pausa e pagamento. Se a situação escala em vez de repetir, e se o corte cai no tempo da piada — em comédia a montagem é metade da graça.'],
    ['humor', 'Graça',
      'O filme faz rir, no tom que ele mesmo propôs? E a piada é sobre alguém sendo humano — despreparado, teimoso, sem saída — ou é só sobre alguém sendo humilhado?']
  ],
  'Ficção científica': [
    ['mundo', 'Construção de mundo',
      'Regras, textura e consequência: o mundo se comporta igual na cena 10 e na cena 80, e alguém pensou no que aquela mudança faria com as pessoas que moram nele.'],
    ['ideia', 'A ideia',
      'A força do "e se" e o que o filme faz de pensamento com ele. Boa ficção científica devolve o nosso mundo estranho: a novidade é uma lente, não um enfeite.']
  ],
  'Ação': [
    ['coreografia', 'Legibilidade da ação',
      'Dá para saber quem está onde, indo para onde e querendo o quê. Encenação, geografia e corte a serviço do golpe — corte rápido que esconde a luta em vez de mostrá-la conta contra.'],
    ['adrenalina', 'Peso & risco',
      'O impacto físico e o que está em jogo: porrada que dói, perseguição que custa, escalada que faz a próxima cena parecer pior que a anterior.']
  ],
  'Animação': [
    ['expressividade', 'Animação',
      'O movimento em si: timing, peso, antecipação, arcos, exagero. Se o personagem tem massa e intenção, ou se é um desenho sendo arrastado pela tela.'],
    ['encanto', 'Encanto',
      'Appeal, no sentido técnico do ofício: o que faz querer olhar. Design, expressão e carisma — e isso vale para o vilão tanto quanto para o herói.']
  ],
  'Documentário': [
    ['argumento', 'Argumento & ponto de vista',
      'O que o filme está defendendo, e com o quê. Pesquisa, evidência, contraditório e a honestidade da montagem em construir isso — um documentário tem uma tese mesmo quando finge não ter.'],
    ['etica', 'Ética',
      'A relação com quem foi filmado: consentimento, exposição, o que a câmera cobra das pessoas na frente dela, e se o filme é justo inclusive com quem discorda dele.']
  ],
  'Romance': [
    ['quimica', 'Química',
      'A relação valendo em cena: desejo, atrito e o que os dois não conseguem dizer. Se dá para acreditar que essas duas pessoas querem estar no mesmo cômodo.'],
    ['impacto', 'Impacto emocional',
      'O quanto o filme mobiliza de fato — arrebatamento, aperto, saudade — e o quanto disso foi conquistado em cena, em vez de extorquido por trilha e câmera lenta.']
  ]
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
 * person rating picks, and the card follows the pick. What the order below is
 * for is deciding which one is offered first — a default, not a verdict.
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

/** The nine this genre is asked, with its swaps applied in place. */
function baseFor(genre) {
  const swap = BASE_SWAP[genre] || {};
  return BASE.map(slot => swap[slot[0]] || slot);
}

/* ── os três grupos ───────────────────────────────────────────────────────
   The client used to group the card by weight: ×1 was the craft, ×2 was the
   genre. With every weight at 1 that proxy says nothing, and the grouping it
   was standing in for is real and worth stating outright — the eight about how
   the film is made, the two its genre brings, and the one that is about you.

   Sent as a field rather than inferred from the key, so the interface never has
   to hold a list of which criteria are which. */
const CRAFT = 'oficio';
const GENRE = 'genero';
const PERSONAL = 'pessoal';

/** The key of the one criterion that asks about the viewer and not the film. */
const PERSONAL_KEY = 'aproveitamento';

const spell = (t, group) => ({ key: t[0], name: t[1], hint: t[2], w: 1, group });

/* Craft, then genre, then the personal one — which is last on purpose. You say
   whether you enjoyed it after taking the film apart, not before, and a card
   that asks it in the middle invites the other answers to be adjusted to
   agree with it. */
function critsFor(genre) {
  const named = GENRE_CRIT[genre] ? genre : 'Drama';
  const base = baseFor(named);
  return base
    .filter(t => t[0] !== PERSONAL_KEY)
    .map(t => spell(t, CRAFT))
    .concat(GENRE_CRIT[named].map(t => spell(t, GENRE)))
    .concat(base.filter(t => t[0] === PERSONAL_KEY).map(t => spell(t, PERSONAL)));
}

/* ── a nota ───────────────────────────────────────────────────────────────
   The mean of what this take answers, weighted — which today means the plain
   mean, because every weight is 1.

   The divisor is counted rather than assumed, and that is the part worth
   reading twice. A take recorded before Aproveitamento existed has ten marks,
   not eleven, and the eleventh is not a zero — it is a question nobody asked.
   Counting only the criteria the take actually carries keeps that take on the
   same 0–10 as a new one instead of docking it a point for a change it could
   not have known about.

   An absent criterion and a criterion marked zero are different things here, so
   the test is on the key being present and not on the value being truthy. */
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

/* What a take answers, in the order the card asks it. Criteria the take has no
   mark for are left out rather than printed as zero: an archive that shows
   "Aproveitamento 0,0" on a film rated in June is inventing an opinion. */
function answeredIn(genre, scores) {
  return critsFor(genre).filter(c => typeof scores?.[c.key] === 'number');
}

module.exports = {
  BASE, BASE_SWAP, GENRE_CRIT, GENRES, GENRE_PRIORITY, TMDB_GENRE_MAP, GENRE_TO_TMDB,
  CRAFT, GENRE, PERSONAL, PERSONAL_KEY,
  genreFromTmdbIds, genresFromTmdbIds, baseFor, critsFor, finalOf, answeredIn
};
