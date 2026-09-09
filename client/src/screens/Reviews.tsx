import { useEffect, useRef, useState } from 'react';
import {
  ArrowDownWideNarrow,
  ArrowUpNarrowWide,
  ChevronDown,
  Pencil,
  Plus,
  Trash2,
} from 'lucide-react';
import {
  Bill,
  Blank,
  Chip,
  Drawer,
  IconKey,
  Key,
  Poster,
  Reel,
  ReelPicker,
  SearchField,
} from '@/components/bits';
/* Voto, conversa e detalhamento saíram desta tela e viraram peça: o feed e o
   perfil abrem a ficha no lugar, com as mesmas regras. */
import { Conversation, TakeVotes } from '@/components/social';
import { Breakdown, OriginNote, OriginTag } from '@/components/take';
import { PersonReel } from '@/components/person';
import { cdel, fmt, initialsOf, reelColor, runtimeOf, type Review } from '@/lib/api';
import { cn, named, norm, plural } from '@/lib/utils';
import { useClub } from '@/App';

export function ReviewsScreen() {
  const club = useClub();
  /* Por filme e não por pessoa: o que se vem perguntar aqui é "o que a gente
     achou daquele", e a resposta é um filme com as fichas de todo mundo. */
  const [view, setView] = useState<'reviewer' | 'movie'>('movie');
  /* Um conjunto e não um id: duas fichas abertas lado a lado é a comparação para
     a qual esta tela existe. */
  const [openIds, setOpenIds] = useState<ReadonlySet<string>>(() => new Set());
  /* Da maior para a menor: o arquivo é lido para achar o que o clube mais gostou
     muito mais vezes do que o contrário. */
  const [desc, setDesc] = useState(true);

  /* A ficha que o endereço pede. As gavetas animam de `0fr` a `1fr` em 240ms, e
     rolar antes disso mira um elemento de altura zero — daí o atraso abaixo. O
     alvo é limpado assim que consumido, senão fechar a carta à mão seria
     desfeito no próximo redesenho. */
  const wanted = club.focusReview;
  const { clearFocusReview } = club;
  /* Dois estados e não um, e isso conserta um defeito real: `flash` é o brilho e
     TEM de apagar; `arrived` é a chegada e NÃO pode. Na mesma variável, a carta
     ficava aberta por causa do brilho — e se fechava com ele, dois segundos e
     meio depois, levando a ficha junto. */
  const [flash, setFlash] = useState<string | null>(null);
  const [arrived, setArrived] = useState<string | null>(null);
  const timers = useRef<number[]>([]);

  useEffect(() => {
    if (!wanted) return;
    const target = club.reviews.find(r => r.id === wanted);
    if (!target) {
      clearFocusReview();
      return;
    }

    setOpenIds(prev => (prev.has(wanted) ? prev : new Set(prev).add(wanted)));
    setArrived(wanted);
    setFlash(wanted);
    clearFocusReview();

    /* Os temporizadores ficam em ref e NÃO no cleanup deste efeito: ele apaga o
       próprio gatilho — `clearFocusReview()` zera `wanted`, que é dependência
       daqui —, então o React roda o cleanup no instante seguinte. Ali dentro,
       os dois eram cancelados antes de disparar. */
    const gentle = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    timers.current.push(
      window.setTimeout(() => {
        document.getElementById(`take-${wanted}`)?.scrollIntoView({
          behavior: gentle ? 'auto' : 'smooth',
          block: 'center',
        });
      }, 300),
      window.setTimeout(() => setFlash(null), 2600)
    );
  }, [wanted, club.reviews, clearFocusReview]);

  useEffect(() => {
    const pending = timers.current;
    return () => {
      pending.forEach(window.clearTimeout);
      pending.length = 0;
    };
  }, []);
  const [query, setQuery] = useState('');

  /** Qual pessoa a tela está mostrando, ou null para o clube inteiro. */
  const [quem, setQuem] = useState<string | null>(null);

  /* ── quem tem ficha aqui ────────────────────────────────────────────────
     Contado do próprio arquivo: um retrato que leva a uma lista vazia é a tira
     prometendo o que não tem. Na ordem do clube, para ela não se reorganizar
     sozinha toda vez que alguém grava uma ficha. */
  const contagem = new Map<string, number>();
  club.reviews.forEach(r => contagem.set(r.reviewerId, (contagem.get(r.reviewerId) ?? 0) + 1));
  const gente = club.reviewers
    .map(p => ({ ...p, count: contagem.get(p.id) ?? 0 }))
    .filter(p => p.count > 0);

  /* Quem sai do clube, ou tem a última ficha apagada, não pode deixar a tela
     vazia e sem explicação: o filtro cai sozinho para o arquivo inteiro. */
  if (quem && !gente.some(p => p.id === quem)) setQuem(null);

  /* Filme ou pessoa, no mesmo campo: esta tela é lida das duas maneiras, e uma
     busca só de filmes responderia metade das perguntas feitas a ela. */
  const searching = query.trim().length > 0;
  /* As duas peneiras contam para a mesma pergunta — o que está à vista não é o
     arquivo —, e é ela que decide se as cartas abrem sozinhas. */
  const filtering = searching || quem !== null;
  const q = norm(query.trim());
  const shown = club.reviews.filter(r => {
    if (quem && r.reviewerId !== quem) return false;
    if (!searching) return true;
    return named(q, r.movieTitle, r.movieOriginal, r.movieEnglish) || named(q, r.reviewerName);
  });

  async function remove(r: Review) {
    if (!confirm(`Excluir a avaliação de "${r.movieTitle}"? Essa ação não pode ser desfeita.`)) return;
    try {
      await cdel(`/reviews/${r.id}`);
      club.reload({ reviews: club.reviews.filter(x => x.id !== r.id) });
    } catch (e) {
      club.fault('Não foi possível excluir: ' + (e as Error).message);
    }
  }

  const toggle = (id: string) =>
    setOpenIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <section>
      <Bill
        title="Avaliados"
        note={
          filtering
            ? `${shown.length} de ${club.reviews.length} avaliações`
            : `${club.reviews.length} avaliações · ${club.reviewers.length} avaliadores`
        }
      />

      {club.reviews.length ? (
        <div className="mb-5 max-w-[440px]">
          <SearchField
            value={query}
            onChange={setQuery}
            placeholder="Buscar por filme ou avaliador…"
            hint={searching ? 'busca no que o clube já gravou, não no TMDB' : undefined}
          />
        </div>
      ) : null}

      {/* ── a chave de quem avaliou ──────────────────────────────────────
          A mesma da fila de filmes: retrato, nome e quantos. O campo de busca
          já achava um avaliador pelo nome, mas achar não é filtrar — era
          preciso saber o nome, escrever certo, e o resultado misturava as
          fichas dela com os filmes cujo título casasse. A chave é a pergunta
          "o que ELA achou" com um toque, e diz de quantas fichas se trata
          antes de alguém escolher.

          Some numa sala de uma pessoa só: um filtro com uma opção é um botão
          que não tem o que escolher. */}
      {gente.length > 1 ? (
        <div className="mb-5">
          <ReelPicker
            title="Quem avaliou"
            value={quem}
            onPick={setQuem}
            choices={[
              {
                id: null,
                label: 'O clube',
                count: club.reviews.length,
                hint: 'Ver o arquivo do clube inteiro',
              },
              ...gente.map(p => ({
                id: p.id,
                label: p.name,
                count: p.count,
                hint: `Ver só as fichas de ${p.name}`,
                reel: (
                  <Reel color={reelColor(p.dot, p.id)} src={p.avatar ?? null} size="md">
                    {initialsOf(p.name)}
                  </Reel>
                ),
              })),
            ]}
          />
        </div>
      ) : null}

      <div className="mb-6 flex flex-wrap items-center gap-2">
        {(['reviewer', 'movie'] as const).map(v => (
          <Chip key={v} on={view === v} onClick={() => setView(v)}>
            {v === 'reviewer' ? 'Por avaliador' : 'Por filme'}
          </Chip>
        ))}

        {/* Um botão e não dois chips: dois estados de uma coisa só, e dois chips
            fariam o olho ler quatro escolhas onde há três. Afastado dos chips
            por uma folga maior — eles escolhem O QUE se agrupa, este a ORDEM. */}
        <button
          type="button"
          onClick={() => setDesc(d => !d)}
          aria-label={desc ? 'Ordenando da maior nota; inverter' : 'Ordenando da menor nota; inverter'}
          title={desc ? 'Da maior nota para a menor' : 'Da menor nota para a maior'}
          className="ml-2 flex items-center gap-2 rounded-cell bg-house-seat/70 px-3 py-1.5 font-display text-[12.5px] uppercase leading-none tracking-[0.12em] text-ink-dim ring-1 ring-house-rail transition-colors duration-150 hover:text-ink hover:ring-white/25"
        >
          {desc ? (
            <ArrowDownWideNarrow className="h-3.5 w-3.5 flex-none" strokeWidth={1.8} aria-hidden />
          ) : (
            <ArrowUpNarrowWide className="h-3.5 w-3.5 flex-none" strokeWidth={1.8} aria-hidden />
          )}
          {desc ? 'Maior nota' : 'Menor nota'}
        </button>
      </div>

      {filtering && !shown.length ? (
        searching ? (
          <Blank title="Nenhuma avaliação com esse nome">
            A busca cobre o filme — em português, no original ou em inglês — e o nome de quem avaliou. Limpe o
            campo para ver o registro inteiro.
          </Blank>
        ) : (
          <Blank title="Nenhuma avaliação dessa pessoa">
            Escolha <span className="text-ink">O clube</span> para ver o arquivo inteiro.
          </Blank>
        )
      ) : view === 'reviewer' ? (
        <ByReviewer
          reviews={shown}
          filtering={filtering}
          desc={desc}
          openIds={openIds}
          lit={flash}
          arrived={arrived}
          onToggle={toggle}
          onDelete={r => void remove(r)}
        />
      ) : (
        <ByMovie
          reviews={shown}
          desc={desc}
          openIds={openIds}
          lit={flash}
          arrived={arrived}
          onToggle={toggle}
          onDelete={r => void remove(r)}
        />
      )}
    </section>
  );
}

