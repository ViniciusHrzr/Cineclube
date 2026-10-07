import { useCallback, useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Key } from '@/components/bits';
import { cn } from '@/lib/utils';

const HEAD = 76;
const BAR = 210;

export type TourStep = { at: string; title: string; text: string };

export function Tour({ steps, done }: { steps: TourStep[]; done: () => void }) {
  const [n, setN] = useState(0);
  const [box, setBox] = useState<DOMRect | null>(null);
  const [el, setEl] = useState<HTMLElement | null>(null);

  useEffect(() => {
    let i = n;
    let found: HTMLElement | null = null;
    while (i < steps.length && !found) {
      found = document.querySelector<HTMLElement>(`[data-tour="${steps[i].at}"]`);
      if (!found) i += 1;
    }
    if (!found) {
      done();
      return;
    }
    if (i !== n) setN(i);
    setEl(found);
  }, [n, steps, done]);

  useEffect(() => {
    if (!el) return;
    const fit = () => {
      const r = el.getBoundingClientRect();
      const over = r.bottom - (window.innerHeight - BAR);
      const under = HEAD - r.top;
      if (under > 0) window.scrollBy(0, -under);
      else if (over > 0) window.scrollBy(0, Math.min(over, r.top - HEAD));
      setBox(el.getBoundingClientRect());
    };
    el.scrollIntoView({ block: 'center' });
    fit();
    const measure = () => setBox(el.getBoundingClientRect());
    window.addEventListener('scroll', measure, true);
    window.addEventListener('resize', fit);
    const esc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') done();
    };
    window.addEventListener('keydown', esc);
    return () => {
      window.removeEventListener('scroll', measure, true);
      window.removeEventListener('resize', fit);
      window.removeEventListener('keydown', esc);
    };
  }, [el, done]);

  if (!el || !box) return null;

  const step = steps[n];
  const last = n >= steps.length - 1;
  const pad = 8;
  const atTop = box.bottom > window.innerHeight - BAR;

  return (
    <div
      className="fixed inset-0 z-[60]"
      role="dialog"
      aria-label="Dicas da tela"
      onClick={() => (last ? done() : setN(n + 1))}
    >
      <div
        className="pointer-events-none absolute rounded-cell"
        style={{
          top: box.top - pad,
          left: box.left - pad,
          width: box.width + pad * 2,
          height: box.height + pad * 2,
          boxShadow: '0 0 0 2px #d9a441, 0 0 0 9999px rgba(5,5,6,0.86)',
        }}
      />
      <motion.div
        key={step.at}
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        className={cn(
          'plate fixed left-1/2 w-[min(420px,calc(100vw-32px))] -translate-x-1/2 p-4',
          'shadow-[0_18px_60px_rgba(0,0,0,0.65)]',
          atTop ? 'top-[76px]' : 'bottom-5'
        )}
        onClick={e => e.stopPropagation()}
      >
        <span className="legend">{step.title}</span>
        <p className="mt-2 text-[13px] leading-relaxed text-ink-dim">{step.text}</p>
        <div className="mt-4 flex items-center gap-3">
          <Key tone="commit" className="flex-1" onClick={() => (last ? done() : setN(n + 1))}>
            {last ? 'Entendi' : 'Próxima'}
          </Key>
          <span className="q text-[11px] text-ink-faint">
            {n + 1}/{steps.length}
          </span>
          {last ? null : (
            <Key tone="ghost" className="px-2" onClick={done}>
              Pular
            </Key>
          )}
        </div>
      </motion.div>
    </div>
  );
}

export function TourKey({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Rever as dicas da tela"
      title="Rever as dicas"
      className="fixed right-3 top-[76px] z-40 flex h-8 w-8 items-center justify-center rounded-full bg-house-seat/80 font-display text-[13px] text-ink-dim ring-1 ring-house-rail backdrop-blur transition-colors hover:text-beam hover:ring-dye-brass"
    >
      ?
    </button>
  );
}

export function useFirstVisit(key: string, ready: boolean) {
  const store = `cineclube.tour.${key}`;
  const [on, setOn] = useState(false);
  useEffect(() => {
    if (ready && !localStorage.getItem(store)) setOn(true);
  }, [ready, store]);
  const close = useCallback(() => {
    localStorage.setItem(store, '1');
    setOn(false);
  }, [store]);
  const open = useCallback(() => setOn(true), []);
  return [on, close, open] as const;
}
