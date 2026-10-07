import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  MessageSquare,
  Plus,
  Settings,
  ShieldCheck,
  ThumbsDown,
  ThumbsUp,
} from 'lucide-react';
import { Blank, Drawer, Key, Poster, Reel, Strip } from '@/components/bits';
import { Breakdown, OriginNote, OriginTag } from '@/components/take';
import { Conversation, TakeVotes } from '@/components/social';
import {
  fmt,
  initialsOf,
  reelColor,
  shows as showsApi,
  type ShowTake,
  type Review,
  type Reviewer,
  type WatchItem,
} from '@/lib/api';
import {
  affinityOf,
  clashesOf,
  crowdGapOf,
  endsOf,
  FLOOR,
  genresOf,
  memberSince,
  spreadOf,
  takesOf,
} from '@/lib/taste';
import { cn, plural } from '@/lib/utils';
import { useClub } from '@/App';

export function ProfileScreen() {
  const club = useClub();
  const [episodes, setEpisodes] = useState<ShowTake[] | null>(null);
  useEffect(() => {
    let alive = true;
    showsApi.takes().then(
      r => alive && setEpisodes(r.takes),
      () => alive && setEpisodes([])
    );
    return () => {
      alive = false;
    };
  }, []);

  const [openTake, setOpenTake] = useState<string | null>(null);
  const timers = useRef<number[]>([]);

  const showTake = useCallback((id: string) => {
    setOpenTake(id);
    const gentle = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    timers.current.push(
      window.setTimeout(() => {
        document
          .getElementById(`ficha-${id}`)
          ?.scrollIntoView({ behavior: gentle ? 'auto' : 'smooth', block: 'start' });
      }, 60)
    );
  }, []);

  useEffect(() => {
    const pending = timers.current;
    return () => {
      pending.forEach(window.clearTimeout);
      pending.length = 0;
    };
  }, []);

  const personKey = club.personId ?? club.me.id;
  const seeded = useRef(personKey);
  if (seeded.current !== personKey) {
    seeded.current = personKey;
    setOpenTake(null);
  }

  const id = club.personId ?? club.me.id;
  const person = club.reviewers.find(p => p.id === id) ?? null;
  const mine = person?.id === club.me.id;

  if (!person) {
    return (
      <section>
        <Blank title="Essa pessoa não está mais no clube">
          O perfil existia quando este link foi feito. O que ela avaliou saiu junto com a conta —
          é assim que uma saída funciona aqui.
        </Blank>
        <Key tone="flush" className="mt-2" onClick={() => club.goPerson()}>
          Ir para o meu perfil
        </Key>
      </section>
    );
  }

  return (
    <section>
      <Header person={person} mine={mine} onSettings={club.openClubSettings} />

      {}
      <div className="mt-8 flex flex-col gap-8">
        <Ends person={person} onOpenTake={showTake} />
        <Crowd person={person} mine={mine} onOpenTake={showTake} />
        <Ruler person={person} onOpenTake={showTake} />
        {}
        <Series person={person} episodes={episodes} />
        <Queued person={person} />
        <Takes
          person={person}
          mine={mine}
          open={openTake}
          onToggle={id => setOpenTake(o => (o === id ? null : id))}
        />
        <Affinities person={person} mine={mine} />
        <Genres person={person} />
      </div>

    </section>
  );
}

function Region({
  title,
  note,
  children,
}: {
  title: string;
  note?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section>
      <div className="mb-4 flex items-baseline gap-3">
        <span className="legend flex-none">{title}</span>
        <span
          aria-hidden
          className="h-px min-w-[1rem] flex-1 bg-gradient-to-r from-beam/20 via-beam/[0.06] to-transparent"
        />
        {note ? <span className="q flex-none text-[11px] text-ink-dim">{note}</span> : null}
      </div>
      {children}
    </section>
  );
}

