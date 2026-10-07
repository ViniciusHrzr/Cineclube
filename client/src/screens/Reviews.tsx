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
import { Conversation, TakeVotes } from '@/components/social';
import { Breakdown, OriginNote, OriginTag } from '@/components/take';
import { PersonReel } from '@/components/person';
import { cdel, fmt, initialsOf, reelColor, runtimeOf, type Review } from '@/lib/api';
import { cn, named, norm, plural } from '@/lib/utils';
import { useClub } from '@/App';

export function ReviewsScreen() {
  const club = useClub();
  const [view, setView] = useState<'reviewer' | 'movie'>('movie');
  const [openIds, setOpenIds] = useState<ReadonlySet<string>>(() => new Set());
  const [desc, setDesc] = useState(true);

  const wanted = club.focusReview;
  const { clearFocusReview } = club;
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

  const [quem, setQuem] = useState<string | null>(null);

  const contagem = new Map<string, number>();
  club.reviews.forEach(r => contagem.set(r.reviewerId, (contagem.get(r.reviewerId) ?? 0) + 1));
  const gente = club.reviewers
    .map(p => ({ ...p, count: contagem.get(p.id) ?? 0 }))
    .filter(p => p.count > 0);

  if (quem && !gente.some(p => p.id === quem)) setQuem(null);

  const searching = query.trim().length > 0;
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

      {}
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

        {}
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

function TakeActions({
  r,
  onDelete,
  className,
  invite = true,
}: {
  r: Review;
  onDelete: () => void;
  className?: string;
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
  lit?: boolean;
  onToggle: () => void;
  onDelete: () => void;
}) {
  return (
    <div
      id={`take-${r.id}`}
      className={cn(
        'scroll-mt-24 border-t border-white/[0.06] transition-colors duration-700',
        lit && 'bg-beam/[0.07]'
      )}
    >
      {}
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
            {}
            {r.origin ? <OriginTag where={r.origin} className="mt-1" /> : null}
          </span>
          <span className="flex flex-none flex-col items-end gap-1">
            <span className="q font-display text-[24px] leading-none text-beam">{fmt(r.final)}</span>
            <CrowdNote crowd={r.crowd} />
          </span>
        </button>
        {}
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

function CrowdNote({ crowd }: { crowd: Review['crowd'] }) {
  if (!crowd) return null;
  return (
    <span className="q block text-[10.5px] leading-none text-ink-dim">TMDB {fmt(crowd.score)}</span>
  );
}

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
  filtering: boolean;
  desc: boolean;
  openIds: ReadonlySet<string>;
  lit: string | null;
  arrived: string | null;
  onToggle: (id: string) => void;
  onDelete: (r: Review) => void;
}) {
  const club = useClub();

  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set());
  const toggleGroup = (id: string) =>
    setOpen(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  useEffect(() => {
    if (!arrived) return;
    const who = reviews.find(r => r.id === arrived)?.reviewerId;
    if (who) setOpen(prev => (prev.has(who) ? prev : new Set(prev).add(who)));
  }, [arrived, reviews]);

  const people = club.reviewers.filter(p => !filtering || reviews.some(r => r.reviewerId === p.id));

  if (!club.reviewers.length)
    return <Blank title="Nenhum avaliador cadastrado">Cadastre as pessoas do clube na seção Avaliadores.</Blank>;

  return (
    <>
      {people.map(p => {
        const items = reviews
          .filter(r => r.reviewerId === p.id)
          .sort((a, b) => (desc ? b.final - a.final : a.final - b.final));
        const expanded = filtering || open.has(p.id);
        const openable = items.length > 0;

        return (
          <div
            key={p.id}
            className="mb-4 overflow-hidden rounded-cell bg-house-seat/55 ring-1 ring-inset ring-white/[0.06]"
          >
            {}
            <div
              className={cn(
                'group flex items-center gap-3 px-3 transition-colors',
                openable && 'hover:bg-beam/[0.05]'
              )}
            >
              {}
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
                  {}
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

function ByMovie({
  reviews,
  desc,
  openIds,
  lit,
  arrived,
  onToggle,
  onDelete,
}: {
  reviews: Review[];
  desc: boolean;
  openIds: ReadonlySet<string>;
  lit: string | null;
  arrived: string | null;
  onToggle: (id: string) => void;
  onDelete: (r: Review) => void;
}) {
  const [open, setOpen] = useState<ReadonlySet<number>>(() => new Set());
  const toggleGroup = (movieId: number) =>
    setOpen(prev => {
      const next = new Set(prev);
      if (next.has(movieId)) next.delete(movieId);
      else next.add(movieId);
      return next;
    });
  useEffect(() => {
    if (!arrived) return;
    const film = reviews.find(r => r.id === arrived)?.movieId;
    if (film != null) setOpen(prev => (prev.has(film) ? prev : new Set(prev).add(film)));
  }, [arrived, reviews]);

  const map: Record<string, Review[]> = {};
  reviews.forEach(r => {
    (map[String(r.movieId)] ||= []).push(r);
  });
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

        const expanded = open.has(head.movieId);

        return (
          <div
            key={head.movieId}
            className="mb-4 overflow-hidden rounded-cell bg-house-seat/55 ring-1 ring-inset ring-white/[0.06]"
          >
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-3">
              {}
              {}
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
                  {}
                  <span className="q block text-[11px] text-ink-dim">
                    {[
                      head.movieYear ?? '—',
                      runtimeOf(items.find(r => r.movieRuntime != null)?.movieRuntime),
                      [...new Set(items.map(r => r.movieGenre))].join(' · '),
                      plural(items.length, 'avaliação', 'avaliações'),
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                </span>
                {}
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
                  <div
                    key={r.id}
                    id={`take-${r.id}`}
                    className={cn(
                      'scroll-mt-24 border-t border-white/[0.06] transition-colors duration-700',
                      lit === r.id && 'bg-beam/[0.07]'
                    )}
                  >
                    {}
                    {}
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
