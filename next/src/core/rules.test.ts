import { describe, expect, it } from 'vitest';
import { catalog } from './catalog';
import { toNum, weekBounds } from './dates';
import { buildSeries, buildSession, counts, lastFor, normalizePrefs, resizeRows, setText, weekStatus } from './rules';
import type { Draft, LogSession } from './types';

const gym = catalog.programs.find((p) => p.id === 'gym')!;
const liftA = gym.sessions.find((s) => s.id === 'lift-a')!;
const deadlift = liftA.exercises[0]!;

function emptyDraft(date = '2026-11-16'): Draft {
  return { sets: {}, note: '', date };
}

describe('toNum', () => {
  it('parses decimals, comma decimals and empty strings', () => {
    expect(toNum('42.5')).toBe(42.5);
    expect(toNum('42,5')).toBe(42.5);
    expect(toNum('')).toBeNull();
    expect(toNum(null)).toBeNull();
  });

  it('rejects negatives and junk', () => {
    expect(Number.isNaN(toNum('-1'))).toBe(true);
    expect(Number.isNaN(toNum('abc'))).toBe(true);
  });
});

describe('weekBounds', () => {
  it('runs Monday to Sunday', () => {
    const { start, end } = weekBounds(new Date(2026, 10, 16)); // Monday
    expect(start).toBe('2026-11-16');
    expect(end).toBe('2026-11-22');
  });

  it('puts Sunday in the week that started six days earlier', () => {
    const { start, end } = weekBounds(new Date(2026, 10, 15));
    expect(start).toBe('2026-11-09');
    expect(end).toBe('2026-11-15');
  });
});

describe('buildSession', () => {
  it('drops empty rows and exercises with no sets', () => {
    const draft = emptyDraft();
    draft.sets[deadlift.id] = [
      { kg: '60', reps: '4' },
      { kg: '', reps: '' },
      { kg: '57.5', reps: '4' },
    ];
    draft.sets[liftA.exercises[1]!.id] = [{ kg: '', reps: '' }];
    draft.note = '  strong  ';

    const res = buildSession({ program: gym, session: liftA, exercises: liftA.exercises, draft, now: 1000 });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.session.id).toBe('s1000');
    expect(res.session.exercises).toHaveLength(1);
    expect(res.session.exercises[0]!.sets).toEqual([
      { kg: 60, reps: 4 },
      { kg: 57.5, reps: 4 },
    ]);
    expect(res.session.note).toBe('strong');
    expect(res.session.programLabel).toBe('Gym program');
    expect(res.session.sessionLabel).toBe('Lift A');
  });

  it('reports field errors and refuses an empty session', () => {
    const draft = emptyDraft();
    draft.sets[deadlift.id] = [{ kg: '-2', reps: 'junk' }];
    const bad = buildSession({ program: gym, session: liftA, exercises: liftA.exercises, draft, now: 1 });
    expect(bad.ok).toBe(false);
    if (!bad.ok) {
      expect(bad.errors).toHaveLength(2);
      expect(bad.errors[0]!.field).toBe('kg');
    }

    const empty = buildSession({ program: gym, session: liftA, exercises: liftA.exercises, draft: emptyDraft(), now: 1 });
    expect(empty.ok).toBe(false);
    if (!empty.ok) expect(empty.errors[0]!.kind).toBe('empty');
  });

  it('keeps the id and ts when updating, and bumps rev', () => {
    const src: LogSession = {
      id: 's10', rev: 10, ts: 10, date: '2026-11-10',
      program: 'gym', programLabel: 'Gym program', session: 'lift-a', sessionLabel: 'Lift A',
      exercises: [{ id: deadlift.id, name: deadlift.title, unit: 'reps', sets: [{ kg: 50, reps: 4 }] }],
      note: '',
    };
    const draft = emptyDraft('2026-11-16');
    draft.sets[deadlift.id] = [{ kg: '65', reps: '4' }];

    const res = buildSession({ program: gym, session: liftA, exercises: liftA.exercises, draft, now: 2000, src });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.session.id).toBe('s10');
    expect(res.session.ts).toBe(10);
    expect(res.session.rev).toBe(2000);
    expect(res.session.exercises[0]!.sets[0]!.kg).toBe(65);
  });
});

describe('lastFor', () => {
  const mk = (id: string, date: string, ts: number, kg: number): LogSession => ({
    id, rev: ts, ts, date, program: 'gym', session: 'lift-a',
    exercises: [{ id: deadlift.id, name: deadlift.title, unit: 'reps', sets: [{ kg, reps: 4 }] }],
  });

  it('prefers the latest date, then the later ts', () => {
    const found = lastFor([mk('a', '2026-11-10', 1, 40), mk('b', '2026-11-12', 2, 50), mk('c', '2026-11-12', 3, 55)], deadlift.id);
    expect(found?.date).toBe('2026-11-12');
    expect(found?.sets[0]!.kg).toBe(55);
  });

  it('returns null when the exercise has no sets', () => {
    expect(lastFor([], deadlift.id)).toBeNull();
  });
});

