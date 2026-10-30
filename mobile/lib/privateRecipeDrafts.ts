import { assertRecipeScope, recipeScope } from './recipeQueryScope';
import { offlineRecipes } from './offlineRecipes';
import { IMPORT_INBOX_STORAGE_KEY } from './importInboxStorage';
import AsyncStorage from '@react-native-async-storage/async-storage';
export type RecipeDraftKind = 'manual' | 'paste' | 'scan' | 'recovery';
export type DraftLease = { owner: string; epoch: number; scope: string };
const PREFIX = 'hafa_private_recipe_draft_v1:';

/** Serialize writes/deletes; invalidated leases cannot resurrect signed-out data. */
export function createPrivateRecipeDrafts(storage: typeof AsyncStorage) {
  let epoch = 0;
  const listeners = new Set<() => void>();
  const emit = () => listeners.forEach(listener => listener());
  const pendingWrites = new Set<{ value: unknown }>();
  let tail: Promise<unknown> = Promise.resolve();
  const run = <T,>(job: () => Promise<T>) => { const next = tail.then(job); tail = next.catch(() => undefined); return next; };
  const key = (lease: DraftLease, kind: RecipeDraftKind) => `${PREFIX}${encodeURIComponent(lease.owner)}:${kind}`;
  const valid = (lease: DraftLease) => { assertRecipeScope(lease.scope); const owner = JSON.parse(lease.scope)[1]; if (owner && owner !== lease.owner) throw new Error('Account changed. Reopen this draft.'); if (lease.epoch !== epoch) throw new Error('Account changed. Reopen this draft.'); };
  offlineRecipes.onRetire(emit);
  return {
    assert: valid,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    preserveImage: (lease: DraftLease, uri: string, guard: () => void) => run(async () => {
      const check = () => { valid(lease); guard(); };
      check();
      const { File, Directory, Paths } = await import('expo-file-system'); check();
      const { randomUUID } = await import('expo-crypto'); check();
      const root = new Directory(Paths.document, 'private-recipe-drafts', encodeURIComponent(lease.owner));
      if (uri.startsWith(root.uri)) return uri;
      if (await storage.getItem(key(lease, 'recovery'))) {
        throw new Error('Finish or discard your previous scan before starting another scan.');
      }
      check();
      root.create({ idempotent: true, intermediates: true });
      const file = new File(root, `${randomUUID()}.${uri.split('.').pop()?.match(/^[a-zA-Z0-9]{1,5}$/)?.[0] || 'jpg'}`);
      try { new File(uri).copy(file); check(); return file.uri; }
      catch (error) { if (file.exists) file.delete(); throw error; }
    }),
    lease: (owner: string): DraftLease => ({ owner, epoch, scope: recipeScope() }),
    read: (lease: DraftLease, kind: RecipeDraftKind) => run(async () => {
      valid(lease); const raw = await storage.getItem(key(lease, kind)); valid(lease);
      return raw ? JSON.parse(raw) : null;
    }),
    write: (lease: DraftLease, kind: RecipeDraftKind, value: unknown) => {
      // Register before enqueueing: cleanup may already be awaiting storage.
      const pending = { value }; pendingWrites.add(pending);
      return run(async () => {
        valid(lease);
        if (kind === 'scan' || kind === 'recovery') {
          const recovery = await storage.getItem(key(lease, 'recovery')); valid(lease);
          if (recovery && (kind === 'scan' || JSON.parse(recovery).captureId !== (value as any)?.captureId)) {
            throw new Error('Finish or discard your previous scan before starting another scan.');
          }
        }
        const raw = JSON.stringify(value);
        if (raw.length > 500_000) throw new Error('This draft is too large to save on this device.');
        const target = key(lease, kind), previous = await storage.getItem(target); valid(lease);
        await storage.setItem(target, raw);
        try { valid(lease); } catch (error) {
          // An already dispatched native write cannot be cancelled; retire its result.
          if (await storage.getItem(target) === raw) {
            if (previous === null) await storage.removeItem(target); else await storage.setItem(target, previous);
          }
          throw error;
        }
        emit();
      }).finally(() => pendingWrites.delete(pending));
    },
    remove: (lease: DraftLease, kind: RecipeDraftKind, expected?: unknown) => run(async () => {
      valid(lease); const raw = await storage.getItem(key(lease, kind));
      valid(lease);
      if (expected !== undefined && raw !== JSON.stringify(expected)) return;
      // A recovery and its scan receipt refer to the same capture. Retire both
      // only when their ordered pages match; a late completion cannot delete B.
      if (kind === 'recovery' && raw) {
        const recovery = JSON.parse(raw);
        const pages = recovery.request?.original_pages ?? recovery.originalPages;
        const scan = await storage.getItem(key(lease, 'scan')); valid(lease);
        if (pages?.length && scan && JSON.stringify(JSON.parse(scan).selectedImages) === JSON.stringify(pages)) {
          await storage.removeItem(key(lease, 'scan')); valid(lease);
        }
      }
      await storage.removeItem(key(lease, kind));
      valid(lease); emit();
      if (raw && raw.includes('private-recipe-drafts/')) {
        // Scan, editor, recovery and pending captures can share the same pages.
        // Retire this receipt first, then delete only files no remaining receipt uses.
        const keys = (await storage.getAllKeys()).filter(value => value.startsWith(PREFIX) || value === IMPORT_INBOX_STORAGE_KEY);
        const references = await Promise.all(keys.map(value => storage.getItem(value)));
        valid(lease);
        const { File, Directory, Paths } = await import('expo-file-system');
        const root = new Directory(Paths.document, 'private-recipe-drafts', encodeURIComponent(lease.owner));
        const clean = (value: any) => {
          if (!value || typeof value !== 'object') return;
          for (const [field, child] of Object.entries(value)) {
            if ((field === 'uri' || field === 'imageUri') && typeof child === 'string' && child.startsWith(root.uri) && !references.some(reference => reference?.includes(child)) &&
              ![...pendingWrites].some(pending => JSON.stringify(pending.value)?.includes(child))) {
              const file = new File(child); if (file.exists) file.delete();
            } else if (typeof child === 'object') clean(child);
          }
        };
        clean(JSON.parse(raw));
      }
    }),
    clearAll() {
      epoch++; emit();
      return run(async () => {
        const keys = (await storage.getAllKeys()).filter(key => key.startsWith(PREFIX));
        if (keys.length) await storage.multiRemove(keys);
        const { Directory, Paths } = await import('expo-file-system');
        const directory = new Directory(Paths.document, 'private-recipe-drafts');
        if (directory.exists) directory.delete();
      });
    },
  };
}
export const privateRecipeDrafts = createPrivateRecipeDrafts(AsyncStorage);

/** Copy picked images out of OS cache before promising a durable draft. */
export function preserveDraftImage(lease: DraftLease, uri: string, guard: () => void): Promise<string> {
  return privateRecipeDrafts.preserveImage(lease, uri, guard);
}
