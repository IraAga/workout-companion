import { fmtDate } from '../core/dates';

export const esc = (s: unknown): string =>
  String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] ?? c),
  );

export const dateLabel = (iso: string): string => fmtDate(iso).toUpperCase();

export const plural = (n: number, one: string, many = one + 's'): string =>
  n + ' ' + (n === 1 ? one : many);
