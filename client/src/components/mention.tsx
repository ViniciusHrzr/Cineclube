import { useEffect, useMemo, useRef, useState } from 'react';
import { Reel } from '@/components/bits';
import { initialsOf, reelColor, type Reviewer } from '@/lib/api';
import { cn, norm } from '@/lib/utils';
import { useWorld } from '@/lib/world';

function openMention(text: string, caret: number) {
  const upto = text.slice(0, caret);
  const at = upto.lastIndexOf('@');
  if (at < 0) return null;
  if (at > 0 && /[a-zA-Z0-9._-]/.test(upto[at - 1])) return null;
  const typed = upto.slice(at + 1);
  if (/\s/.test(typed)) return null;
  return { at, typed };
}

export function MentionField({
  value,
  onChange,
  onSubmit,
  placeholder,
  rows = 2,
  maxLength,
  label,
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  onSubmit?: () => void;
  placeholder?: string;
  rows?: number;
  maxLength?: number;
  label: string;
  className?: string;
}) {
  const club = useWorld();
  const box = useRef<HTMLTextAreaElement>(null);
  const [open, setOpen] = useState<{ at: number; typed: string } | null>(null);
  const [pick, setPick] = useState(0);

  const found = useMemo(() => {
    if (!open) return [];
    const typed = norm(open.typed);
    return club.reviewers
      .filter(r => r.handle && (!typed || r.handle.startsWith(typed) || norm(r.name).includes(typed)))
      .slice(0, 6);
  }, [open, club.reviewers]);

  useEffect(() => setPick(0), [open?.typed]);

  function readCaret() {
    const el = box.current;
    if (!el) return;
    setOpen(openMention(el.value, el.selectionStart ?? el.value.length));
  }

  function choose(who: Reviewer) {
    const el = box.current;
    if (!el || !open || !who.handle) return;
    const caret = el.selectionStart ?? value.length;
    const next = `${value.slice(0, open.at)}@${who.handle} ${value.slice(caret)}`;
    const to = open.at + who.handle.length + 2;
    onChange(next);
    setOpen(null);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(to, to);
    });
  }

  return (
    <div className={cn('relative', className)}>
      <label className="block">
        <span className="sr-only">{label}</span>
        <textarea
          ref={box}
          rows={rows}
          value={value}
          maxLength={maxLength}
          placeholder={placeholder}
          aria-autocomplete="list"
          aria-expanded={!!found.length}
          onChange={e => {
            onChange(e.target.value);
            requestAnimationFrame(readCaret);
          }}
          onClick={readCaret}
          onBlur={() => {
            window.setTimeout(() => setOpen(null), 120);
          }}
          onKeyDown={e => {
            if (found.length) {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                return setPick(p => (p + 1) % found.length);
              }
              if (e.key === 'ArrowUp') {
                e.preventDefault();
                return setPick(p => (p - 1 + found.length) % found.length);
              }
              if (e.key === 'Enter' || e.key === 'Tab') {
                e.preventDefault();
                return choose(found[pick]);
              }
              if (e.key === 'Escape') {
                e.preventDefault();
                return setOpen(null);
              }
            }
            if (onSubmit && e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              onSubmit();
            }
            requestAnimationFrame(readCaret);
          }}
          className="w-full resize-y rounded-cell bg-house-deep px-3 py-2 text-[13px] leading-relaxed text-ink caret-dye-red ring-1 ring-house-rail placeholder:text-ink-dim focus-visible:ring-dye-brass"
        />
      </label>

      {found.length ? (
        <ul
          role="listbox"
          aria-label="Quem chamar"
          className="plate absolute bottom-[calc(100%+4px)] left-0 z-30 w-[min(260px,100%)] overflow-hidden p-0"
        >
          {found.map((r, i) => (
            <li key={r.id}>
              <button
                type="button"
                role="option"
                aria-selected={i === pick}
                onMouseDown={e => e.preventDefault()}
                onClick={() => choose(r)}
                onMouseEnter={() => setPick(i)}
                className={cn(
                  'flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors duration-100',
                  i === pick ? 'bg-beam/[0.08]' : 'hover:bg-beam/[0.05]'
                )}
              >
                <Reel color={reelColor(r.dot, r.id)} src={r.avatar} size="sm">
                  {initialsOf(r.name)}
                </Reel>
                <span className="min-w-0 flex-1 truncate text-[12.5px] text-ink">{r.name}</span>
                <span className="q flex-none text-[11px] text-dye-brass">@{r.handle}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export function WithMentions({ text }: { text: string }) {
  const club = useWorld();
  const handles = useMemo(
    () =>
      club.reviewers
        .filter(r => r.handle)
        .map(r => r.handle as string)
        .sort((a, b) => b.length - a.length),
    [club.reviewers]
  );

  if (!text.includes('@') || !handles.length) return <>{text}</>;

  const pattern = new RegExp(`(^|[^a-zA-Z0-9@._-])@(${handles.join('|')})(?![a-z0-9])`, 'gi');
  const out: React.ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;

  while ((m = pattern.exec(text)) !== null) {
    const start = m.index + m[1].length;
    if (start > last) out.push(text.slice(last, start));
    out.push(
      <span key={`${start}`} className="text-dye-brass">
        @{m[2]}
      </span>
    );
    last = start + m[2].length + 1;
  }
  if (last < text.length) out.push(text.slice(last));
  return <>{out}</>;
}
