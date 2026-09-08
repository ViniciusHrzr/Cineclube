import { useSyncExternalStore } from 'react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/* ── is there a mouse? ────────────────────────────────────────────────────
   The room answers a pointer: the wall lights where the cursor is, a poster
   tips toward the hand reaching for it. On a touch screen none of that can
   happen — and it was still being built and composited on every phone that
   opened the site.

   A media query and not a user-agent guess, so a laptop with a touchscreen
   keeps the mouse behaviour. One query for the whole page: every poster asks
   this, and a hundred cards meant a hundred MediaQueryList objects and a
   hundred listeners for a single fact that is the same for all of them. */
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
   Cada lista que o clube filtra localmente casava só com o título em português.
   Quem viu Entre Facas e Segredos lembra dele como Knives Out, e uma busca que
   não acha numa lista que está na tela lê como o filme não estar lá.

   Qualquer nome casa: o português, o original, o inglês. Eles chegam nulos
   quando só repetiriam um nome já na lista, então isto nunca compara a mesma
   string duas vezes.

   A consulta é normalizada uma vez por quem chama e os nomes uma vez cada aqui:
   um campo de busca é uma tecla e uma varredura da lista inteira. */
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

/* ── o relógio de um mural ────────────────────────────────────────────────
   As duas peças que quebram um feed em dias. Moravam dentro do feed de filmes e
   saíram quando o de séries passou a existir: são a mesma leitura de tempo, e
   uma segunda cópia diverge na primeira vez que alguém mexe em uma delas.

   A mesma armadilha de fuso do `whenOf` acima: sem o `Z`, o navegador lê o que
   o servidor gravou em UTC como hora local. */
const dateOf = (iso: string) => new Date(iso.includes('T') ? iso : iso.replace(' ', 'T') + 'Z');

/** "Hoje", "Ontem", ou a data por extenso. O ano só quando não é este. */
export function dayOf(iso: string) {
  const at = dateOf(iso);
  if (Number.isNaN(at.getTime())) return '—';
  const midnight = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((midnight(new Date()) - midnight(at)) / 86400000);
  if (days <= 0) return 'Hoje';
  if (days === 1) return 'Ontem';
  return at.toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: 'long',
    year: at.getFullYear() === new Date().getFullYear() ? undefined : 'numeric',
  });
}

/** A hora, ou nada: uma ficha antiga só tem a data, e meia-noite seria inventada. */
export function clockOf(iso: string) {
  const at = dateOf(iso);
  if (Number.isNaN(at.getTime())) return '';
  if (!/\d\d:\d\d/.test(iso)) return '';
  return at.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}
