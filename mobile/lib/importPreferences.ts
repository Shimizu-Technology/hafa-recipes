import AsyncStorage from '@react-native-async-storage/async-storage';

export type ImportPreferences = { isPublic: boolean; location: string };
export type ImportPreferenceState = ImportPreferences & { ready: boolean; error: string | null };
const INITIAL: ImportPreferenceState = { isPublic: true, location: 'Guam', ready: false, error: null };
const GUEST: ImportPreferenceState = { ...INITIAL, ready: true };

/** Preferences are scoped to the stable application owner, never a Clerk subject. */
export function createImportPreferences(storage: Pick<typeof AsyncStorage, 'getItem' | 'setItem'>) {
  const states = new Map<string, ImportPreferenceState>();
  const listeners = new Set<() => void>();
  let operations: Promise<unknown> = Promise.resolve();
  const key = (owner: string) => `hafa_import_preferences_v1:${encodeURIComponent(owner)}`;
  const snapshot = (owner: string | null) => owner ? states.get(owner) ?? INITIAL : GUEST;
  const emit = () => listeners.forEach((listener) => listener());
  const transaction = <T,>(operation: () => Promise<T>) => {
    const next = operations.then(operation);
    operations = next.catch(() => undefined);
    return next;
  };
  const load = async (owner: string) => {
    if (snapshot(owner).ready) return;
    const raw = await storage.getItem(key(owner));
    const value = raw ? JSON.parse(raw) as Partial<ImportPreferences> : INITIAL;
    if (typeof value.isPublic !== 'boolean' || typeof value.location !== 'string' ||
        !value.location.trim() || value.location.length > 100) throw new Error('Could not read import settings.');
    states.set(owner, { isPublic: value.isPublic, location: value.location, ready: true, error: null });
    emit();
  };
  return {
    snapshot,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    hydrate: (owner: string) => transaction(async () => {
      try { await load(owner); } catch {
        states.set(owner, { ...INITIAL, error: 'Could not load import settings. Reopen Håfa to try again.' });
        emit();
      }
    }),
    update: (owner: string, patch: Partial<ImportPreferences>) => transaction(async () => {
      await load(owner);
      const current = snapshot(owner);
      const next = { isPublic: patch.isPublic ?? current.isPublic, location: patch.location ?? current.location };
      if (!next.location.trim() || next.location.length > 100) throw new Error('Choose a valid cost estimate location.');
      await storage.setItem(key(owner), JSON.stringify(next));
      states.set(owner, { ...next, ready: true, error: null });
      emit();
    }),
  };
}

export const importPreferences = createImportPreferences(AsyncStorage);
