import type { Review, Reviewer } from '@/lib/api';

/* ══════════════════════════════════════════════════════════════════════════
   O QUE UM HISTÓRICO SABE DIZER SOBRE UMA PESSOA

   Tudo aqui é derivado: nada é gravado, nada é pedido ao servidor. O acervo
   inteiro já está em memória desde o boot, e um clube de seis pessoas com
   cinquenta fichas é da ordem de seiscentas notas — menos trabalho do que uma
   requisição levaria para ser montada.

   Derivado é também a razão de isto existir: as perguntas aqui são sobre
   RELAÇÃO — onde a pessoa se entusiasmou, o quanto se afasta do público, com
   quem costuma brigar —, e nenhuma delas é respondível contando filmes.

   ── a regra que rege o arquivo inteiro: o piso ───────────────────────────
   Cada função devolve `null` quando não tem material, e nunca um número fraco.
   Não é cautela, é o produto se recusando a mentir: uma média tirada de duas
   fichas é um acidente com formato de dado, e apresentada com a firmeza da de
   quem tem cinquenta seria indistinguível dela.

   Quem chama nunca precisa saber os pisos: um `null` significa "esta página não
   tem o que dizer sobre isso ainda", e a tela desenha o silêncio.
   ══════════════════════════════════════════════════════════════════════════ */

/* Números diferentes porque as perguntas afirmam coisas diferentes.

   `ENDS` é três porque "o que mais amou e o que mais detestou" é uma escolha
   entre extremos existentes, não uma média. `CROWD` é quatro porque a
   comparação com o TMDB é uma média de diferenças, e um filme em que o clube
   discorda muito move demais um par. `SHARED` é três porque afinidade é sobre
   duas pessoas: menos que isso descreve uma noite, não um gosto em comum. */
export const FLOOR = { ends: 3, crowd: 4, shared: 3 } as const;

const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;

/** As fichas de uma pessoa, da mais nova para a mais velha. */
export function takesOf(reviews: Review[], reviewerId: string) {
  return reviews
    .filter(r => r.reviewerId === reviewerId)
    .sort((a, b) => String(b.date).localeCompare(String(a.date)));
}

/* As duas melhores frases de qualquer perfil, e as duas mais baratas: não são
   médias, são as pontas de uma lista que já existe.

   Empate resolvido pela ficha mais recente — entre dois 9,0, o que a pessoa
   diria hoje é o de hoje. Ausente quando as duas pontas são a mesma ficha, e
   quando não há distância entre elas: onze notas iguais não têm alto nem
   baixo. */
export function endsOf(reviews: Review[], reviewerId: string) {
  const mine = takesOf(reviews, reviewerId);
  if (mine.length < FLOOR.ends) return null;
  const byScore = [...mine].sort((a, b) => b.final - a.final || String(b.date).localeCompare(String(a.date)));
  const best = byScore[0];
  const worst = byScore[byScore.length - 1];
  if (best.id === worst.id || best.final - worst.final < 1) return null;
  return { best, worst };
}

/* A única régua externa que este produto tem, e ela sai de graça: `crowd` já
   viaja em toda ficha. Diz uma coisa que o clube sozinho não sabe — se esta
   pessoa é mais dura ou mais mole que o mundo lá fora.

   Média das diferenças por filme, e não diferença das médias: as duas dão o
   mesmo número quando todo filme tem nota do TMDB e divergem quando não têm, e
   é a primeira que responde "em média, o quanto ela se afasta". */
export function crowdGapOf(reviews: Review[], reviewerId: string) {
  const pairs = takesOf(reviews, reviewerId)
    .filter(r => r.crowd && Number.isFinite(r.crowd.score))
    .map(r => ({ review: r, gap: r.final - (r.crowd as { score: number }).score }));
  if (pairs.length < FLOOR.crowd) return null;

  const gap = mean(pairs.map(p => p.gap));
  /* O filme em que ela mais se afastou do público, para a frase ter um exemplo.
     Um número sem um caso é uma estatística; com o caso é um argumento. */
  const widest = pairs.reduce((a, b) => (Math.abs(b.gap) > Math.abs(a.gap) ? b : a));
  return { gap, n: pairs.length, widest: widest.review, widestGap: widest.gap };
}

/* A distribuição das notas finais em dez faixas de um ponto. Responde o que a
   média esconde: duas pessoas com média 7,4 podem ser uma que dá 7 e 8 em tudo
   e outra que dá 3 e 10, e a segunda é muito mais interessante de ter no clube.

   Devolve os FILMES e não a contagem. Devolvendo `number[]`, a régua só sabia
   desenhar alturas — blocos parecidos que ninguém compara — e não tinha como
   responder a pergunta que ela mesma provoca: "três filmes entre 7 e 8, quais?"

   Com as fichas na mão, a faixa vira uma pilha de células (uma por filme, então
   a contagem se lê contando) e passa a ter o que mostrar quando alguém aponta
   para ela. */
export function spreadOf(reviews: Review[], reviewerId: string) {
  const mine = takesOf(reviews, reviewerId);
  if (!mine.length) return null;
  const bands: Review[][] = Array.from({ length: 10 }, () => []);
  for (const r of mine) {
    // 10,0 pertence à última faixa, não a uma décima primeira que não existe.
    bands[Math.min(9, Math.max(0, Math.floor(r.final)))].push(r);
  }
  for (const band of bands) band.sort((a, b) => b.final - a.final);
  const finals = mine.map(r => r.final);
  return {
    bands,
    peak: Math.max(...bands.map(b => b.length)),
    low: Math.min(...finals),
    high: Math.max(...finals),
    avg: mean(finals),
    n: mine.length,
  };
}

