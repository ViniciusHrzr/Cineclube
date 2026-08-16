import { useSyncExternalStore } from 'react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/* ── is there a mouse? ────────────────────────────────────────────────────
   The room answers a pointer: the wall lights where the cursor is, a poster
   tips toward the hand reaching for it. On a touch screen none of that can ever
   happen — and it was still being built, laid out and composited on every phone
   that opened the site, which is most of them.

   This is the switch that lets the interface not build what it cannot use. It
   is a media query and not a user-agent guess, so a laptop with a touchscreen
   keeps the mouse behaviour and a tablet with a trackpad gets it too.

   One query for the whole page, not one per component. Every poster on the wall
   asks this — a hundred cards on a loaded catalogue meant a hundred MediaQueryList
   objects and a hundred listeners for a single fact that is the same for all of
   them, and each one held its own copy of it in React state. The fact lives here
   once and the components subscribe to it. */
const FINE = '(hover: hover) and (pointer: fine)';
const fineQuery = typeof window === 'undefined' ? null : window.matchMedia(FINE);

function subscribeFine(onChange: () => void) {
  fineQuery?.addEventListener('change', onChange);
  return () => fineQuery?.removeEventListener('change', onChange);
}

export function useFinePointer() {
  return useSyncExternalStore(
    subscribeFine,
    () => fineQuery?.matches ?? false,
    () => false
  );
}

/* ── counting things out loud ─────────────────────────────────────────────
   "1 avaliação(ões)" is a form pretending to be a sentence. It is what a
   program writes when it does not want to decide, and the reader pays for that
   indecision every time — they have to look at the number, pick the ending
   themselves and discard the other one.

   The number is right there. Deciding is one comparison. */
export function plural(n: number, one: string, many: string) {
  return `${n} ${n === 1 ? one : many}`;
}

/* Accent- and case-insensitive, so "cacador" finds "Caçador" and "orfa" finds
   "Órfã". Nobody reaches for the dead keys to filter a list they can see. */
export function norm(s: string) {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}
