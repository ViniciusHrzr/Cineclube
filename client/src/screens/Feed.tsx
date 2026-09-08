import { useCallback, useEffect, useState } from 'react';
import { ArrowUpRight, ChevronDown, MessageSquare, ThumbsDown, ThumbsUp } from 'lucide-react';
import { Bill, Blank, Drawer, Fault, Poster, Skeleton, Strip } from '@/components/bits';
/* As mesmas peças do acervo, não uma cópia compacta: regras escritas duas vezes
   divergem na terceira. */
import { Conversation, TakeVotes } from '@/components/social';
import { Breakdown } from '@/components/take';
import { PersonName, PersonReel } from '@/components/person';
import { capi, fmt, type FeedEvent, type Review } from '@/lib/api';
import { useLive } from '@/lib/live';
import { clockOf, cn, dayOf, plural } from '@/lib/utils';
import { useClub } from '@/App';

/* ── o feed ───────────────────────────────────────────────────────────────
   O sino é privado: se alguém avaliou ontem e outra pessoa discordou, os dois
   sabem e mais ninguém. Esta é a tela do princípio "o grupo é visível".

   A linha da avaliação carrega os onze critérios, e é disso que sai conversa —
   "fulano avaliou Parasita — 8,5" seria intercambiável com qualquer app.

   Dois tipos de acontecimento, com pesos diferentes de propósito: a avaliação é
   o assunto e ganha placa; o comentário é uma linha. Um feed em que tudo pesa
   igual é uma lista, e lista se lê do começo ao fim ou não se lê.

   Eram quatro tipos. O voto em critério e o filme posto na fila saíram — ver
   routes/feed.js: um voto acontece até onze vezes por ficha por pessoa, e uma
   noite de discussão enterrava a ficha embaixo das linhas sobre ela.

   Tudo se faz aqui: reagir, ler os onze critérios, responder. Cada viagem ao
   acervo desmontava o feed e custava a rolagem de volta. */

/* Mais lento que o sino porque um aviso é sobre você e um feed é sobre todo
   mundo. Só com a aba à vista: isto fica aberto por horas. */
const POLL_MS = 120_000;

/* A quebra por dia e o relógio da linha moram em lib/utils.ts: o mural do outro
   universo lê o tempo do mesmo jeito, e duas cópias divergem na terceira. */

