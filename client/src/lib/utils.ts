import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/* Accent- and case-insensitive, so "cacador" finds "Caçador" and "orfa" finds
   "Órfã". Nobody reaches for the dead keys to filter a list they can see. */
export function norm(s: string) {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}
