import React, { act } from 'react';
import { create, type ReactTestRenderer } from 'react-test-renderer';
import { expect, it, vi } from 'vitest';
const values = vi.hoisted(() => new Map<string, string>());
vi.mock('@react-native-async-storage/async-storage', () => ({ default: {
  getItem: async (key: string) => values.get(key) ?? null,
  setItem: async (key: string, value: string) => { values.set(key, value); },
  getAllKeys: async () => [...values.keys()], multiRemove: async (keys: string[]) => { keys.forEach(key => values.delete(key)); },
} }));
vi.mock('@/lib/api', () => ({ api: { getCurrentUserIdentity: vi.fn(), checkRecipeSaved: vi.fn() } }));
import { offlineRecipes } from '@/lib/offlineRecipes';
import { useOfflineRecipe } from './useOfflineRecipe';
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
const refetch = async () => undefined;
let shown: ReturnType<typeof useOfflineRecipe>;
function Screen() { shown = useOfflineRecipe('private-a', 'same-subject', undefined, undefined, false, refetch); return null; }
it('retires mounted private offline content when one subject resolves to a new stable owner', async () => {
  await offlineRecipes.bindSubject('same-subject'); await offlineRecipes.verify('same-subject', 'a');
  await offlineRecipes.observe(offlineRecipes.lease('same-subject')!, { id: 'private-a', is_owner: true, is_public: false, extracted: { title: 'A secret', ingredients: [], steps: ['Private'] } } as any);
  let root!: ReactTestRenderer;
  try {
    await act(async () => { root = create(<Screen />); });
    expect(shown.recipe?.extracted.title).toBe('A secret');
    await act(async () => { await offlineRecipes.verify('same-subject', 'b'); });
    expect(shown.recipe).toBeUndefined();
    expect(await offlineRecipes.list(offlineRecipes.lease('same-subject')!)).toEqual([]);
  } finally { await act(async () => root?.unmount()); await offlineRecipes.clear(); }
});