export function FeedScreen() {
  const [items, setItems] = useState<FeedEvent[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const got = await capi<{ items: FeedEvent[] }>('/feed');
      setItems(got.items);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    void load();
    const tick = () => {
      if (document.visibilityState === 'visible') void load();
    };
    const id = window.setInterval(tick, POLL_MS);
    document.addEventListener('visibilitychange', tick);
    return () => {
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [load]);

  /* A linha nasce na tela de todo mundo no instante em que alguém escreve. O
     relógio acima é a rede de baixo, para quando a conexão ao vivo cair. */
  useLive(kinds => {
    if (kinds.has('social') || kinds.has('reviews')) void load();
  });

  if (error && !items) {
    return (
      <section>
        <Bill title="Feed" />
        <div className="max-w-[60ch]">
          <Fault detail={error}>Não foi possível carregar o feed.</Fault>
        </div>
      </section>
    );
  }

  if (!items) {
    return (
      <section>
        <Bill title="Feed" note="carregando…" />
        {/* No formato do que vai chegar: a página não muda de forma quando o
            conteúdo pousa. */}
        <div className="flex flex-col gap-3">
          {[0, 1, 2].map(i => (
            <div key={i} className="plate flex gap-4 p-4">
              <Skeleton className="aspect-[2/3] w-[54px] flex-none" />
              <div className="flex-1 space-y-2.5 pt-1">
                <Skeleton className="h-3 w-2/5" />
                <Skeleton className="h-4 w-3/5" />
                <Skeleton className="h-2.5 w-full" />
              </div>
            </div>
          ))}
        </div>
      </section>
    );
  }

  if (!items.length) {
    return (
      <section>
        <Bill title="Feed" />
        <Blank title="O clube ainda não fez nada">
          Quando alguém avaliar um filme ou comentar uma avaliação, aparece aqui — do mais recente para
          o mais antigo.
        </Blank>
      </section>
    );
  }

  /* Agrupado na renderização e não no estado: guardado, este valor fica velho à
     meia-noite. */
  let lastDay = '';

  return (
    <section>
      <Bill
        title="Feed"
        note={`${plural(items.length, 'acontecimento', 'acontecimentos')} no clube`}
      />

      <div className="max-w-[760px]">
        {items.map(e => {
          const day = dayOf(e.at);
          const opensDay = day !== lastDay;
          lastDay = day;
          return (
            <div key={e.id}>
              {opensDay ? (
                /* Grudado no que vem depois: um cabeçalho a igual distância dos
                   dois lados pertence a ambos e a nenhum. */
                <p className="legend mb-3 mt-7 first:mt-0">{day}</p>
              ) : null}
              {e.kind === 'review' ? <Rated e={e} /> : <Aside e={e} />}
            </div>
          );
        })}
      </div>
    </section>
  );
}

/* Quatro coisas empilhadas, e não um botão só: o corpo (que desdobra), o
   detalhamento, a barra de ação e a conversa. Um `<button>` dentro de outro não
   é coisa que o navegador monte, então a barra teve de sair do corpo.

   A régua acima da barra diz que dali para baixo o clique faz outra coisa que
   não abrir; sem ela os polegares pareceriam parte da superfície clicável.

   Duas gavetas e não uma: são duas perguntas — "o que ela achou de cada coisa"
   e "o que o clube disse disso". Juntá-las faria quem quer responder passar por
   onze números. */
function Rated({ e }: { e: FeedEvent }) {
  const club = useClub();
  /* Do acervo que o clube tem em memória desde o boot — nada é buscado. Nula só
     entre alguém apagar uma avaliação e o feed recarregar; aí a barra some, que
     oferecer um polegar para uma ficha morta é prometer um 404. */
  const review = club.reviews.find(r => r.id === e.reviewId) ?? null;
  const talk = club.comments.filter(c => c.reviewId === e.reviewId).length;
  const clock = clockOf(e.at);

  const [talking, setTalking] = useState(false);
  /* Aberta uma vez, montada para sempre: desmontar ao fechar faria a gaveta
     recolher de altura zero para altura zero, e montar as oitenta de saída é
     uma tela inteira de trabalho que ninguém pediu. */
  const [touched, setTouched] = useState(false);
  /* O mesmo par para o detalhamento. */
  const [open, setOpen] = useState(false);
  const [unfolded, setUnfolded] = useState(false);

  /* A placa já mostra o que a pessoa escreveu, cortado em 120 caracteres (ver
     `excerpt` em routes/feed.js). O detalhamento recebe o comentário exatamente
     quando o resumo não é ele — senão é a mesma frase duas vezes. */
  const written = review?.comment?.replace(/\s+/g, ' ').trim() ?? '';
  const clipped = !!written && written !== (e.excerpt ?? '');

  return (
    <div className="plate mb-3">
      {/* Fora do botão: dentro dele o rosto era pixel morto, porque um
          `<button>` dentro de outro não é coisa que o navegador monte. O
          `px-4 pt-4` daqui e o `pt-2.5` do botão somam o `p-4` de antes. */}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 px-4 pt-4">
        <PersonReel person={e.actor} size="sm" />
        <PersonName
          person={e.actor}
          className="font-display text-[13px] uppercase tracking-[0.1em] text-ink"
        />
        <span className="text-[12.5px] text-ink-dim">avaliou</span>
        {clock ? <span className="q ml-auto text-[10.5px] text-ink-faint">{clock}</span> : null}
      </div>

      {/* Sem a ficha em memória cai na folha do filme, que é sobreposta e também
          não tira ninguém do feed. */}
      <button
        type="button"
        onClick={() => {
          if (!review) {
            club.openSheet(e.movieId);
            return;
          }
          setOpen(v => !v);
          setUnfolded(true);
        }}
        aria-expanded={review ? open : undefined}
        aria-label={
          review
            ? `${open ? 'Fechar' : 'Abrir'} a avaliação de ${e.movieTitle} por ${e.actor.name}`
            : `Abrir os detalhes de ${e.movieTitle}`
        }
        className="group flex w-full gap-4 px-4 pb-4 pt-2.5 text-left transition-colors duration-150 hover:bg-house-seat"
      >
        <Poster src={e.moviePoster} className="aspect-[2/3] w-[54px] flex-none sm:w-[62px]" />

        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-baseline gap-x-3">
            <span className="font-display text-[22px] leading-none tracking-[0.02em] text-beam transition-colors group-hover:text-beam-hot">
              {e.movieTitle}
            </span>
            <span className="q text-[11.5px] text-ink-dim">{e.genre}</span>
          </span>

          <span className="mt-2.5 flex items-center gap-3">
            <Strip value={e.final ?? 0} cells={10} className="h-[6px] w-[120px] flex-none" />
            <span className="q text-[15px] font-medium text-beam">{fmt(e.final ?? 0)}</span>
            <span className="q text-[11px] text-ink-faint">/10</span>
          </span>

          {/* Ausente quando a ficha não tem distância entre o alto e o baixo —
              ver `endsOf` no servidor: onze notas iguais não têm extremos, e
              apontá-los seria inventar uma opinião que ninguém teve. */}
          {e.ends ? (
            <span className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px]">
              <span className="flex items-center gap-1.5 text-ink-dim">
                <ThumbsUp className="h-3 w-3 flex-none text-ink-faint" strokeWidth={1.9} aria-hidden />
                {e.ends.high.name}
                <span className="q text-beam">{fmt(e.ends.high.value)}</span>
              </span>
              <span className="flex items-center gap-1.5 text-ink-dim">
                <ThumbsDown className="h-3 w-3 flex-none text-ink-faint" strokeWidth={1.9} aria-hidden />
                {e.ends.low.name}
                <span className="q text-ink">{fmt(e.ends.low.value)}</span>
              </span>
            </span>
          ) : null}

          {e.excerpt ? (
            <span className="mt-2.5 block break-words text-[13px] italic leading-relaxed text-ink-dim">
              “{e.excerpt}”
            </span>
          ) : null}
        </span>

        {/* Alinhada com o título e não com o bloco: é dele que ela é a
            promessa. */}
        {review ? (
          <ChevronDown
            aria-hidden
            className={cn(
              'mt-1 h-4 w-4 flex-none text-ink-faint transition-transform duration-200 group-hover:text-ink-dim',
              open && 'rotate-180'
            )}
            strokeWidth={1.7}
          />
        ) : null}
      </button>

      {/* Antes da barra de ação: é mais da ficha, não mais uma ação sobre ela. */}
      <Drawer open={open}>
        {unfolded && review ? (
          <div className="px-4 pb-4">
            <Breakdown r={review} comment={clipped ? review.comment : undefined} />
          </div>
        ) : null}
      </Drawer>

      {/* Os números moram dentro dos próprios controles: o polegar que diz "duas
          pessoas concordaram" é o mesmo que se aperta para ser a terceira. Some
          junto com a ficha, senão a régua ficaria com nada embaixo. */}
      {review ? (
        <div className="flex flex-wrap items-center gap-2 border-t border-white/[0.06] px-4 py-2.5">
          <TakeVotes take={review} labelled />

          <button
            type="button"
            aria-expanded={talking}
            aria-label={
              `${talking ? 'Fechar' : 'Abrir'} a conversa da avaliação de ${e.actor.name}` +
              (talk ? `, ${plural(talk, 'resposta', 'respostas')}` : '')
            }
            title={talking ? 'Fechar a conversa' : 'Comentar esta avaliação'}
            onClick={() => {
              setTalking(v => !v);
              setTouched(true);
            }}
            className={cn(
              'flex h-7 items-center gap-1.5 rounded-cell px-2.5 ring-1 transition-colors duration-150',
              talking
                ? 'text-dye-brass ring-dye-brass/60 shadow-[inset_0_0_14px_rgba(217,164,65,0.18)]'
                : 'text-ink-dim ring-house-rail hover:text-beam hover:ring-white/25'
            )}
          >
            <MessageSquare className="h-3.5 w-3.5 flex-none" strokeWidth={1.9} aria-hidden />
            {/* Em tela estreita cai a palavra, nunca o número: sem rótulo sobra
                um balão, que se entende; sem número sobra um placar mentindo. */}
            <span className="hidden font-display text-[11px] uppercase leading-none tracking-[0.12em] sm:inline">
              {talking ? 'Fechar' : 'Comentar'}
            </span>
            {talk ? <span className="q text-[10.5px] leading-none opacity-80">{talk}</span> : null}
          </button>

          {/* O acervo como escolha, no fim da barra: lá a ficha aparece entre as
              outras do mesmo filme, que é a única coisa que o feed não mostra.
              Sem rótulo — uma quarta palavra quebraria a linha antes do
              tablet. */}
          <button
            type="button"
            onClick={() => club.goReview(review.id)}
            title="Abrir no acervo, junto das outras avaliações deste filme"
            aria-label={`Abrir no acervo a avaliação de ${e.movieTitle} por ${e.actor.name}`}
            className="ml-auto flex h-7 items-center rounded-cell px-1.5 text-ink-faint transition-colors duration-150 hover:text-beam"
          >
            <ArrowUpRight className="h-4 w-4 flex-none" strokeWidth={1.8} aria-hidden />
          </button>
        </div>
      ) : null}

      <Drawer open={talking}>
        {touched && review ? (
          /* Sem régua e sem título: a gaveta não contém mais nada além dela. No
             acervo a régua separa os onze números do que se disse deles. */
          <div className="px-4 pb-4">
            <Conversation take={review} ruled={false} />
          </div>
        ) : null}
      </Drawer>
    </div>
  );
}