/* Uma ficha é de quem a deu. A tela oferecia "Editar" em todas, e aquele botão
   não editava a dos outros — o servidor assina a ficha com a sessão —, ele abria
   a SUA daquele filme. No lugar dele: um convite, num filme que você ainda não
   avaliou; nada, num que você já avaliou. */
function TakeActions({
  r,
  onDelete,
  className,
  invite = true,
}: {
  r: Review;
  onDelete: () => void;
  className?: string;
  /** Fica quieto onde o cartão do filme já carrega o convite (visão por filme). */
  invite?: boolean;
}) {
  const club = useClub();
  const mine = r.reviewerId === club.me.id;
  const rated = club.reviews.some(x => x.reviewerId === club.me.id && x.movieId === r.movieId);

  if (mine) {
    return (
      <div className={cn('flex gap-2', className)}>
        <Key tone="flush" onClick={() => club.rateMovie(r.movieId)}>
          <Pencil className="h-3.5 w-3.5" strokeWidth={1.8} />
          Editar
        </Key>
        <IconKey aria-label={`Excluir sua avaliação de ${r.movieTitle}`} onClick={onDelete}>
          <Trash2 className="h-4 w-4" strokeWidth={1.7} />
        </IconKey>
      </div>
    );
  }

  if (rated || !invite) return null;

  return (
    <div className={cn('flex gap-2', className)}>
      <Key tone="flush" onClick={() => club.rateMovie(r.movieId)}>
        <Plus className="h-3.5 w-3.5" strokeWidth={2} />
        Avaliar também
      </Key>
    </div>
  );
}