/* O módulo mais social da página, e ele não existiria em nenhum outro app de
   filme: é uma rede social medida em gosto, não em quem segue quem.

   Para cada outra pessoa, a distância média entre as duas notas finais nos
   filmes que as DUAS avaliaram. Só o filme em comum entra — comparar a média
   geral de duas pessoas seria comparar o que cada uma escolheu assistir, e
   alguém que só vê terror pareceria implicante.

   A DISTÂNCIA e não a diferença com sinal, porque discordar para cima e para
   baixo são a mesma discordância: com sinal, quem dá dois pontos a mais num
   filme e dois a menos no outro apareceria em acordo perfeito. */
export type Affinity = {
  person: Reviewer;
  /** Distância média entre as notas dos dois, nos filmes em comum. */
  gap: number;
  /** Quantos filmes os dois avaliaram. */
  shared: number;
  /** Onde vocês mais discordaram — o assunto, quando existe um. */
  clash: { title: string; movieId: number; mine: number; theirs: number } | null;
};

export function affinityOf(
  reviews: Review[],
  reviewers: Reviewer[],
  reviewerId: string
): Affinity[] {
  const mine = new Map(takesOf(reviews, reviewerId).map(r => [r.movieId, r]));
  if (!mine.size) return [];

  const out: Affinity[] = [];
  for (const person of reviewers) {
    if (person.id === reviewerId) continue;
    const gaps: number[] = [];
    let clash: Affinity['clash'] = null;
    let worst = -1;
    for (const r of reviews) {
      if (r.reviewerId !== person.id) continue;
      const ours = mine.get(r.movieId);
      if (!ours) continue;
      const d = Math.abs(ours.final - r.final);
      gaps.push(d);
      if (d > worst) {
        worst = d;
        clash = { title: r.movieTitle, movieId: r.movieId, mine: ours.final, theirs: r.final };
      }
    }
    if (gaps.length < FLOOR.shared) continue;
    /* O par que mais discorda só vira "assunto" quando discorda de verdade.
       Meio ponto é o passo do controle: abaixo disso o "onde vocês mais
       discordaram" seria arredondamento apresentado como briga. */
    out.push({ person, gap: mean(gaps), shared: gaps.length, clash: worst >= 1 ? clash : null });
  }
  /* Do mais parecido para o mais diferente. Empate pelo número de filmes em
     comum: entre dois acordos iguais, o medido em mais filmes é o mais real. */
  return out.sort((a, b) => a.gap - b.gap || b.shared - a.shared);
}

/* Não é uma média: são os filmes que vocês dois viram, com as duas notas lado a
   lado e a distância entre elas. Ordenado do maior desacordo para o menor,
   porque é para isso que se abre isto.

   Devolve a lista mesmo abaixo do piso da afinidade — quem apertou "comparar"
   já sabe com quem. O piso governa se o CARD é oferecido; aberto, ele mostra o
   que tem. */
export type Clash = {
  movieId: number;
  title: string;
  poster: string | null;
  /** A nota de quem está lendo. */
  mine: number;
  /** A nota da pessoa do perfil. */
  theirs: number;
  gap: number;
};

export function clashesOf(reviews: Review[], meId: string, themId: string): Clash[] {
  const mine = new Map(takesOf(reviews, meId).map(r => [r.movieId, r]));
  const out: Clash[] = [];
  for (const r of takesOf(reviews, themId)) {
    const ours = mine.get(r.movieId);
    if (!ours) continue;
    out.push({
      movieId: r.movieId,
      title: r.movieTitle,
      poster: r.moviePoster,
      mine: ours.final,
      theirs: r.final,
      gap: Math.abs(ours.final - r.final),
    });
  }
  return out.sort((a, b) => b.gap - a.gap || a.title.localeCompare(b.title));
}

/* ── em que gêneros ela vive ──────────────────────────────────────────────
   Quantas fichas por gênero e a média em cada um, do mais avaliado para o
   menos. Sem piso: contar filmes não é afirmar nada sobre gosto, e "três de
   terror" é verdade absoluta mesmo com três fichas no total. */
export function genresOf(reviews: Review[], reviewerId: string) {
  const acc = new Map<string, number[]>();
  for (const r of takesOf(reviews, reviewerId)) {
    const list = acc.get(r.movieGenre) ?? [];
    list.push(r.final);
    acc.set(r.movieGenre, list);
  }
  return [...acc.entries()]
    .map(([genre, finals]) => ({ genre, n: finals.length, avg: mean(finals) }))
    .sort((a, b) => b.n - a.n || b.avg - a.avg);
}

/* ── desde quando ─────────────────────────────────────────────────────────
   "no clube desde agosto de 2026". Mês e ano, nunca o dia: o dia em que alguém
   criou uma conta não é um fato sobre a pessoa, e uma data cheia num perfil
   pede ao leitor uma precisão que ele não vai usar.

   O servidor grava em UTC sem fuso no texto, então o `Z` é acrescentado aqui —
   a mesma armadilha que já custou três horas à conversa. Ver `whenOf`. */
export function memberSince(createdAt: string | null | undefined) {
  if (!createdAt) return null;
  const at = new Date(createdAt.includes('T') ? createdAt : createdAt.replace(' ', 'T') + 'Z');
  if (Number.isNaN(at.getTime())) return null;
  return at.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
}
