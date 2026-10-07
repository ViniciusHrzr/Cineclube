import { useEffect, useRef, useState } from 'react';
import {
  Check as CheckIcon,
  ChevronDown as ChevronDownIcon,
  Play as PlayIcon,
  Search as SearchIcon,
  Users as UsersIcon,
  X as XIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { fmt, type Universe } from '@/lib/api';
import { mediaUrl } from '@/lib/session';

const LENSES: { id: Universe; label: string }[] = [
  { id: 'filmes', label: 'Filmes' },
  { id: 'series', label: 'Séries' },
];

export function Lens({ on, onPick }: { on: Universe; onPick: (u: Universe) => void }) {
  return (
    <div className="flex flex-none items-center gap-0.5" role="tablist" aria-label="Universo">
      {LENSES.map(o => {
        const here = on === o.id;
        return (
          <button
            key={o.id}
            type="button"
            role="tab"
            aria-selected={here}
            onClick={() => onPick(o.id)}
            className={cn(
              'relative pb-1.5 pt-1 font-display uppercase leading-none',
              'transition-colors duration-150',
              'px-1 text-[12px] tracking-[0.08em] coarse:min-h-[38px]',
              'sm:px-2 sm:text-[13px] sm:tracking-[0.12em]',
              here ? 'text-beam' : 'text-ink-dim hover:text-ink'
            )}
          >
            {o.label}
            {}
            <span
              aria-hidden
              className={cn(
                'absolute inset-x-1 bottom-0 h-[2px] bg-dye-red transition-opacity duration-150',
                here ? 'opacity-100' : 'opacity-0'
              )}
            />
          </button>
        );
      })}
    </div>
  );
}

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

const REEL_SIZE = {
  sm: { photo: 'h-5 w-5', tag: 'h-5 min-w-[28px] px-1.5 text-[10.5px]' },
  md: { photo: 'h-6 w-6', tag: 'h-6 min-w-[32px] px-1.5 text-[11px]' },
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
        <img src={mediaUrl(src)} alt="" loading="lazy" className="h-full w-full object-cover" />
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

export function Bill({
  title,
  note,
  children,
}: {
  title: string;
  note?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <header className="mb-6">
      {}
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
        'coarse:min-h-[44px] coarse:px-5 coarse:text-[14px]',
        'font-display text-[13px] uppercase tracking-[0.14em] leading-none',
        'transition-[background-color,color,border-color,transform] duration-150 active:translate-y-px',
        'disabled:cursor-not-allowed disabled:opacity-40',
        tone === 'commit' &&
          'bg-dye-red text-beam-hot ring-1 ring-dye-red hover:bg-dye-red-hot disabled:bg-house-seat disabled:text-ink-dim disabled:ring-house-rail',
        tone === 'flush' &&
          'bg-house-seat/70 ring-1 ring-house-rail text-ink hover:ring-beam/70 hover:text-beam',
        tone === 'ghost' && 'text-ink-dim hover:text-beam',
        tone === 'danger' &&
          'ring-1 ring-dye-red-lit/45 text-dye-red-lit hover:ring-dye-red-lit hover:text-dye-red-glow',
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
        'inline-flex h-[38px] w-[38px] flex-none items-center justify-center rounded-cell',
        'coarse:h-11 coarse:w-11',
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

const CHIP_SIZE = {
  sm: 'rounded-[1px] px-2 py-0.5 text-[11px] tracking-[0.14em] coarse:min-h-[34px] coarse:px-3 coarse:text-[12px]',
  md: 'rounded-cell px-3 py-1.5 text-[12.5px] tracking-[0.12em] coarse:min-h-[40px] coarse:px-4 coarse:text-[13.5px]',
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
        'inline-flex items-center justify-center bg-house-seat/70 font-display uppercase',
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

export type ReelChoice = {
  id: string | null;
  label: string;
  count: number;
  reel?: React.ReactNode;
  hint?: string;
};

export function ReelPicker({
  choices,
  value,
  onPick,
  title,
}: {
  choices: ReelChoice[];
  value: string | null;
  onPick: (id: string | null) => void;
  title: string;
}) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setOpen(false);
      trigger.current?.focus();
    };
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', away);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);

  const here = choices.find(c => c.id === value) ?? choices[0];
  if (!here) return null;

  const face = (c: ReelChoice) =>
    c.reel ?? (
      <span className="flex h-6 w-6 flex-none items-center justify-center">
        <UsersIcon className="h-[15px] w-[15px]" strokeWidth={1.7} aria-hidden />
      </span>
    );

  return (
    <div ref={box} className="relative inline-flex">
      <button
        ref={trigger}
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        aria-haspopup="true"
        title={title}
        aria-label={`${title} — ${here.label}`}
        className={cn(
          'flex items-center gap-2 rounded-cell bg-house-seat/70 py-1 pl-1 pr-2 ring-1 transition-colors duration-150',
          'coarse:min-h-[40px]',
          value !== null || open
            ? 'text-dye-brass ring-dye-brass/70 shadow-[inset_0_0_14px_rgba(217,164,65,0.20)]'
            : 'text-ink-dim ring-house-rail hover:text-ink hover:ring-white/25'
        )}
      >
        {face(here)}
        <span className="max-w-[46vw] truncate font-display text-[12.5px] uppercase leading-none tracking-[0.1em] sm:max-w-[220px]">
          {here.label}
        </span>
        <span className="q text-[10.5px] leading-none opacity-70">{here.count}</span>
        <ChevronDownIcon
          aria-hidden
          strokeWidth={1.8}
          className={cn(
            'h-3.5 w-3.5 flex-none opacity-70 transition-transform duration-200 ease-beam',
            open && 'rotate-180'
          )}
        />
      </button>

      {}
      {open ? (
        <div
          role="group"
          aria-label={title}
          className="plate absolute left-0 top-[calc(100%+6px)] z-40 max-h-[min(calc(60dvh/var(--ui-zoom)),360px)] w-[264px] max-w-[calc(100vw-2rem)] overflow-y-auto p-1"
        >
          {choices.map(c => {
            const on = c.id === here.id;
            return (
              <button
                key={c.id ?? 'tudo'}
                type="button"
                aria-pressed={on}
                aria-label={c.hint}
                onClick={() => {
                  onPick(c.id);
                  setOpen(false);
                  trigger.current?.focus();
                }}
                className={cn(
                  'flex w-full items-center gap-2.5 rounded-cell px-2 py-2 text-left transition-colors duration-150 coarse:min-h-[44px]',
                  on
                    ? 'bg-beam/[0.06] text-dye-brass'
                    : 'text-ink-dim hover:bg-beam/[0.05] hover:text-ink'
                )}
              >
                {face(c)}
                <span className="min-w-0 flex-1 truncate font-display text-[12.5px] uppercase leading-tight tracking-[0.1em]">
                  {c.label}
                </span>
                <span className="q flex-none text-[10.5px] leading-none opacity-70">{c.count}</span>
                {}
                <CheckIcon
                  aria-hidden
                  strokeWidth={2}
                  className={cn('h-3.5 w-3.5 flex-none', on ? 'opacity-100' : 'opacity-0')}
                />
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

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

export function Drawer({ open, children }: { open: boolean; children: React.ReactNode }) {
  return (
    <div
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

const YT_ID = /(?:youtube(?:-nocookie)?\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/)|youtu\.be\/)([\w-]{11})/;

export function TrailerKey({
  url,
  title,
  className,
  children,
}: {
  url: string;
  title: string;
  className?: string;
  children?: React.ReactNode;
}) {
  const [aberto, setAberto] = useState(false);
  const id = YT_ID.exec(url)?.[1] ?? null;

  const look = cn(
    'inline-flex w-fit items-center gap-2 font-display text-[12px] uppercase leading-none tracking-[0.14em]',
    'text-dye-red-lit transition-colors hover:text-dye-red-glow',
    className
  );
  const rotulo = children ?? 'Assistir trailer';

  if (!id) {
    return (
      <a href={url} target="_blank" rel="noopener noreferrer" className={look}>
        <PlayIcon className="h-3.5 w-3.5 fill-current" strokeWidth={0} aria-hidden />
        {rotulo}
      </a>
    );
  }

  return (
    <>
      <button type="button" onClick={() => setAberto(true)} className={look}>
        <PlayIcon className="h-3.5 w-3.5 fill-current" strokeWidth={0} aria-hidden />
        {rotulo}
      </button>
      {aberto ? (
        <TrailerSheet id={id} url={url} title={title} onClose={() => setAberto(false)} />
      ) : null}
    </>
  );
}

function TrailerSheet({
  id,
  url,
  title,
  onClose,
}: {
  id: string;
  url: string;
  title: string;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    ref.current?.showModal();
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const cancel = (e: Event) => {
      e.preventDefault();
      onClose();
    };
    el.addEventListener('cancel', cancel);
    return () => el.removeEventListener('cancel', cancel);
  }, [onClose]);

  return (
    <dialog
      ref={ref}
      aria-label={`Trailer de ${title}`}
      onClick={e => {
        if (e.target === ref.current) onClose();
      }}
      className="w-full max-w-[980px] bg-transparent p-2 text-ink backdrop:bg-house-deep/95 open:animate-beam-in sm:p-4"
    >
      <div className="plate relative p-3 sm:p-4">
        <div className="flex items-center gap-3 pr-1">
          <p className="legend min-w-0 flex-1 truncate">Trailer · {title}</p>
          <IconKey aria-label="Fechar" onClick={onClose} className="flex-none">
            <XIcon className="h-4 w-4" strokeWidth={1.8} />
          </IconKey>
        </div>

        {}
        <div className="mt-3 aspect-video w-full overflow-hidden rounded-cell bg-black ring-1 ring-white/[0.08]">
          <iframe
            src={`https://www.youtube-nocookie.com/embed/${id}?autoplay=1&rel=0&modestbranding=1&playsinline=1`}
            title={`Trailer de ${title}`}
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
            referrerPolicy="strict-origin-when-cross-origin"
            allowFullScreen
            className="h-full w-full border-0"
          />
        </div>

        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="q mt-3 inline-flex items-center gap-1.5 text-[11.5px] text-ink-dim transition-colors hover:text-beam"
        >
          Abrir no YouTube
        </a>
      </div>
    </dialog>
  );
}

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
