import { useEffect, useState } from 'react';
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
   keeps the mouse behaviour and a tablet with a trackpad gets it too. */
export function useFinePointer() {
  const query = '(hover: hover) and (pointer: fine)';
  const [fine, setFine] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const q = window.matchMedia(query);
    const sync = () => setFine(q.matches);
    sync();
    q.addEventListener('change', sync);
    return () => q.removeEventListener('change', sync);
  }, []);
  return fine;
}

/* Accent- and case-insensitive, so "cacador" finds "Caçador" and "orfa" finds
   "Órfã". Nobody reaches for the dead keys to filter a list they can see. */
export function norm(s: string) {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}
