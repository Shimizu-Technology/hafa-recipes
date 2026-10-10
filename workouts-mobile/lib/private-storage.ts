import type { Storage } from "./drafts";
type FullStorage = Storage & { getAllKeys(): Promise<readonly string[]> };
type PrivateStorage = FullStorage & { isCurrent(): boolean };
export function ownedStorageKey(key: string, owner: string) {
  const encoded = encodeURIComponent(owner);
  return (
    key.startsWith(`hafa-workouts:v1:${encoded}:`) ||
    key.startsWith(`hafa-workouts:training:v1:${encoded}:`) ||
    key.startsWith(`hafa-workouts:health:v1:${encoded}:`) ||
    key.startsWith(`hafa-workouts:reminders:v1:${encodeURIComponent(`${owner}:workouts:`)}`)
  );
}
export function createPrivateStorageRegistry(raw: FullStorage) {
  const epochs = new Map<string, number>();
  const pending = new Map<string, Promise<unknown>>();
  const epoch = (owner: string) => epochs.get(owner) ?? 0;
  function ordered<T>(owner: string, work: () => Promise<T>) {
    const next = (pending.get(owner) ?? Promise.resolve()).catch(() => undefined).then(work);
    pending.set(owner, next);
    return next;
  }
  return {
    retire(owner: string) {
      epochs.set(owner, epoch(owner) + 1);
    },
    capture(owner: string): PrivateStorage {
      const captured = epoch(owner);
      const guard = (key?: string) => {
        if (epoch(owner) !== captured) throw Error("This device draft was retired when account data was removed.");
        if (key && !ownedStorageKey(key, owner)) throw Error("This storage key belongs to another account.");
      };
      return {
        isCurrent: () => epoch(owner) === captured,
        getItem: (key) =>
          ordered(owner, async () => {
            guard(key);
            const value = await raw.getItem(key);
            guard(key);
            return value;
          }),
        setItem: (key, value) =>
          ordered(owner, async () => {
            guard(key);
            await raw.setItem(key, value);
          }),
        removeItem: (key) =>
          ordered(owner, async () => {
            guard(key);
            await raw.removeItem(key);
          }),
        getAllKeys: () =>
          ordered(owner, async () => {
            guard();
            const keys = await raw.getAllKeys();
            guard();
            return keys.filter((key) => ownedStorageKey(key, owner));
          }),
      };
    },
    erase(owner: string, beforeRemove?: (value: string) => Promise<void>) {
      epochs.set(owner, epoch(owner) + 1);
      return ordered(owner, async () => {
        for (const key of await raw.getAllKeys())
          if (ownedStorageKey(key, owner)) {
            const value = await raw.getItem(key);
            if (value && beforeRemove) await beforeRemove(value);
            await raw.removeItem(key);
          }
      });
    },
  };
}
