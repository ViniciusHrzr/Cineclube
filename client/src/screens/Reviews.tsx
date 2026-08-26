import { useEffect, useRef, useState } from 'react';
import {
  ArrowDownWideNarrow,
  ArrowUpNarrowWide,
  ChevronDown,
  Pencil,
  Plus,
  ThumbsDown,
  ThumbsUp,
  Trash2,
  X,
} from 'lucide-react';
import { Bill, Blank, Chip, IconKey, Key, Poster, Reel, SearchField, Strip } from '@/components/bits';
import { del, fmt, initialsOf, reelColor, runtimeOf, type Review, type ReviewComment } from '@/lib/api';
import { cn, named, norm, plural, whenOf } from '@/lib/utils';
import { useClub } from '@/App';

export function ReviewsScreen() {
  const club = useClub();
  /* By film, not by person. What the club comes here asking is "what did we
     think of that one", and the answer to that is a film with everyone's takes
     under it. */
  const [view, setView] = useState<'reviewer' | 'movie'>('movie');
  /* A set and not a single id: two takes on the same film, or the same film
     under two people, is exactly the comparison this screen exists for, and
     opening the second one used to close the first. */
  const [openIds, setOpenIds] = useState<ReadonlySet<string>>(() => new Set());
  /* Da maior para a menor por padrão: o arquivo é lido para achar o que o clube
     mais gostou muito mais vezes do que para achar o que ele detestou. */
  const [desc, setDesc] = useState(true);

  /* ── a ficha que o endereço pede ────────────────────────────────────────
     `#reviews/r1a2b3c` chega aqui como `club.focusReview`, e três coisas têm de
     acontecer para que o link tenha valor: a carta que contém a ficha se abre,
     a ficha se abre, e a página rola até ela.

     A ordem importa e o tempo também. As gavetas animam de `0fr` a `1fr` em
     240ms, e rolar antes disso mira um elemento que ainda tem altura zero — a
     página para no lugar errado e a ficha aparece fora da tela. Por isso o
     scroll espera a gaveta terminar.

     O alvo é limpado assim que é consumido: sem isso, fechar a carta à mão
     seria desfeito no próximo redesenho, e o acervo teria uma ficha que se
     recusa a fechar.

     Uma avaliação apagada — ou de um filme que a busca escondeu — não abre nada
     e não rola nada. O endereço fica, a aba abre, e é isso: é o que sobra de
     honesto quando a coisa apontada não está mais lá. */
  const wanted = club.focusReview;
  const { clearFocusReview } = club;
  /* Dois estados, e separá-los é o conserto de um defeito real: a ficha chegava
     por link, abria, e fechava sozinha dois segundos e meio depois.

     `flash` é o brilho, e ele TEM de apagar. `arrived` é a chegada, e ela NÃO
     pode apagar. Estavam na mesma variável, e a carta que contém a ficha — a
     pessoa numa visão, o filme na outra — estava aberta por causa do brilho.
     Quando o brilho apagava, a carta se fechava e levava a ficha junto.

     `arrived` sobrevive porque não é um efeito visual: é a resposta a "esta
     carta foi aberta?", e foi. A partir daí ela se comporta como qualquer carta
     que alguém abriu à mão, inclusive podendo ser fechada. */
  const [flash, setFlash] = useState<string | null>(null);
  const [arrived, setArrived] = useState<string | null>(null);
  /** Rolagem e apagar do destaque. Ver a nota longa dentro do efeito. */
  const timers = useRef<number[]>([]);

  useEffect(() => {
    if (!wanted) return;
    const target = club.reviews.find(r => r.id === wanted);
    if (!target) {
      clearFocusReview();
      return;
    }

    // A ficha abre; a carta que a contém é aberta pela visão, que sabe se
    // agrupa por pessoa ou por filme.
    setOpenIds(prev => (prev.has(wanted) ? prev : new Set(prev).add(wanted)));
    setArrived(wanted);
    setFlash(wanted);
    clearFocusReview();

    /* ── por que estes temporizadores não moram no cleanup deste efeito ────
       Porque este efeito apaga o próprio gatilho. `clearFocusReview()` acima
       zera `club.focusReview`, que é `wanted`, que é dependência daqui — então
       o React roda o cleanup deste efeito no instante seguinte a ele terminar.

       Com os `clearTimeout` ali dentro, os dois temporizadores que acabaram de
       ser agendados eram cancelados antes de disparar: a página não rolava e o
       destaque não apagava. Guardados em ref e limpos só na desmontagem, eles
       sobrevivem à limpeza do gatilho e continuam cancelando corretamente
       quando a pessoa sai da aba. */
    const gentle = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    timers.current.push(
      window.setTimeout(() => {
        document.getElementById(`take-${wanted}`)?.scrollIntoView({
          behavior: gentle ? 'auto' : 'smooth',
          block: 'center',
        });
      }, 300),
      // Longo o bastante para o olho encontrar depois de a rolagem terminar,
      // curto o bastante para não virar um estado permanente da fileira.
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

  /* Title or person, in one field. This screen is the club's record and it is
     read two ways — "what did we think of that one" and "what has she rated" —
     so a search that only matched films would answer half the questions asked
     of it. Both views filter from the same set, so switching between them
     while searching keeps the same answer on screen. */
  const filtering = query.trim().length > 0;
  const q = norm(query.trim());
  const shown = filtering
    ? club.reviews.filter(
        r => named(q, r.movieTitle, r.movieOriginal, r.movieEnglish) || named(q, r.reviewerName)
      )
    : club.reviews;

  async function remove(r: Review) {
    if (!confirm(`Excluir a avaliação de "${r.movieTitle}"? Essa ação não pode ser desfeita.`)) return;
    try {
      await del(`/api/reviews/${r.id}`);
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
            hint={filtering ? 'busca no que o clube já gravou, não no TMDB' : undefined}
          />
        </div>
      ) : null}

      <div className="mb-6 flex flex-wrap items-center gap-2">
        {(['reviewer', 'movie'] as const).map(v => (
          <Chip key={v} on={view === v} onClick={() => setView(v)}>
            {v === 'reviewer' ? 'Por avaliador' : 'Por filme'}
          </Chip>
        ))}

        {/* ── da maior ou da menor ────────────────────────────────────────
            Um botão e não dois chips: são dois estados de uma coisa só, e uma
            fila de filtros em que dois deles são o mesmo filtro invertido faz
            o olho ler quatro escolhas onde há três. O ícone diz para que lado a
            lista corre, e o rótulo ao lado diz em palavras — sozinho, um ícone
            de ordenação é um símbolo que cada produto desenha diferente.

            Separado dos chips por uma folga maior: eles escolhem O QUE se
            agrupa, este escolhe em QUE ORDEM. */}
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
        <Blank title="Nenhuma avaliação com esse nome">
          A busca cobre o filme — em português, no original ou em inglês — e o nome de quem avaliou. Limpe o
          campo para ver o registro inteiro.
        </Blank>
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

/* ── what you may do with a take ──────────────────────────────────────────
   A take belongs to whoever gave it. Yours is yours to change or to unsay;
   somebody else's is not, and the screen used to offer "Editar" on every one of
   them. That button did not edit theirs — it could not, the server signs a take
   with the session — it opened your own card for that film, which means the
   only thing it ever did was mislead.

   In its place, on a film you have not rated: an invitation. On one you already
   have, nothing at all — you have said your piece, and the record showing you
   somebody else's take is not a prompt to do anything about it. */
function TakeActions({
  r,
  onDelete,
  className,
  invite = true,
}: {
  r: Review;
  onDelete: () => void;
  className?: string;
  /* Where the film's own card already carries the invitation — the by-film
     view — this one stays quiet. Saying it twice on the same screen would make
     the reader check whether the two are different things. */
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

/* ── the invitation, where the film is ────────────────────────────────────
   It used to live inside the drawer, which meant the club only found out they
   could weigh in by opening somebody else's take first — the one action the
   screen wants to offer was behind the one interaction nobody had a reason to
   perform. It belongs next to the film's own score, in the open.

   The rule it carries is unchanged: on a film you have already rated there is
   nothing to invite, so nothing is drawn. */
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

/* ── the drawer ───────────────────────────────────────────────────────────
   Opening used to animate height from 0 to `auto`, which cannot be done without
   measuring: the panel mounts, its full height is read, and only then does the
   animation start from zero. If the browser paints in between — and it does —
   one frame lands at full height, and everything below the panel jumps down and
   comes straight back. That was the flick.

   A grid row measured in fractions needs no measurement. `0fr` to `1fr`
   interpolates natively, the browser resolves the content's height itself on
   every frame, and there is never a frame at the wrong size. The content stays
   mounted, so `visibility` is what closes it to the keyboard and to a screen
   reader — it is transitioned rather than switched, which lets it turn visible
   at the start of the opening and stay visible until the closing has finished. */
function Drawer({ open, children }: { open: boolean; children: React.ReactNode }) {
  return (
    <div
      /* No `motion-reduce` escape here, by the owner's standing decision: this
         is the same call as the wall's drift. Opening a drawer is a response to
         a click and not a performance played at the reader, and the height it
         travels is the only thing that says where the panel came from. */
      className={cn(
        'grid transition-[grid-template-rows] duration-[240ms] ease-beam',
        open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'
      )}
    >
      <div
        className={cn(
          'overflow-hidden transition-[visibility] duration-[240ms]',
          open ? 'visible' : 'invisible'
        )}
      >
        {children}
      </div>
    </div>
  );
}

/* ── one take, criterion by criterion ─────────────────────────────────────
   The detail is a recess, not a second plate. Now that the film itself carries
   a card, stacking another raised surface inside it would be two boxes doing
   the same job at the same height; sunk into the card instead — darker than
   what holds it — it reads as a compartment of that record rather than as a
   separate object sitting on top of it.

   Whatever the depth, the unit that gets an edge is the film someone sat
   through, not each individual number: boxing every criterion separately
   turned one record into ten little tickets.

   Inside it, a criterion and its mark stay close. The name column used to be
   fluid, which stretched it to fill its share of the grid and left a hand's
   width of nothing between "Direção" and the 7,0 that belongs to it; at that
   distance the eye reads two lists instead of one pair. It is now capped, so
   the marks still line up down the grid without the gap.

   The plate is also what these numbers were missing: sitting on nothing but the
   wall, with the beam moving behind them, they read as loose type rather than
   as a record. */
function Breakdown({ r, comment }: { r: Review; comment?: string }) {
  const rows = r.breakdown;
  return (
    /* The ring is inset. A Tailwind ring is a shadow cast outside the box, and
       this plate opens inside a container that clips its overflow to animate the
       height — flush against that container's top edge, the outer 1px lands
       outside the clip and the plate loses its lid. Drawn inside, it cannot be
       cropped by whatever it is opened in. */
    <div className="rounded-cell bg-house-deep/60 px-3 py-2.5 ring-1 ring-inset ring-white/[0.05]">
      {/* Filled down the columns rather than across the rows. The two criteria
          the genre weighs double are the last two on the card, and read across
          they landed diagonally apart — one at the end of a row, the other alone
          on the next — which is the least cohesive place two halves of a pair
          can be. Read down, they finish in the same column, one under the other.

          The row count is the criteria divided by the columns at that width, so
          this holds if a genre is ever given a third criterion. The DOM order
          never changes, so a screen reader still hears the card as it is written.

          Every row measures the same — a capped name, a fixed strip, a fixed
          number — so centring them in equal columns keeps them in register with
          each other and the block centred on the plate. */}
      <div
        style={
          {
            '--rows-1': rows.length,
            '--rows-2': Math.ceil(rows.length / 2),
            '--rows-3': Math.ceil(rows.length / 3),
          } as React.CSSProperties
        }
        /* Two columns from `md` and not from `sm`. The vote control added ~66px
           to every row, and at 640px two of these no longer fit inside the
           card's padding — the grid did not wrap, it overflowed, which on a
           breakdown means the tally of the right-hand column sitting off the
           edge of the drawer. One column is taller and correct; the second
           arrives when there is room for it. */
        className={cn(
          'grid grid-flow-col auto-cols-fr justify-items-center gap-x-4 gap-y-0.5',
          'grid-rows-[repeat(var(--rows-1),auto)]',
          'md:grid-rows-[repeat(var(--rows-2),auto)]',
          'lg:grid-rows-[repeat(var(--rows-3),auto)]'
        )}
      >
        {rows.map(b => (
          /* The vote column is fixed-width and always present, so a criterion
             nobody has voted on and one with three votes occupy the same
             ground and the numbers down the grid stay in register. */
          <div
            key={b.key}
            className="grid w-fit grid-cols-[minmax(0,104px)_52px_30px_66px] items-center gap-1.5 py-1"
          >
            {/* The genre pair used to be the bright row because it weighed
                double. It still reads brighter, for what is now the honest
                reason: it is the part of the card this film chose, and the
                personal one is bright for the same kind of reason — it is the
                only answer that is about the person whose card this is. */}
            <span className={cn('truncate text-[12.5px]', b.group === 'oficio' ? 'text-ink-dim' : 'text-ink')}>
              {b.name}
            </span>
            <Strip value={b.value} cells={10} className="h-[5px]" />
            <span className="q text-right text-[12.5px]">{fmt(b.value)}</span>
            <CriterionVotes review={r} criterionKey={b.key} label={b.name} />
          </div>
        ))}
      </div>
      {comment ? (
        <p className="mt-2 border-t border-white/[0.06] pt-2.5 text-[13px] italic leading-relaxed text-ink-dim">
          “{comment}”
        </p>
      ) : null}
    </div>
  );
}

/* ── concordar com uma nota, e não com uma pessoa ─────────────────────────
   Concordar com alguém inteiro é raro. Concordar com o 9 dela em fotografia e
   achar o 4 em roteiro absurdo é o que acontece de verdade, e é por isso que o
   voto é por critério.

   Três decisões que o mundo visual decide por nós:

   · Sem verde e sem vermelho. A regra das três cores vale aqui como em todo o
     resto — o que separa concordar de discordar é a direção do ícone e a
     posição, e o que marca o seu voto é ciano, que é a cor de estado neste
     sistema. Um placar que pinta de verde quando fica positivo estaria pintando
     um limiar, que é a outra coisa que este mundo não faz.
   · Contador só quando existe. Um zero em cada critério de cada ficha é uma
     coluna de zeros dizendo que ninguém votou em nada, que é ruído com formato
     de dado.
   · Na própria ficha os botões somem e só o placar fica. Não é regra moral, é
     aritmética: um placar em que o autor pode se somar não mede mais
     concordância do clube. O servidor recusa de qualquer jeito; o que a tela
     faz é não oferecer o que vai ser negado. */
function CriterionVotes({
  review,
  criterionKey,
  label,
}: {
  review: Review;
  criterionKey: string;
  /** O nome do critério, para quem lê a tela em vez de olhar para ela. */
  label: string;
}) {
  const club = useClub();
  const [busy, setBusy] = useState(false);

  const cast = club.votes.filter(v => v.reviewId === review.id && v.key === criterionKey);
  const up = cast.filter(v => v.value === 1).length;
  const down = cast.filter(v => v.value === -1).length;
  const mine = cast.find(v => v.reviewerId === club.me.id)?.value ?? 0;
  const own = review.reviewerId === club.me.id;

  async function press(value: 1 | -1) {
    if (busy) return;
    setBusy(true);
    try {
      // Pressing the vote you already cast takes it back — the same key does
      // both, which is the only way a toggle can be undone without a second one.
      await club.voteOn(review.id, criterionKey, mine === value ? 0 : value);
    } catch (e) {
      club.fault('Não foi possível registrar o voto: ' + (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const tally = (n: number) =>
    n > 0 ? <span className="q text-[10.5px] leading-none text-ink-dim">{n}</span> : null;

  /* Na própria ficha: o placar, sem os controles. Uma linha inteira em branco
     seria o autor não sabendo que alguém reagiu ao que ele escreveu. */
  if (own) {
    // The column is held even when it is empty, so the numbers to its left stay
    // in register down the grid.
    if (!up && !down) return <span aria-hidden />;
    return (
      <span className="flex items-center gap-2 text-ink-faint">
        {up ? (
          <span className="flex items-center gap-1" title={`${up} concordam com ${label}`}>
            <ThumbsUp className="h-3.5 w-3.5" strokeWidth={1.9} aria-hidden />
            {tally(up)}
          </span>
        ) : null}
        {down ? (
          <span className="flex items-center gap-1" title={`${down} discordam de ${label}`}>
            <ThumbsDown className="h-3.5 w-3.5" strokeWidth={1.9} aria-hidden />
            {tally(down)}
          </span>
        ) : null}
      </span>
    );
  }

  const key = (side: 1 | -1, n: number) => {
    const on = mine === side;
    const Icon = side === 1 ? ThumbsUp : ThumbsDown;
    const verb = side === 1 ? 'Concordar com' : 'Discordar de';
    return (
      <button
        type="button"
        disabled={busy}
        aria-pressed={on}
        aria-label={`${verb} ${label} na avaliação de ${review.reviewerName}${n ? `, ${n} até agora` : ''}`}
        onClick={() => void press(side)}
        /* 24px tall and at least 24 wide even with no tally beside it. The icon
           is 14px; the rest is the target, because a 16px hit area is a control
           that only works with a mouse and this app is also used on a phone. */
        className={cn(
          'flex h-6 min-w-[24px] items-center justify-center gap-1 rounded-cell transition-colors duration-150',
          'disabled:opacity-40',
          on ? 'text-dye-brass' : 'text-ink-faint hover:text-beam'
        )}
      >
        <Icon className="h-3.5 w-3.5 flex-none" strokeWidth={1.9} aria-hidden />
        {tally(n)}
      </button>
    );
  };

  return (
    <span className="flex items-center gap-0.5">
      {key(1, up)}
      {key(-1, down)}
    </span>
  );
}

/* ── a conversa em cima de uma ficha ──────────────────────────────────────
   O clube discute por voz e a discussão morre com a chamada. Isto é a primeira
   coisa no produto que guarda alguma parte dela.

   Pendurada na avaliação e não no filme, de propósito: o que se discute é a
   ficha de alguém — "teu 9 em fotografia" — e é a mesma unidade em que se vota
   um critério logo acima. Um fio por filme juntaria as quatro conversas numa e
   descolaria a resposta de quem foi respondido.

   Não tem chave commit vermelha. A regra da lâmpada vale: no máximo uma
   superfície vermelha por tela, e esta tela pode ter seis gavetas abertas ao
   mesmo tempo. */
/** O mesmo teto que routes/social.js aplica. Espelhado, nunca decidido aqui. */
const MAX_COMMENT = 1000;

/* ── curtir o que alguém escreveu ─────────────────────────────────────────
   Um botão só, e não o par de polegares que a nota tem. Lá o par existe porque
   se concorda ou se discorda de um número; aqui o contrário de curtir não é a
   mesma informação com o sinal trocado — é outra coisa, e num clube de seis
   amigos que se falam por voz ela custa mais do que informa.

   Segue as mesmas regras do voto em critério, porque é o mesmo tipo de gesto:
   latão quando é seu, contador só quando existe, e no que você mesmo escreveu
   sobra o placar sem o botão. */
function CommentLikes({ comment }: { comment: ReviewComment }) {
  const club = useClub();
  const [busy, setBusy] = useState(false);

  const likes = club.commentLikes.filter(l => l.commentId === comment.id);
  const mine = likes.some(l => l.reviewerId === club.me.id);
  const own = comment.reviewerId === club.me.id;

  async function press() {
    if (busy) return;
    setBusy(true);
    try {
      await club.likeComment(comment.id, !mine);
    } catch (e) {
      club.fault('Não foi possível curtir: ' + (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (own) {
    if (!likes.length) return null;
    return (
      <span
        className="flex items-center gap-1 text-ink-faint"
        title={`${likes.length} ${likes.length === 1 ? 'curtida' : 'curtidas'}`}
      >
        <ThumbsUp className="h-3 w-3" strokeWidth={1.9} aria-hidden />
        <span className="q text-[10.5px] leading-none text-ink-dim">{likes.length}</span>
      </span>
    );
  }

  return (
    <button
      type="button"
      disabled={busy}
      aria-pressed={mine}
      aria-label={`${mine ? 'Descurtir' : 'Curtir'} o comentário de ${comment.reviewerName}${
        likes.length ? `, ${likes.length} até agora` : ''
      }`}
      onClick={() => void press()}
      className={cn(
        'flex h-6 min-w-[24px] items-center justify-center gap-1 rounded-cell transition-colors duration-150',
        'disabled:opacity-40',
        mine ? 'text-dye-brass' : 'text-ink-faint hover:text-beam'
      )}
    >
      <ThumbsUp className="h-3 w-3 flex-none" strokeWidth={1.9} aria-hidden />
      {likes.length ? (
        <span className="q text-[10.5px] leading-none text-ink-dim">{likes.length}</span>
      ) : null}
    </button>
  );
}

function Conversation({ review }: { review: Review }) {
  const club = useClub();
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  /* Na sua própria ficha você está respondendo quem te respondeu; na dos outros
     você está comentando. O campo e a chave dizem o mesmo verbo — um botão que
     diz "Comentar" embaixo de um campo que diz "Responder" faz a pessoa parar
     para conferir se são duas coisas. */
  const own = review.reviewerId === club.me.id;

  const thread = club.comments
    .filter(c => c.reviewId === review.id)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  async function send() {
    const body = draft.trim();
    if (!body || sending) return;
    setSending(true);
    try {
      await club.comment(review.id, body);
      setDraft('');
    } catch (e) {
      club.fault('Não foi possível comentar: ' + (e as Error).message);
    } finally {
      setSending(false);
    }
  }

  async function remove(id: string) {
    try {
      await club.uncomment(id);
    } catch (e) {
      club.fault('Não foi possível apagar o comentário: ' + (e as Error).message);
    }
  }

  return (
    <div className="mt-4 border-t border-white/[0.06] pt-4">
      <div className="flex flex-wrap items-baseline gap-3">
        <span className="legend">Conversa</span>
        {thread.length ? (
          <span className="q text-[11px] text-ink-dim">{plural(thread.length, 'resposta', 'respostas')}</span>
        ) : null}
      </div>

      {thread.length ? (
        <ul className="mt-3 flex flex-col gap-3">
          {thread.map(c => {
            const mine = c.reviewerId === club.me.id;
            return (
              <li key={c.id} className="flex gap-2.5">
                <Reel color={reelColor(c.reviewerDot, c.reviewerId)} src={club.avatarOf(c.reviewerId)} size="sm">
                  {initialsOf(c.reviewerName)}
                </Reel>
                <div className="min-w-0 flex-1">
                  {/* A curtida fica na linha do nome e da hora, empurrada para
                      o fim: é sobre o comentário inteiro, e uma linha de ação
                      própria embaixo de cada um deles somaria uma altura por
                      comentário numa gaveta que já é a mais alta da tela. */}
                  <p className="flex flex-wrap items-center gap-x-2">
                    <span className="font-display text-[13px] uppercase tracking-[0.1em] text-ink">
                      {c.reviewerName}
                    </span>
                    <span className="q text-[10.5px] text-ink-dim" title={c.createdAt}>
                      {whenOf(c.createdAt)}
                    </span>
                    <span className="ml-auto pl-2">
                      <CommentLikes comment={c} />
                    </span>
                  </p>
                  {/* `break-words` porque um link colado sem espaço é uma
                      palavra de duzentos caracteres, e ela empurraria a gaveta
                      inteira para fora da carta. */}
                  <p className="mt-0.5 whitespace-pre-wrap break-words text-[13px] leading-relaxed text-ink-dim">
                    {c.body}
                  </p>
                </div>
                {mine || club.me.isAdmin ? (
                  <button
                    type="button"
                    onClick={() => void remove(c.id)}
                    aria-label={mine ? 'Apagar seu comentário' : `Apagar o comentário de ${c.reviewerName}`}
                    className="h-fit flex-none rounded-cell p-1 text-ink-faint transition-colors hover:text-dye-red-lit"
                  >
                    <X className="h-3.5 w-3.5" strokeWidth={1.8} />
                  </button>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}

      <div className="mt-3 flex flex-wrap items-end gap-2">
        <label className="relative min-w-[16ch] flex-1">
          <span className="sr-only">Comentar a avaliação de {review.reviewerName}</span>
          <textarea
            rows={2}
            value={draft}
            /* O mesmo teto do servidor. Sem isto, quem escrevesse um parágrafo
               a mais só descobria no 400 depois de apertar — o erro chegava
               como um toast vermelho no fim de um texto já escrito, que é a
               pior hora possível para descobrir um limite. */
            maxLength={MAX_COMMENT}
            onChange={e => setDraft(e.target.value)}
            /* Enter envia, Shift+Enter quebra linha. Uma caixa de conversa em
               que Enter não envia é uma caixa que faz a pessoa procurar o
               botão toda vez, e a discussão aqui é rápida por definição — ela
               está acontecendo em paralelo a uma chamada. */
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
            placeholder={own ? 'Responder' : 'Comentar'}
            className="w-full resize-y rounded-cell bg-house-deep px-3 py-2 text-[13px] leading-relaxed text-ink caret-dye-red ring-1 ring-house-rail placeholder:text-ink-dim focus-visible:ring-dye-brass"
          />
          {/* Só perto do fim. Um contador ligado desde o primeiro caractere
              conta uma coisa que ninguém está tentando saber; aparecendo no
              último quinto, ele responde a pergunta no momento em que ela
              passa a existir. */}
          {draft.length > MAX_COMMENT * 0.8 ? (
            <span
              aria-live="polite"
              className="q pointer-events-none absolute bottom-1.5 right-2 text-[10.5px] text-ink-dim"
            >
              {MAX_COMMENT - draft.length}
            </span>
          ) : null}
        </label>
        <Key tone="flush" disabled={!draft.trim() || sending} onClick={() => void send()}>
          {sending ? 'Enviando…' : own ? 'Responder' : 'Comentar'}
        </Key>
      </div>
    </div>
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
    /* A row inside the person's card, not a card of its own. The surface here
       belongs to the reviewer — everything under that header is one person's
       record — and a plate for each film sitting on top of that plate would be
       two boxes claiming the same thing. A hairline is enough to say where one
       film ends, exactly as the by-film view separates the people under it. */
    <div
      id={`take-${r.id}`}
      /* ── acabou de chegar por link ──────────────────────────────────────
         Uma folha do facho por cima da fileira, apagando sozinha. Não é um anel
         nem uma borda colorida: aquilo desenharia uma caixa nova em volta de
         uma fileira que não tem caixa, e ela ficaria com uma forma diferente
         das vizinhas pelo tempo do brilho. Uma lâmina de luz por trás some sem
         deixar geometria para trás.

         `scroll-mt` porque a marquise é fixa: sem isso o `scrollIntoView`
         entrega a fileira debaixo do cabeçalho. */
      className={cn(
        'scroll-mt-24 border-t border-white/[0.06] transition-colors duration-700',
        lit && 'bg-beam/[0.07]'
      )}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full items-center gap-3 px-3 py-3 text-left transition-colors hover:bg-beam/[0.05]"
      >
        <Poster src={r.moviePoster} className="h-[52px] w-[35px] flex-none" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[15px] font-semibold">{r.movieTitle}</span>
          <span className="q block text-[11px] text-ink-dim">
            {[r.movieYear ?? '—', runtimeOf(r.movieRuntime), r.movieGenre].filter(Boolean).join(' · ')}
          </span>
        </span>
        <span className="flex flex-none flex-col items-end gap-1">
          <span className="q font-display text-[24px] leading-none text-beam">{fmt(r.final)}</span>
          <CrowdNote crowd={r.crowd} />
        </span>
        <ChevronDown className={cn('h-4 w-4 flex-none text-ink-dim transition-transform duration-200', open && 'rotate-180')} strokeWidth={1.7} />
      </button>
      <Drawer open={open}>
        <div className="px-3 pb-4 pt-1">
          <Breakdown r={r} comment={r.comment} />
          <Conversation review={r} />
          <TakeActions r={r} onDelete={onDelete} className="mt-4" />
        </div>
      </Drawer>
    </div>
  );
}

/* ── a nota do TMDB, embaixo da do clube ──────────────────────────────────
   The club's number stays the big one and this stays a footnote, which is the
   hierarchy the whole product argues for: the verdict here is the club's, and
   TMDB is the thing it is measured against rather than the thing it is
   measured by.

   Named TMDB and not "o mundo". It is one site's voters — a specific crowd with
   a specific bias — and the club is entitled to know which crowd it is
   disagreeing with.

   Silent when the film cache has never seen the film, which after the column
   was added means a film rated long ago and not opened since. It fills itself
   in the next time anybody looks the film up. */
function CrowdNote({ crowd }: { crowd: Review['crowd'] }) {
  if (!crowd) return null;
  return (
    <span className="q block text-[10.5px] leading-none text-ink-dim">TMDB {fmt(crowd.score)}</span>
  );
}

/* ── the person, and everything they sat through ──────────────────────────
   The mirror of the by-film view, and it earns the same shape for the same
   reason: this screen is read by looking for one thing in it. Every take from
   every member laid out at once is a sheet you scroll past, and the member you
   came for is not helped by the other five being open. So a person arrives as a
   person — face, name, how many films and their average — and the films are one
   press away.

   Two levels here too, and they mean what they meant on the other side:
   opening the person asks what they rated, opening a film asks what they gave
   each criterion. */
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
  /* Already filtered by the search upstairs, same as the by-film view. */
  reviews: Review[];
  /* Whether a search is running — not to filter with, only to decide whether
     the cards should stand open. See below. */
  filtering: boolean;
  /** Which way the score runs. Decided once, above both views. */
  desc: boolean;
  openIds: ReadonlySet<string>;
  /** A ficha que acabou de chegar por link, acesa por alguns segundos. */
  lit: string | null;
  /* A mesma ficha, mas o valor que não apaga: é ele que abre a carta de quem a
     assinou. Ver o comentário sobre `flash` e `arrived` lá em cima. */
  arrived: string | null;
  onToggle: (id: string) => void;
  onDelete: (r: Review) => void;
}) {
  const club = useClub();

  /* Which people are showing their takes. Kept here and not in the card for
     the same reason as the other view: the card is redrawn whenever the record
     changes, and state living inside it would fold itself back up.

     Everything starts closed. */
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set());
  const toggleGroup = (id: string) =>
    setOpen(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  /* Uma ficha que chegou por link abre a carta de quem a assinou, uma vez, do
     mesmo jeito que um clique abriria — e a partir daí ela é uma carta aberta
     como qualquer outra, que fecha quando alguém a fecha. O efeito só corre
     quando `arrived` muda, então reabrir à força nunca acontece.

     Isto também é o que faz o link continuar valendo depois de trocar de visão:
     a outra montada com o mesmo `arrived` abre a carta certa lá também. */
  useEffect(() => {
    if (!arrived) return;
    const who = reviews.find(r => r.id === arrived)?.reviewerId;
    if (who) setOpen(prev => (prev.has(who) ? prev : new Set(prev).add(who)));
  }, [arrived, reviews]);

  /* A search hides the people it did not match: a column of empty names is not
     an answer to "what did she rate". */
  const people = club.reviewers.filter(p => !filtering || reviews.some(r => r.reviewerId === p.id));

  if (!club.reviewers.length)
    return <Blank title="Nenhum avaliador cadastrado">Cadastre as pessoas do clube na seção Avaliadores.</Blank>;

  return (
    <>
      {people.map(p => {
        const items = reviews
          .filter(r => r.reviewerId === p.id)
          .sort((a, b) => (desc ? b.final - a.final : a.final - b.final));
        /* A search forces every matching card open. Collapsed, a hit would show
           the name of someone who rated the film you typed and then hide the
           film itself — the card would be the answer to a question you did not
           ask. Clearing the field hands the cards back to whatever you had
           opened by hand.

           Um link também abre a carta de quem assinou a ficha — mas por
           `setOpen` no efeito acima, e não por uma condição aqui. A condição foi
           o defeito: ela dependia do destaque, o destaque apaga em dois segundos
           e meio, e a carta se fechava sozinha levando a ficha junto. */
        const expanded = filtering || open.has(p.id);
        /* Nothing to open on someone who has not rated anything: a chevron that
           unfolds an empty drawer is a promise the card cannot keep. The header
           already says "nenhuma avaliação". */
        const openable = items.length > 0;

        return (
          <div
            key={p.id}
            className="mb-4 overflow-hidden rounded-cell bg-house-seat/55 ring-1 ring-inset ring-white/[0.06]"
          >
            <button
              type="button"
              disabled={!openable}
              onClick={() => toggleGroup(p.id)}
              aria-expanded={openable ? expanded : undefined}
              className={cn(
                'group flex w-full items-center gap-3 px-3 py-3 text-left transition-colors',
                openable && 'hover:bg-beam/[0.05]'
              )}
            >
              <Reel color={reelColor(p.dot, p.id)} src={p.avatar} size="md">
                {initialsOf(p.name)}
              </Reel>
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
  const { avatarOf } = useClub();

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

        /* ── the card is closed until it is asked ─────────────────────────
           Every take on every film, all open at once, is a wall of names
           between one film and the next: the screen stops being a record you
           can scan and becomes a list you scroll past. So a film arrives as a
           film — poster, title, the club's number — and the people who gave
           that number are one press away.

           Two levels, and they mean different things. Opening the film asks
           who; opening a person asks what they gave each criterion.

           A carta de uma ficha pedida por link também abre — pelo efeito acima,
           não por uma condição aqui. A condição foi o defeito: dependia do
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
              <button
                type="button"
                onClick={() => toggleGroup(head.movieId)}
                aria-expanded={expanded}
                className="group flex min-w-0 flex-1 items-center gap-3 text-left"
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
                      [...new Set(items.map(r => r.movieGenre))].join(' · '),
                      plural(items.length, 'avaliação', 'avaliações'),
                    ]
                      .filter(Boolean)
                      .join(' · ')}
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
                    <button
                      type="button"
                      onClick={() => onToggle(r.id)}
                      aria-expanded={openIds.has(r.id)}
                      className="flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-beam/[0.05]"
                    >
                      <Reel color={reelColor(r.reviewerDot, r.reviewerId)} src={avatarOf(r.reviewerId)} size="md">
                        {initialsOf(r.reviewerName)}
                      </Reel>
                      <span className="min-w-0 flex-1 truncate text-[13.5px]">{r.reviewerName}</span>
                      <span className="q text-[17px]">{fmt(r.final)}</span>
                      <ChevronDown
                        className={cn(
                          'h-4 w-4 flex-none text-ink-dim transition-transform duration-200',
                          openIds.has(r.id) && 'rotate-180'
                        )}
                        strokeWidth={1.7}
                      />
                    </button>
                    <Drawer open={openIds.has(r.id)}>
                      <div className="px-3 pb-4 pt-1">
                        <Breakdown r={r} comment={r.comment} />
                        <Conversation review={r} />
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
