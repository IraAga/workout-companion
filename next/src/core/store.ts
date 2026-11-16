import { catalog, programById, sessionById } from './catalog';
import { collectBackup, restoreBackup, type Backup } from './backup';
import { isoDate } from './dates';
import {
  buildSession, counts, draftFor, draftFromSession, exercisesFor, lastFor,
  normalizePrefs, resizeRows, rowsFor, sessionKey, weekStatus,
} from './rules';
import { browserStore, KEYS, readJSON, writeJSON, type KeyValueStore } from './storage';
import type {
  BuildResult, Draft, Drafts, DraftSet, ExerciseDef, LogSession, Plan, Prefs,
  Program, SessionDef,
} from './types';

interface EditingSnapshot {
  src: LogSession;
  prevPrefs: Prefs;
  prevDraft?: Draft;
  hadDraft: boolean;
  key: string;
}

export interface Store {
  readonly sessions: LogSession[];
  readonly editingId: string | null;

  program(): Program;
  session(): SessionDef;
  key(): string;
  prefs(): Prefs;
  exercises(): ExerciseDef[];
  draft(): Draft;
  rows(exId: string): DraftSet[];
  counts(): { ex: number; sets: number };
  lastTime(exId: string): ReturnType<typeof lastFor>;
  week(): ReturnType<typeof weekStatus>;
  isCollapsed(exId: string): boolean;
  pendingDelete(): { session: LogSession; index: number } | null;

  subscribe(fn: () => void): () => void;

  setProgram(id: string): void;
  setSession(id: string): void;
  setDate(iso: string): void;
  setNote(value: string): void;
  setRow(exId: string, index: number, field: 'kg' | 'reps', value: string): void;
  toggleDone(exId: string, index: number): boolean;
  addSet(exId: string): void;
  removeSet(exId: string, index: number): void;
  copyLast(exId: string): void;
  toggleCollapse(exId: string): void;
  setProgress(key: string, id: string): void;
  addExercise(def: ExerciseDef): void;
  updateExercise(def: ExerciseDef): void;
  removeExercise(id: string): void;
  reorderExercises(ids: string[]): void;
  moveExercise(from: number, to: number): void;

  save(): BuildResult;
  startEdit(id: string): boolean;
  cancelEdit(): void;
  discard(): void;
  clearDraft(): void;
  remove(id: string): void;
  undoRemove(): void;

  exportBackup(): Backup;
  importBackup(backup: Backup): void;
}

export interface StoreOptions {
  store?: KeyValueStore;
  now?: () => number;
}

const clone = <T,>(v: T): T => structuredClone(v);

