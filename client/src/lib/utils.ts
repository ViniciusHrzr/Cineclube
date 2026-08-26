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

/* ── um filme tem mais de um nome ─────────────────────────────────────────
   Every list the club filters locally — a fila, a sessão, o acervo — used to
   match the Portuguese title and nothing else, which quietly made the app worse
   at the one thing it is for. Somebody who watched Entre Facas e Segredos
   remembers it as Knives Out; somebody hunting a copy of Parasita is typing
   Parasite. Both were misses, and a miss on a list you are looking straight at
   reads as the film not being there.

   Any name matches: the Portuguese one, the original, the English one. They
   arrive null when they would only repeat a name already in the list, so this
   never compares the same string twice.

   The query is normalised once by the caller and the names once each here —
   see `norm`. A search box is a keystroke and a full list scan, and this runs
   on every one of them. */
export function named(query: string, ...names: (string | null | undefined)[]) {
  return names.some(n => n && norm(n).includes(query));
}

/* ── quando foi ───────────────────────────────────────────────────────────
   Uma conversa e um aviso são lidos na ordem em que aconteceram, e o que
   interessa é se foi agora ou faz semanas — não o carimbo. Hoje e ontem por
   extenso, o resto em data curta; o carimbo completo fica no `title` de quem
   desenha isto, para quem precisar dele.

   O servidor grava com `datetime('now')`, que é UTC e não traz fuso no texto.
   Sem o `Z` acrescentado aqui o navegador lê a string como hora local e a
   conversa inteira aparece três horas fora do lugar. */
export function whenOf(iso: string) {
  const at = new Date(iso.includes('T') ? iso : iso.replace(' ', 'T') + 'Z');
  if (Number.isNaN(at.getTime())) return '';
  const days = Math.floor((Date.now() - at.getTime()) / 86400000);
  const clock = at.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  if (days <= 0) return clock;
  if (days === 1) return `ontem, ${clock}`;
  return at.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
}
