import { catalog } from './catalog';
import { byDateDesc, fmtNum, has, isoDate, toNum, weekBounds } from './dates';
import type {
  BuildResult, Draft, Drafts, DraftSet, ExerciseDef, FieldError, LogSession,
  Plan, Prefs, Program, SessionDef, SetEntry, Unit,
} from './types';

export function normalizePrefs(prefs: Prefs, now: Date = new Date()): Prefs {
  const program = catalog.programs.find((p) => p.id === prefs.program) ?? catalog.programs[0];
  if (!program) return prefs;

  let session = program.sessions.find((s) => s.id === prefs.session);
  if (!session) {
    const byDay: Record<number, string> = { 1: 'lift-a', 3: 'lift-b', 5: 'lift-c' };
    const firstRun = !prefs.program;
    const wanted = firstRun ? byDay[now.getDay()] ?? 'lift-a' : '';
    session = program.sessions.find((s) => s.id === wanted) ?? program.sessions[0];
  }
  if (!session) return { ...prefs, program: program.id };
  return { ...prefs, program: program.id, session: session.id };
}

export const sessionKey = (programId: string, sessionId: string): string =>
  programId + '/' + sessionId;

export function exercisesFor(session: SessionDef, plan: Plan, key: string): ExerciseDef[] {
  const list = plan[key];
  return list === undefined ? session.exercises : list;
}

export function emptyDraft(date: string): Draft {
  return { sets: {}, note: '', date };
}

export function draftFor(drafts: Drafts, key: string, date: string): Draft {
  let d = drafts[key];
  if (!d) {
    d = emptyDraft(date);
    drafts[key] = d;
  }
  return d;
}

export function rowsFor(draft: Draft, ex: ExerciseDef): DraftSet[] {
  let rows = draft.sets[ex.id];
  if (!rows) {
    const n = Math.max(1, ex.sets || 1);
    rows = Array.from({ length: n }, () => ({ kg: '', reps: '', done: false }));
    draft.sets[ex.id] = rows;
  }
  return rows;
}

/** Grow to `want`; drop only empty trailing rows. Filled rows are never lost. */
export function resizeRows(draft: Draft, exId: string, want: number): void {
  if (!want) return;
  const rows = draft.sets[exId];
  if (!rows) return;
  while (rows.length < want) rows.push({ kg: '', reps: '', done: false });
  while (rows.length > want && !filled(rows[rows.length - 1]!)) rows.pop();
}

export function filled(r: DraftSet | undefined): boolean {
  return !!r && (has(r.kg) || has(r.reps));
}

export function counts(exercises: ExerciseDef[], draft: Draft): { ex: number; sets: number } {
  let ex = 0;
  let sets = 0;
  for (const e of exercises) {
    const n = (draft.sets[e.id] ?? []).filter(filled).length;
    if (n) { ex += 1; sets += n; }
  }
  return { ex, sets };
}

export function lastFor(
  sessions: LogSession[],
  exId: string,
): { date: string; sets: SetEntry[] } | null {
  const ordered = sessions.slice().sort(byDateDesc);
  for (const s of ordered) {
    for (const e of s.exercises ?? []) {
      if (e.id === exId && e.sets?.length) return { date: s.date, sets: e.sets };
    }
  }
  return null;
}

export function weekStatus(
  sessions: LogSession[],
  now: Date = new Date(),
): { start: string; end: string; done: Set<string>; count: number } {
  const b = weekBounds(now);
  const done = new Set<string>();
  const lifts = new Set(['lift-a', 'lift-b', 'lift-c']);
  for (const s of sessions) {
    if (s.source === 'progress') continue;
    if (!s.date || s.date < b.start || s.date > b.end) continue;
    if (lifts.has(s.session)) done.add(s.session);
  }
  return { ...b, done, count: done.size };
}

export interface BuildInput {
  program: Program;
  session: SessionDef;
  exercises: ExerciseDef[];
  draft: Draft;
  now?: number;
  src?: LogSession;
}

export function buildSession(input: BuildInput): BuildResult {
  const now = input.now ?? Date.now();
  const errors: FieldError[] = [];
  const out: { id: string; name: string; unit: Unit; sets: SetEntry[] }[] = [];

  for (const ex of input.exercises) {
    const rows = input.draft.sets[ex.id] ?? [];
    const sets: SetEntry[] = [];
    rows.forEach((r, i) => {
      if (!filled(r)) return;
      const kg = toNum(r.kg);
      const reps = toNum(r.reps);
      if (Number.isNaN(kg)) errors.push({ kind: 'field', exId: ex.id, row: i, field: 'kg' });
      if (Number.isNaN(reps)) errors.push({ kind: 'field', exId: ex.id, row: i, field: 'reps' });
      sets.push({
        kg: kg === null || Number.isNaN(kg) ? null : kg,
        reps: reps === null || Number.isNaN(reps) ? null : reps,
      });
    });
    if (sets.length) {
      out.push({ id: ex.id, name: ex.title, unit: ex.unit === 'sec' ? 'sec' : ex.unit === 'min' ? 'min' : 'reps', sets });
    }
  }

  if (errors.length) return { ok: false, errors };
  if (!out.length) return { ok: false, errors: [{ kind: 'empty' }] };

  const src = input.src;
  const doc: LogSession = {
    id: src?.id ?? 's' + now,
    rev: now,
    ts: src?.ts ?? now,
    date: input.draft.date || isoDate(new Date(now)),
    program: src?.program ?? input.program.id,
    programLabel: src?.programLabel ?? input.program.label,
    session: src?.session ?? input.session.id,
    sessionLabel: src?.sessionLabel ?? input.session.label,
    exercises: out,
    note: input.draft.note.trim(),
  };
  if (src?.source) doc.source = src.source;
  return { ok: true, session: doc };
}

