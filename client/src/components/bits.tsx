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
      {Array.from({ length: cells }, (_, i) => (
        /* Two layers per cell, and only one number changes: the unlit cell is
           always there underneath, and the beam is laid over it at the exact
           fraction of that cell the score reaches.

           It was one layer before, with the class deciding the colour and an
           inline opacity deciding the fraction — which made opacity mean two
           different things. Leaving the partial cell dropped the inline value,
           so opacity snapped back to 1 while the background was still 100ms
           into fading out, and for that moment the cell sat fully opaque over a
           half-lit colour. That was the blink, and it fired on the way up and
           on the way back down. Here nothing switches class and nothing
           reverts: one opacity, from 0 to 1, meaning one thing. */
        <span key={i} className="relative flex-1 rounded-[1px] bg-white/[0.07]">
          <span
            className={cn(
              'absolute inset-0 rounded-[1px] transition-opacity duration-100',
              live ? 'bg-beam' : 'bg-beam/45'
            )}
            style={{ opacity: Math.max(0, Math.min(1, filled - i)) }}
          />
        </span>
      ))}
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
        /* The chip's surface, for the chip's reason: these keys sit on the film
           wall too — under every poster in the bin, and at the foot of the
           catalogue — and a ring around nothing leaves the lettering to fend for
           itself against a lit, moving background. Seven tenths, so the room
           still comes through and the key stays part of it. Even with a frame
           line burning behind it at full beam, the label holds 5:1.

           Cream on hover, like the ghost keys and the icon keys it stands next
           to. Not red: `commit` fills with red and `danger` goes red on hover,
           and if the ordinary key did the same, the two colours the room keeps
           for "this writes something" and "this destroys something" would stop
           meaning anything. */
        tone === 'flush' &&
          'bg-house-seat/70 ring-1 ring-house-rail text-ink hover:ring-beam/70 hover:text-beam',
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
        /* Same surface as the key it stands beside — under a poster they are one
           row of controls, and one of them floating on the wall while the other
           sits on a plate would read as two different kinds of thing. */
        'inline-flex h-[38px] w-[38px] flex-none items-center justify-center rounded-cell',
        'bg-house-seat/70 ring-1 ring-house-rail',
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

/* ── the chip ─────────────────────────────────────────────────────────────
   A filter that is either on or off. It carries an opaque surface, and that is
   not decoration: these sit straight on the film wall, in tracked caps at
   12.5px, and the wall is lit and moving underneath them — a ring alone left
   the dim ink reading against whatever happened to be behind it that second.
   On the seat colour it holds 6.4:1 unlit and lit alike, because the surface no
   longer lets the room through.

   Both states share that surface. What marks the chosen one is the red of the
   marquee's underline, said twice — in the lettering and in the ring — over an
   inner glow of the same dye. Filling it with a tenth of red instead, as it was,
   meant the selected chip was the one place the wall still showed through. */
export function Chip({
  on,
  onClick,
  children,
}: {
  on: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={cn(
        'rounded-cell bg-house-seat/70 px-3 py-1.5 font-display text-[12.5px] uppercase tracking-[0.12em]',
        'ring-1 transition-colors duration-150',
        on
          ? 'text-dye-red-lit ring-dye-red-lit/70 shadow-[inset_0_0_14px_rgba(209,42,32,0.22)]'
          : 'text-ink-dim ring-house-rail hover:text-ink hover:ring-white/25'
      )}
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