function Header({
  person,
  mine,
  onSettings,
}: {
  person: Reviewer;
  mine: boolean;
  onSettings: () => void;
}) {
  const club = useClub();
  const takes = takesOf(club.reviews, person.id);
  const since = memberSince(person.createdAt);

  const cover = useMemo(
    () =>
      [...takes]
        .filter(r => r.moviePoster)
        .sort((a, b) => b.final - a.final)
        .slice(0, 14),
    [takes]
  );

  const avg = takes.length ? takes.reduce((s, r) => s + r.final, 0) / takes.length : null;

  return (
    <header className="relative">
      {cover.length ? (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 h-[172px] overflow-hidden rounded-plate"
          style={{
            maskImage:
              'linear-gradient(to bottom, transparent 0, rgba(0,0,0,0.92) 20px, rgba(0,0,0,0.92) 48%, transparent 97%)',
            WebkitMaskImage:
              'linear-gradient(to bottom, transparent 0, rgba(0,0,0,0.92) 20px, rgba(0,0,0,0.92) 48%, transparent 97%)',
          }}
        >
          <div
            className="flex h-full gap-[2px]"
            style={{
              maskImage: 'linear-gradient(to right, black 0, black 74%, transparent 100%)',
              WebkitMaskImage: 'linear-gradient(to right, black 0, black 74%, transparent 100%)',
            }}
          >
            {cover.map(r => (
              <img
                key={r.id}
                src={r.moviePoster as string}
                alt=""
                loading="lazy"
                className="h-full w-auto max-w-none flex-none opacity-[0.24]"
              />
            ))}
          </div>
        </div>
      ) : null}

      {}
      <div className={cn('relative', cover.length && 'pt-[104px]')}>
        <div className="flex flex-wrap items-end gap-x-5 gap-y-4">
          {}
          <Reel
            color={reelColor(person.dot, person.id)}
            src={person.avatar}
            className={cn(
              'h-[92px] w-[92px] flex-none text-[30px] ring-2 ring-house',
              !person.avatar && 'min-w-0'
            )}
          >
            {initialsOf(person.name)}
          </Reel>

          <div className="min-w-[220px] flex-1">
            <h1 className="flex flex-wrap items-center gap-x-3 gap-y-1 font-display text-[38px] leading-none tracking-[0.04em] text-beam sm:text-[46px]">
              {person.name}
              {person.isAdmin ? (
                <span className="inline-flex items-center gap-1 self-center text-[11px] tracking-[0.14em] text-dye-brass">
                  <ShieldCheck className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
                  ADM
                </span>
              ) : null}
            </h1>
            {}
            <p className="q mt-2 flex flex-wrap items-center gap-x-2 text-[12.5px] text-ink-dim">
              {person.handle ? <span className="text-dye-brass">@{person.handle}</span> : null}
              {person.handle && since ? <span aria-hidden>·</span> : null}
              {since ? <span>no clube desde {since}</span> : null}
            </p>
          </div>

          {mine ? (
            <Key tone="flush" className="flex-none" onClick={onSettings}>
              <Settings className="h-3.5 w-3.5" strokeWidth={1.8} aria-hidden />
              Ajustes
            </Key>
          ) : null}
        </div>

        {person.bio ? (
          <p className="mt-4 max-w-[62ch] text-[14px] leading-relaxed text-ink">{person.bio}</p>
        ) : null}

        {}
        <p className="q mt-5 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[12.5px] text-ink-dim">
          <span>
            <span className="text-ink">{takes.length}</span>{' '}
            {takes.length === 1 ? 'filme avaliado' : 'filmes avaliados'}
          </span>
          {avg != null ? (
            <>
              <span aria-hidden>·</span>
              <span>
                média <span className="text-ink">{fmt(avg)}</span>
              </span>
            </>
          ) : null}
        </p>
      </div>
    </header>
  );
}

function Ends({ person, onOpenTake }: { person: Reviewer; onOpenTake: (id: string) => void }) {
  const club = useClub();
  const ends = endsOf(club.reviews, person.id);
  if (!ends) return null;

  return (
    <Region title="Extremos">
      <div className="grid gap-3 sm:grid-cols-2">
        <EndCard review={ends.best} label="O que mais gostou" onOpen={onOpenTake} />
        <EndCard review={ends.worst} label="O que menos gostou" onOpen={onOpenTake} />
      </div>
    </Region>
  );
}

