export interface Storage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}
export function draftKey(owner: string, kind: string) {
  if (!owner) throw new Error("Drafts require an authenticated owner");
  return `hafa-workouts:v1:${encodeURIComponent(owner)}:${encodeURIComponent(kind)}`;
}
export function drafts(storage: Storage) {
  const pending = new Map<string, Promise<void>>();
  function ordered(key: string, work: () => Promise<void>) {
    const next = (pending.get(key) ?? Promise.resolve()).catch(() => undefined).then(work);
    pending.set(key, next);
    void next
      .finally(() => {
        if (pending.get(key) === next) pending.delete(key);
      })
      .catch(() => undefined);
    return next;
  }
  return {
    async load<T>(owner: string, kind: string): Promise<T | null> {
      const key = draftKey(owner, kind);
      await pending.get(key)?.catch(() => undefined);
      const raw = await storage.getItem(key);
      if (!raw) return null;
      try {
        return JSON.parse(raw) as T;
      } catch {
        return null;
      }
    },
    save: (owner: string, kind: string, value: unknown) => {
      const key = draftKey(owner, kind);
      const snapshot = JSON.stringify(value);
      return ordered(key, () => storage.setItem(key, snapshot));
    },
    remove: (owner: string, kind: string) => {
      const key = draftKey(owner, kind);
      return ordered(key, () => storage.removeItem(key));
    },
  };
}
