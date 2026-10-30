import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Recipe } from '@/types/recipe';

type Authority = { subject: string; owner: string; generation: string };
export type OfflineRecipe = { recipe: Recipe; savedAt: number; pinned: boolean };
type Lease = Authority & { epoch: number };
const PREFIX = 'hafa_offline_recipes_v1:';
const META = `${PREFIX}authority`;

/** Serialized account generations prevent late reads/writes resurrecting erased data. */
export function createOfflineRecipes(storage: typeof AsyncStorage) {
  let authority: Authority | null = null;
  let subject: string | null = null;
  let epoch = 0;
  let tail: Promise<unknown> = Promise.resolve();
  const observed = new Map<string, { recipe: Recipe; fetchedAt: number }>();
  const eligible = new Set<string>();
  const revisions = new Map<string, number>();
  const revision = (id: string) => revisions.get(id) ?? 0;
  const run = <T,>(job: () => Promise<T>) => { const result = tail.then(job); tail = result.catch(() => undefined); return result; };
  const valid = (lease: Lease) => lease.epoch === epoch && authority?.owner === lease.owner && authority?.generation === lease.generation && subject === lease.subject;
  const key = (lease: Lease) => `${PREFIX}${encodeURIComponent(lease.owner)}:${lease.generation}`;
  const recordKey = (lease: Lease, id: string) => `${key(lease)}:recipe:${encodeURIComponent(id)}`;
  const readIndex = async (lease: Lease): Promise<string[]> => {
    if (!valid(lease)) return [];
    const raw = await storage.getItem(key(lease));
    return valid(lease) && raw ? JSON.parse(raw) : [];
  };
  const readAll = async (lease: Lease): Promise<OfflineRecipe[]> => {
    const ids = await readIndex(lease);
    const values = await Promise.all(ids.map(id => storage.getItem(recordKey(lease, id))));
    return valid(lease) ? values.flatMap(raw => raw ? [JSON.parse(raw) as OfflineRecipe] : []) : [];
  };
  const writeAll = async (lease: Lease, rows: OfflineRecipe[], changedId: string) => {
    if (!valid(lease)) return;
    const prior = await readIndex(lease);
    await Promise.all(rows.filter(row => row.recipe.id === changedId).map(row => storage.setItem(recordKey(lease, row.recipe.id), JSON.stringify(row))));
    if (!valid(lease)) return;
    const ids = rows.map(row => row.recipe.id);
    // Retire IDs before erasing bytes: failed cleanup cannot resurrect a revoked copy.
    await storage.setItem(key(lease), JSON.stringify(ids));
    const removed = prior.filter(id => !ids.includes(id)).map(id => recordKey(lease, id));
    if (removed.length) await storage.multiRemove(removed);
  };
  const forget = async (lease: Lease, id: string) => {
    if (!valid(lease)) return;
    observed.delete(id); eligible.delete(id);
    const ids = await readIndex(lease);
    if (!valid(lease)) return;
    await storage.setItem(key(lease), JSON.stringify(ids.filter(value => value !== id)));
    await storage.multiRemove([recordKey(lease, id)]);
  };
  const erase = async () => {
    const keys = (await storage.getAllKeys()).filter(k => k.startsWith(PREFIX));
    if (keys.length) await storage.multiRemove(keys);
  };
  const save = async (lease: Lease, recipe: Recipe, pinned?: boolean, fetchedAt = Date.now()) => {
    if (!valid(lease)) return;
    const rows = await readAll(lease);
    const previous = rows.find(row => row.recipe.id === recipe.id);
    const next = { recipe: { ...recipe, raw_text: undefined }, savedAt: fetchedAt, pinned: pinned ?? previous?.pinned ?? false };
    if (JSON.stringify(next).length > 500_000) throw new Error('This recipe is too large to keep offline.');
    const remaining = rows.filter(row => row.recipe.id !== recipe.id);
    const all = [next, ...remaining];
    const kept = [...all.filter(row => row.pinned), ...all.filter(row => !row.pinned).slice(0, 30)];
    await writeAll(lease, kept, recipe.id);
  };
  return {
    revision,
    lease: (currentSubject?: string | null): Lease | null => authority && subject && currentSubject === subject ? { ...authority, epoch } : null,
    bindSubject(next: string | null) {
      epoch++; subject = next; authority = null; observed.clear(); eligible.clear(); revisions.clear();
      const currentEpoch = epoch;
      return run(async () => {
        const raw = await storage.getItem(META);
        const prior: Authority | null = raw ? JSON.parse(raw) : null;
        if (!next || prior?.subject !== next) await erase();
        if (epoch === currentEpoch && next && prior?.subject === next) authority = prior;
      });
    },
    verify(currentSubject: string, owner: string) {
      const currentEpoch = epoch;
      return run(async () => {
        if (subject !== currentSubject || epoch !== currentEpoch) return;
        if (authority?.owner !== owner) {
          await erase();
          if (epoch !== currentEpoch) return;
          authority = { subject: currentSubject, owner, generation: `${Date.now()}-${Math.random().toString(36).slice(2)}` };
        }
        await storage.setItem(META, JSON.stringify(authority));
      });
    },
    observe(lease: Lease, recipe: Recipe, fetchedAt = Date.now(), requestedRevision = revision(recipe.id)) {
      return run(async () => {
        if (!valid(lease)) return;
        if (requestedRevision !== revision(recipe.id)) return;
        observed.set(recipe.id, { recipe, fetchedAt });
        if (observed.size > 64) observed.delete(observed.keys().next().value!);
        if (recipe.is_owner || eligible.has(recipe.id)) await save(lease, recipe, undefined, fetchedAt);
      });
    },
    markSaved(lease: Lease, id: string, saved: boolean, requestedRevision = revision(id)) {
      if (!saved && valid(lease)) revisions.set(id, revision(id) + 1);
      return run(async () => {
        if (!valid(lease) || saved && requestedRevision !== revision(id)) return;
        if (saved) eligible.add(id); else eligible.delete(id);
        const observation = observed.get(id);
        const recipe = observation?.recipe;
        if (recipe && (saved || recipe.is_owner)) await save(lease, recipe, undefined, observation!.fetchedAt);
        else if (!saved) {
          await forget(lease, id);
        }
      });
    },
    read: (lease: Lease, id: string) => run(async () => {
      if (!(await readIndex(lease)).includes(id)) return null;
      const raw = await storage.getItem(recordKey(lease, id));
      return valid(lease) && raw ? JSON.parse(raw) as OfflineRecipe : null;
    }),
    list: (lease: Lease) => run(() => readAll(lease)),
    pin: (lease: Lease, id: string, pinned: boolean) => run(async () => {
      const rows = await readAll(lease);
      const row = rows.find(item => item.recipe.id === id);
      const observation = observed.get(id);
      if (!row && valid(lease) && observation && (observation.recipe.is_owner || eligible.has(id))) {
        await save(lease, observation.recipe, pinned, observation.fetchedAt); return;
      }
      if (!row || !valid(lease)) throw new Error('Open a saved or own recipe online before marking it Available offline.');
      row.pinned = pinned;
      await writeAll(lease, rows, id);
    }),
    remove: (lease: Lease, id: string) => {
      if (valid(lease)) revisions.set(id, revision(id) + 1);
      return run(() => forget(lease, id));
    },
    clear() {
      epoch++; authority = null; observed.clear(); eligible.clear(); revisions.clear();
      return run(erase);
    },
  };
}
export const offlineRecipes = createOfflineRecipes(AsyncStorage);
