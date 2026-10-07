import { useCallback, useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Key } from '@/components/bits';

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
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    const measure = () => setBox(el.getBoundingClientRect());
    measure();
    window.addEventListener('scroll', measure, true);
    window.addEventListener('resize', measure);
    const esc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') done();
    };
    window.addEventListener('keydown', esc);
    return () => {
      window.removeEventListener('scroll', measure, true);
      window.removeEventListener('resize', measure);
      window.removeEventListener('keydown', esc);
    };
  }, [el, done]);

  if (!el || !box) return null;

  const step = steps[n];
  const last = n >= steps.length - 1;
  const pad = 8;
  const below = box.bottom + 190 < window.innerHeight;
  const width = Math.min(320, window.innerWidth - 32);
  const left = Math.min(Math.max(box.left - pad, 16), window.innerWidth - width - 16);
  const room = window.innerHeight - 220;
  const top = Math.min(Math.max(box.bottom + pad + 12, 16), room);
  const bottom = Math.min(Math.max(window.innerHeight - box.top + pad + 12, 16), room);

  return (
    <div
      className="fixed inset-0 z-[60]"
      role="dialog"
      aria-label="Dicas da tela de avaliar"
      onClick={() => (last ? done() : setN(n + 1))}
    >
      <motion.div
        className="pointer-events-none absolute rounded-cell ring-2 ring-dye-brass"
        style={{
          top: box.top - pad,
          left: box.left - pad,
          width: box.width + pad * 2,
          height: box.height + pad * 2,
          boxShadow: '0 0 0 9999px rgba(5,5,6,0.86)',
        }}
      />
      <motion.div
        key={step.at}
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        className="plate absolute p-4"
        style={{
          width,
          left,
          top: below ? top : undefined,
          bottom: below ? undefined : bottom,
        }}
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
