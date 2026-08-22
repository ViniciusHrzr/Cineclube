import { useState } from 'react';
import { ChevronDown, Pencil, Plus, Trash2 } from 'lucide-react';
import { Blank, Chip, IconKey, Key, Poster, Reel, SearchField, Strip } from '@/components/bits';
import { del, fmt, initialsOf, reelColor, runtimeOf, type Review } from '@/lib/api';
import { cn, norm, plural } from '@/lib/utils';
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
  const [query, setQuery] = useState('');

  /* Title or person, in one field. This screen is the club's record and it is
     read two ways — "what did we think of that one" and "what has she rated" —
     so a search that only matched films would answer half the questions asked
     of it. Both views filter from the same set, so switching between them
     while searching keeps the same answer on screen. */
  const filtering = query.trim().length > 0;
  const q = norm(query.trim());
  const shown = filtering
    ? club.reviews.filter(r => norm(r.movieTitle).includes(q) || norm(r.reviewerName).includes(q))
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
      <header className="mb-6">
        <h1 className="font-display text-[38px] leading-none tracking-[0.04em] text-beam sm:text-[46px]">Avaliados</h1>
        <p className="q mt-2 text-[12.5px] text-ink-dim">
          {filtering
            ? `${shown.length} de ${club.reviews.length} avaliações`
            : `${club.reviews.length} avaliações · ${club.reviewers.length} avaliadores`}
        </p>
      </header>

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

      <div className="mb-6 flex flex-wrap gap-2">
        {(['reviewer', 'movie'] as const).map(v => (
          <Chip key={v} on={view === v} onClick={() => setView(v)}>
            {v === 'reviewer' ? 'Por avaliador' : 'Por filme'}
          </Chip>
        ))}
      </div>

      {filtering && !shown.length ? (
        <Blank title="Nenhuma avaliação com esse nome">
          A busca cobre o título do filme e o nome de quem avaliou. Limpe o campo para ver o registro inteiro.
        </Blank>
      ) : view === 'reviewer' ? (
        <ByReviewer
          reviews={shown}
          filtering={filtering}
          openIds={openIds}
          onToggle={toggle}
          onDelete={r => void remove(r)}
        />
      ) : (
        <ByMovie reviews={shown} openIds={openIds} onToggle={toggle} onDelete={r => void remove(r)} />
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
function Breakdown({ rows, comment }: { rows: Review['breakdown']; comment?: string }) {
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
        className={cn(
          'grid grid-flow-col auto-cols-fr justify-items-center gap-x-4 gap-y-0.5',
          'grid-rows-[repeat(var(--rows-1),auto)]',
          'sm:grid-rows-[repeat(var(--rows-2),auto)]',
          'lg:grid-rows-[repeat(var(--rows-3),auto)]'
        )}
      >
        {rows.map(b => (
          <div key={b.key} className="grid w-fit grid-cols-[minmax(0,124px)_58px_34px] items-center gap-2 py-1">
            <span className={cn('truncate text-[12.5px]', b.w === 2 ? 'text-ink' : 'text-ink-dim')}>
              {b.name} <span className="q text-[10px] text-ink-faint">×{b.w}</span>
            </span>
            <Strip value={b.value} cells={10} className="h-[5px]" />
            <span className="q text-right text-[12.5px]">{fmt(b.value)}</span>
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

function Take({ r, open, onToggle, onDelete }: { r: Review; open: boolean; onToggle: () => void; onDelete: () => void }) {
  return (
    /* A row inside the person's card, not a card of its own. The surface here
       belongs to the reviewer — everything under that header is one person's
       record — and a plate for each film sitting on top of that plate would be
       two boxes claiming the same thing. A hairline is enough to say where one
       film ends, exactly as the by-film view separates the people under it. */
    <div className="border-t border-white/[0.06]">
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
        <span className="q font-display text-[24px] leading-none text-beam">{fmt(r.final)}</span>
        <ChevronDown className={cn('h-4 w-4 flex-none text-ink-dim transition-transform duration-200', open && 'rotate-180')} strokeWidth={1.7} />
      </button>
      <Drawer open={open}>
        <div className="px-3 pb-4 pt-1">
          <Breakdown rows={r.breakdown} comment={r.comment} />
          <TakeActions r={r} onDelete={onDelete} className="mt-4" />
        </div>
      </Drawer>
    </div>
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
  openIds,
  onToggle,
  onDelete,
}: {
  /* Already filtered by the search upstairs, same as the by-film view. */
  reviews: Review[];
  /* Whether a search is running — not to filter with, only to decide whether
     the cards should stand open. See below. */
  filtering: boolean;
  openIds: ReadonlySet<string>;
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

  /* A search hides the people it did not match: a column of empty names is not
     an answer to "what did she rate". */
  const people = club.reviewers.filter(p => !filtering || reviews.some(r => r.reviewerId === p.id));

  if (!club.reviewers.length)
    return <Blank title="Nenhum avaliador cadastrado">Cadastre as pessoas do clube na seção Avaliadores.</Blank>;

  return (
    <>
      {people.map(p => {
        const items = reviews.filter(r => r.reviewerId === p.id).sort((a, b) => b.final - a.final);
        /* A search forces every matching card open. Collapsed, a hit would show
           the name of someone who rated the film you typed and then hide the
           film itself — the card would be the answer to a question you did not
           ask. Clearing the field hands the cards back to whatever you had
           opened by hand. */
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
  openIds,
  onToggle,
  onDelete,
}: {
  /* Already filtered by the search upstairs, so this view never has to know
     one is running. */
  reviews: Review[];
  openIds: ReadonlySet<string>;
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
  /* Grouped by film and by film alone. The club watches together on Discord but
     rates whenever each person gets to it, so two people rating the same movie a
     week apart are still the same conversation — keying this by date used to
     split one film into unrelated cards. */
  const map: Record<string, Review[]> = {};
  reviews.forEach(r => {
    (map[String(r.movieId)] ||= []).push(r);
  });
  /* Ranked by the club's number, best first. The record is read as a ranking —
     "what did we like" — and the date a film happened to be rated says nothing
     about that. Films tied on the average fall back to the title so the order
     is stable between renders rather than shuffling on every reload. */
  const mean = (rs: Review[]) => rs.reduce((s, r) => s + r.final, 0) / rs.length;
  const groups = Object.values(map).sort(
    (a, b) => mean(b) - mean(a) || a[0].movieTitle.localeCompare(b[0].movieTitle)
  );

  if (!groups.length)
    return <Blank title="Nenhum filme avaliado ainda">Quando alguém gravar a primeira nota, o filme aparece aqui com as avaliações de todo mundo juntas.</Blank>;

  return (
    <>
      {groups.map(items => {
        const head = items[0];
        const avg = items.reduce((s, r) => s + r.final, 0) / items.length;
        const sorted = [...items].sort((a, b) => b.final - a.final);

        /* ── the card is closed until it is asked ─────────────────────────
           Every take on every film, all open at once, is a wall of names
           between one film and the next: the screen stops being a record you
           can scan and becomes a list you scroll past. So a film arrives as a
           film — poster, title, the club's number — and the people who gave
           that number are one press away.

           Two levels, and they mean different things. Opening the film asks
           who; opening a person asks what they gave each criterion. */
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
                <span className="q font-display text-[24px] leading-none text-beam">{fmt(avg)}</span>
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
                  <div key={r.id} className="border-t border-white/[0.06]">
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
                        <Breakdown rows={r.breakdown} comment={r.comment} />
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
