import AsyncStorage from '@react-native-async-storage/async-storage';
import type { ExtractRequest } from '@/types/recipe';
import type { SharedRecipeImage } from './shareCapture';

export type ImportCapture =
  | { kind: 'url'; url: string }
  | { kind: 'text'; text: string }
  | { kind: 'images'; images: SharedRecipeImage[] };

export type ImportInboxEntry = {
  id: string;
  ownerId: string | null;
  accountScopeId?: string;
  capture: ImportCapture;
  createdAt: number;
  state: 'waiting' | 'ready' | 'submitting' | 'accepted' | 'error';
  request?: ExtractRequest;
  jobId?: string;
  recipeId?: string;
  error?: string;
  preferences?: { isPublic: boolean; location: string };
};

type Storage = Pick<typeof AsyncStorage, 'getItem' | 'setItem'>;
const STORAGE_KEY = 'hafa_import_inbox_v1';

/** Persist intake before acknowledging native data. Serialize read-modify-write operations. */
export function createImportInbox(storage: Storage) {
  let entries: ImportInboxEntry[] = [];
  let loaded = false;
  let operations: Promise<unknown> = Promise.resolve();
  const listeners = new Set<() => void>();
  const emit = () => listeners.forEach((listener) => listener());
  const load = async () => {
    if (loaded) return;
    const raw = await storage.getItem(STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed) || parsed.some((entry) => !entry ||
        typeof entry.id !== 'string' || !entry.capture ||
        !['url', 'text', 'images'].includes(entry.capture.kind))) {
      throw new Error('Your pending imports could not be read. Please try opening the app again.');
    }
    entries = parsed as ImportInboxEntry[];
    loaded = true;
    emit();
  };
  const transaction = <T,>(operation: () => Promise<T>): Promise<T> => {
    const result = operations.then(operation);
    operations = result.catch(() => undefined);
    return result;
  };
  const update = (operation: (current: ImportInboxEntry[]) => ImportInboxEntry[]) =>
    transaction(async () => {
      await load();
      const next = operation(entries);
      // Do not expose or acknowledge an entry until the write actually succeeds.
      await storage.setItem(STORAGE_KEY, JSON.stringify(next));
      entries = next;
      emit();
    });
  return {
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    snapshot: () => entries,
    hydrate: () => transaction(load),
    add: (entry: ImportInboxEntry) => update((current) => (
      current.some((existing) => existing.id === entry.id) ? current : [...current,
        entry.state === 'accepted' ? { ...entry, capture: { kind: 'url' as const, url: '' }, request: undefined } : entry]
    )),
    patch: (id: string, patch: Partial<ImportInboxEntry>) => update((current) => (
      current.map((entry) => entry.id === id ? { ...entry, ...patch, id: entry.id,
        ...(patch.state === 'accepted' ? { capture: { kind: 'url' as const, url: '' }, request: undefined } : {}) } : entry)
    )),
    remove: (id: string) => update((current) => current.filter((entry) => entry.id !== id)),
    /** Signed-out captures require an explicit choice before associating an account. */
    claim: (id: string, ownerId: string, request?: ExtractRequest) => update((current) => (
      current.map((entry) => entry.id === id && (entry.ownerId === null && !entry.accountScopeId || entry.ownerId === ownerId)
        ? { ...entry, ownerId, request: request ?? entry.request,
          state: entry.capture.kind === 'url' ? 'ready' : 'waiting', error: undefined }
        : entry)
    )),
  };
}

export const importInbox = createImportInbox(AsyncStorage);

export function visibleImportEntries(entries: ImportInboxEntry[], ownerId: string | null) {
  return entries.filter((entry) => entry.state !== 'accepted' &&
    (entry.ownerId === ownerId && ownerId !== null || entry.ownerId === null && !entry.accountScopeId));
}

/** Native capabilities use opaque scopes; bind them to the verified durable owner. */
export async function saveShareScopeOwner(scope: string, ownerId: string) {
  await AsyncStorage.setItem(`hafa_share_scope_owner:${encodeURIComponent(scope)}`, ownerId);
}

export async function getShareScopeOwner(scope: string) {
  return AsyncStorage.getItem(`hafa_share_scope_owner:${encodeURIComponent(scope)}`);
}
