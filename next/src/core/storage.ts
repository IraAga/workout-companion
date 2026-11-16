export const KEYS = {
  sessions: 'ol-sessions',
  drafts: 'ol-drafts',
  plan: 'ol-plan',
  prefs: 'ol-prefs',
  collapse: 'ol-collapse',
  tombstones: 'ol-tombstones',
  sync: 'ol-sync',
} as const;

export interface KeyValueStore {
  get(key: string): string | null;
  set(key: string, value: string): void;
  remove(key: string): void;
}

export const browserStore: KeyValueStore = {
  get(key) {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch {
      /* quota or private mode: keep working in memory */
    }
  },
  remove(key) {
    try {
      localStorage.removeItem(key);
    } catch {
      /* ignore */
    }
  },
};

export function readJSON<T>(store: KeyValueStore, key: string): T | null {
  const raw = store.get(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function writeJSON(store: KeyValueStore, key: string, value: unknown): void {
  try {
    store.set(key, JSON.stringify(value));
  } catch {
    /* ignore */
  }
}
