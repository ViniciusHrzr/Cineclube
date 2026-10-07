import { useEffect, useSyncExternalStore, type RefObject } from 'react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function useAwayClose(
  open: boolean,
  box: RefObject<HTMLElement | null>,
  onClose: () => void
) {
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) onClose();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('mousedown', away);
      document.removeEventListener('keydown', key);
    };
  }, [open, box, onClose]);
}

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

export function plural(n: number, one: string, many: string) {
  return `${n} ${n === 1 ? one : many}`;
}

export function norm(s: string) {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

export function named(query: string, ...names: (string | null | undefined)[]) {
  return names.some(n => n && norm(n).includes(query));
}

export function whenOf(iso: string) {
  const at = new Date(iso.includes('T') ? iso : iso.replace(' ', 'T') + 'Z');
  if (Number.isNaN(at.getTime())) return '';
  const days = Math.floor((Date.now() - at.getTime()) / 86400000);
  const clock = at.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  if (days <= 0) return clock;
  if (days === 1) return `ontem, ${clock}`;
  return at.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
}

const dateOf = (iso: string) => new Date(iso.includes('T') ? iso : iso.replace(' ', 'T') + 'Z');

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

export function clockOf(iso: string) {
  const at = dateOf(iso);
  if (Number.isNaN(at.getTime())) return '';
  if (!/\d\d:\d\d/.test(iso)) return '';
  return at.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}
