import { useEffect, useRef } from 'react';

const DISTANCIA = 56;
const INCLINACAO = 1.5;
const TEMPO_MS = 800;

const SOBRA = 24;

const DE_OUTRO_DONO = 'input[type="range"], video, [data-noswipe], dialog[open]';

function daquiNao(alvo: EventTarget | null) {
  const el = alvo instanceof Element ? alvo : null;
  if (!el) return true;
  if (el.closest(DE_OUTRO_DONO)) return true;

  for (let no: Element | null = el; no; no = no.parentElement) {
    if (no.scrollWidth - no.clientWidth < SOBRA) continue;
    const estilo = getComputedStyle(no).overflowX;
    if (estilo === 'auto' || estilo === 'scroll') return true;
  }
  return false;
}

export function useSwipeTabs(onPrev: () => void, onNext: () => void, enabled = true) {
  const held = useRef({ onPrev, onNext, enabled });
  held.current = { onPrev, onNext, enabled };

  useEffect(() => {
    if (!window.matchMedia('(hover: none), (pointer: coarse)').matches) return;

    let x = 0;
    let y = 0;
    let quando = 0;
    let vale = false;

    const começou = (e: TouchEvent) => {
      vale = held.current.enabled && e.touches.length === 1 && !daquiNao(e.target);
      if (!vale) return;
      x = e.touches[0].clientX;
      y = e.touches[0].clientY;
      quando = Date.now();
    };

    const acabou = (e: TouchEvent) => {
      if (!vale) return;
      vale = false;
      const toque = e.changedTouches[0];
      if (!toque) return;

      const dx = toque.clientX - x;
      const dy = toque.clientY - y;
      if (Date.now() - quando > TEMPO_MS) return;
      if (Math.abs(dx) < DISTANCIA) return;
      if (Math.abs(dx) < Math.abs(dy) * INCLINACAO) return;

      if (dx < 0) held.current.onNext();
      else held.current.onPrev();
    };

    const cancelou = () => {
      vale = false;
    };

    window.addEventListener('touchstart', começou, { passive: true });
    window.addEventListener('touchend', acabou, { passive: true });
    window.addEventListener('touchcancel', cancelou, { passive: true });

    return () => {
      window.removeEventListener('touchstart', começou);
      window.removeEventListener('touchend', acabou);
      window.removeEventListener('touchcancel', cancelou);
    };
  }, []);
}

export function neighbour<T extends { id: string }>(
  tabs: readonly T[],
  atual: string,
  passo: 1 | -1
): string | null {
  const onde = tabs.findIndex(t => t.id === atual);
  if (onde < 0) return null;
  const proximo = tabs[onde + passo];
  return proximo ? proximo.id : null;
}
