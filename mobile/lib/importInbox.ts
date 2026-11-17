import { IMPORT_INBOX_STORAGE_KEY } from './importInboxStorage';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { ExtractRequest } from '@/types/recipe';
import type { SharedRecipeImage } from './shareCapture';

export type ImportCapture =
  | { kind: 'url'; url: string; notes?: string }
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
  submissionClaimed?: boolean;
  /** One approval for this owner and unchanged request; consumed at submission. */
  publicConfirmed?: boolean;
  preferences?: { isPublic: boolean; location: string };
};

type Storage = Pick<typeof AsyncStorage, 'getItem' | 'setItem'>;
const STORAGE_KEY = IMPORT_INBOX_STORAGE_KEY;
const CLEANUP_KEY = 'hafa_import_attachment_cleanup_v1';
type AttachmentCleanup = (released: string[], protectedPaths: string[]) => Promise<string[]>;
const attachmentPaths = (entries: ImportInboxEntry[]) => entries.flatMap((entry) =>
  entry.capture.kind === 'images' ? entry.capture.images.map((image) => image.uri) : []);

/** Keep recovery byte-for-byte consistent with the request used by intake. */
export const importInboxRequest = (entry: ImportInboxEntry): ExtractRequest => entry.request ?? {
  url: entry.capture.kind === 'url' ? entry.capture.url : '',
  location: 'Guam', notes: '', is_public: false,
};

/** Persist intake before acknowledging native data. Serialize read-modify-write operations. */
export function createImportInbox(storage: Storage, cleanup?: AttachmentCleanup) {
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
  let pendingCleanup: string[] | null = null;
  const readCleanup = async () => {
    if (pendingCleanup) return pendingCleanup;
    const raw = await storage.getItem(CLEANUP_KEY);
    const paths: unknown = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(paths) || paths.some((path) => typeof path !== 'string')) {
      throw new Error('Could not read pending attachment cleanup. Please reopen Håfa.');
    }
    return pendingCleanup = paths as string[];
  };
  const flushCleanup = async () => {
    if (!cleanup) return;
    try {
      const paths = await readCleanup();
      const remaining = await cleanup(paths, attachmentPaths(entries));
      await storage.setItem(CLEANUP_KEY, JSON.stringify(remaining));
      pendingCleanup = remaining;
    } catch {
      // Acceptance/removal already persisted. Retry the deletion journal on
      // foreground or the next transaction without resubmitting the import.
    }
  };
  const update = (operation: (current: ImportInboxEntry[]) => ImportInboxEntry[], incomingReleased: string[] = []) =>
    transaction(async () => {
      await load();
      const next = operation(entries);
      const kept = new Set(attachmentPaths(next));
      const released = [...attachmentPaths(entries), ...incomingReleased].filter((path) => !kept.has(path));
      if (released.length) {
        const paths = [...new Set([...await readCleanup(), ...released])];
        // Journal before scrubbing/removing the source. A crash between these
        // writes retains the old inbox references, which native cleanup protects.
        await storage.setItem(CLEANUP_KEY, JSON.stringify(paths));
        pendingCleanup = paths;
      }
      // Do not expose or acknowledge an entry until the write actually succeeds.
      await storage.setItem(STORAGE_KEY, JSON.stringify(next));
      entries = next;
      emit();
      await flushCleanup();
    });
  return {
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    snapshot: () => entries,
    hydrate: () => transaction(async () => { await load(); await flushCleanup(); }),
    cleanupAttachments: (cleaner?: AttachmentCleanup) => transaction(async () => {
      if (cleaner) cleanup = cleaner;
      await load();
      await flushCleanup();
    }),
    protectedAttachmentPaths: () => transaction(async () => { await load(); return attachmentPaths(entries); }),
    add: (entry: ImportInboxEntry) => update((current) => (
      current.some((existing) => existing.id === entry.id) ? current : [...current,
        entry.state === 'accepted' ? { ...entry, capture: { kind: 'url' as const, url: '' }, request: undefined } : entry]
    ), entry.state === 'accepted' ? attachmentPaths([entry]) : []),
    patch: (id: string, patch: Partial<ImportInboxEntry>) => update((current) => (
      current.map((entry) => entry.id === id ? { ...entry, ...patch, id: entry.id,
        ...(('ownerId' in patch || 'request' in patch || 'capture' in patch || patch.state === 'accepted')
          ? { publicConfirmed: undefined } : {}),
        ...(patch.state === 'accepted' ? { capture: { kind: 'url' as const, url: '' }, request: undefined } : {}) } : entry)
    )),
    remove: (id: string) => update((current) => current.filter((entry) => entry.id !== id)),
    removeWaiting: (id: string, ownerId: string | null) => update((current) => current.filter((entry) =>
      entry.id !== id || entry.ownerId !== ownerId || Boolean(entry.accountScopeId && !ownerId) ||
      entry.state === 'submitting' || entry.state === 'accepted' || Boolean(entry.submissionClaimed || entry.jobId))),
    /** Only a definitive start rejection can release an unconfirmed submission. */
    rejectSubmission: (id: string, ownerId: string, error: string) => update((current) => current.map((entry) =>
      entry.id === id && entry.ownerId === ownerId && entry.state !== 'accepted' &&
      (entry.submissionClaimed || entry.state === 'submitting') && !entry.jobId && !entry.recipeId
        ? { ...entry, state: 'error' as const, submissionClaimed: false, error }
        : entry)),
    /** Claim after all preparatory awaits, atomically with local removal. */
    claimForSubmit: (id: string, ownerId: string, expected: ImportInboxEntry) => transaction(async () => {
      await load();
      const entry = entries.find((item) => item.id === id);
      if (!entry || entry !== expected || entry.ownerId !== ownerId || entry.state !== 'ready' ||
          entry.submissionClaimed || entry.jobId || entry.capture.kind !== 'url' ||
          (entry.request?.is_public && !entry.publicConfirmed)) return null;
      const claimed = { ...entry, request: importInboxRequest(entry),
        state: 'submitting' as const, submissionClaimed: true, publicConfirmed: undefined, error: undefined };
      const next = entries.map((item) => item === entry ? claimed : item);
      await storage.setItem(STORAGE_KEY, JSON.stringify(next));
      entries = next;
      emit();
      return claimed;
    }),
    /** Signed-out captures require an explicit choice before associating an account. */
    claim: (id: string, ownerId: string, request?: ExtractRequest,
      approval?: { publicConfirmed: boolean; expected: ImportInboxEntry }) => update((current) => (
      current.map((entry) => entry.id === id && (!approval || entry === approval.expected) && !entry.submissionClaimed && entry.state !== 'submitting' && entry.state !== 'accepted' &&
        (entry.ownerId === null && !entry.accountScopeId || entry.ownerId === ownerId)
        ? { ...entry, ownerId, request: request ?? entry.request,
          publicConfirmed: Boolean(approval?.publicConfirmed && (request ?? entry.request)?.is_public),
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
