import { describe, expect, it } from 'vitest';
import { catalog } from './catalog';
import { createStore } from './store';
import { KEYS, type KeyValueStore } from './storage';

const gym = catalog.programs.find((p) => p.id === 'gym')!;
const liftA = gym.sessions.find((s) => s.id === 'lift-a')!;
const deadlift = liftA.exercises[0]!;

function memoryStore(): KeyValueStore {
  const data = new Map<string, string>();
  return {
    get: (k) => data.get(k) ?? null,
    set: (k, v) => void data.set(k, v),
    remove: (k) => void data.delete(k),
  };
}

function setup() {
  const kv = memoryStore();
  let t = 1000;
  const store = createStore({ store: kv, now: () => t });
  store.setProgram('gym');
  store.setSession('lift-a');
  return { kv, store, advance: (ms: number) => { t += ms; }, at: () => t };
}

function fillFirstSets(store: ReturnType<typeof setup>['store']) {
  store.setRow(deadlift.id, 0, 'kg', '60');
  store.setRow(deadlift.id, 0, 'reps', '4');
  store.setRow(deadlift.id, 2, 'kg', '57.5');
  store.setRow(deadlift.id, 2, 'reps', '4');
}

describe('store save', () => {
  it('creates a session, drops empty rows and clears the draft', () => {
    const { store, kv } = setup();
    expect(store.program().id).toBe('gym');
    expect(store.session().id).toBe('lift-a');

    fillFirstSets(store);
    expect(store.counts()).toEqual({ ex: 1, sets: 2 });

    const res = store.save();
    expect(res.ok).toBe(true);
    expect(store.sessions).toHaveLength(1);
    const saved = store.sessions[0]!;
    expect(saved.id).toBe('s1000');
    expect(saved.exercises).toHaveLength(1);
    expect(saved.exercises[0]!.sets).toHaveLength(2);
    expect(saved.exercises[0]!.sets[0]).toEqual({ kg: 60, reps: 4 });

    const drafts = JSON.parse(kv.get(KEYS.drafts) ?? '{}') as Record<string, unknown>;
    expect(drafts['gym/lift-a']).toBeUndefined();
    expect(store.counts()).toEqual({ ex: 0, sets: 0 });
  });

  it('refuses an empty session and invalid numbers', () => {
    const { store } = setup();
    const empty = store.save();
    expect(empty.ok).toBe(false);

    store.setRow(deadlift.id, 0, 'kg', 'heavy');
    const bad = store.save();
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.errors[0]!.kind).toBe('field');
  });
});

describe('store edit', () => {
  it('updates in place, keeping id and ts, and restores the previous draft', () => {
    const { store, advance } = setup();
    fillFirstSets(store);
    store.setRow(liftA.exercises[1]!.id, 0, 'reps', '4'); // keep a draft around? no, dies on save
    store.save();
    const id = store.sessions[0]!.id;
    const ts = store.sessions[0]!.ts;

    // A fresh draft exists for the next workout.
    store.setRow(deadlift.id, 0, 'kg', '62');

    advance(5000);
    expect(store.startEdit(id)).toBe(true);
    expect(store.editingId).toBe(id);
    expect(store.rows(deadlift.id)[0]!.kg).toBe('60');

    store.setRow(deadlift.id, 0, 'kg', '65');
    const res = store.save();
    expect(res.ok).toBe(true);

    expect(store.sessions).toHaveLength(1);
    expect(store.sessions[0]!.id).toBe(id);
    expect(store.sessions[0]!.ts).toBe(ts);
    expect(store.sessions[0]!.rev).toBe(6000);
    expect(store.sessions[0]!.exercises[0]!.sets[0]!.kg).toBe(65);
    expect(store.editingId).toBeNull();
    // The draft that existed before the edit came back.
    expect(store.rows(deadlift.id)[0]!.kg).toBe('62');
  });

  it('cancel restores selection and the pre-edit draft', () => {
    const { store } = setup();
    fillFirstSets(store);
    store.save();
    const id = store.sessions[0]!.id;

    store.setRow(deadlift.id, 0, 'kg', '70');
    store.startEdit(id);
    store.setRow(deadlift.id, 0, 'kg', '99');
    store.cancelEdit();

    expect(store.editingId).toBeNull();
    expect(store.program().id).toBe('gym');
    expect(store.session().id).toBe('lift-a');
    expect(store.rows(deadlift.id)[0]!.kg).toBe('70');
  });
});

describe('store delete', () => {
  it('removes and undoes at the same index', () => {
    const { store } = setup();
    fillFirstSets(store);
    store.save();
    const id = store.sessions[0]!.id;

    store.remove(id);
    expect(store.sessions).toHaveLength(0);
    expect(store.pendingDelete()?.session.id).toBe(id);

    store.undoRemove();
    expect(store.sessions).toHaveLength(1);
    expect(store.sessions[0]!.id).toBe(id);
    expect(store.pendingDelete()).toBeNull();
  });
});

describe('store drafts', () => {
  it('keeps drafts per program/session key', () => {
    const { store } = setup();
    store.setRow(deadlift.id, 0, 'kg', '60');

    store.setSession('lift-b');
    store.setRow('barbell-bench-press', 0, 'kg', '32.5');

    store.setSession('lift-a');
    expect(store.rows(deadlift.id)[0]!.kg).toBe('60');

    store.setSession('lift-b');
    expect(store.rows('barbell-bench-press')[0]!.kg).toBe('32.5');
  });

  it('discard clears only the current draft', () => {
    const { store } = setup();
    store.setRow(deadlift.id, 0, 'kg', '60');
    store.setSession('lift-b');
    store.setRow('barbell-bench-press', 0, 'kg', '30');

    store.setSession('lift-a');
    store.discard();
    expect(store.counts().sets).toBe(0);

    store.setSession('lift-b');
    expect(store.rows('barbell-bench-press')[0]!.kg).toBe('30');
  });
});
