import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** دمج أصناف Tailwind مع حل التعارضات (آخر صنف يفوز). */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
