import { useCallback, useEffect, useState } from 'react';
import { MessageSquare, ThumbsDown, ThumbsUp } from 'lucide-react';
import { Bill, Blank, Fault, Poster, Reel, Skeleton, Strip } from '@/components/bits';
import { api, fmt, initialsOf, reelColor, type FeedEvent } from '@/lib/api';
import { plural } from '@/lib/utils';
import { useClub } from '@/App';

/* ══════════════════════════════════════════════════════════════════════════
   O FEED

   Chamou-se Mural por um dia. O nome caiu por colidir: "wall" neste projeto já
   é a parede de celuloide que fica atrás de tudo, e o servidor sempre disse
   feed — `/api/feed`, routes/feed.js. Três nomes para duas coisas viravam dois
   nomes para duas coisas.

   O clube tinha três coisas que produzem sinal social — comentário, curtida,
   aviso — e nenhuma que o mostrasse junto. O sino é privado: se a Beren avaliou
   ontem à noite e o Leonardo discordou da montagem dela, os dois sabem e mais
   ninguém. Esta é a tela que faltava, e o princípio que ela serve já estava
   escrito: *o grupo é visível*.

   ── por que isto não é o feed de qualquer produto ───────────────────────
   Porque a linha da avaliação carrega os onze critérios. Um feed que dissesse
   "fulano avaliou Parasita — 8,5" seria intercambiável com qualquer app de
   filme; este diz onde a pessoa se entusiasmou e onde se decepcionou, na mesma
   linha, e é disso que sai conversa. A régua de células ao lado é a mesma que o
   arquivo usa, então uma nota é reconhecível como nota antes de ser lida.

   ── a densidade é o desenho ─────────────────────────────────────────────
   Dois tipos de acontecimento, e eles não pesam o mesmo. A avaliação é o
   assunto — pôster, nota, régua, os dois extremos, o que a pessoa escreveu. O
   comentário é a conversa em cima dela: uma linha, sem pôster, com o filme dito
   por escrito.

   Um feed em que tudo tem o mesmo tamanho é uma lista, e uma lista é lida do
   começo ao fim ou não é lida. Este é feito para ser varrido: o olho cai nas
   fichas e as linhas menores preenchem o entre.

   Eram quatro tipos. O voto em critério e o filme posto na fila saíram no dia
   seguinte — ver routes/feed.js: um voto acontece até onze vezes por ficha por
   pessoa, e uma noite de discussão enterrava a ficha embaixo das linhas sobre
   ela. O voto continua na tela como contagem na própria ficha, que é onde ele
   significa alguma coisa.
   ══════════════════════════════════════════════════════════════════════════ */

/* De dois minutos, e só com a aba à vista — a mesma regra do sino, pelo mesmo
   motivo: o clube deixa isto aberto ao lado do Discord por horas. Mais lento
   que o sino porque um aviso é sobre você e um feed é sobre todo mundo: chegar
   dois minutos atrasado a um feed não custa nada. */
const POLL_MS = 120_000;

/* ── o dia como cabeçalho ─────────────────────────────────────────────────
   Um feed sem quebra de dia é uma coluna de horas soltas, e "14:22" não diz
   nada sem saber de quando. Hoje e ontem por extenso porque é assim que se fala
   deles; o resto por data, com o ano só quando não é este — um clube com dois
   anos de arquivo precisa da diferença, e um com dois meses não. */
function dayOf(iso: string) {
  const at = new Date(iso.includes('T') ? iso : iso.replace(' ', 'T') + 'Z');
  if (Number.isNaN(at.getTime())) return '—';
  const midnight = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((midnight(new Date()) - midnight(at)) / 86400000);
  if (days <= 0) return 'Hoje';
  if (days === 1) return 'Ontem';
  return at.toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: 'long',
    year: at.getFullYear() === new Date().getFullYear() ? undefined : 'numeric',
  });
}

