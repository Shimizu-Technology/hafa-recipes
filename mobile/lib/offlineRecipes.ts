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
  const run = <T,>(job: () => Promise<T>) => { const result = tail.then(job); tail = result.catch(() => undefined); return result; };
  const valid = (lease: Lease) => lease.epoch === epoch && authority?.owner === lease.owner && authority?.generation === lease.generation && subject === lease.subject;
  const key = (lease: Lease) => `${PREFIX}${encodeURIComponent(lease.owner)}:${lease.generation}`;
  const readAll = async (lease: Lease): Promise<OfflineRecipe[]> => {
    if (!valid(lease)) return [];
    const raw = await storage.getItem(key(lease));
    if (!valid(lease)) return [];
    return raw ? JSON.parse(raw) : [];
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
    if (JSON.stringify(next).length > 2_000_000) throw new Error('This recipe is too large to keep offline.');
    const remaining = rows.filter(row => row.recipe.id !== recipe.id);
    const all = [next, ...remaining];
    const kept = [...all.filter(row => row.pinned), ...all.filter(row => !row.pinned).slice(0, 30)];
    if (kept.filter(row => row.pinned).length > 20) throw new Error('Up to 20 recipes can be marked Available offline.');
    if (valid(lease)) await storage.setItem(key(lease), JSON.stringify(kept));
  };
  return {
    lease: (currentSubject?: string | null): Lease | null => authority && subject && currentSubject === subject ? { ...authority, epoch } : null,
    bindSubject(next: string | null) {
      epoch++; subject = next; authority = null; observed.clear(); eligible.clear();
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
    observe(lease: Lease, recipe: Recipe, fetchedAt = Date.now()) {
      return run(async () => {
        if (!valid(lease)) return;
        observed.set(recipe.id, { recipe, fetchedAt });
        if (observed.size > 64) observed.delete(observed.keys().next().value!);
        if (recipe.is_owner || eligible.has(recipe.id)) await save(lease, recipe, undefined, fetchedAt);
      });
    },
    markSaved(lease: Lease, id: string, saved: boolean) {
      return run(async () => {
        if (!valid(lease)) return;
        if (saved) eligible.add(id); else eligible.delete(id);
        const observation = observed.get(id);
        const recipe = observation?.recipe;
        if (recipe && (saved || recipe.is_owner)) await save(lease, recipe, undefined, observation!.fetchedAt);
        else if (!saved) {
          const rows = await readAll(lease);
          if (valid(lease)) await storage.setItem(key(lease), JSON.stringify(rows.filter(row => row.recipe.id !== id)));
        }
      });
    },
    read: (lease: Lease, id: string) => run(async () => (await readAll(lease)).find(row => row.recipe.id === id) ?? null),
    list: (lease: Lease) => run(() => readAll(lease)),
    pin: (lease: Lease, id: string, pinned: boolean) => run(async () => {
      const rows = await readAll(lease);
      const row = rows.find(item => item.recipe.id === id);
      if (!row || !valid(lease)) throw new Error('Open a saved or own recipe online before marking it Available offline.');
      if (pinned && rows.filter(item => item.pinned && item.recipe.id !== id).length >= 20) throw new Error('Up to 20 recipes can be marked Available offline.');
      row.pinned = pinned;
      if (valid(lease)) await storage.setItem(key(lease), JSON.stringify(rows));
    }),
    remove: (lease: Lease, id: string) => run(async () => {
      observed.delete(id); eligible.delete(id);
      const rows = await readAll(lease);
      if (valid(lease)) await storage.setItem(key(lease), JSON.stringify(rows.filter(row => row.recipe.id !== id)));
    }),
    clear() {
      epoch++; authority = null; observed.clear(); eligible.clear();
      return run(erase);
    },
  };
}
export const offlineRecipes = createOfflineRecipes(AsyncStorage);
