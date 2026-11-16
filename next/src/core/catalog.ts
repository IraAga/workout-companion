import raw from '../../../contract/data/catalog.json';
import type { Catalog, ExerciseDef, Program, SessionDef } from './types';

/** Generated from docs/index.html. Never hand-edit. */
export const catalog = raw as unknown as Catalog;

export function programById(id: string | undefined): Program {
  return catalog.programs.find((p) => p.id === id) ?? catalog.programs[0]!;
}

export function sessionById(program: Program, id: string | undefined): SessionDef {
  return program.sessions.find((s) => s.id === id) ?? program.sessions[0]!;
}

export function restSeconds(exId: string): number {
  return catalog.exerciseIndex[exId]?.restSeconds ?? catalog.restFallbackSeconds;
}

export function exerciseById(id: string): ExerciseDef | undefined {
  return catalog.exerciseIndex[id];
}