/* Uma linha, sem placa e sem pôster: dar a ela a mesma superfície da ficha faria
   o feed inteiro pesar igual. O ícone à esquerda é a coluna fixa que deixa o
   feed ser varrido.

   Ela também abre a ficha embaixo de si, com o texto anunciado já aceso —
   `aimComment` diz qual é, e a conversa cresce até ele, rola e o acende (ver
   `focusComment` em components/social.tsx). */
function Aside({ e }: { e: FeedEvent }) {
  const club = useClub();
  const clock = clockOf(e.at);
  /* Nula se a ficha foi apagada entre a busca do feed e a do acervo; aí a linha
     abre a folha do filme, que também não tira ninguém daqui. */
  const review = club.reviews.find(r => r.id === e.reviewId) ?? null;
  const [open, setOpen] = useState(false);
  /* Montada só depois de pedida e nunca desmontada — o mesmo par das gavetas da
     placa. */
  const [unfolded, setUnfolded] = useState(false);
  const { aimComment } = club;

  function press() {
    if (!review) {
      club.openSheet(e.movieId);
      return;
    }
    const next = !open;
    setOpen(next);
    setUnfolded(true);
    /* Só ao ABRIR: reapontar ao fechar faria a conversa rolar atrás de um texto
       que acabou de sair da tela. */
    if (next && e.commentId) aimComment(e.commentId);
  }

  return (
    <div className="mb-1">
      <button
        type="button"
        onClick={press}
        aria-expanded={review ? open : undefined}
        className="group flex w-full items-start gap-3 rounded-cell px-3 py-2.5 text-left transition-colors duration-150 hover:bg-beam/[0.05]"
      >
        <MessageSquare
          className="mt-[3px] h-3.5 w-3.5 flex-none text-ink-faint"
          strokeWidth={1.9}
          aria-hidden
        />
        <span className="min-w-0 flex-1">
          {/* Montada aqui e não no servidor como no sino: lá a frase é sobre
              você, na segunda pessoa. */}
          <span className="block text-[12.5px] leading-snug text-ink-dim">
            <span className="font-display uppercase tracking-[0.08em] text-ink">{e.actor.name}</span>{' '}
            {/* Responder é outro gesto que comentar: anunciar uma resposta como
                "comentou a ficha" faz quem chega procurar um comentário de
                primeiro nível que não existe. */}
            {e.parentId ? 'respondeu um comentário na avaliação de ' : 'comentou a avaliação de '}
            <Who name={e.owner?.name} me={e.owner?.id === club.me.id} /> em{' '}
            <span className="text-ink transition-colors group-hover:text-beam">{e.movieTitle}</span>
          </span>
          {e.excerpt ? (
            <span className="mt-0.5 block break-words text-[12px] italic leading-snug text-ink-faint">
              “{e.excerpt}”
            </span>
          ) : null}
        </span>
        {clock ? (
          <span className="q mt-0.5 flex-none text-[10.5px] text-ink-faint">{clock}</span>
        ) : null}
        {review ? (
          <ChevronDown
            aria-hidden
            className={cn(
              'mt-[1px] h-3.5 w-3.5 flex-none text-ink-faint transition-transform duration-200',
              open && 'rotate-180'
            )}
            strokeWidth={1.7}
          />
        ) : null}
      </button>

      {/* Sobre uma superfície própria: a linha não tem placa, e sem uma caixa em
          volta o detalhamento flutuaria solto entre duas linhas do feed sem
          dizer de qual das duas é. */}
      <Drawer open={open}>
        {unfolded && review ? (
          <div className="ml-6 mr-1 mb-2 mt-1 rounded-cell bg-house-seat/55 p-3 ring-1 ring-inset ring-white/[0.06]">
            <TakeHead review={review} />
            <div className="mt-3">
              <Breakdown r={review} comment={review.comment} />
            </div>
            <Conversation take={review} />
          </div>
        ) : null}
      </Drawer>
    </div>
  );
}

