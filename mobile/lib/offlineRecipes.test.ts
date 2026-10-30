import { describe, expect, it, vi } from 'vitest';
vi.mock('@react-native-async-storage/async-storage', () => ({ default: {} }));
import { createOfflineRecipes } from './offlineRecipes';
import type { Recipe } from '@/types/recipe';
function setup() {
  const values = new Map<string, string>();
  const storage = { getItem: async (key: string) => values.get(key) ?? null,
    setItem: async (key: string, value: string) => { values.set(key, value); },
    getAllKeys: async () => [...values.keys()], multiRemove: async (keys: string[]) => { keys.forEach(k => values.delete(k)); } };
  return { values, storage: storage as never, store: createOfflineRecipes(storage as never) };
}
const recipe = (id: string, own = true) => ({ id, is_owner: own, extracted: { title: id, ingredients: [{ name: 'rice' }], steps: ['Cook'] } }) as Recipe;
describe('offline recipe authority and retention', () => {
  it('persists own and confirmed saved recipes, never a merely browsed public recipe', async () => {
    const { store } = setup();
    await store.bindSubject('subject'); await store.verify('subject', 'stable-owner');
    const lease = store.lease('subject')!;
    expect(lease.owner).toBe('stable-owner');
    await store.observe(lease, recipe('own'));
    await store.observe(lease, recipe('public', false));
    expect(await store.read(lease, 'public')).toBeNull();
    await store.markSaved(lease, 'public', true);
    expect((await store.read(lease, 'public'))?.recipe.extracted.steps).toEqual(['Cook']);
    await store.markSaved(lease, 'public', false);
    expect(await store.read(lease, 'public')).toBeNull();
  });
  it('restores exact account and generation at cold start; sign-out and switches erase everything', async () => {
    const { store, storage } = setup();
    await store.bindSubject('a'); await store.verify('a', 'stable-a');
    const old = store.lease('a')!;
    await store.observe(old, recipe('own'));
    const cold = createOfflineRecipes(storage);
    await cold.bindSubject('a');
    expect((await cold.read(cold.lease('a')!, 'own'))?.recipe.id).toBe('own');
    await store.bindSubject('b'); await store.verify('b', 'stable-b');
    await store.observe(old, recipe('late-write'));
    expect(await store.list(store.lease('b')!)).toEqual([]);
    await store.clear();
    expect(store.lease('b')).toBeNull();
  });
  it('keeps 30 recent copies plus explicit pins, and revocation removes a pin', async () => {
    const { store } = setup();
    await store.bindSubject('a'); await store.verify('a', 'stable');
    const lease = store.lease('a')!;
    await store.observe(lease, recipe('pinned')); await store.pin(lease, 'pinned', true);
    for (let i = 0; i < 32; i++) await store.observe(lease, recipe(String(i)));
    expect(await store.list(lease)).toHaveLength(31);
    expect((await store.read(lease, 'pinned'))?.pinned).toBe(true);
    await store.remove(lease, 'pinned');
    expect(await store.read(lease, 'pinned')).toBeNull();
  });
  it('invalidates queued writes immediately on clear', async () => {
    const { store, values } = setup();
    await store.bindSubject('a'); await store.verify('a', 'stable');
    const lease = store.lease('a')!;
    const pending = store.observe(lease, recipe('late'));
    const clear = store.clear();
    await Promise.all([pending, clear]);
    expect(values.size).toBe(0);
  });
});

it('retains content freshness when checking saved status and rejects an old stable owner generation', async () => {
  const { store } = setup();
  await store.bindSubject('subject'); await store.verify('subject', 'stable-a');
  const old = store.lease('subject')!;
  await store.observe(old, recipe('saved', false), 1234);
  await store.markSaved(old, 'saved', true);
  expect((await store.read(old, 'saved'))?.savedAt).toBe(1234);
  await store.verify('subject', 'stable-b');
  await store.observe(old, recipe('late'));
  expect(await store.list(store.lease('subject')!)).toEqual([]);
});

it('stores bounded recipes separately from its index and keeps every explicit pin', async () => {
  const { store, values } = setup();
  await store.bindSubject('a'); await store.verify('a', 'stable');
  const lease = store.lease('a')!;
  for (let i = 0; i < 25; i++) {
    await store.observe(lease, recipe(String(i)));
    await store.pin(lease, String(i), true);
  }
  expect((await store.list(lease)).filter(row => row.pinned)).toHaveLength(25);
  const index = [...values.entries()].find(([key]) => !key.endsWith('authority') && !key.includes(':recipe:'))!;
  expect(JSON.parse(index[1])).toEqual(expect.arrayContaining(['0', '24']));
  expect(index[1]).not.toContain('ingredients');
  expect([...values.keys()].filter(key => key.includes(':recipe:'))).toHaveLength(25);
});

it('a late saved check or recipe response cannot restore a removed offline copy', async () => {
  const { store } = setup();
  await store.bindSubject('a'); await store.verify('a', 'stable');
  const lease = store.lease('a')!;
  await store.observe(lease, recipe('saved', false)); await store.markSaved(lease, 'saved', true);
  const stale = store.revision('saved');
  await store.markSaved(lease, 'saved', false);
  await store.observe(lease, recipe('saved', false), 1111, stale);
  await store.markSaved(lease, 'saved', true, stale);
  expect(await store.read(lease, 'saved')).toBeNull();
});
it('retires access before byte cleanup, even when storage deletion fails', async () => {
  const { store, storage, values } = setup();
  await store.bindSubject('a'); await store.verify('a', 'stable');
  const lease = store.lease('a')!;
  await store.observe(lease, recipe('gone'));
  (storage as unknown as { multiRemove: () => Promise<void> }).multiRemove = async () => { throw new Error('storage busy'); };
  await expect(store.remove(lease, 'gone')).rejects.toThrow('storage busy');
  expect([...values.keys()].some(key => key.endsWith(':recipe:gone'))).toBe(true);
  expect(await store.read(lease, 'gone')).toBeNull();
});
