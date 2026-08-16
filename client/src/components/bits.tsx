import { Search as SearchIcon, X as XIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { fmt } from '@/lib/api';

/* ── poster ───────────────────────────────────────────────────────────────
   A film with no poster is not a hole: it is an unexposed cell, which is a
   real state in this world rather than a grey rectangle. */
export function Poster({ src, alt, className }: { src?: string | null; alt?: string; className?: string }) {
  return (
    <div
      className={cn(
        'relative overflow-hidden rounded-cell bg-house-deep ring-1 ring-white/[0.06]',
        className
      )}
      style={
        src
          ? undefined
          : {
              backgroundImage:
                'repeating-linear-gradient(135deg, rgba(255,233,196,0.05) 0 6px, transparent 6px 12px)',
            }
      }
    >
      {src ? <img src={src} alt={alt ?? ''} loading="lazy" className="h-full w-full object-cover" /> : null}
    </div>
  );
}

/* ── the strip meter ──────────────────────────────────────────────────────
   A run of film cells, one per half point on the master (twenty of them, the
   exact step the criteria move in) and one per point on the small records.
   Brightness encodes role, never score: the live take burns at full beam, a
   past take sits dim. Nothing changes colour at a threshold, because the scale
   the club rates on is continuous. */
export function Strip({
  value,
  cells = 10,
  live = false,
  className,
}: {
  value: number;
  cells?: number;
  live?: boolean;
  className?: string;
}) {
  const per = 10 / cells;
  const filled = Math.max(0, Math.min(cells, value / per));
  return (
    <div className={cn('flex gap-[2px]', className)} role="img" aria-label={`${fmt(value)} de 10`}>
      {Array.from({ length: cells }, (_, i) => {
        const n = i + 1;
        const full = filled >= n;
        const part = !full && filled > n - 1;
        return (
          <span
            key={i}
            className={cn(
              'flex-1 rounded-[1px] transition-[background-color,opacity] duration-100',
              full || part ? (live ? 'bg-beam' : 'bg-beam/45') : 'bg-white/[0.07]'
            )}
            style={part ? { opacity: filled - (n - 1) } : undefined}
          />
        );
      })}
    </div>
  );
}

/* ── reel tag ─────────────────────────────────────────────────────────────
   Who signed a take. A reel label, not an avatar bubble. */
export function Reel({ color, children, className }: { color: string; children: React.ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex h-5 min-w-[28px] flex-none items-center justify-center rounded-[1px] px-1.5 text-[10.5px] font-bold tracking-[0.08em] text-house-deep',
        className
      )}
      style={{ background: color }}
    >
      {children}
    </span>
  );
}

/* ── keys ─────────────────────────────────────────────────────────────────
   One action shape across the whole product. `tone` names what it does, never
   how loud it should look. */
export function Key({
  tone = 'flush',
  className,
  children,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { tone?: 'flush' | 'commit' | 'ghost' | 'danger' }) {
  return (
    <button
      type="button"
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-cell px-4 py-2.5',
        'font-display text-[13px] uppercase tracking-[0.14em] leading-none',
        'transition-[background-color,color,border-color,transform] duration-150 active:translate-y-px',
        'disabled:cursor-not-allowed disabled:opacity-40',
        tone === 'commit' &&
          'bg-dye-red text-beam-hot ring-1 ring-dye-red hover:bg-[#e2352a] disabled:bg-house-seat disabled:text-ink-dim disabled:ring-house-rail',
        tone === 'flush' && 'ring-1 ring-house-rail text-ink hover:ring-dye-cyan hover:text-dye-cyan',
        tone === 'ghost' && 'text-ink-dim hover:text-beam',
        tone === 'danger' && 'ring-1 ring-house-rail text-ink-dim hover:text-dye-red-lit hover:ring-dye-red-lit/60',
        className
      )}
      {...rest}
    >
      {children}
    </button>
  );
}

export function IconKey({
  className,
  children,
  active,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean }) {
  return (
    <button
      type="button"
      className={cn(
        'inline-flex h-[38px] w-[38px] flex-none items-center justify-center rounded-cell ring-1 ring-house-rail',
        'transition-colors duration-150 active:translate-y-px',
        active ? 'text-dye-red-lit' : 'text-ink-dim hover:text-beam',
        className
      )}
      {...rest}
    >
      {children}
    </button>
  );
}

/* ── search ───────────────────────────────────────────────────────────────
   One field shape for both bins. `onClear` renders the escape hatch, because a
   filtered list that offers no way back reads as an empty library. */
export function SearchField({
  value,
  onChange,
  placeholder,
  hint,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  hint?: string;
}) {
  return (
    <div>
      <div className="flex items-center gap-3 rounded-cell bg-house-deep px-3 ring-1 ring-house-rail focus-within:ring-dye-cyan">
        <SearchIcon className="h-4 w-4 flex-none text-ink-dim" strokeWidth={1.7} />
        <input
          type="search"
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder={placeholder}
          aria-label={placeholder}
          autoComplete="off"
          className="w-full bg-transparent py-2.5 text-[14.5px] text-ink caret-dye-red outline-none placeholder:text-ink-dim [&::-webkit-search-cancel-button]:hidden"
        />
        {value ? (
          <button
            type="button"
            onClick={() => onChange('')}
            aria-label="Limpar busca"
            className="flex-none rounded-cell p-1 text-ink-dim transition-colors hover:text-beam"
          >
            <XIcon className="h-4 w-4" strokeWidth={1.8} />
          </button>
        ) : null}
      </div>
      {hint ? <p className="q mt-2 text-[11px] text-ink-dim">{hint}</p> : null}
    </div>
  );
}

/* ── states ───────────────────────────────────────────────────────────── */

export function Blank({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="max-w-[58ch] py-10">
      <p className="font-display text-[18px] tracking-[0.1em] text-ink-dim uppercase">{title}</p>
      {children ? <p className="mt-2 text-[13.5px] leading-relaxed text-ink-dim">{children}</p> : null}
    </div>
  );
}

export function Fault({ children, detail }: { children: React.ReactNode; detail?: string }) {
  return (
    <div role="alert" className="rounded-cell bg-dye-red/10 px-4 py-3 text-[13.5px] text-ink ring-1 ring-dye-red/45">
      {children}
      {detail ? <span className="q mt-1 block text-[11.5px] text-ink-dim">{detail}</span> : null}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('animate-pulse rounded-cell bg-white/[0.05]', className)} />;
}