/** The formatted text a saved set shows, e.g. "60 kg × 4". */
export function setText(s: SetEntry, unit: Unit = 'reps'): string {
  const kg = s.kg != null ? fmtNum(s.kg) : '';
  const reps = s.reps != null ? fmtNum(s.reps) : '';
  if (unit === 'min') return reps ? reps + ' min' : kg ? kg + ' kg' : '';
  if (kg && reps) return kg + ' kg × ' + reps + (unit === 'sec' ? ' s' : '');
  if (kg) return kg + ' kg';
  if (reps) return reps + (unit === 'sec' ? ' s' : ' reps');
  return '';
}

export function draftFromSession(src: LogSession): { exercises: ExerciseDef[]; draft: Draft } {
  const exercises: ExerciseDef[] = (src.exercises ?? []).map((e) => {
    const meta = catalog.exerciseIndex[e.id];
    const n = Math.max(1, (e.sets ?? []).length);
    return {
      id: e.id,
      title: e.name || meta?.title || e.id,
      hint: meta?.hint ?? '',
      sets: n,
      target: meta?.target ?? `${n} ${n === 1 ? 'set' : 'sets'}`,
      unit: e.unit === 'sec' || e.unit === 'min' ? e.unit : 'reps',
      suggested: meta?.suggested ?? '',
      bw: meta?.bw ?? false,
    };
  });
  const draft: Draft = { sets: {}, note: src.note ?? '', date: src.date || isoDate() };
  (src.exercises ?? []).forEach((e) => {
    draft.sets[e.id] = (e.sets ?? []).map((x) => ({
      kg: x.kg != null ? fmtNum(x.kg) : '',
      reps: x.reps != null ? fmtNum(x.reps) : '',
      done: false,
    }));
  });
  return { exercises, draft };
}

/* --------------------------------------------------------------- progress */

export function normTitle(s: string | null | undefined): string {
  return String(s ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
}

export function seriesKey(name: string): string {
  return 'n|' + normTitle(name);
}

export interface SeriesPoint {
  date: string;
  v: number;
  sets: SetEntry[];
}

export interface Series {
  key: string;
  id: string;
  name: string;
  unit: Unit;
  rows: number;
  useKg: boolean;
  pts: SeriesPoint[];
  metric: string;
  mu: string;
}

/** R9: series are keyed by exercise name, so a rename starts a new line. */
export function buildSeries(sessions: LogSession[]): Series[] {
  const index = new Map<string, { id: string; name: string; unit: Unit; rows: { date: string; sets: SetEntry[] }[] }>();
  const oldestFirst = sessions.slice().sort((a, b) => byDateDesc(b, a));

  for (const s of oldestFirst) {
    for (const e of s.exercises ?? []) {
      if (!e.sets?.length) continue;
      const name = e.name || catalog.exerciseIndex[e.id]?.title || e.id;
      const key = seriesKey(name);
      let o = index.get(key);
      if (!o) {
        o = { id: e.id, name, unit: e.unit, rows: [] };
        index.set(key, o);
      }
      o.id = e.id;
      o.name = name;
      o.unit = e.unit || o.unit;
      o.rows.push({ date: s.date, sets: e.sets });
    }
  }

  const out: Series[] = [];
  for (const [key, o] of index) {
    const useKg = o.rows.every((r) => r.sets.some((x) => x.kg != null && x.kg > 0));
    const pts: SeriesPoint[] = o.rows.map((r) => {
      const vals = useKg
        ? r.sets.filter((x) => x.kg != null && x.kg > 0).map((x) => x.kg as number)
        : r.sets.map((x) => x.reps ?? 0);
      return { date: r.date, v: Math.max(...(vals.length ? vals : [0])), sets: r.sets };
    });
    out.push({
      key,
      id: o.id,
      name: o.name,
      unit: o.unit,
      rows: o.rows.length,
      useKg,
      pts,
      metric: useKg ? 'Top weight' : o.unit === 'sec' ? 'Best hold' : o.unit === 'min' ? 'Longest' : 'Best reps',
      mu: useKg ? 'kg' : o.unit === 'sec' ? 'sec' : o.unit === 'min' ? 'min' : 'reps',
    });
  }

  return out.sort((a, b) => b.rows - a.rows || a.name.localeCompare(b.name));
}