/** Só a hora na linha: o dia já foi dito no cabeçalho acima dela. */
function clockOf(iso: string) {
  const at = new Date(iso.includes('T') ? iso : iso.replace(' ', 'T') + 'Z');
  if (Number.isNaN(at.getTime())) return '';
  // Uma ficha antiga só tem a data, sem hora — ver `recorded_at` em db.js. Aí
  // a hora seria meia-noite inventada, e é melhor não dizer nada.
  if (!/\d\d:\d\d/.test(iso)) return '';
  return at.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

export function FeedScreen() {
  const club = useClub();
  const [items, setItems] = useState<FeedEvent[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const got = await api<{ items: FeedEvent[] }>('/api/feed');
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
        {/* No formato do que vai chegar, e não um spinner: a página não muda de
            forma quando o conteúdo pousa. */}
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
          Quando alguém avaliar um filme ou comentar uma ficha, aparece aqui — do mais recente para
          o mais antigo.
        </Blank>
      </section>
    );
  }

  /* Agrupado na renderização e não no estado: o dia de um acontecimento é uma
     função da hora dele, e guardar isso em paralelo seria um segundo lugar onde
     a mesma verdade pode ficar velha à meia-noite. */
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
                /* Grudado no que vem depois e afastado do que veio antes: um
                   cabeçalho a igual distância dos dois lados pertence a ambos e
                   a nenhum. */
                <p className="legend mb-3 mt-7 first:mt-0">{day}</p>
              ) : null}
              {/* As duas linhas levam à mesma ficha: o comentário é sobre ela.
                  `reviewId` sempre existe agora que só avaliação e comentário
                  chegam aqui, mas a queda para o pôster fica — é uma linha, e é
                  ela que impede uma tela em branco se o servidor voltar a
                  mandar um tipo que não aponta para ficha nenhuma. */}
              {e.kind === 'review' ? (
                <Rated e={e} onOpen={() => club.goReview(e.reviewId!)} />
              ) : (
                <Aside
                  e={e}
                  onOpen={() => (e.reviewId ? club.goReview(e.reviewId) : club.openSheet(e.movieId))}
                />
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

/* ── a ficha, que é o assunto ─────────────────────────────────────────────
   A única linha do feed que ganha uma placa, e ela ganha porque é a única que
   tem conteúdo próprio: uma nota, uma régua, dois critérios e, quando existe,
   o que a pessoa escreveu. As outras três são sobre esta.

   Toda a placa é um botão, e isso é uma decisão contra o hábito: a alternativa
   é um título clicável dentro de um cartão inerte, que faz a pessoa mirar em
   quatro palavras quando a placa inteira quer dizer a mesma coisa. Nada dentro
   é clicável, então não há controle dentro de controle. */
function Rated({ e, onOpen }: { e: FeedEvent; onOpen: () => void }) {
  const club = useClub();
  const talk = club.comments.filter(c => c.reviewId === e.reviewId).length;
  /* ── concordar e discordar são dois números ─────────────────────────────
     Eram um só, somados e desenhados sob um polegar para cima — então uma ficha
     com três discordâncias anunciava "👍 3", que é o contrário do que
     aconteceu. Um contador que junta as duas direções não está contando
     reação, está contando barulho, e o ícone escolhia um lado pelos dois.

     Separados e silenciosos no zero, a mesma regra do voto no arquivo: uma
     ficha só com discordância mostra só o polegar para baixo. */
  const cast = club.votes.filter(v => v.reviewId === e.reviewId);
  const agree = cast.filter(v => v.value === 1).length;
  const differ = cast.filter(v => v.value === -1).length;
  const clock = clockOf(e.at);

  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`Abrir a avaliação de ${e.movieTitle} por ${e.actor.name}`}
      className="plate group mb-3 flex w-full gap-4 p-4 text-left transition-colors duration-150 hover:bg-house-seat"
    >
      <Poster src={e.moviePoster} className="aspect-[2/3] w-[54px] flex-none sm:w-[62px]" />

      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <Reel color={reelColor(e.actor.dot, e.actor.id)} src={club.avatarOf(e.actor.id)} size="sm">
            {initialsOf(e.actor.name)}
          </Reel>
          <span className="font-display text-[13px] uppercase tracking-[0.1em] text-ink">
            {e.actor.name}
          </span>
          <span className="text-[12.5px] text-ink-dim">avaliou</span>
          {clock ? <span className="q ml-auto text-[10.5px] text-ink-faint">{clock}</span> : null}
        </span>

        <span className="mt-1.5 flex flex-wrap items-baseline gap-x-3">
          <span className="font-display text-[22px] leading-none tracking-[0.02em] text-beam transition-colors group-hover:text-beam-hot">
            {e.movieTitle}
          </span>
          <span className="q text-[11.5px] text-ink-dim">{e.genre}</span>
        </span>

        {/* A nota como número e como comprimento, do mesmo jeito que o arquivo
            a mostra: a régua é o que deixa duas fichas comparáveis com o olho,
            sem ler os dois números. */}
        <span className="mt-2.5 flex items-center gap-3">
          <Strip value={e.final ?? 0} cells={10} className="h-[6px] w-[120px] flex-none" />
          <span className="q text-[15px] font-medium text-beam">{fmt(e.final ?? 0)}</span>
          <span className="q text-[11px] text-ink-faint">/10</span>
        </span>

        {/* ── onde ela se entusiasmou e onde se decepcionou ───────────────
            O que só este produto sabe dizer. Ausente quando a ficha não tem
            distância entre o alto e o baixo — ver `endsOf` no servidor: onze
            notas iguais não têm extremos, e apontá-los seria inventar uma
            opinião que ninguém teve. */}
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

        {/* Quantas pessoas responderam a esta ficha. Contado do que o clube já
            carregou, e não pedido ao servidor: os comentários e os votos já
            estão na memória desta aba desde o boot. Silencioso no zero — uma
            fileira de zeros embaixo de cada ficha conta que ninguém falou nada,
            que é ruído com formato de dado. */}
        {talk || agree || differ ? (
          <span className="mt-2.5 flex items-center gap-4 text-ink-faint">
            {talk ? (
              <span className="flex items-center gap-1.5" title={plural(talk, 'resposta', 'respostas')}>
                <MessageSquare className="h-3 w-3" strokeWidth={1.9} aria-hidden />
                <span className="q text-[11px] text-ink-dim">{talk}</span>
              </span>
            ) : null}
            {agree ? (
              <span
                className="flex items-center gap-1.5"
                title={`${plural(agree, 'concordância', 'concordâncias')} com um critério desta ficha`}
              >
                <ThumbsUp className="h-3 w-3" strokeWidth={1.9} aria-hidden />
                <span className="q text-[11px] text-ink-dim">{agree}</span>
              </span>
            ) : null}
            {differ ? (
              <span
                className="flex items-center gap-1.5"
                title={`${plural(differ, 'discordância', 'discordâncias')} de um critério desta ficha`}
              >
                <ThumbsDown className="h-3 w-3" strokeWidth={1.9} aria-hidden />
                <span className="q text-[11px] text-ink-dim">{differ}</span>
              </span>
            ) : null}
          </span>
        ) : null}
      </span>
    </button>
  );
}

