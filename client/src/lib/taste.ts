import type { Review, Reviewer } from '@/lib/api';

/* ══════════════════════════════════════════════════════════════════════════
   O QUE UM HISTÓRICO SABE DIZER SOBRE UMA PESSOA

   Tudo neste arquivo é derivado. Nada é gravado, nada é pedido ao servidor:
   o acervo inteiro já está em memória desde o boot, e um clube de seis pessoas
   com cinquenta fichas é da ordem de seiscentas notas — menos trabalho do que
   uma requisição levaria para ser montada.

   Derivado é também a razão de isto existir. O perfil de um app de filme
   costuma ser uma foto, um nome e uma contagem; este produto tem onze critérios
   por ficha, e onze critérios descrevem um gosto com uma precisão que nenhuma
   contagem alcança. A pergunta que o perfil responde não é "quantos filmes" —
   é "o que essa pessoa olha num filme".

   ── a regra que rege o arquivo inteiro: o piso ───────────────────────────
   Cada função aqui devolve `null` quando não tem material para responder, e
   nunca um número fraco. Isto não é cautela, é o produto se recusando a mentir:
   uma "média em Fotografia" tirada de duas fichas não é um gosto, é um acidente
   com formato de dado — e desenhada na mesma régua que uma média de cinquenta
   fichas, ela seria indistinguível dela.

   O piso já é doutrina neste código: `endsOf` no servidor se cala quando a
   ficha não tem um ponto de distância entre o alto e o baixo, e o detalhamento
   pede três critérios marcados antes de apontar extremos. Aqui a mesma ideia
   vale por módulo, com o piso escolhido pelo que cada resposta afirma.

   Quem chama nunca precisa saber os pisos: um `null` significa "esta página
   não tem o que dizer sobre isso ainda", e a tela desenha o silêncio.
   ══════════════════════════════════════════════════════════════════════════ */

/* ── os pisos, todos num lugar ────────────────────────────────────────────
   Números diferentes porque as perguntas afirmam coisas diferentes.

   `TASTE` é o mais alto dos quatro. Ele governa a afirmação mais forte que a
   página faz — "esta pessoa valoriza fotografia acima do clube" — e essa frase
   precisa de mais de um punhado de filmes por trás. Cinco é onde uma média
   deixa de virar de lado quando uma ficha nova entra.

   `ENDS` é três porque "o que mais amou e o que mais detestou" é uma escolha
   entre extremos existentes, não uma média: com três fichas os extremos são
   reais, só são poucos.

   `CROWD` é quatro porque a comparação com o TMDB é uma média de diferenças, e
   um filme em que o clube discorda muito do público move demais um par.

   `SHARED` é três porque afinidade é sobre duas pessoas: menos que isso e o
   número descreve uma noite, não um gosto em comum. */
export const FLOOR = { taste: 5, ends: 3, crowd: 4, shared: 3 } as const;

const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;

/** As fichas de uma pessoa, da mais nova para a mais velha. */
export function takesOf(reviews: Review[], reviewerId: string) {
  return reviews
    .filter(r => r.reviewerId === reviewerId)
    .sort((a, b) => String(b.date).localeCompare(String(a.date)));
}

/* ── a ficha da pessoa ────────────────────────────────────────────────────
   O instrumento do produto virado contra o membro. O clube decompõe filme em
   onze critérios; isto decompõe uma pessoa nos mesmos onze.

   `delta` é a metade que importa. Uma média de 8,4 em Fotografia não diz nada
   sozinha — pode ser que a pessoa seja generosa em tudo, pode ser que o clube
   inteiro tenha visto filmes bonitos. O que diz alguma coisa é a distância até
   o clube: +1,3 significa *ela vê a câmera*, e é uma frase que só existe porque
   há um coletivo para comparar.

   ── por que a média do clube exclui a própria pessoa ────────────────────
   Porque incluí-la é comparar alguém consigo mesmo. Num clube de duas pessoas
   ativas — que é o clube real hoje — a média "do clube" contendo você puxa a
   referência para o seu lado e encolhe todo delta pela metade: você seria
   sempre morno, por construção. Fora dela, o delta responde a pergunta certa:
   "quanto esta pessoa se afasta de todo mundo que não é ela".

   Um critério só entra quando os DOIS lados existem. Um gênero que só ela
   avaliou não tem clube para comparar, e imprimir o delta contra o nada seria
   inventar o consenso mais conveniente. */
