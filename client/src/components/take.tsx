import { Strip } from '@/components/bits';
import { WithMentions } from '@/components/mention';
import { fmt, type BreakdownRow } from '@/lib/api';
import { cn } from '@/lib/utils';

export function Breakdown({ r, comment }: { r: { breakdown: BreakdownRow[] }; comment?: string }) {
  const rows = r.breakdown;
  if (!rows.length && !comment) return null;
  return (
    <div className="rounded-cell bg-house-deep/60 px-3 py-2.5 ring-1 ring-inset ring-white/[0.05]">
      {}
      {rows.length ? <div
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
          <div
            key={b.key}
            className="grid w-fit grid-cols-[minmax(0,104px)_52px_30px] items-center gap-1.5 py-1"
          >
            {}
            <span className={cn('truncate text-[12.5px]', b.group === 'oficio' ? 'text-ink-dim' : 'text-ink')}>
              {b.name}
            </span>
            <Strip value={b.value} cells={10} className="h-[5px]" />
            <span className="q text-right text-[12.5px]">{fmt(b.value)}</span>
          </div>
        ))}
      </div> : null}
      {}
      {comment ? (
        <p className={cn(
          'text-[13px] italic leading-relaxed text-ink-dim',
          rows.length && 'mt-2 border-t border-white/[0.06] pt-2.5'
        )}>
          “<WithMentions text={comment} />”
        </p>
      ) : null}
    </div>
  );
}

export type Origin = { name: string | null; slug: string | null };

export function OriginTag({ where, className }: { where: Origin; className?: string }) {
  const name = where.name ? `no ${where.name}` : 'de outro clube';
  return (
    <span
      title={where.name ? `Avaliado no ${where.name}` : 'Avaliado em outro clube'}
      className={cn(
        'inline-block max-w-full flex-none truncate rounded-cell bg-house-seat/70 px-1.5 py-[3px]',
        'font-display text-[9.5px] uppercase leading-none tracking-[0.1em] text-dye-brass ring-1 ring-house-rail',
        className
      )}
    >
      {name}
    </span>
  );
}

export function OriginNote({ where }: { where: Origin }) {
  const name = where.name ?? 'outro clube';
  return (
    <p className="q mt-4 border-t border-white/[0.06] pt-3 text-[12px] text-ink-dim">
      Avaliado no <span className="text-ink">{name}</span> — a conversa sobre esta ficha acontece lá.
      {where.slug ? (
        <>
          {' '}
          <a
            href={`#c/${encodeURIComponent(where.slug)}/avaliados`}
            className="underline underline-offset-2 transition-colors hover:text-beam"
          >
            Abrir
          </a>
        </>
      ) : null}
    </p>
  );
}