describe('weekStatus', () => {
  const mk = (session: string, date: string, source?: 'progress'): LogSession => ({
    id: session + date, rev: 1, ts: 1, date, program: 'gym', session, source,
    exercises: [{ id: 'x', name: 'x', unit: 'reps', sets: [{ kg: 1, reps: 1 }] }],
  });

  it('counts distinct lifts in the current Mon-Sun week only', () => {
    const now = new Date(2026, 10, 18); // Wednesday
    const sessions = [
      mk('lift-a', '2026-11-16'),
      mk('lift-a', '2026-11-17'),
      mk('lift-b', '2026-11-18'),
      mk('lift-c', '2026-11-15'), // previous week
      mk('lift-c', '2026-11-19', 'progress'),
    ];
    const week = weekStatus(sessions, now);
    expect(week.start).toBe('2026-11-16');
    expect(week.count).toBe(2);
    expect([...week.done].sort()).toEqual(['lift-a', 'lift-b']);
  });
});

describe('normalizePrefs', () => {
  it('picks the weekday session on first run', () => {
    const monday = new Date(2026, 10, 16);
    expect(normalizePrefs({}, monday).session).toBe('lift-a');
    const wednesday = new Date(2026, 10, 18);
    expect(normalizePrefs({}, wednesday).session).toBe('lift-b');
    const tuesday = new Date(2026, 10, 17);
    expect(normalizePrefs({}, tuesday).session).toBe('lift-a');
  });

  it('falls back to the first program and session', () => {
    const prefs = normalizePrefs({ program: 'gone', session: 'gone' }, new Date(2026, 10, 18));
    expect(prefs.program).toBe('gym');
    expect(prefs.session).toBe('lift-a');
  });
});

describe('resizeRows', () => {
  it('grows and only trims empty trailing rows', () => {
    const draft = emptyDraft();
    draft.sets[deadlift.id] = [{ kg: '60', reps: '4' }, { kg: '', reps: '' }];
    resizeRows(draft, deadlift.id, 4);
    expect(draft.sets[deadlift.id]).toHaveLength(4);
    resizeRows(draft, deadlift.id, 1);
    expect(draft.sets[deadlift.id]).toHaveLength(1); // filled row kept
    expect(counts([deadlift], draft).sets).toBe(1);
  });
});

describe('buildSeries', () => {
  const mk = (id: string, date: string, name: string, sets: { kg: number | null; reps: number | null }[], unit: 'reps' | 'sec' = 'reps'): LogSession => ({
    id, rev: 1, ts: 1, date, program: 'gym', session: 'lift-a',
    exercises: [{ id, name, unit, sets }],
  });

  it('merges by name, keeps chronological points and the latest id', () => {
    const series = buildSeries([
      mk('old', '2026-11-01', 'Bench Press', [{ kg: 50, reps: 5 }]),
      mk('new', '2026-11-10', 'Bench Press', [{ kg: 55, reps: 5 }]),
    ]);
    expect(series).toHaveLength(1);
    expect(series[0]!.id).toBe('new');
    expect(series[0]!.pts.map((p) => p.v)).toEqual([50, 55]);
    expect(series[0]!.metric).toBe('Top weight');
  });

  it('falls back to reps when any session has no weight', () => {
    const series = buildSeries([
      mk('a', '2026-11-01', 'Pull-up', [{ kg: null, reps: 6 }]),
      mk('b', '2026-11-08', 'Pull-up', [{ kg: 10, reps: 5 }]),
    ]);
    expect(series[0]!.useKg).toBe(false);
    expect(series[0]!.pts.map((p) => p.v)).toEqual([6, 5]);
    expect(series[0]!.mu).toBe('reps');
  });

  it('uses seconds as the metric for holds', () => {
    const series = buildSeries([mk('plank', '2026-11-01', 'Plank', [{ kg: null, reps: 45 }], 'sec')]);
    expect(series[0]!.metric).toBe('Best hold');
    expect(series[0]!.mu).toBe('sec');
  });
});

describe('minutes unit', () => {
  const bike: import('./types').ExerciseDef = {
    id: 'cardio-bike', title: 'Bike', hint: '', sets: 1, target: '',
    unit: 'min', suggested: '', bw: false, custom: true,
  };

  it('saves a single duration set', () => {
    const draft = emptyDraft();
    draft.sets['cardio-bike'] = [{ kg: '', reps: '20' }];
    const res = buildSession({ program: gym, session: liftA, exercises: [bike], draft, now: 5 });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.session.exercises[0]!.unit).toBe('min');
    expect(res.session.exercises[0]!.sets).toEqual([{ kg: null, reps: 20 }]);
    expect(setText(res.session.exercises[0]!.sets[0]!, 'min')).toBe('20 min');
  });

  it('reports the longest duration in progress', () => {
    const mk = (id: string, date: string, mins: number): LogSession => ({
      id, rev: 1, ts: 1, date, program: 'gym', session: 'lift-a',
      exercises: [{ id: 'cardio-bike', name: 'Bike', unit: 'min', sets: [{ kg: null, reps: mins }] }],
    });
    const series = buildSeries([mk('a', '2026-11-01', 20), mk('b', '2026-11-08', 25)]);
    expect(series[0]!.metric).toBe('Longest');
    expect(series[0]!.mu).toBe('min');
    expect(series[0]!.pts.map((p) => p.v)).toEqual([20, 25]);
  });
});