export type TasteRow = {
  key: string;
  name: string;
  /** A média dela naquele critério. */
  value: number;
  /** A média de todo mundo que não é ela, ou null quando ninguém mais marcou. */
  club: number | null;
  /** `value − club`, e null pelo mesmo motivo. */
  delta: number | null;
  /** Em quantas fichas dela este critério foi respondido. */
  n: number;
};

export function tasteOf(reviews: Review[], reviewerId: string): TasteRow[] | null {
  const mine = takesOf(reviews, reviewerId);
  if (mine.length < FLOOR.taste) return null;

  /* Acumulado por chave e não por nome: um critério guarda a mesma chave entre
     gêneros mesmo quando o rótulo muda, e é a chave que o servidor persiste. O
     nome vem da ficha mais recente que o usou, que é o rótulo que a pessoa viu
     por último. */
  const ours = new Map<string, { name: string; values: number[] }>();
  for (const r of mine) {
    for (const b of r.breakdown) {
      if (typeof b.value !== 'number') continue;
      const slot = ours.get(b.key) ?? { name: b.name, values: [] };
      slot.values.push(b.value);
      ours.set(b.key, slot);
    }
  }
  if (!ours.size) return null;

  const theirs = new Map<string, number[]>();
  for (const r of reviews) {
    if (r.reviewerId === reviewerId) continue;
    for (const b of r.breakdown) {
      if (typeof b.value !== 'number') continue;
      const list = theirs.get(b.key) ?? [];
      list.push(b.value);
      theirs.set(b.key, list);
    }
  }

  const rows: TasteRow[] = [];
  for (const [key, slot] of ours) {
    const others = theirs.get(key);
    const club = others?.length ? mean(others) : null;
    const value = mean(slot.values);
    rows.push({
      key,
      name: slot.name,
      value,
      club,
      delta: club == null ? null : value - club,
      n: slot.values.length,
    });
  }

  /* Ordenado pela distância até o clube, do mais acima para o mais abaixo — e
     não pela nota. Uma lista ordenada por nota diz em que a pessoa é generosa,
     que é quase sempre a mesma ordem para todo mundo (ninguém é duro com trilha
     e mole com roteiro por acaso: os critérios têm médias diferentes entre si).
     Ordenada por delta, a lista diz o que é *dela*, e a primeira linha é a
     resposta à pergunta que trouxe alguém ao perfil.

     Um critério sem clube para comparar cai para o fim, porque ele não responde
     essa pergunta — mas fica, porque a nota dela existe e é verdade. */
  return rows.sort((a, b) => {
    if (a.delta == null) return b.delta == null ? b.value - a.value : 1;
    if (b.delta == null) return -1;
    return b.delta - a.delta;
  });
}

/* ── o que ela mais amou e o que mais detestou ────────────────────────────
   As duas melhores frases de qualquer perfil, e as duas mais baratas: não são
   médias, são as pontas de uma lista que já existe.

   Empate resolvido pela ficha mais recente, porque entre dois 9,0 o que a
   pessoa diria hoje é o de hoje. Ausente quando a ponta de cima e a de baixo
   são a mesma ficha — uma pessoa com uma nota só não tem extremos, tem uma
   nota — e quando não há distância entre elas, pela mesma razão que faz o feed
   se calar: onze notas iguais não têm alto nem baixo. */
export function endsOf(reviews: Review[], reviewerId: string) {
  const mine = takesOf(reviews, reviewerId);
  if (mine.length < FLOOR.ends) return null;
  const byScore = [...mine].sort((a, b) => b.final - a.final || String(b.date).localeCompare(String(a.date)));
  const best = byScore[0];
  const worst = byScore[byScore.length - 1];
  if (best.id === worst.id || best.final - worst.final < 1) return null;
  return { best, worst };
}

/* ── ela contra o público do TMDB ─────────────────────────────────────────
   A única régua externa que este produto tem. `crowd` já viaja em toda ficha —
   é lido do cache do filme, não gravado com a avaliação — então a comparação
   sai de graça e diz uma coisa que o clube sozinho não sabe: se esta pessoa é
   mais dura ou mais mole que o mundo lá fora.

   Média das diferenças por filme, e não diferença das médias. As duas dão o
   mesmo número quando todo filme tem nota do TMDB, e divergem quando não têm —
   e é a primeira que responde "em média, o quanto ela se afasta", que é a
   pergunta. */
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

