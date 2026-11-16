export type Unit = 'reps' | 'sec' | 'min';

export interface ExerciseDef {
  id: string;
  title: string;
  hint: string;
  sets: number;
  target: string;
  unit: Unit;
  suggested: string;
  bw: boolean;
  custom?: boolean;
}

export interface SessionDef {
  id: string;
  label: string;
  note: string;
  exercises: ExerciseDef[];
}

export interface Program {
  id: string;
  label: string;
  sessions: SessionDef[];
}

export interface IndexedExercise extends ExerciseDef {
  programs: string[];
  restSeconds: number;
}

export interface Catalog {
  source: string;
  restFallbackSeconds: number;
  programs: Program[];
  exerciseIndex: Record<string, IndexedExercise>;
}

/** A saved set. null means "not entered"; at least one side is a number. */
export interface SetEntry {
  kg: number | null;
  reps: number | null;
}

export interface LoggedExercise {
  id: string;
  name: string;
  unit: Unit;
  sets: SetEntry[];
}

export interface LogSession {
  id: string;
  rev: number;
  ts: number;
  date: string;
  program: string;
  programLabel?: string;
  session: string;
  sessionLabel?: string;
  source?: 'progress';
  exercises: LoggedExercise[];
  note?: string;
}

/** Raw input strings, exactly as typed. */
export interface DraftSet {
  kg: string;
  reps: string;
  done?: boolean;
}

export interface Draft {
  sets: Record<string, DraftSet[]>;
  note: string;
  date: string;
}

export type Drafts = Record<string, Draft>;
export type Plan = Record<string, ExerciseDef[]>;

export interface Prefs {
  program?: string;
  session?: string;
  progressEx?: string;
  progressId?: string;
}

export interface StoredState {
  sessions: LogSession[];
  drafts: Drafts;
  plan: Plan;
  prefs: Prefs;
  collapsed: Record<string, true>;
}

export interface FieldError {
  kind: 'field' | 'empty';
  exId?: string;
  row?: number;
  field?: 'kg' | 'reps';
}

export type BuildResult =
  | { ok: true; session: LogSession }
  | { ok: false; errors: FieldError[] };
