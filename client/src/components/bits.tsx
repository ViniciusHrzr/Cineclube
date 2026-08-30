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
   Who signed a take. A reel label, not an avatar bubble.

   With a portrait it stays a reel: the frame goes square and the picture sits
   inside it, cropped like a film cell, with the same hard 1px corner the rest
   of the room uses. Not a circle — a circle is every other product's avatar,
   and a round portrait next to square everything would be the one element in
   this interface that came from somewhere else.

   Without one, nothing changes: the coloured tag with initials, which is still
   what most of the club will look like. */
/* Both branches are listed side by side on purpose. A row where one person has
   a portrait and the next has initials is the ordinary case, and the two have
   to stand the same height or the row reads as broken — so the pair of sizes
   is decided here, once, instead of at each call site where only one of them
   would be in front of whoever is editing. */
const REEL_SIZE = {
  /** Beside a line of text, where it is a signature and not a face. */
  sm: { photo: 'h-5 w-5', tag: 'h-5 min-w-[28px] px-1.5 text-[10.5px]' },
  /** In a list of takes, where the person is half of what the row is about. */
  md: { photo: 'h-6 w-6', tag: 'h-6 min-w-[32px] px-1.5 text-[11px]' },
  /** Where the person is the subject: the marquee, the roster. */
  lg: { photo: 'h-7 w-7', tag: 'h-7 min-w-[36px] px-2 text-[12px]' },
} as const;

export function Reel({
  color,
  src,
  size = 'sm',
  children,
  className,
}: {
  color: string;
  /** The portrait, if this person has one. */
  src?: string | null;
  size?: keyof typeof REEL_SIZE;
  children: React.ReactNode;
  className?: string;
}) {
  if (src) {
    return (
      <span
        className={cn(
          'inline-flex flex-none overflow-hidden rounded-[1px] ring-1 ring-white/15',
          REEL_SIZE[size].photo,
          className
        )}
        style={{ background: color }}
      >
        <img src={src} alt="" loading="lazy" className="h-full w-full object-cover" />
      </span>
    );
  }
  return (
    <span
      className={cn(
        'inline-flex flex-none items-center justify-center rounded-[1px] font-bold tracking-[0.08em] text-house-deep',
        REEL_SIZE[size].tag,
        className
      )}
      style={{ background: color }}
    >
      {children}
    </span>
  );
}

/* ── the bill ─────────────────────────────────────────────────────────────
   The board outside a cinema, naming what is playing. Every section had one and
   every section built its own: the same five classes typed out in five files,
   with the margin drifting to `mb-7` in one of them and the count line present
   in three. Same role, same type, one component.

   The rule is the part that is new. A single word set at 46px leaves most of a
   1240px line empty, and the emptiness read as the layout not having finished
   loading rather than as air. A hairline running from the lettering to the edge
   of the deck closes it, and it is drawn in the beam's own colour at a fifth of
   its strength, fading out — the light spilling off the title and falling away
   across the board.

   Beam and not brass, deliberately. Brass means *selected* in this room, and
   spending it on a decoration at the top of all five screens would spend the
   one thing that makes a chosen chip legible as chosen. Beam is light, it is
   already the colour of the lettering it runs out of, and light has no state to
   dilute. */
export function Bill({
  title,
  note,
  children,
}: {
  title: string;
  /** The line under the title: a count, a source, what the filter left. */
  note?: React.ReactNode;
  /** Anything that belongs on the title's own line, at the far end. */
  children?: React.ReactNode;
}) {
  return (
    <header className="mb-6">
      {/* Centred on the line box rather than on the baseline: the display face
          is caps-only, so there are no descenders and the optical middle of the
          lettering is the middle of the box. */}
      <div className="flex items-center gap-4">
        <h1 className="font-display text-[38px] leading-none tracking-[0.04em] text-beam sm:text-[46px]">
          {title}
        </h1>
        <span
          aria-hidden
          className="h-px min-w-[2rem] flex-1 bg-gradient-to-r from-beam/25 via-beam/[0.07] to-transparent"
        />
        {children}
      </div>
      {note ? <p className="q mt-2.5 text-[12.5px] text-ink-dim">{note}</p> : null}
    </header>
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
          'bg-dye-red text-beam-hot ring-1 ring-dye-red hover:bg-dye-red-hot disabled:bg-house-seat disabled:text-ink-dim disabled:ring-house-rail',
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
   The surface holds whatever is written on it at 8:1 or better, lit and unlit
   alike, because it no longer lets the room through.

   ── por que latão, e não vermelho ───────────────────────────────────────
   The chosen chip was red until 25/08/2026 — the same dye as the marquee's
   underline — and that was a rule being broken in the most visible place the
   product has. Brass carries state and selection everywhere else: the focus
   ring, the field being typed in, the genre criteria's legend, the vote you
   cast. Red carries two other things, action and recording, and it is kept
   scarce so those two stay legible.

   The distinction the product actually needs is the one it now draws: **red
   says where you are** — the lit tab of the section you are standing in — and
   **brass says what you chose**. A chip is a choice, not a location, so it
   wears brass.

   What survives from the red version is the reason it was made: the wash. The
   chosen chip is opaque and glowing from the inside, not a tint that let the
   wall show through it. Only the dye changed. */
/* Two geometries, one control. `md` is the filter row that stands on its own
   line — the catalogue's sort and its genres. `sm` is the same choice made
   inline beside something else, where a full-size chip would outweigh the thing
   it is attached to: the genre a take is being rated as, sitting on the slate
   next to the film's own name. The state, the surface and the dye are shared;
   only the size is not. */
const CHIP_SIZE = {
  sm: 'rounded-[1px] px-2 py-0.5 text-[11px] tracking-[0.14em]',
  md: 'rounded-cell px-3 py-1.5 text-[12.5px] tracking-[0.12em]',
} as const;

export function Chip({
  on,
  onClick,
  size = 'md',
  children,
}: {
  on: boolean;
  onClick: () => void;
  size?: keyof typeof CHIP_SIZE;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={cn(
        'bg-house-seat/70 font-display uppercase',
        CHIP_SIZE[size],
        'ring-1 transition-colors duration-150',
        on
          ? 'text-dye-brass ring-dye-brass/70 shadow-[inset_0_0_14px_rgba(217,164,65,0.20)]'
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
      <div className="flex items-center gap-3 rounded-cell bg-house-deep px-3 ring-1 ring-house-rail focus-within:ring-dye-brass">
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
   at the start of the opening and stay visible until the closing has finished.

   Mora aqui, e não na tela que a inventou, porque duas telas abrem gavetas: o
   acervo abre a ficha de alguém e o feed abre a conversa em cima dela. Uma
   segunda cópia deste truque seria uma segunda chance de ele ser feito errado. */
export function Drawer({ open, children }: { open: boolean; children: React.ReactNode }) {
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