/* ── a régua dela ─────────────────────────────────────────────────────────
   A distribuição das notas finais em dez faixas de um ponto. Responde uma
   pergunta que a média esconde: esta pessoa usa a escala inteira ou mora entre
   o 7 e o 8?

   Duas pessoas com média 7,4 podem ser completamente diferentes — uma que dá
   7 e 8 em tudo e outra que dá 3 e 10 —, e a segunda é muito mais interessante
   de ter no clube. A média não distingue as duas; isto distingue. */
export function spreadOf(reviews: Review[], reviewerId: string) {
  const mine = takesOf(reviews, reviewerId);
  if (!mine.length) return null;
  const bins = Array.from({ length: 10 }, () => 0);
  for (const r of mine) {
    // 10,0 pertence à última faixa, não a uma décima primeira que não existe.
    bins[Math.min(9, Math.max(0, Math.floor(r.final)))] += 1;
  }
  const finals = mine.map(r => r.final);
  return {
    bins,
    peak: Math.max(...bins),
    low: Math.min(...finals),
    high: Math.max(...finals),
    avg: mean(finals),
    n: mine.length,
  };
}

/* ── com quem ela concorda ────────────────────────────────────────────────
   O módulo mais social da página, e ele não existiria em nenhum outro app de
   filme: é uma rede social medida em gosto, não em quem segue quem.

   Para cada outra pessoa, a distância média entre as duas notas finais nos
   filmes que as DUAS avaliaram. Perto de zero é acordo; longe é o par que rende
   discussão — e discussão é o produto.

   Só o filme em comum entra. Comparar a média geral de duas pessoas seria
   comparar o que cada uma escolheu assistir, não o que elas acharam da mesma
   coisa: alguém que só vê terror teria média baixa e pareceria implicante.

   ── por que a distância e não a diferença com sinal ─────────────────────
   Porque a pergunta é "vocês concordam?", e discordar para cima e para baixo
   são a mesma discordância. Uma média com sinal cancelaria as duas: quem dá
   dois pontos a mais num filme e dois a menos no outro apareceria em acordo
   perfeito, que é o contrário do que aconteceu. */
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

/* ── você e ela, ficha por ficha ──────────────────────────────────────────
   O módulo mais ambicioso da página. Não é uma média: são os filmes que vocês
   dois viram, com as duas notas lado a lado e a distância entre elas.

   Ordenado pela distância, do maior desacordo para o menor, porque é para isso
   que se abre isto. Ninguém compara duas fichas para descobrir onde concordou.

   Devolve a lista mesmo abaixo do piso da afinidade — quem apertou "comparar"
   já sabe com quem, e um filme em comum é um filme em comum. O piso governa se
   o CARD é oferecido; aberto, ele mostra o que tem. */
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

/* ── o que o clube devolveu para ela ──────────────────────────────────────
   Reação recebida, nunca dada: quantas concordâncias e discordâncias as fichas
   dela juntaram, e quantas curtidas o que ela escreveu recebeu.

   Recebida e não dada porque um perfil é sobre como a pessoa é lida pelo clube.
   Quantas vezes ela curtiu os outros é um fato sobre o comportamento dela, e
   exibi-lo transformaria a página num relatório de atividade. */
export function reactionsOf(
  votes: { reviewId: string; value: number }[],
  commentLikes: { commentId: string }[],
  comments: { id: string; reviewerId: string }[],
  reviews: Review[],
  reviewerId: string
) {
  const hers = new Set(takesOf(reviews, reviewerId).map(r => r.id));
  let agree = 0;
  let differ = 0;
  for (const v of votes) {
    if (!hers.has(v.reviewId)) continue;
    if (v.value === 1) agree += 1;
    else if (v.value === -1) differ += 1;
  }
  const written = new Set(comments.filter(c => c.reviewerId === reviewerId).map(c => c.id));
  const likes = commentLikes.filter(l => written.has(l.commentId)).length;
  return { agree, differ, likes, wrote: written.size };
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
