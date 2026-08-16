import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ChevronDown, Pencil, Trash2 } from 'lucide-react';
import { Blank, IconKey, Key, Poster, Reel, Strip } from '@/components/bits';
import { del, fmt, initialsOf, reelColor, type Review } from '@/lib/api';
import { cn } from '@/lib/utils';
import { useClub } from '@/App';

export function ReviewsScreen() {
  const club = useClub();
  const [view, setView] = useState<'reviewer' | 'movie'>('reviewer');
  const [openId, setOpenId] = useState<string | null>(null);

  async function remove(r: Review) {
    if (!confirm(`Excluir a avaliação de "${r.movieTitle}"? Essa ação não pode ser desfeita.`)) return;
    try {
      await del(`/api/reviews/${r.id}`);
      club.reload({ reviews: club.reviews.filter(x => x.id !== r.id) });
    } catch (e) {
      club.fault('Não foi possível excluir: ' + (e as Error).message);
    }
  }

  const toggle = (id: string) => setOpenId(o => (o === id ? null : id));

  return (
    <section>
      <header className="mb-6">
        <h1 className="font-display text-[38px] leading-none tracking-[0.04em] text-beam sm:text-[46px]">Avaliados</h1>
        <p className="q mt-2 text-[12.5px] text-ink-dim">
          {club.reviews.length} avaliações · {club.reviewers.length} avaliadores
        </p>
      </header>

      <div className="mb-6 flex flex-wrap gap-2">
        {(['reviewer', 'movie'] as const).map(v => (
          <button
            key={v}
            type="button"
            aria-pressed={view === v}
            onClick={() => setView(v)}
            className={cn(
              'rounded-cell px-3 py-1.5 font-display text-[12.5px] uppercase tracking-[0.12em] ring-1 transition-colors duration-150',
              view === v
                ? 'bg-dye-cyan/10 text-dye-cyan ring-dye-cyan/60'
                : 'text-ink-dim ring-house-rail hover:text-ink hover:ring-white/20'
            )}
          >
            {v === 'reviewer' ? 'Por avaliador' : 'Por filme'}
          </button>
        ))}
      </div>

      {view === 'reviewer' ? (
        club.reviewers.length ? (
          club.reviewers.map(p => {
            const items = club.reviews.filter(r => r.reviewerId === p.id).sort((a, b) => b.final - a.final);
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
                    <Take key={r.id} r={r} open={openId === r.id} onToggle={() => toggle(r.id)} onDelete={() => void remove(r)} />
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
        <ByMovie openId={openId} onToggle={toggle} onDelete={r => void remove(r)} />
      )}
    </section>
  );
}

function Take({ r, open, onToggle, onDelete }: { r: Review; open: boolean; onToggle: () => void; onDelete: () => void }) {
  const club = useClub();
  return (
    <div className="border-t border-white/[0.07] last:border-b">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full items-center gap-3 px-1 py-3 text-left transition-colors hover:bg-beam/[0.05]"
      >
        <Poster src={r.moviePoster} className="h-[52px] w-[35px] flex-none" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[15px] font-semibold">{r.movieTitle}</span>
          <span className="q block text-[11px] text-ink-dim">
            {r.movieYear ?? '—'} · {r.movieGenre} · {r.date}
          </span>
        </span>
        <span className="q font-display text-[24px] leading-none text-beam">{fmt(r.final)}</span>
        <ChevronDown className={cn('h-4 w-4 flex-none text-ink-dim transition-transform duration-200', open && 'rotate-180')} strokeWidth={1.7} />
      </button>
      <AnimatePresence initial={false}>
        {open ? (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.24, ease: [0.16, 1, 0.3, 1] }}
            className="overflow-hidden"
          >
            <div className="px-1 pb-5">
              <div className="grid gap-x-6 gap-y-1 sm:grid-cols-2 lg:grid-cols-3">
                {r.breakdown.map(b => (
                  <div key={b.key} className="grid grid-cols-[1fr_62px_36px] items-center gap-2 py-1">
                    <span className={cn('truncate text-[12.5px]', b.w === 2 ? 'text-ink' : 'text-ink-dim')}>
                      {b.name} <span className="q text-[10px] text-ink-faint">×{b.w}</span>
                    </span>
                    <Strip value={b.value} cells={10} className="h-[5px]" />
                    <span className="q text-right text-[12.5px]">{fmt(b.value)}</span>
                  </div>
                ))}
              </div>
              {r.comment ? (
                <p className="mt-4 border-t border-white/[0.06] pt-3 text-[13px] leading-relaxed text-ink-dim">
                  “{r.comment}”
                </p>
              ) : null}
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
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

/* ── where the club split ─────────────────────────────────────────────────
   Every reviewer's mark for a criterion on one shared 0–10 track, so a
   disagreement reads as distance instead of as a number you compute by
   flipping between two lists. Δ lights when the gap is wide; it uses the beam,
   not the red, because a disagreement is information and not a fault. */
function ByMovie({
  openId,
  onToggle,
  onDelete,
}: {
  openId: string | null;
  onToggle: (id: string) => void;
  onDelete: (r: Review) => void;
}) {
  const club = useClub();
  /* Grouped by film and by film alone. The club watches together on Discord but
     rates whenever each person gets to it, so two people rating the same movie a
     week apart are still the same conversation — keying this by date used to
     split one film into unrelated cards. */
  const map: Record<string, Review[]> = {};
  club.reviews.forEach(r => {
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
        const dates = items.map(r => r.date).sort();
        const when =
          dates[0] === dates[dates.length - 1] ? dates[0] : `${dates[0]} a ${dates[dates.length - 1]}`;
        return (
          <div key={head.movieId} className="mb-7 border-y border-white/[0.07]">
            <div className="flex items-center gap-3 px-1 py-3">
              <Poster src={head.moviePoster} className="h-[68px] w-[45px] flex-none" />
              <div className="min-w-0 flex-1">
                <h2 className="truncate text-[15px] font-semibold">{head.movieTitle}</h2>
                <p className="q text-[11px] text-ink-dim">
                  {head.movieYear ?? '—'} · {head.movieGenre} · {items.length} avaliação(ões) · {when}
                </p>
              </div>
              <span className="q font-display text-[24px] leading-none text-beam">{fmt(avg)}</span>
            </div>

            {items.length > 1 ? (
              <div className="px-1 pb-4">
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
                    aria-expanded={openId === r.id}
                    className="flex w-full items-center gap-3 px-1 py-2.5 text-left transition-colors hover:bg-beam/[0.05]"
                  >
                    <Reel color={reelColor(r.reviewerDot, r.reviewerId)}>{initialsOf(r.reviewerName)}</Reel>
                    <span className="min-w-0 flex-1 truncate text-[13.5px]">{r.reviewerName}</span>
                    <span className="q text-[17px]">{fmt(r.final)}</span>
                    <ChevronDown
                      className={cn('h-4 w-4 flex-none text-ink-dim transition-transform duration-200', openId === r.id && 'rotate-180')}
                      strokeWidth={1.7}
                    />
                  </button>
                  <AnimatePresence initial={false}>
                    {openId === r.id ? (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.24, ease: [0.16, 1, 0.3, 1] }}
                        className="overflow-hidden"
                      >
                        <div className="grid gap-x-6 gap-y-1 px-1 pb-4 sm:grid-cols-2 lg:grid-cols-3">
                          {r.breakdown.map(b => (
                            <div key={b.key} className="grid grid-cols-[1fr_62px_36px] items-center gap-2 py-1">
                              <span className={cn('truncate text-[12.5px]', b.w === 2 ? 'text-ink' : 'text-ink-dim')}>
                                {b.name} <span className="q text-[10px] text-ink-faint">×{b.w}</span>
                              </span>
                              <Strip value={b.value} cells={10} className="h-[5px]" />
                              <span className="q text-right text-[12.5px]">{fmt(b.value)}</span>
                            </div>
                          ))}
                        </div>
                        {r.comment ? (
                          <p className="px-1 pb-3 text-[13px] italic leading-relaxed text-ink-dim">“{r.comment}”</p>
                        ) : null}
                        <div className="flex gap-2 px-1 pb-4">
                          <Key tone="flush" onClick={() => club.rateMovie(r.movieId)}>
                            <Pencil className="h-3.5 w-3.5" strokeWidth={1.8} />
                            Editar
                          </Key>
                          <IconKey aria-label={`Excluir avaliação de ${r.reviewerName}`} onClick={() => onDelete(r)}>
                            <Trash2 className="h-4 w-4" strokeWidth={1.7} />
                          </IconKey>
                        </div>
                      </motion.div>
                    ) : null}
                  </AnimatePresence>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </>
  );
}
