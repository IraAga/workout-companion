import { describe, expect, it } from 'vitest';
import { collectBackup, parseBackup, restoreBackup } from './backup';
import { KEYS, type KeyValueStore } from './storage';

function memory(seed: Record<string, string> = {}): KeyValueStore {
  const data = new Map(Object.entries(seed));
  return {
    get: (k) => data.get(k) ?? null,
    set: (k, v) => void data.set(k, v),
    remove: (k) => void data.delete(k),
  };
}

const sessions = JSON.stringify([
  { id: 's1', rev: 1, ts: 1, date: '2026-11-16', program: 'gym', session: 'lift-a', exercises: [] },
]);

function payload(keys: Record<string, string>): string {
  return JSON.stringify({ format: 'off-season-plan/backup', schema: 1, exportedAt: '2026-11-16T00:00:00.000Z', sessions: 1, keys });
}

describe('parseBackup', () => {
  it('accepts the shipped backup shape and counts sessions', () => {
    const parsed = parseBackup(payload({ 'ol-sessions': sessions, 'ol-prefs': '{}' }));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.sessions).toHaveLength(1);
    expect(parsed.backup.keys['ol-sessions']).toBe(sessions);
  });

  it('rejects invalid JSON, missing keys and malformed sessions', () => {
    expect(parseBackup('{').ok).toBe(false);
    expect(parseBackup(JSON.stringify({ hello: 1 })).ok).toBe(false);
    expect(parseBackup(JSON.stringify({ keys: { 'ol-sessions': 'not json' } })).ok).toBe(false);
    expect(parseBackup(JSON.stringify({ keys: { 'ol-sessions': '{}' } })).ok).toBe(false);
  });
});

describe('restoreBackup', () => {
  it('writes the four keys, removes absent ones and keeps sync state', () => {
    const kv = memory({ 'ol-sync': '{"token":"secret"}', 'ol-tombstones': '{"old":1}', 'ol-sessions': '[]' });
    const parsed = parseBackup(payload({ 'ol-sessions': sessions, 'ol-prefs': '{"program":"gym"}' }));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    restoreBackup(kv, parsed.backup);

    expect(kv.get('ol-sessions')).toBe(sessions);
    expect(kv.get('ol-prefs')).toBe('{"program":"gym"}');
    expect(kv.get('ol-plan')).toBeNull();
    expect(kv.get('ol-drafts')).toBeNull();
    expect(kv.get('ol-sync')).toBe('{"token":"secret"}');
    expect(kv.get('ol-tombstones')).toBe('{"old":1}');
  });
});

describe('collectBackup', () => {
  it('round-trips raw values', () => {
    const kv = memory({ 'ol-sessions': sessions, 'ol-plan': '{"gym/lift-a":[]}' });
    const backup = collectBackup(kv, 1);
    expect(backup.sessions).toBe(1);
    expect(backup.keys['ol-sessions']).toBe(sessions);
    expect(backup.keys['ol-plan']).toBe('{"gym/lift-a":[]}');
    expect(backup.keys[KEYS.prefs]).toBeUndefined();

    const parsed = parseBackup(JSON.stringify(backup));
    expect(parsed.ok).toBe(true);
  });
});