/* Morava dentro da gaveta, o que fazia a única ação que a tela quer oferecer
   ficar atrás da única interação que ninguém tinha motivo para fazer. */
function Invite({ movieId, className }: { movieId: number; className?: string }) {
  const club = useClub();
  const rated = club.reviews.some(x => x.reviewerId === club.me.id && x.movieId === movieId);
  if (rated) return null;
  return (
    <Key tone="flush" className={cn('px-3 py-2', className)} onClick={() => club.rateMovie(movieId)}>
      <Plus className="h-3.5 w-3.5" strokeWidth={2} />
      Avaliar também
    </Key>
  );
}

/* Fora do botão porque um botão dentro de outro não é coisa que o navegador
   monte. Escondida do leitor de tela: o gesto é o mesmo do botão ao lado, e um
   segundo `aria-expanded` seria a mesma frase duas vezes. */
function DrawerArrow({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  return (
    <span
      aria-hidden
      onClick={onToggle}
      className="flex flex-none cursor-pointer items-center py-3 pl-0.5"
    >
      <ChevronDown
        className={cn('h-4 w-4 text-ink-dim transition-transform duration-200', open && 'rotate-180')}
        strokeWidth={1.7}
      />
    </span>
  );
}

function Take({
  r,
  open,
  lit,
  onToggle,
  onDelete,
}: {
  r: Review;
  open: boolean;
  /** Recém-chegado por link: a ficha acende por alguns segundos. */
  lit?: boolean;
  onToggle: () => void;
  onDelete: () => void;
}) {
  return (
    /* Uma fileira dentro do cartão da pessoa, e não um cartão próprio: uma placa
       por filme em cima da placa dela seriam duas caixas reivindicando a mesma
       coisa. Um fio de cabelo basta. */
    <div
      id={`take-${r.id}`}
      /* Chegando por link, uma lâmina de luz por trás, apagando sozinha: um anel
         desenharia uma caixa em volta de uma fileira que não tem caixa.

         `scroll-mt` porque a marquise é fixa — sem isso o `scrollIntoView`
         entrega a fileira debaixo do cabeçalho. */
      className={cn(
        'scroll-mt-24 border-t border-white/[0.06] transition-colors duration-700',
        lit && 'bg-beam/[0.07]'
      )}
    >
      {/* Os polegares encostados na nota — é dela que se concorda. FORA do botão
          que abre a gaveta: reagir a uma nota não deve dobrar um painel. */}
      <div className="flex items-center gap-2 px-3 transition-colors hover:bg-beam/[0.05]">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          className="flex min-w-0 flex-1 items-center gap-3 py-3 text-left"
        >
          <Poster src={r.moviePoster} className="h-[52px] w-[35px] flex-none" />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[15px] font-semibold">{r.movieTitle}</span>
            <span className="q block text-[11px] text-ink-dim">
              {[r.movieYear ?? '—', runtimeOf(r.movieRuntime), r.movieGenre].filter(Boolean).join(' · ')}
            </span>
            {/* Entre os fatos do filme, e não na ponta da fileira: o porquê
                está em `OriginTag`. Uma ficha emprestada diz de que sala é sem
                precisar ser aberta, em qualquer largura de tela. */}
            {r.origin ? <OriginTag where={r.origin} className="mt-1" /> : null}
          </span>
          <span className="flex flex-none flex-col items-end gap-1">
            <span className="q font-display text-[24px] leading-none text-beam">{fmt(r.final)}</span>
            <CrowdNote crowd={r.crowd} />
          </span>
        </button>
        {/* A ficha de fora não tem polegar: concordar é um gesto da sala onde a
            ficha foi gravada, e aqui ela é acervo, não conversa. No lugar dele,
            a pastilha que diz de onde veio. */}
        {r.origin ? null : <TakeVotes take={r} />}
        <DrawerArrow open={open} onToggle={onToggle} />
      </div>
      <Drawer open={open}>
        <div className="px-3 pb-4 pt-1">
          <Breakdown r={r} comment={r.comment} />
          {r.origin ? <OriginNote where={r.origin} /> : <Conversation take={r} />}
          <TakeActions r={r} onDelete={onDelete} className="mt-4" />
        </div>
      </Drawer>
    </div>
  );
}

/* Nota de rodapé, com o número do clube grande: o veredito aqui é do clube, e o
   TMDB é aquilo contra o que ele se mede. Chamado de TMDB e não "o mundo" — é o
   público de um site, com o viés dele, e o clube tem direito de saber com quem
   está discordando. Calado quando o cache nunca viu o filme. */
function CrowdNote({ crowd }: { crowd: Review['crowd'] }) {
  if (!crowd) return null;
  return (
    <span className="q block text-[10.5px] leading-none text-ink-dim">TMDB {fmt(crowd.score)}</span>
  );
}

/* O espelho da visão por filme, com a mesma forma pelo mesmo motivo: esta tela é
   lida procurando UMA coisa nela, e quem se procura não é ajudado pelos outros
   cinco estarem abertos. Dois níveis — abrir a pessoa pergunta o que ela
   avaliou, abrir um filme pergunta o que ela deu em cada critério. */
function ByReviewer({
  reviews,
  filtering,
  desc,
  openIds,
  lit,
  arrived,
  onToggle,
  onDelete,
}: {
  reviews: Review[];
  /** Se há busca rodando — não para filtrar, só para decidir se as cartas abrem. */
  filtering: boolean;
  desc: boolean;
  openIds: ReadonlySet<string>;
  /** A ficha que chegou por link, acesa por alguns segundos. */
  lit: string | null;
  /** A mesma ficha, no valor que não apaga: abre a carta de quem a assinou. */
  arrived: string | null;
  onToggle: (id: string) => void;
  onDelete: (r: Review) => void;
}) {
  const club = useClub();

  /* Aqui e não no cartão: ele é redesenhado a cada mudança no acervo, e estado
     morando dentro dele se fecharia sozinho. Tudo começa fechado. */
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set());
  const toggleGroup = (id: string) =>
    setOpen(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  /* Abre a carta de quem assinou uma vez, como um clique abriria; daí em diante
     ela fecha quando alguém a fecha. É também o que faz o link continuar valendo
     depois de trocar de visão. */
  useEffect(() => {
    if (!arrived) return;
    const who = reviews.find(r => r.id === arrived)?.reviewerId;
    if (who) setOpen(prev => (prev.has(who) ? prev : new Set(prev).add(who)));
  }, [arrived, reviews]);

  /* A busca esconde quem ela não casou: uma coluna de nomes vazios não responde
     "o que ela avaliou". */
  const people = club.reviewers.filter(p => !filtering || reviews.some(r => r.reviewerId === p.id));

  if (!club.reviewers.length)
    return <Blank title="Nenhum avaliador cadastrado">Cadastre as pessoas do clube na seção Avaliadores.</Blank>;

  return (
    <>
      {people.map(p => {
        const items = reviews
          .filter(r => r.reviewerId === p.id)
          .sort((a, b) => (desc ? b.final - a.final : a.final - b.final));
        /* A busca abre toda carta que casou: fechada, ela mostraria o nome de
           quem avaliou o filme digitado e esconderia o filme. Um link abre pelo
           `setOpen` do efeito acima e não por uma condição aqui — a condição foi
           o defeito, porque dependia do destaque, que apaga sozinho. */
        const expanded = filtering || open.has(p.id);
        /* Quem não avaliou nada não abre: uma seta que desdobra gaveta vazia é
           uma promessa que o cartão não cumpre. */
        const openable = items.length > 0;

        return (
          <div
            key={p.id}
            className="mb-4 overflow-hidden rounded-cell bg-house-seat/55 ring-1 ring-inset ring-white/[0.06]"
          >
            {/* ── o rosto abre a pessoa, a fileira abre a lista ──────────────
                Duas perguntas diferentes na mesma linha, e por isso dois
                controles irmãos em vez de um dentro do outro: o retrato leva ao
                perfil de quem assinou, e o resto da fileira desdobra o que ela
                avaliou. Enquanto tudo isto era um botão só, o retrato aqui era
                pixel morto. */}
            <div
              className={cn(
                'group flex items-center gap-3 px-3 transition-colors',
                openable && 'hover:bg-beam/[0.05]'
              )}
            >
              {/* `solo`: o nome desta pessoa mora dentro do botão da gaveta e
                  não pode virar link, então o retrato é o único caminho até o
                  perfil dela — e um caminho que só o mouse alcança não é um
                  caminho. */}
              <PersonReel person={p} size="md" solo />
              <button
                type="button"
                disabled={!openable}
                onClick={() => toggleGroup(p.id)}
                aria-expanded={openable ? expanded : undefined}
                className="flex min-w-0 flex-1 items-center gap-3 py-3 text-left"
              >
                <span className="min-w-0 flex-1">
                  <span
                    className={cn(
                      'block truncate font-display text-[17px] uppercase tracking-[0.1em] text-ink transition-colors',
                      openable && 'group-hover:text-beam'
                    )}
                  >
                    {p.name}
                  </span>
                  {/* How many films, and nothing else. A person's overall average
                      is not a fact about the person — it is a fact about whatever
                      they happened to have watched, and printed at the head of the
                      card it reads as a grade, inviting a comparison between two
                      members who never rated the same films. The numbers that mean
                      something are inside, one per film. */}
                  <span className="q block text-[11px] text-ink-dim">
                    {items.length ? plural(items.length, 'filme', 'filmes') : 'nenhuma avaliação'}
                  </span>
                </span>
                {openable ? (
                  <ChevronDown
                    className={cn(
                      'h-4 w-4 flex-none text-ink-dim transition-transform duration-200',
                      expanded && 'rotate-180'
                    )}
                    strokeWidth={1.7}
                  />
                ) : null}
              </button>
            </div>

            <Drawer open={expanded && openable}>
              <div className="flex flex-col">
                {items.map(r => (
                  <Take
                    key={r.id}
                    r={r}
                    open={openIds.has(r.id)}
                    lit={lit === r.id}
                    onToggle={() => onToggle(r.id)}
                    onDelete={() => onDelete(r)}
                  />
                ))}
              </div>
            </Drawer>
          </div>
        );
      })}
    </>
  );
}

/* ── the film, and everyone who sat through it ────────────────────────────
   One card per film, holding each person's take, opened one at a time or side
   by side. There was a chart above them once, plotting every reviewer's mark
   for every criterion on a shared 0–10 line with the spread called out beside
   it. It answered a question nobody was asking: the disagreement is legible by
   opening two takes and reading them, and the chart was a second, harder way to
   say the same thing — one that had to be decoded before it could be read. */
function ByMovie({
  reviews,
  desc,
  openIds,
  lit,
  arrived,
  onToggle,
  onDelete,
}: {
  /* Already filtered by the search upstairs, so this view never has to know
     one is running. */
  reviews: Review[];
  /** Which way the score runs — the films, and the takes inside each one. */
  desc: boolean;
  openIds: ReadonlySet<string>;
  /** A ficha que acabou de chegar por link, acesa por alguns segundos. */
  lit: string | null;
  /** A mesma ficha, no valor que não apaga: abre a carta do filme. */
  arrived: string | null;
  onToggle: (id: string) => void;
  onDelete: (r: Review) => void;
}) {
  /* Which films are showing their takes. Per film, and kept here rather than in
     the card, because the card is redrawn whenever anything in the record
     changes and state that lives inside it would fold itself back up.

     Everything starts closed. A record of forty films is read by looking for
     one of them, and the one being looked for is not helped by the other
     thirty-nine being open. */
  const [open, setOpen] = useState<ReadonlySet<number>>(() => new Set());
  const toggleGroup = (movieId: number) =>
    setOpen(prev => {
      const next = new Set(prev);
      if (next.has(movieId)) next.delete(movieId);
      else next.add(movieId);
      return next;
    });
  /* O par do efeito na outra visão: uma ficha que chegou por link abre a carta
     do filme dela, uma vez, e depois disso a carta é uma carta aberta como
     qualquer outra. Ver o comentário sobre `flash` e `arrived` na tela. */
  useEffect(() => {
    if (!arrived) return;
    const film = reviews.find(r => r.id === arrived)?.movieId;
    if (film != null) setOpen(prev => (prev.has(film) ? prev : new Set(prev).add(film)));
  }, [arrived, reviews]);

  /* Grouped by film and by film alone. The club watches together on Discord but
     rates whenever each person gets to it, so two people rating the same movie a
     week apart are still the same conversation — keying this by date used to
     split one film into unrelated cards. */
  const map: Record<string, Review[]> = {};
  reviews.forEach(r => {
    (map[String(r.movieId)] ||= []).push(r);
  });
  /* Ranked by the club's number, in the direction the control above asked for.
     The record is read as a ranking — "what did we like", and sometimes "what
     did we hate" — and the date a film happened to be rated says nothing about
     either. Films tied on the average fall back to the title so the order is
     stable between renders rather than shuffling on every reload; the tiebreak
     stays alphabetical in both directions, because a name has no worse end. */
  const mean = (rs: Review[]) => rs.reduce((s, r) => s + r.final, 0) / rs.length;
  const groups = Object.values(map).sort(
    (a, b) =>
      (desc ? mean(b) - mean(a) : mean(a) - mean(b)) ||
      a[0].movieTitle.localeCompare(b[0].movieTitle)
  );

  if (!groups.length)
    return <Blank title="Nenhum filme avaliado ainda">Quando alguém gravar a primeira nota, o filme aparece aqui com as avaliações de todo mundo juntas.</Blank>;

  return (
    <>
      {groups.map(items => {
        const head = items[0];
        const avg = items.reduce((s, r) => s + r.final, 0) / items.length;
        const sorted = [...items].sort((a, b) => (desc ? b.final - a.final : a.final - b.final));

        /* Toda ficha de todo filme aberta de uma vez é uma parede de nomes entre
           um filme e o próximo. Então um filme chega como filme — cartaz,
           título, o número do clube — e quem deu esse número está a um toque.

           Dois níveis, e eles significam coisas diferentes: abrir o filme
           pergunta QUEM, abrir uma pessoa pergunta o que ela deu em cada
           critério.

           A carta de uma ficha pedida por link também abre, pelo efeito acima e
           não por uma condição aqui — a condição foi o defeito: dependia do
           destaque, que apaga sozinho, e a carta fechava junto com ele. */
        const expanded = open.has(head.movieId);

        return (
          /* Here the card is the film and every take on it — the group is the
             unit, so the surface goes around the group. */
          <div
            key={head.movieId}
            className="mb-4 overflow-hidden rounded-cell bg-house-seat/55 ring-1 ring-inset ring-white/[0.06]"
          >
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-3">
              {/* The film opens the film. `Avaliar também` stays outside this
                  button rather than inside it: a control nested in another
                  control is not a thing a browser will build, and pressing
                  "rate this too" should never also fold a card open. */}
              {/* ── por que a linha inteira, e não uma fração dela ──────────
                  Isto dividia a linha com o "Avaliar também" e o resultado no
                  telefone era o cartão da imagem: o título reduzido a UMA letra
                  e a linha de dados quebrando palavra por palavra, com os
                  pontos separadores sozinhos em linhas próprias.

                  A causa não é o `flex-wrap` — é o `min-w-0` com `flex-1`. Sem
                  piso de largura, o navegador prefere ESPREMER o primeiro item
                  até quase zero a mandar o segundo para a linha de baixo, e o
                  espremido era o filme inteiro. `w-full` tira a escolha: no
                  telefone o filme ocupa a linha e o convite desce sozinho.

                  `min-w-0` fica, e é outro assunto: é ele que permite ao título
                  cortar com reticências dentro da largura que agora existe. */}
              <button
                type="button"
                onClick={() => toggleGroup(head.movieId)}
                aria-expanded={expanded}
                className="group flex w-full min-w-0 items-center gap-3 text-left sm:w-auto sm:flex-1"
              >
                <Poster src={head.moviePoster} className="h-[68px] w-[45px] flex-none" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[15px] font-semibold transition-colors group-hover:text-beam">
                    {head.movieTitle}
                  </span>
                  {/* The genres these takes were given under, not the film's.
                      Two members can rate the same film as different things —
                      one watched a horror, the other watched a drama — and
                      naming only the first would hide that the scores under
                      this average answered different questions. */}
                  <span className="q block text-[11px] text-ink-dim">
                    {[
                      head.movieYear ?? '—',
                      /* Any take that knows the runtime speaks for the film:
                         it is a fact about the film and not about the take, so
                         one member having rated it before the archive recorded
                         durations does not blank the number for everyone. */
                      runtimeOf(items.find(r => r.movieRuntime != null)?.movieRuntime),
                      [...new Set(items.map(r => r.movieGenre))].join(' · '),
                      plural(items.length, 'avaliação', 'avaliações'),
                    ]
                      .filter(Boolean)
                      /* Espaço NÃO separável antes do ponto: ele gruda no que
                         acabou de ser dito, e a quebra acontece depois dele. Com
                         espaço comum dos dois lados, uma linha estreita deixa o
                         ponto órfão no começo da linha seguinte — que foi o que
                         apareceu no telefone e não é erro de largura, é erro de
                         tipografia esperando uma largura estreita. */
                      .join(' · ')}
                  </span>
                </span>
                {/* Any take that knows it speaks for the film, same as the
                    runtime above: it is a fact about the film, so one member
                    having rated it before the archive recorded TMDB's number
                    does not blank the comparison for everyone. */}
                <span className="flex flex-none flex-col items-end gap-1">
                  <span className="q font-display text-[24px] leading-none text-beam">{fmt(avg)}</span>
                  <CrowdNote crowd={items.find(r => r.crowd)?.crowd} />
                </span>
                <ChevronDown
                  className={cn(
                    'h-4 w-4 flex-none text-ink-dim transition-transform duration-200',
                    expanded && 'rotate-180'
                  )}
                  strokeWidth={1.7}
                />
              </button>
              <Invite movieId={head.movieId} />
            </div>

            <Drawer open={expanded}>
              <div className="flex flex-col">
                {sorted.map(r => (
                  /* O mesmo id e o mesmo acender da outra visão: um link tem de
                     achar a ficha esteja o acervo agrupado por pessoa ou por
                     filme, e quem colou o link não sabe em qual das duas quem
                     recebeu está. */
                  <div
                    key={r.id}
                    id={`take-${r.id}`}
                    className={cn(
                      'scroll-mt-24 border-t border-white/[0.06] transition-colors duration-700',
                      lit === r.id && 'bg-beam/[0.07]'
                    )}
                  >
                    {/* O mesmo par de polegares da outra visão, no mesmo
                        lugar: colado na nota de quem assinou a ficha. É a
                        mesma pergunta nas duas — "achei alto demais" —, então
                        ela não pode existir só num dos dois jeitos de olhar o
                        mesmo acervo. */}
                    {/* O retrato de quem assinou fica fora do botão da gaveta,
                        pela mesma razão que os polegares ficam: leva ao perfil
                        dela, e um controle não se aninha em outro. */}
                    <div className="flex items-center gap-2 px-3 transition-colors hover:bg-beam/[0.05]">
                      <PersonReel
                        person={{ id: r.reviewerId, name: r.reviewerName, dot: r.reviewerDot }}
                        size="md"
                        solo
                      />
                      <button
                        type="button"
                        onClick={() => onToggle(r.id)}
                        aria-expanded={openIds.has(r.id)}
                        className="flex min-w-0 flex-1 items-center gap-3 py-2.5 text-left"
                      >
                        <span className="min-w-0 flex-1 truncate text-[13.5px]">{r.reviewerName}</span>
                        <span className="q flex-none text-[17px]">{fmt(r.final)}</span>
                      </button>
                      {r.origin ? <OriginTag where={r.origin} /> : <TakeVotes take={r} />}
                      <DrawerArrow open={openIds.has(r.id)} onToggle={() => onToggle(r.id)} />
                    </div>
                    <Drawer open={openIds.has(r.id)}>
                      <div className="px-3 pb-4 pt-1">
                        <Breakdown r={r} comment={r.comment} />
                        {r.origin ? <OriginNote where={r.origin} /> : <Conversation take={r} />}
                        <TakeActions r={r} onDelete={() => onDelete(r)} className="mt-4" invite={false} />
                      </div>
                    </Drawer>
                  </div>
                ))}
              </div>
            </Drawer>
          </div>
        );
      })}
    </>
  );
}
