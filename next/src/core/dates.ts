import type { LogSession } from './types';

export const pad = (n: number): string => (n < 10 ? '0' : '') + n;

/** Local YYYY-MM-DD. Never derive this from toISOString(). */
export function isoDate(d: Date = new Date()): string {
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}

export function parseISO(s: string): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1);
}

export function fmtDate(s: string): string {
  const d = parseISO(s);
  if (Number.isNaN(d.getTime())) return s;
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

export function fmtNum(n: number): string {
  return String(Number(n.toFixed(2)));
}

export function has(v: unknown): boolean {
  return v !== '' && v != null;
}

/** '' -> null; '42,5' -> 42.5; negative or junk -> NaN. */
export function toNum(v: unknown): number | null {
  if (!has(v)) return null;
  const n = Number.parseFloat(String(v).replace(',', '.'));
  return Number.isFinite(n) && n >= 0 ? n : Number.NaN;
}

export function byDateDesc(a: LogSession, b: LogSession): number {
  const da = String(a.date ?? '');
  const db = String(b.date ?? '');
  if (da !== db) return da < db ? 1 : -1;
  return (b.ts ?? 0) - (a.ts ?? 0);
}

export function weekBounds(now: Date = new Date()): { start: string; end: string } {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  const day = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - day);
  const start = isoDate(d);
  d.setDate(d.getDate() + 6);
  return { start, end: isoDate(d) };
}

export function fmtSet(s: { kg: number | null; reps: number | null }, unit = 'reps'): string {
  const kg = s.kg != null ? fmtNum(s.kg) : null;
  const reps = s.reps != null ? fmtNum(s.reps) : null;
  if (kg !== null && reps !== null) return kg + ' kg × ' + reps + (unit === 'sec' ? ' s' : '');
  if (kg !== null) return kg + ' kg';
  if (reps !== null) return reps + (unit === 'sec' ? ' s' : ' reps');
  return '';
}