/* ── a conversa em cima da ficha ──────────────────────────────────────────
   Uma linha, sem placa e sem pôster. É acontecimento real e não merece sumir,
   mas dar a ela a mesma superfície da ficha faria o feed inteiro pesar igual —
   e um feed que pesa igual é uma lista.

   O ícone à esquerda é a coluna que deixa o feed ser varrido: uma forma fixa
   numa posição fixa, e o olho aprende a pular ou a parar sem ler. */
function Aside({ e, onOpen }: { e: FeedEvent; onOpen: () => void }) {
  const club = useClub();
  const clock = clockOf(e.at);

  return (
    <button
      type="button"
      onClick={onOpen}
      className="group mb-1 flex w-full items-start gap-3 rounded-cell px-3 py-2.5 text-left transition-colors duration-150 hover:bg-beam/[0.05]"
    >
      <MessageSquare
        className="mt-[3px] h-3.5 w-3.5 flex-none text-ink-faint"
        strokeWidth={1.9}
        aria-hidden
      />
      <span className="min-w-0 flex-1">
        {/* A frase é montada aqui, e não no servidor como no sino. Lá ela é
            sobre você, na segunda pessoa; aqui é sobre duas outras pessoas, o
            nome de quem agiu já está desenhado ao lado, e o que sobra é curto
            demais para valer uma viagem pela rede. */}
        <span className="block text-[12.5px] leading-snug text-ink-dim">
          <span className="font-display uppercase tracking-[0.08em] text-ink">{e.actor.name}</span>{' '}
          comentou a ficha de <Who name={e.owner?.name} me={e.owner?.id === club.me.id} /> em{' '}
          <span className="text-ink transition-colors group-hover:text-beam">{e.movieTitle}</span>
        </span>
        {e.excerpt ? (
          <span className="mt-0.5 block break-words text-[12px] italic leading-snug text-ink-faint">
            “{e.excerpt}”
          </span>
        ) : null}
      </span>
      {clock ? <span className="q mt-0.5 flex-none text-[10.5px] text-ink-faint">{clock}</span> : null}
    </button>
  );
}

/* "a ficha de Beren" e "a sua ficha". A segunda pessoa é o que faz o feed
   parar de ser um boletim sobre estranhos: quando o acontecimento é sobre você,
   ele diz isso. */
function Who({ name, me }: { name?: string; me?: boolean }) {
  if (me) return <span className="text-dye-brass">você</span>;
  return <span className="text-ink">{name ?? 'alguém'}</span>;
}

