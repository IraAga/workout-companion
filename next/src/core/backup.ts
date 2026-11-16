import { KEYS, type KeyValueStore } from './storage';
import type { LogSession } from './types';

export const BACKUP_FORMAT = 'off-season-plan/backup';
export const BACKUP_SCHEMA = 1;

/** The four keys the shipped app's restore touches. Device-local sync state is excluded. */
export const BACKUP_KEYS = [KEYS.prefs, KEYS.plan, KEYS.drafts, KEYS.sessions] as const;

export interface Backup {
  format: string;
  schema: number;
  exportedAt: string;
  sessions?: number;
  keys: Record<string, string>;
}

export type ParsedBackup =
  | { ok: true; backup: Backup; sessions: LogSession[] }
  | { ok: false; error: string };

/**
 * Accepts the file downloaded by the shipped app's "Download backup".
 * Keys are raw JSON strings and are restored verbatim, matching R14.
 */
export function parseBackup(text: string): ParsedBackup {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { ok: false, error: 'That file is not valid JSON.' };
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return { ok: false, error: 'That file is not a backup from this app.' };
  }

  const obj = data as Record<string, unknown>;
  const keys = obj.keys;
  if (!keys || typeof keys !== 'object' || Array.isArray(keys)) {
    return { ok: false, error: 'That file has no backup keys.' };
  }

  const map = keys as Record<string, unknown>;
  if (!BACKUP_KEYS.some((k) => typeof map[k] === 'string')) {
    return { ok: false, error: 'That file is not a backup from this app.' };
  }

  for (const k of [KEYS.prefs, KEYS.plan, KEYS.drafts]) {
    const v = map[k];
    if (typeof v !== 'string') continue;
    try {
      JSON.parse(v);
    } catch {
      return { ok: false, error: 'The backup contains malformed ' + k + '.' };
    }
  }

  let sessions: LogSession[] = [];
  if (typeof map[KEYS.sessions] === 'string') {
    try {
      const parsed = JSON.parse(map[KEYS.sessions] as string);
      if (!Array.isArray(parsed)) throw new Error('not an array');
      sessions = parsed as LogSession[];
    } catch {
      return { ok: false, error: 'The backup session list is not valid JSON.' };
    }
  }

  return {
    ok: true,
    sessions,
    backup: {
      format: typeof obj.format === 'string' ? obj.format : BACKUP_FORMAT,
      schema: typeof obj.schema === 'number' ? obj.schema : BACKUP_SCHEMA,
      exportedAt: typeof obj.exportedAt === 'string' ? obj.exportedAt : '',
      sessions: typeof obj.sessions === 'number' ? obj.sessions : sessions.length,
      keys: map as Record<string, string>,
    },
  };
}

/** Writes exactly the four backup keys; leaves ol-sync and ol-tombstones alone. */
export function restoreBackup(kv: KeyValueStore, backup: Backup): void {
  for (const k of BACKUP_KEYS) {
    const value = backup.keys[k];
    if (typeof value === 'string') kv.set(k, value);
    else kv.remove(k);
  }
}

export function collectBackup(kv: KeyValueStore, sessionCount: number): Backup {
  const keys: Record<string, string> = {};
  for (const k of BACKUP_KEYS) {
    const value = kv.get(k);
    if (value != null) keys[k] = value;
  }
  return {
    format: BACKUP_FORMAT,
    schema: BACKUP_SCHEMA,
    exportedAt: new Date().toISOString(),
    sessions: sessionCount,
    keys,
  };
}

export function backupName(date: string): string {
  return 'workout-log-' + date + '.json';
}