/* Só a linha de conversa precisa disto: a placa já diz filme, rosto, nome e nota
   antes de desdobrar. Sem o cabeçalho, o detalhamento seriam onze números sem
   dizer de quem são. */
function TakeHead({ review }: { review: Review }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <Poster src={review.moviePoster} className="aspect-[2/3] w-[40px] flex-none" />
      <div className="min-w-0 flex-1">
        <p className="truncate font-display text-[17px] leading-none tracking-[0.02em] text-beam">
          {review.movieTitle}
        </p>
        <p className="mt-1.5 flex flex-wrap items-center gap-x-2 text-[12px] text-ink-dim">
          <PersonReel
            person={{ id: review.reviewerId, name: review.reviewerName, dot: review.reviewerDot }}
            size="sm"
          />
          <PersonName
            person={{ id: review.reviewerId, name: review.reviewerName, dot: review.reviewerDot }}
            className="font-display text-[12.5px] uppercase tracking-[0.1em] text-ink"
          />
        </p>
      </div>
      <span className="flex flex-none items-center gap-2.5">
        <Strip value={review.final} cells={10} className="hidden h-[6px] w-[90px] flex-none sm:block" />
        <span className="q font-display text-[20px] leading-none text-beam">{fmt(review.final)}</span>
      </span>
      <TakeVotes take={review} />
    </div>
  );
}

/* "a ficha de Beren" e "a sua ficha": quando o acontecimento é sobre você, a
   frase diz isso. */
function Who({ name, me }: { name?: string; me?: boolean }) {
  if (me) return <span className="text-dye-brass">você</span>;
  return <span className="text-ink">{name ?? 'alguém'}</span>;
}