function EndCard({
  review,
  label,
  onOpen,
}: {
  review: Review;
  label: string;
  onOpen: (id: string) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onOpen(review.id)}
      aria-label={`Abrir a avaliação de ${review.movieTitle}`}
      className="plate group flex gap-4 p-4 text-left transition-colors duration-150 hover:bg-house-seat"
    >
      <Poster src={review.moviePoster} className="aspect-[2/3] w-[58px] flex-none" />
      <span className="min-w-0 flex-1">
        <span className="legend block">{label}</span>
        <span className="mt-1.5 block font-display text-[20px] leading-tight tracking-[0.02em] text-beam transition-colors group-hover:text-beam-hot">
          {review.movieTitle}
        </span>
        <span className="q mt-1 block text-[11px] text-ink-dim">{review.movieGenre}</span>
        <span className="mt-2.5 flex items-center gap-2.5">
          <Strip value={review.final} cells={10} className="h-[6px] w-[92px] flex-none" />
          <span className="q text-[15px] font-medium text-beam">{fmt(review.final)}</span>
        </span>
      </span>
    </button>
  );
}

function Series({ person, episodes }: { person: Reviewer; episodes: ShowTake[] | null }) {
  const shows = useMemo(() => {
    const mine = (episodes ?? []).filter(t => t.reviewerId === person.id && t.final != null);
    const byShow = new Map<
      number,
      { id: number; title: string; poster: string | null; notes: number[] }
    >();
    for (const t of mine) {
      const held = byShow.get(t.showId);
      if (held) held.notes.push(t.final as number);
      else
        byShow.set(t.showId, {
          id: t.showId,
          title: t.showTitle,
          poster: t.showPoster,
          notes: [t.final as number],
        });
    }
    return [...byShow.values()]
      .map(s => ({
        ...s,
        average: s.notes.reduce((a, b) => a + b, 0) / s.notes.length,
      }))
      .sort((a, b) => b.average - a.average);
  }, [episodes, person.id]);

  if (!shows.length) return null;

  const rated = shows.reduce((n, s) => n + s.notes.length, 0);

  return (
    <Region
      title="Séries"
      note={`${plural(rated, 'ficha', 'fichas')} em ${plural(shows.length, 'série', 'séries')}`}
    >
      <ul className="flex flex-col gap-2.5">
        {shows.map(s => (
          <li key={s.id} className="flex items-center gap-3">
            <Poster src={s.poster} className="h-[46px] w-[31px] flex-none" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13.5px] text-ink">{s.title}</span>
              <span className="q block text-[11px] text-ink-dim">
                {plural(s.notes.length, 'ficha', 'fichas')}
              </span>
            </span>
            <Strip value={s.average} cells={10} className="hidden h-[5px] w-[80px] flex-none sm:block" />
            <span className="q w-[34px] flex-none text-right text-[15px] text-beam">
              {fmt(s.average)}
            </span>
          </li>
        ))}
      </ul>
    </Region>
  );
}

function Crowd({
  person,
  mine,
  onOpenTake,
}: {
  person: Reviewer;
  mine: boolean;
  onOpenTake: (id: string) => void;
}) {
  const club = useClub();
  const crowd = crowdGapOf(club.reviews, person.id);
  if (!crowd) return null;

  const subject = mine ? 'você' : person.name.split(' ')[0];
  const aligned = Math.abs(crowd.gap) < 0.5;
  const leaning = crowd.gap > 0 ? 'generoso' : 'severo';

  return (
    <Region title="Contra o público" note={`${plural(crowd.n, 'filme', 'filmes')} com nota do TMDB`}>
      <p className="max-w-[62ch] text-[14px] leading-relaxed text-ink-dim">
        {aligned ? (
          <>
            Na média, {subject} dá praticamente a mesma nota que o público do TMDB — a distância é
            de <span className="q text-beam">{fmt(Math.abs(crowd.gap))}</span>.
          </>
        ) : (
          <>
            Na média, {subject} é <span className="q text-beam">{fmt(Math.abs(crowd.gap))}</span>{' '}
            {Math.abs(crowd.gap) === 1 ? 'ponto' : 'pontos'} mais {leaning} que o público do TMDB.
          </>
        )}{' '}
        A maior distância foi em{' '}
        <button
          type="button"
          onClick={() => onOpenTake(crowd.widest.id)}
          className="text-ink underline decoration-white/20 underline-offset-4 transition-colors hover:text-beam hover:decoration-beam/50"
        >
          {crowd.widest.movieTitle}
        </button>
        : <span className="q text-ink">{fmt(crowd.widest.final)}</span> contra{' '}
        <span className="q text-ink">{fmt(crowd.widest.crowd?.score ?? 0)}</span> lá fora.
      </p>
    </Region>
  );
}

