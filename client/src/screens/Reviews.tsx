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
  SearchField,
} from '@/components/bits';
/* O voto e a conversa saíram desta tela e viraram peça — o feed passou a
   oferecer os dois na porta de entrada do clube, e são as mesmas regras. Ver a
   nota de abertura em components/social.tsx. */
import { Conversation, TakeVotes } from '@/components/social';
/* E o detalhamento saiu pelo mesmo motivo: o perfil abre a ficha na própria
   página agora, em vez de mandar quem está explorando alguém para cá. */
import { Breakdown } from '@/components/take';
import { PersonReel } from '@/components/person';
import { del, fmt, runtimeOf, type Review } from '@/lib/api';
import { cn, named, norm, plural } from '@/lib/utils';
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


/* ── a seta da gaveta, ao lado dos votos ──────────────────────────────────
   A fileira inteira abre a ficha, e a seta diz que ela abre. Enquanto a linha
   era um botão só, a seta morava dentro dele; com o par de polegares na mesma
   linha isso deixou de ser possível — um botão dentro de outro não é uma coisa
   que o navegador monte — e a linha virou um botão largo com os votos e a seta
   ao lado.

   Escondida do leitor de tela de propósito: o gesto que ela oferece é o mesmo
   do botão que ocupa o resto da fileira, e um segundo controle anunciando o
   mesmo `aria-expanded` seria a mesma frase dita duas vezes seguidas. Para o
   mouse ela continua clicável, que é o que ela sempre foi. */
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
      {/* Os polegares saíram da gaveta e vieram para cá, encostados na nota —
          é dela que se concorda ou se discorda, e enterrados dois cliques
          abaixo eles só eram encontrados por quem já tinha aberto a ficha por
          outro motivo. Ficam FORA do botão que abre a gaveta porque um botão
          dentro de outro não existe em HTML, e porque reagir a uma nota nunca
          deveria também dobrar um painel. */}
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
              {[r.movieYear ?? '—', runtimeOf(r.movieRuntime), r.movieGenre].filter(Boolean).join(' · ')}
            </span>
          </span>
          <span className="flex flex-none flex-col items-end gap-1">
            <span className="q font-display text-[24px] leading-none text-beam">{fmt(r.final)}</span>
            <CrowdNote crowd={r.crowd} />
          </span>
        </button>
        <TakeVotes review={r} />
        <DrawerArrow open={open} onToggle={onToggle} />
      </div>
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
                      <TakeVotes review={r} />
                      <DrawerArrow open={openIds.has(r.id)} onToggle={() => onToggle(r.id)} />
                    </div>
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
