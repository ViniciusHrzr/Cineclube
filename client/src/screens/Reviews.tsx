import { useState } from 'react';
import { ChevronDown, Pencil, Trash2 } from 'lucide-react';
import { Blank, Chip, IconKey, Key, Poster, Reel, SearchField, Strip } from '@/components/bits';
import { del, fmt, initialsOf, reelColor, type Review } from '@/lib/api';
import { cn, norm } from '@/lib/utils';
import { useClub } from '@/App';

export function ReviewsScreen() {
  const club = useClub();
  const [view, setView] = useState<'reviewer' | 'movie'>('reviewer');
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
        club.reviewers.length ? (
          club.reviewers
            /* A search hides the people it did not match: a column of empty
               names is not an answer to "what did she rate". */
            .filter(p => !filtering || shown.some(r => r.reviewerId === p.id))
            .map(p => {
              const items = shown.filter(r => r.reviewerId === p.id).sort((a, b) => b.final - a.final);
              const mean = items.length ? items.reduce((s, r) => s + r.final, 0) / items.length : 0;
              return (
              <div key={p.id} className="mb-9">
                <div className="mb-3 flex items-center gap-3">
                  <Reel color={reelColor(p.dot, p.id)}>{initialsOf(p.name)}</Reel>
                  <h2 className="font-display text-[19px] uppercase tracking-[0.1em] text-ink">{p.name}</h2>
                  <span className="h-px flex-1 bg-gradient-to-r from-white/15 to-transparent" />
                  <span className="q text-[11px] text-ink-dim">
                    {items.length ? `${items.length} filmes · média ${fmt(mean)}` : 'nenhuma avaliação'}
                  </span>
                </div>
                {items.length ? (
                  items.map(r => (
                    <Take key={r.id} r={r} open={openIds.has(r.id)} onToggle={() => toggle(r.id)} onDelete={() => void remove(r)} />
                  ))
                ) : (
                  <Blank title="Ainda não avaliou nenhum filme" />
                )}
              </div>
            );
          })
        ) : (
          <Blank title="Nenhum avaliador cadastrado">Cadastre as pessoas do clube na seção Avaliadores.</Blank>
        )
      ) : (
        <ByMovie reviews={shown} openIds={openIds} onToggle={toggle} onDelete={r => void remove(r)} />
      )}
    </section>
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
  const club = useClub();
  return (
    /* A card per film, instead of hairlines dividing one long sheet. The rows
       are what the club actually points at — "that one" — and a divider only
       says where one ends; a surface says the thing has edges. It also gives
       the title and the score a ground of their own, which they did not have
       while the wall ran behind them.

       `overflow-hidden` so the hover wash and the drawer both stop at the
       rounded corner instead of squaring it off. */
    <div className="mb-2 overflow-hidden rounded-cell bg-house-seat/55 ring-1 ring-inset ring-white/[0.06]">
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
            {r.movieYear ?? '—'} · {r.movieGenre}
          </span>
        </span>
        <span className="q font-display text-[24px] leading-none text-beam">{fmt(r.final)}</span>
        <ChevronDown className={cn('h-4 w-4 flex-none text-ink-dim transition-transform duration-200', open && 'rotate-180')} strokeWidth={1.7} />
      </button>
      <Drawer open={open}>
        <div className="px-3 pb-4 pt-1">
          <Breakdown rows={r.breakdown} comment={r.comment} />
          <div className="mt-4 flex gap-2">
            <Key tone="flush" onClick={() => club.rateMovie(r.movieId)}>
              <Pencil className="h-3.5 w-3.5" strokeWidth={1.8} />
              Editar
            </Key>
            <IconKey aria-label={`Excluir avaliação de ${r.movieTitle}`} onClick={onDelete}>
              <Trash2 className="h-4 w-4" strokeWidth={1.7} />
            </IconKey>
          </div>
        </div>
      </Drawer>
    </div>
  );
}