function Ruler({ person, onOpenTake }: { person: Reviewer; onOpenTake: (id: string) => void }) {
  const club = useClub();
  const spread = spreadOf(club.reviews, person.id);
  const [hover, setHover] = useState<number | null>(null);
  const [pinned, setPinned] = useState<number | null>(null);
  if (!spread || spread.n < FLOOR.ends) return null;

  const active = hover ?? pinned;
  const band = active != null ? spread.bands[active] : null;

  return (
    <Region
      title="Régua"
      note={
        band && active != null ? (
          <>
            <span className="text-ink">{band.length}</span>{' '}
            {band.length === 1 ? 'filme' : 'filmes'} entre{' '}
            <span className="text-ink">{active}</span> e{' '}
            <span className="text-ink">{active + 1}</span>
          </>
        ) : (
          <>
            de <span className="text-ink">{fmt(spread.low)}</span> a{' '}
            <span className="text-ink">{fmt(spread.high)}</span>
          </>
        )
      }
    >
      <div className="plate px-3 py-4 sm:px-4">
        <ul
          className="flex items-end gap-[3px]"
          onMouseLeave={() => setHover(null)}
        >
          {spread.bands.map((films, i) => {
            const on = active === i;
            const label = films.length
              ? `${plural(films.length, 'filme', 'filmes')} entre ${i} e ${i + 1}`
              : `nenhum filme entre ${i} e ${i + 1}`;
            return (
              <li key={i} className="flex min-w-0 flex-1 flex-col items-center gap-1.5">
                {films.length ? (
                  <button
                    type="button"
                    aria-pressed={pinned === i}
                    aria-label={label}
                    title={label}
                    onMouseEnter={() => setHover(i)}
                    onFocus={() => setHover(i)}
                    onBlur={() => setHover(null)}
                    onClick={() => setPinned(p => (p === i ? null : i))}
                    className="flex w-full flex-col-reverse gap-[2px] rounded-[1px] pt-4"
                  >
                    {}
                    {films.map(r => (
                      <span
                        key={r.id}
                        className={cn(
                          'h-[12px] w-full rounded-[1px] transition-colors duration-150',
                          on ? 'bg-beam' : 'bg-beam/45'
                        )}
                      />
                    ))}
                  </button>
                ) : (
                  <span
                    aria-label={label}
                    title={label}
                    className="mt-4 h-[12px] w-full rounded-[1px] bg-white/[0.05]"
                  />
                )}
                <span
                  className={cn(
                    'q text-[10px] leading-none transition-colors duration-150',
                    on ? 'text-beam' : 'text-ink-dim'
                  )}
                >
                  {i}
                </span>
              </li>
            );
          })}
        </ul>

        {}
        {band?.length ? (
          <ul className="mt-4 flex flex-col gap-1 border-t border-white/[0.06] pt-3">
            {band.map(r => (
              <li key={r.id}>
                <button
                  type="button"
                  onClick={() => onOpenTake(r.id)}
                  aria-label={`Abrir a avaliação de ${r.movieTitle}`}
                  className="group flex w-full items-center gap-3 rounded-cell px-1 py-1.5 text-left transition-colors hover:bg-beam/[0.05]"
                >
                  <Poster src={r.moviePoster} className="h-[34px] w-[23px] flex-none" />
                  <span className="min-w-0 flex-1 truncate text-[13px] text-ink transition-colors group-hover:text-beam">
                    {r.movieTitle}
                  </span>
                  <span className="q flex-none text-[13px] text-beam">{fmt(r.final)}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}

        {}
        {active == null ? (
          <p className="q mt-3 text-[10.5px] text-ink-dim">
            aponte uma faixa para ver os filmes dela
          </p>
        ) : null}
      </div>
    </Region>
  );
}

function Affinities({ person, mine }: { person: Reviewer; mine: boolean }) {
  const club = useClub();
  const list = affinityOf(club.reviews, club.reviewers, person.id);
  if (!list.length) return null;

  return (
    <Region title={mine ? 'Com quem você concorda' : 'Com quem concorda'}>
      <ul className="flex flex-col">
        {list.map((a, i) => (
          <li key={a.person.id} className={cn(i > 0 && 'border-t border-white/[0.06]')}>
            <button
              type="button"
              onClick={() => club.goPerson(a.person.id)}
              aria-label={`Abrir o perfil de ${a.person.name}`}
              className="group flex w-full items-center gap-3 rounded-cell px-2 py-3 text-left transition-colors duration-150 hover:bg-beam/[0.05]"
            >
              <Reel color={reelColor(a.person.dot, a.person.id)} src={a.person.avatar} size="md">
                {initialsOf(a.person.name)}
              </Reel>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13.5px] text-ink transition-colors group-hover:text-beam">
                  {a.person.name}
                </span>
                <span className="q block text-[11px] text-ink-dim">
                  {plural(a.shared, 'filme em comum', 'filmes em comum')}
                  {a.clash ? ` · brigaram em ${a.clash.title}` : ''}
                </span>
              </span>
              {}
              <span className="flex flex-none items-center gap-2.5">
                <Strip
                  value={Math.max(0, 10 - Math.min(5, a.gap) * 2)}
                  cells={10}
                  className="hidden h-[6px] w-[80px] sm:flex"
                />
                <span className="q w-[30px] text-right text-[12.5px] text-ink">{fmt(a.gap)}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
      <p className="q mt-3 text-[10.5px] text-ink-dim">
        distância média entre as duas notas, só nos filmes que os dois avaliaram — perto de zero é
        acordo
      </p>
      {!mine ? <Compare person={person} /> : null}
    </Region>
  );
}

function Compare({ person }: { person: Reviewer }) {
  const club = useClub();
  const [open, setOpen] = useState(false);
  const [touched, setTouched] = useState(false);
  const rows = useMemo(
    () => clashesOf(club.reviews, club.me.id, person.id),
    [club.reviews, club.me.id, person.id]
  );
  if (!rows.length) return null;

  const first = person.name.split(' ')[0];

  return (
    <div className="mt-4 border-t border-white/[0.06] pt-4">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => {
          setOpen(v => !v);
          setTouched(true);
        }}
        className="flex items-center gap-2 font-display text-[12.5px] uppercase leading-none tracking-[0.12em] text-ink-dim transition-colors hover:text-beam"
      >
        <ChevronDown
          className={cn('h-4 w-4 flex-none transition-transform duration-200', open && 'rotate-180')}
          strokeWidth={1.7}
          aria-hidden
        />
        {open ? 'Fechar a comparação' : `Comparar com você (${rows.length})`}
      </button>

      <Drawer open={open}>
        {touched ? (
          <div className="pt-4">
            {}
            <div className="flex items-center gap-3 pb-2">
              <span className="min-w-0 flex-1" />
              <span className="legend w-[46px] flex-none text-center text-[10px]">Você</span>
              <span className="legend w-[46px] flex-none truncate text-center text-[10px]">
                {first}
              </span>
              <span className="legend w-[38px] flex-none text-right text-[10px]">Δ</span>
            </div>
            <ul className="flex flex-col">
              {rows.map(c => {
                const loud = c.gap >= 2;
                return (
                  <li key={c.movieId} className="border-t border-white/[0.06]">
                    <button
                      type="button"
                      onClick={() => club.openSheet(c.movieId)}
                      aria-label={`Abrir ${c.title}`}
                      className="group flex w-full items-center gap-3 py-2.5 text-left transition-colors hover:bg-beam/[0.04]"
                    >
                      <Poster src={c.poster} className="h-[38px] w-[26px] flex-none" />
                      <span className="min-w-0 flex-1 truncate text-[13px] text-ink transition-colors group-hover:text-beam">
                        {c.title}
                      </span>
                      <span className="q w-[46px] flex-none text-center text-[13px] text-ink">
                        {fmt(c.mine)}
                      </span>
                      <span className="q w-[46px] flex-none text-center text-[13px] text-ink">
                        {fmt(c.theirs)}
                      </span>
                      <span
                        className={cn(
                          'q w-[38px] flex-none text-right text-[12.5px]',
                          loud ? 'text-beam' : 'text-ink-dim'
                        )}
                      >
                        {fmt(c.gap)}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        ) : null}
      </Drawer>
    </div>
  );
}

function Genres({ person }: { person: Reviewer }) {
  const club = useClub();
  const list = genresOf(club.reviews, person.id);
  if (list.length < 2) return null;

  return (
    <Region title="Gêneros">
      <ul className="flex flex-wrap gap-2">
        {list.map(g => (
          <li
            key={g.genre}
            className="flex items-baseline gap-2 rounded-cell bg-house-seat/70 px-3 py-1.5 ring-1 ring-house-rail"
          >
            <span className="font-display text-[12.5px] uppercase leading-none tracking-[0.12em] text-ink">
              {g.genre}
            </span>
            <span className="q text-[11px] leading-none text-ink-dim">
              {g.n} · {fmt(g.avg)}
            </span>
          </li>
        ))}
      </ul>
    </Region>
  );
}

function Queued({ person }: { person: Reviewer }) {
  const club = useClub();
  const items = club.watchlist.filter(w => w.wanters.includes(person.id));
  const [open, setOpen] = useState(false);
  const [touched, setTouched] = useState(false);
  const rail = useRef<HTMLUListElement>(null);
  const [edge, setEdge] = useState({ start: true, end: true, over: false });

  const measure = useCallback(() => {
    const el = rail.current;
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    setEdge({ start: el.scrollLeft <= 2, end: el.scrollLeft >= max - 2, over: max > 2 });
  }, []);

  useEffect(() => {
    const el = rail.current;
    if (!el) return;
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    for (const child of Array.from(el.children)) ro.observe(child);
    el.addEventListener('scroll', measure, { passive: true });
    return () => {
      ro.disconnect();
      el.removeEventListener('scroll', measure);
    };
  }, [measure, items.length, open]);

  if (!items.length) return null;

  const nudge = (dir: 1 | -1) => {
    const el = rail.current;
    if (!el) return;
    const gentle = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    el.scrollBy({ left: dir * el.clientWidth * 0.8, behavior: gentle ? 'auto' : 'smooth' });
  };

  return (
    <Region
      title="Na fila"
      note={
        edge.over || open ? (
          <button
            type="button"
            aria-expanded={open}
            onClick={() => {
              setOpen(v => !v);
              setTouched(true);
            }}
            className="font-display text-[11px] uppercase leading-none tracking-[0.12em] text-ink-dim transition-colors hover:text-beam"
          >
            {open ? 'Recolher' : `Ver todos (${items.length})`}
          </button>
        ) : (
          plural(items.length, 'filme', 'filmes')
        )
      }
    >
      {}
      <Drawer open={!open}>
        <div className="relative">
          <ul
            ref={rail}
            className="flex gap-3 overflow-x-auto scroll-px-11 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            style={{
              maskImage: `linear-gradient(to right, ${
                edge.start ? 'black 0' : 'transparent 0, black 44px'
              }, ${edge.end ? 'black 100%' : 'black calc(100% - 44px), transparent 100%'})`,
              WebkitMaskImage: `linear-gradient(to right, ${
                edge.start ? 'black 0' : 'transparent 0, black 44px'
              }, ${edge.end ? 'black 100%' : 'black calc(100% - 44px), transparent 100%'})`,
            }}
          >
            {items.map(w => (
              <li key={w.id} className="w-[84px] flex-none">
                <QueuedPoster item={w} onOpen={() => club.openSheet(w.id)} />
              </li>
            ))}
          </ul>

          {}
          <RailKey side="left" show={!edge.start} onClick={() => nudge(-1)} />
          <RailKey side="right" show={!edge.end} onClick={() => nudge(1)} />
        </div>
      </Drawer>

      {}
      <Drawer open={open}>
        {touched ? (
          <ul className="grid grid-cols-[repeat(auto-fill,minmax(84px,1fr))] gap-3 pb-1">
            {items.map(w => (
              <li key={w.id}>
                <QueuedPoster item={w} onOpen={() => club.openSheet(w.id)} />
              </li>
            ))}
          </ul>
        ) : null}
      </Drawer>
    </Region>
  );
}

function QueuedPoster({ item, onOpen }: { item: WatchItem; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`Abrir ${item.title}`}
      className="group block w-full text-left"
    >
      <Poster
        src={item.poster}
        className="aspect-[2/3] w-full transition-[box-shadow] duration-150 group-hover:ring-white/25"
      />
      <span className="mt-1.5 block truncate text-[11.5px] text-ink-dim transition-colors group-hover:text-beam">
        {item.title}
      </span>
    </button>
  );
}

function RailKey({
  side,
  show,
  onClick,
}: {
  side: 'left' | 'right';
  show: boolean;
  onClick: () => void;
}) {
  const Icon = side === 'left' ? ChevronLeft : ChevronRight;
  return (
    <button
      type="button"
      aria-hidden
      tabIndex={-1}
      onClick={onClick}
      className={cn(
        'absolute top-[63px] flex h-8 w-8 -translate-y-1/2 items-center justify-center',
        'rounded-cell bg-house/85 text-ink-dim ring-1 ring-house-rail',
        'transition-[opacity,color] duration-200 hover:text-beam',
        side === 'left' ? 'left-0' : 'right-0',
        show ? 'opacity-100' : 'pointer-events-none opacity-0'
      )}
    >
      <Icon className="h-4 w-4" strokeWidth={1.8} />
    </button>
  );
}

function Takes({
  person,
  mine,
  open,
  onToggle,
}: {
  person: Reviewer;
  mine: boolean;
  open: string | null;
  onToggle: (id: string) => void;
}) {
  const club = useClub();
  const takes = takesOf(club.reviews, person.id);
  const [all, setAll] = useState(false);

  if (!takes.length) {
    return (
      <Region title="Avaliações">
        <Blank title={mine ? 'Você ainda não avaliou nada' : `${person.name.split(' ')[0]} ainda não avaliou nada`}>
          {mine
            ? 'Escolha um filme no catálogo ou na fila e responda as onze perguntas. Da terceira avaliação em diante esta página começa a ter o que dizer sobre você.'
            : 'Quando essa pessoa gravar a primeira avaliação, ela aparece aqui.'}
        </Blank>
        {mine ? (
          <Key tone="flush" onClick={() => club.goTab('catalog')}>
            <Plus className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
            Ir para o catálogo
          </Key>
        ) : null}
      </Region>
    );
  }

  const openIndex = open ? takes.findIndex(r => r.id === open) : -1;
  const shown = all || openIndex >= 12 ? takes : takes.slice(0, 12);
  const hidden = takes.length - shown.length;

  return (
    <Region title="Avaliações" note={plural(takes.length, 'avaliação', 'avaliações')}>
      <ul className="flex flex-col">
        {shown.map(r => (
          <li key={r.id} className="border-t border-white/[0.06] first:border-t-0">
            <TakeLine review={r} open={open === r.id} onToggle={() => onToggle(r.id)} />
          </li>
        ))}
      </ul>
      {hidden ? (
        <button
          type="button"
          onClick={() => setAll(true)}
          className="mt-4 font-display text-[11px] uppercase leading-none tracking-[0.12em] text-ink-dim transition-colors hover:text-beam"
        >
          Ver as outras {hidden}
        </button>
      ) : null}
    </Region>
  );
}

function TakeLine({
  review,
  open,
  onToggle,
}: {
  review: Review;
  open: boolean;
  onToggle: () => void;
}) {
  const club = useClub();
  const cast = club.votes.filter(v => v.reviewId === review.id);
  const up = cast.filter(v => v.value === 1).length;
  const down = cast.filter(v => v.value === -1).length;
  const talk = club.comments.filter(c => c.reviewId === review.id).length;

  const [touched, setTouched] = useState(open);
  if (open && !touched) setTouched(true);

  return (
    <div id={`ficha-${review.id}`} className="scroll-mt-24">
      {}
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-controls={`ficha-corpo-${review.id}`}
        className="group flex w-full items-center gap-3 rounded-cell px-2 py-2.5 text-left transition-colors duration-150 hover:bg-beam/[0.05]"
      >
      <Poster src={review.moviePoster} className="h-[52px] w-[35px] flex-none" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[14px] text-ink transition-colors group-hover:text-beam">
          {review.movieTitle}
        </span>
        <span className="q block text-[11px] text-ink-dim">
          {[review.movieYear ?? '—', review.movieGenre].filter(Boolean).join(' · ')}
        </span>
        {}
        {review.origin ? <OriginTag where={review.origin} className="mt-1" /> : null}
        {!open && (talk || up || down) ? (
          <span className="mt-1 flex items-center gap-3 text-ink-faint">
            {talk ? (
              <span className="flex items-center gap-1" title={plural(talk, 'resposta', 'respostas')}>
                <MessageSquare className="h-3 w-3" strokeWidth={1.9} aria-hidden />
                <span className="q text-[10.5px] text-ink-dim">{talk}</span>
              </span>
            ) : null}
            {up ? (
              <span className="flex items-center gap-1" title={`${up} ${up === 1 ? 'concorda' : 'concordam'}`}>
                <ThumbsUp className="h-3 w-3" strokeWidth={1.9} aria-hidden />
                <span className="q text-[10.5px] text-ink-dim">{up}</span>
              </span>
            ) : null}
            {down ? (
              <span
                className="flex items-center gap-1"
                title={`${down} ${down === 1 ? 'discorda' : 'discordam'}`}
              >
                <ThumbsDown className="h-3 w-3" strokeWidth={1.9} aria-hidden />
                <span className="q text-[10.5px] text-ink-dim">{down}</span>
              </span>
            ) : null}
          </span>
        ) : null}
      </span>
      <span className="flex flex-none items-center gap-2.5">
        <Strip value={review.final} cells={10} className="hidden h-[6px] w-[80px] sm:flex" />
        <span className="q w-[34px] text-right text-[16px] text-beam">{fmt(review.final)}</span>
        <ChevronDown
          className={cn(
            'h-4 w-4 flex-none text-ink-dim transition-transform duration-200',
            open && 'rotate-180'
          )}
          strokeWidth={1.7}
          aria-hidden
        />
      </span>
      </button>

      <Drawer open={open}>
        {touched ? (
          <div id={`ficha-corpo-${review.id}`} className="px-2 pb-4 pt-1">
            <Breakdown r={review} comment={review.comment} />
            <div className="mt-3 flex flex-wrap items-center gap-3">
              {}
              {review.origin ? null : <TakeVotes take={review} labelled />}
              {}
              <button
                type="button"
                onClick={() => club.goReview(review.id)}
                className="font-display text-[11px] uppercase leading-none tracking-[0.12em] text-ink-dim transition-colors hover:text-beam"
              >
                Ver no acervo
              </button>
            </div>
            {review.origin ? <OriginNote where={review.origin} /> : <Conversation take={review} />}
          </div>
        ) : null}
      </Drawer>
    </div>
  );
}