export function createStore(options: StoreOptions = {}): Store {
  const kv = options.store ?? browserStore;
  const now = options.now ?? Date.now;

  let sessions: LogSession[] = readJSON<LogSession[]>(kv, KEYS.sessions) ?? [];
  const drafts: Drafts = readJSON<Drafts>(kv, KEYS.drafts) ?? {};
  const plan: Plan = readJSON<Plan>(kv, KEYS.plan) ?? {};
  let prefs: Prefs = normalizePrefs(readJSON<Prefs>(kv, KEYS.prefs) ?? {}, new Date(now()));
  const collapsed: Record<string, true> = readJSON<Record<string, true>>(kv, KEYS.collapse) ?? {};

  let editing: EditingSnapshot | null = null;
  let editPlan: ExerciseDef[] | null = null;
  let editDraft: Draft | null = null;
  let pending: { session: LogSession; index: number } | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const listeners = new Set<() => void>();
  const emit = (): void => { for (const fn of listeners) fn(); };

  const persistSessions = (): void => writeJSON(kv, KEYS.sessions, sessions);
  const persistPrefs = (): void => writeJSON(kv, KEYS.prefs, prefs);
  const persistCollapse = (): void => writeJSON(kv, KEYS.collapse, collapsed);
  const persistDrafts = (): void => {
    if (!editing) writeJSON(kv, KEYS.drafts, drafts);
  };
  const persistDraftsSoon = (): void => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(persistDrafts, 300);
  };

  const program = (): Program => programById(prefs.program);
  const session = (): SessionDef => sessionById(program(), prefs.session);
  const key = (): string => sessionKey(program().id, session().id);

  function draft(): Draft {
    if (editing && editDraft) return editDraft;
    return draftFor(drafts, key(), isoDate(new Date(now())));
  }

  function exercises(): ExerciseDef[] {
    if (editing && editPlan) return editPlan;
    return exercisesFor(session(), plan, key());
  }

  function rows(exId: string): DraftSet[] {
    const ex = exercises().find((e) => e.id === exId);
    if (!ex) return [];
    return rowsFor(draft(), ex);
  }

  function currentCounts(): { ex: number; sets: number } {
    return counts(exercises(), draft());
  }

  function restoreEditing(): void {
    if (!editing) return;
    prefs = editing.prevPrefs;
    if (editing.hadDraft && editing.prevDraft) drafts[editing.key] = editing.prevDraft;
    else delete drafts[editing.key];
    persistPrefs();
    writeJSON(kv, KEYS.drafts, drafts);
    editing = null;
    editPlan = null;
    editDraft = null;
  }

  const store: Store = {
    get sessions() { return sessions; },
    get editingId() { return editing?.src.id ?? null; },

    program,
    session,
    key,
    prefs: () => prefs,
    exercises,
    draft,
    rows,
    counts: currentCounts,
    lastTime: (exId) => lastFor(sessions.filter((s) => s.id !== editing?.src.id), exId),
    week: () => weekStatus(sessions, new Date(now())),
    isCollapsed: (exId) => !!collapsed[exId],
    pendingDelete: () => pending,

    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },

    setProgram(id) {
      prefs = { ...prefs, program: id, session: '' };
      prefs = normalizePrefs(prefs, new Date(now()));
      persistPrefs();
      emit();
    },

    setSession(id) {
      prefs = { ...prefs, session: id };
      persistPrefs();
      emit();
    },

    setDate(iso) {
      draft().date = iso;
      persistDraftsSoon();
      emit();
    },

    setNote(value) {
      draft().note = value;
      persistDraftsSoon();
    },

    setRow(exId, index, field, value) {
      const row = rows(exId)[index];
      if (!row) return;
      row[field] = value.trim();
      persistDraftsSoon();
    },

    toggleDone(exId, index) {
      const row = rows(exId)[index];
      if (!row) return false;
      row.done = !row.done;
      persistDrafts();
      return !!row.done;
    },

    addSet(exId) {
      const list = rows(exId);
      if (list.length >= 12) return;
      list.push({ kg: '', reps: '', done: false });
      persistDrafts();
      emit();
    },

    removeSet(exId, index) {
      const list = rows(exId);
      if (index < 0 || index >= list.length) return;
      list.splice(index, 1);
      persistDrafts();
      emit();
    },

    copyLast(exId) {
      const last = lastFor(sessions, exId);
      if (!last) return;
      const list = rows(exId);
      const ex = exercises().find((e) => e.id === exId);
      const want = Math.max(1, ex?.sets ?? 1, last.sets.length, list.length);
      const copied: DraftSet[] = last.sets.map((s) => ({
        kg: s.kg != null ? String(s.kg) : '',
        reps: s.reps != null ? String(s.reps) : '',
        done: false,
      }));
      while (copied.length < want) copied.push({ kg: '', reps: '', done: false });
      draft().sets[exId] = copied;
      persistDrafts();
      emit();
    },

    toggleCollapse(exId) {
      if (collapsed[exId]) delete collapsed[exId];
      else collapsed[exId] = true;
      persistCollapse();
      emit();
    },

    setProgress(key, id) {
      prefs = { ...prefs, progressEx: key, progressId: id };
      persistPrefs();
      emit();
    },

    addExercise(def) {
      const clean = def.unit === 'min' ? { ...def, sets: 1, suggested: '', bw: false } : def;
      const current = exercises();
      if (current.some((e) => e.id === clean.id)) return;
      if (editing && editPlan) {
        editPlan = [...editPlan, clean];
      } else {
        plan[key()] = [...current, clean];
        writeJSON(kv, KEYS.plan, plan);
      }
      emit();
    },

    updateExercise(def) {
      const list = exercises().slice();
      const index = list.findIndex((e) => e.id === def.id);
      if (index < 0) return;
      const clean = def.unit === 'min' ? { ...def, sets: 1, suggested: '', bw: false } : def;
      list[index] = clean;

      if (editing && editPlan) {
        editPlan = list;
      } else {
        plan[key()] = list;
        writeJSON(kv, KEYS.plan, plan);
      }

      const d = draft();
      if (clean.unit === 'min') {
        const first = d.sets[clean.id]?.[0];
        d.sets[clean.id] = [{ kg: '', reps: first?.reps ?? '', done: false }];
      } else {
        resizeRows(d, clean.id, Math.max(1, clean.sets || 1));
      }
      persistDrafts();
      emit();
    },

    removeExercise(id) {
      const list = exercises().filter((e) => e.id !== id);
      if (editing && editPlan) {
        editPlan = list;
      } else {
        plan[key()] = list;
        writeJSON(kv, KEYS.plan, plan);
      }
      delete draft().sets[id];
      persistDrafts();
      emit();
    },

    reorderExercises(ids) {
      const current = exercises();
      const byId = new Map(current.map((e) => [e.id, e]));
      const next: ExerciseDef[] = [];
      for (const id of ids) {
        const ex = byId.get(id);
        if (ex) {
          next.push(ex);
          byId.delete(id);
        }
      }
      for (const ex of byId.values()) next.push(ex);
      if (editing && editPlan) {
        editPlan = next;
      } else {
        plan[key()] = next;
        writeJSON(kv, KEYS.plan, plan);
      }
      emit();
    },

    moveExercise(from, to) {
      const list = exercises().map((e) => e.id);
      if (from < 0 || from >= list.length || to < 0 || to >= list.length || from === to) return;
      const [id] = list.splice(from, 1);
      if (!id) return;
      list.splice(to, 0, id);
      store.reorderExercises(list);
    },

    save() {
      const src = editing?.src;
      const result = buildSession({
        program: program(),
        session: session(),
        exercises: exercises(),
        draft: draft(),
        now: now(),
        src,
      });
      if (!result.ok) return result;

      if (src) {
        sessions = sessions.map((s) => (s.id === src.id ? result.session : s));
        restoreEditing();
      } else {
        sessions = [result.session, ...sessions];
        delete drafts[key()];
        writeJSON(kv, KEYS.drafts, drafts);
      }
      persistSessions();
      persistPrefs();
      emit();
      return result;
    },

    startEdit(id) {
      const src = sessions.find((s) => s.id === id);
      if (!src) return false;
      if (editing) store.cancelEdit();

      const prevPrefs = { ...prefs };
      if (catalog.programs.some((p) => p.id === src.program)) prefs.program = src.program;
      const prog = programById(src.program);
      if (prog.sessions.some((s) => s.id === src.session)) prefs.session = src.session;
      prefs = normalizePrefs(prefs, new Date(now()));

      const k = key();
      const hadDraft = Object.prototype.hasOwnProperty.call(drafts, k);
      const prevDraft = hadDraft && drafts[k] ? clone(drafts[k]!) : undefined;
      const built = draftFromSession(src);

      editing = { src, prevPrefs, prevDraft, hadDraft, key: k };
      editPlan = built.exercises;
      editDraft = built.draft;
      persistPrefs();
      emit();
      return true;
    },

    cancelEdit() {
      restoreEditing();
      emit();
    },

    discard() {
      if (editing) {
        store.cancelEdit();
        return;
      }
      delete drafts[key()];
      writeJSON(kv, KEYS.drafts, drafts);
      emit();
    },

    clearDraft() {
      delete drafts[key()];
      writeJSON(kv, KEYS.drafts, drafts);
      emit();
    },

    remove(id) {
      const index = sessions.findIndex((s) => s.id === id);
      if (index < 0) return;
      const src = sessions[index]!;
      pending = { session: clone(src), index };
      sessions = sessions.filter((s) => s.id !== id);
      if (editing?.src.id === id) restoreEditing();
      persistSessions();
      emit();
    },

    undoRemove() {
      if (!pending) return;
      const at = Math.min(Math.max(pending.index, 0), sessions.length);
      sessions = [...sessions.slice(0, at), pending.session, ...sessions.slice(at)];
      pending = null;
      persistSessions();
      emit();
    },

    exportBackup() {
      persistSessions();
      persistPrefs();
      writeJSON(kv, KEYS.drafts, drafts);
      return collectBackup(kv, sessions.length);
    },

    importBackup(backup) {
      restoreBackup(kv, backup);
    },
  };

  return store;
}