/* ── where the club split ─────────────────────────────────────────────────
   Every reviewer's mark for a criterion on one shared 0–10 track, so a
   disagreement reads as distance instead of as a number you compute by
   flipping between two lists. Δ lights when the gap is wide; it uses the beam,
   not the red, because a disagreement is information and not a fault. */
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
  const club = useClub();
  /* Grouped by film and by film alone. The club watches together on Discord but
     rates whenever each person gets to it, so two people rating the same movie a
     week apart are still the same conversation — keying this by date used to
     split one film into unrelated cards. */
  const map: Record<string, Review[]> = {};
  reviews.forEach(r => {
    (map[String(r.movieId)] ||= []).push(r);
  });
  const groups = Object.values(map).sort((a, b) => {
    const lastA = a.reduce((d, r) => (r.date > d ? r.date : d), '');
    const lastB = b.reduce((d, r) => (r.date > d ? r.date : d), '');
    return lastB.localeCompare(lastA) || a[0].movieTitle.localeCompare(b[0].movieTitle);
  });

  if (!groups.length)
    return <Blank title="Nenhum filme avaliado ainda">Quando alguém gravar a primeira nota, o filme aparece aqui com as avaliações de todo mundo juntas.</Blank>;

  return (
    <>
      {groups.map(items => {
        const head = items[0];
        const avg = items.reduce((s, r) => s + r.final, 0) / items.length;
        const sorted = [...items].sort((a, b) => b.final - a.final);
        return (
          /* Here the card is the film and every take on it — the group is the
             unit, so the surface goes around the group. */
          <div
            key={head.movieId}
            className="mb-4 overflow-hidden rounded-cell bg-house-seat/55 ring-1 ring-inset ring-white/[0.06]"
          >
            <div className="flex items-center gap-3 px-3 py-3">
              <Poster src={head.moviePoster} className="h-[68px] w-[45px] flex-none" />
              <div className="min-w-0 flex-1">
                <h2 className="truncate text-[15px] font-semibold">{head.movieTitle}</h2>
                <p className="q text-[11px] text-ink-dim">
                  {head.movieYear ?? '—'} · {head.movieGenre} · {items.length} avaliação(ões)
                </p>
              </div>
              <span className="q font-display text-[24px] leading-none text-beam">{fmt(avg)}</span>
            </div>

            {items.length > 1 ? (
              <div className="px-3 pb-4">
                <div className="mb-2 flex flex-wrap items-baseline gap-3">
                  <span className="legend">Onde o clube divergiu</span>
                  <span className="q text-[10.5px] text-ink-dim">Δ = distância entre a maior e a menor nota</span>
                </div>
                <div className="mb-1 hidden grid-cols-[130px_minmax(0,1fr)_58px] gap-3 sm:grid">
                  <span />
                  <span className="q flex justify-between text-[10px] text-ink-dim">
                    <i className="not-italic">0</i>
                    <i className="not-italic">5</i>
                    <i className="not-italic">10</i>
                  </span>
                  <span />
                </div>
                {head.breakdown.map(k => {
                  const marks = items.map(r => ({
                    v: r.breakdown.find(b => b.key === k.key)?.value ?? 0,
                    color: reelColor(r.reviewerDot, r.reviewerId),
                    who: r.reviewerName,
                  }));
                  const values = marks.map(m => m.v);
                  const gap = Math.max(...values) - Math.min(...values);
                  return (
                    <div
                      key={k.key}
                      className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-3 gap-y-1 py-1.5 sm:grid-cols-[130px_minmax(0,1fr)_58px] sm:items-center"
                    >
                      <span className={cn('text-[12px] sm:order-1', k.w === 2 ? 'text-ink' : 'text-ink-dim')}>{k.name}</span>
                      <span className="relative order-last col-span-2 h-[18px] sm:order-2 sm:col-span-1" aria-hidden="true">
                        <span className="absolute inset-x-0 top-2 h-[2px] rounded bg-white/[0.08]" />
                        <span
                          className="absolute inset-x-0 top-3 h-1"
                          style={{
                            backgroundImage:
                              'repeating-linear-gradient(90deg, rgba(255,233,196,0.22) 0 1px, transparent 1px 10%)',
                          }}
                        />
                        {marks.map((m, idx) => (
                          <span
                            key={idx}
                            title={`${m.who}: ${fmt(m.v)}`}
                            className="absolute top-0.5 h-[14px] w-[3px] -translate-x-[1.5px] rounded-[1px] mix-blend-screen ring-1 ring-black/60"
                            style={{ left: `${(m.v / 10) * 100}%`, background: m.color }}
                          />
                        ))}
                      </span>
                      <span
                        className={cn('q text-right text-[11px] sm:order-3', gap >= 2 ? 'text-beam' : 'text-ink-dim')}
                      >
                        {gap > 0 ? `Δ ${fmt(gap)}` : '—'}
                      </span>
                      <span className="sr-only">
                        {marks.map(m => `${m.who} ${fmt(m.v)}`).join(', ')}. Diferença {fmt(gap)}.
                      </span>
                    </div>
                  );
                })}
                <div className="mt-3 flex flex-wrap gap-3">
                  {items.map(r => (
                    <span key={r.id} className="flex items-center gap-1.5 text-[11.5px] text-ink-dim">
                      <span className="h-2.5 w-2.5 rounded-[1px]" style={{ background: reelColor(r.reviewerDot, r.reviewerId) }} />
                      {r.reviewerName}
                    </span>
                  ))}
                </div>
              </div>
            ) : null}

            <div className="flex flex-col">
              {sorted.map(r => (
                <div key={r.id} className="border-t border-white/[0.06]">
                  <button
                    type="button"
                    onClick={() => onToggle(r.id)}
                    aria-expanded={openIds.has(r.id)}
                    className="flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-beam/[0.05]"
                  >
                    <Reel color={reelColor(r.reviewerDot, r.reviewerId)}>{initialsOf(r.reviewerName)}</Reel>
                    <span className="min-w-0 flex-1 truncate text-[13.5px]">{r.reviewerName}</span>
                    <span className="q text-[17px]">{fmt(r.final)}</span>
                    <ChevronDown
                      className={cn('h-4 w-4 flex-none text-ink-dim transition-transform duration-200', openIds.has(r.id) && 'rotate-180')}
                      strokeWidth={1.7}
                    />
                  </button>
                  <Drawer open={openIds.has(r.id)}>
                    <div className="px-3 pb-4 pt-1">
                      <Breakdown rows={r.breakdown} comment={r.comment} />
                    </div>
                    <div className="flex gap-2 px-3 pb-4">
                      <Key tone="flush" onClick={() => club.rateMovie(r.movieId)}>
                        <Pencil className="h-3.5 w-3.5" strokeWidth={1.8} />
                        Editar
                      </Key>
                      <IconKey aria-label={`Excluir avaliação de ${r.reviewerName}`} onClick={() => onDelete(r)}>
                        <Trash2 className="h-4 w-4" strokeWidth={1.7} />
                      </IconKey>
                    </div>
                  </Drawer>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </>
  );
}
