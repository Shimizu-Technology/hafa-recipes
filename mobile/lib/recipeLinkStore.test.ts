import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({ items: new Map<string, string>(), generation: null as string | null }));
vi.mock('expo-secure-store', () => ({
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 1,
  getItemAsync: vi.fn(async (key: string) => m.items.get(key) ?? null),
  setItemAsync: vi.fn(async (key: string, value: string) => { m.items.set(key, value); }),
  deleteItemAsync: vi.fn(async (key: string) => { m.items.delete(key); }),
}));
vi.mock('./offlineRecipes', () => ({ offlineRecipes: {
  ownerGeneration: () => m.generation, onRetire: () => () => {}, subscribe: () => () => {}, scope: () => '[null,null,null,0]',
} }));

import { currentLinkOwner, forgetOwnerRecipeLinks, forgetRecipeLink, readStoredRecipeLink, storeRecipeLink, watchRecipeLinkOwners } from './recipeLinkStore';

const link = { url: 'https://hafa-recipes.com/r/k', createdAt: '2026-11-16T03:00:00Z' };
beforeEach(() => { m.items.clear(); m.generation = JSON.stringify(['app-owner-1', 'gen-1']); });

describe('links kept on this phone', () => {
  it('belong to the stable application owner, not the Clerk subject', async () => {
    expect(currentLinkOwner()).toBe('app-owner-1');
    await storeRecipeLink('r1', link);
    expect([...m.items.keys()].sort()).toEqual(['hafa.recipeLink.app-owner-1.r1', 'hafa.recipeLinkIndex.app-owner-1']);
    await expect(readStoredRecipeLink('r1')).resolves.toEqual(link);
    m.generation = JSON.stringify(['app-owner-2', 'gen-2']);
    await expect(readStoredRecipeLink('r1')).resolves.toBeNull();
  });

  it('keeps nothing before the owner is verified', async () => {
    m.generation = null;
    await storeRecipeLink('r1', link);
    expect(m.items.size).toBe(0);
    await expect(readStoredRecipeLink('r1')).resolves.toBeNull();
  });

  it('indexes links so an owner’s links can all be removed', async () => {
    await storeRecipeLink('r1', link);
    await storeRecipeLink('r2', link);
    await forgetRecipeLink('r1');
    expect(JSON.parse(m.items.get('hafa.recipeLinkIndex.app-owner-1')!)).toEqual(['r2']);
    await forgetOwnerRecipeLinks('app-owner-1');
    expect(m.items.size).toBe(0);
  });
});

describe('sign-out and account switches', () => {
  function source() {
    const s = { retire: null as null | ((p: any) => void), change: null as null | (() => void), scope: '["clerk_a","app-owner-1","g",1]' };
    return { s, api: {
      onRetire: (fn: any) => { s.retire = fn; return () => {}; },
      subscribe: (fn: any) => { s.change = fn; return () => {}; },
      scope: () => s.scope,
    } };
  }

  it('removes the departed owner’s links on sign-out', () => {
    const { s, api } = source();
    const forget = vi.fn();
    watchRecipeLinkOwners(api as any, forget);
    s.retire!({ owner: 'app-owner-1' });
    s.scope = '[null,null,null,2]';
    s.change!();
    expect(forget).toHaveBeenCalledWith('app-owner-1');
  });

  it('removes them when a different owner is verified', () => {
    const { s, api } = source();
    const forget = vi.fn();
    watchRecipeLinkOwners(api as any, forget);
    s.retire!({ owner: 'app-owner-1' });
    s.scope = '["clerk_b",null,null,2]';
    s.change!();
    expect(forget).not.toHaveBeenCalled();
    s.scope = '["clerk_b","app-owner-2","g2",2]';
    s.change!();
    expect(forget).toHaveBeenCalledWith('app-owner-1');
  });

  it('keeps them when the same person is rebound', () => {
    const { s, api } = source();
    const forget = vi.fn();
    watchRecipeLinkOwners(api as any, forget);
    s.retire!({ owner: 'app-owner-1' });
    s.scope = '["clerk_a",null,null,2]';
    s.change!();
    s.scope = '["clerk_a","app-owner-1","g",2]';
    s.change!();
    expect(forget).not.toHaveBeenCalled();
  });
});
