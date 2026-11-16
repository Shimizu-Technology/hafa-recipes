import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({ list: vi.fn(), status: vi.fn() }));
vi.mock('@/lib/api', () => ({ api: { listRecipeShareLinks: m.list, getRecipeShareLink: m.status, getAuthScope: () => ({ userId: 'user_a' }) } }));
vi.mock('@/hooks/useRecipeQuery', () => ({ useRecipeQuery: vi.fn(), useRecipeMutation: vi.fn(), useRecipeQueryClient: vi.fn() }));
vi.mock('expo-secure-store', () => ({ WHEN_UNLOCKED_THIS_DEVICE_ONLY: 1, getItemAsync: vi.fn(), setItemAsync: vi.fn(), deleteItemAsync: vi.fn() }));

import { scopedRecipeKey } from '@/lib/recipeQueryScope';
import { findActiveRecipeLinks, recipeShareLinkKeys, usableStoredLink } from './useRecipeShareLink';

const summary = (id: string) => ({ recipe_id: id, title: `Recipe ${id}`, thumbnail_url: null, created_at: `2026-11-16T03:00:0${id.length}Z` });

beforeEach(() => vi.clearAllMocks());

describe('share link query keys', () => {
  it('are the owner-scoped keys the recipe queries observe, so cache writes reach the sheet', () => {
    for (const key of [recipeShareLinkKeys.status('r1'), recipeShareLinkKeys.device('r1'), recipeShareLinkKeys.active()]) {
      expect(key.length).toBeGreaterThan(3);
      expect(scopedRecipeKey(key)).toEqual(key);
    }
  });
});

describe('link kept on this phone', () => {
  const stored = { url: 'https://hafa-recipes.com/r/key', createdAt: '2026-11-16T03:00:00Z' };
  it('is used only while it is the server’s current link', () => {
    expect(usableStoredLink({ active: true, created_at: '2026-11-16T03:00:00Z' }, stored)).toBe(stored.url);
    expect(usableStoredLink({ active: true, created_at: '2026-11-17T09:00:00Z' }, stored)).toBeNull();
    expect(usableStoredLink({ active: false, created_at: null }, stored)).toBeNull();
    expect(usableStoredLink(undefined, stored)).toBeNull();
    expect(usableStoredLink({ active: true, created_at: '2026-11-16T03:00:00Z' }, null)).toBeNull();
  });

  it('never treats a link kept without a date as current', () => {
    const undated = { url: 'https://hafa-recipes.com/r/key', createdAt: null };
    expect(usableStoredLink({ active: true, created_at: '2026-11-16T03:00:00Z' }, undated)).toBeNull();
  });
});

describe('Settings › Sharing links', () => {
  it('reads one list request when everything fits on a page', async () => {
    m.list.mockResolvedValueOnce([summary('a'), { ...summary('b'), thumbnail_url: 'https://media.test/b.webp' }]);
    await expect(findActiveRecipeLinks()).resolves.toEqual([
      { recipe: { id: 'a', title: 'Recipe a', thumbnail_url: null }, createdAt: '2026-11-16T03:00:01Z' },
      { recipe: { id: 'b', title: 'Recipe b', thumbnail_url: 'https://media.test/b.webp' }, createdAt: '2026-11-16T03:00:01Z' },
    ]);
    expect(m.list).toHaveBeenCalledTimes(1);
    expect(m.list).toHaveBeenCalledWith(100, 0);
    expect(m.status).not.toHaveBeenCalled();
  });

  it('pages until a short page', async () => {
    m.list
      .mockResolvedValueOnce(Array.from({ length: 100 }, (_, i) => summary(`r${i}`)))
      .mockResolvedValueOnce([summary('last')]);
    const links = await findActiveRecipeLinks();
    expect(links).toHaveLength(101);
    expect(m.list).toHaveBeenNthCalledWith(2, 100, 100);
  });

  it('passes a missing-table 503 to the screen, which shows links as unavailable', async () => {
    m.list.mockRejectedValue({ response: { status: 503 } });
    await expect(findActiveRecipeLinks()).rejects.toEqual({ response: { status: 503 } });
    expect(m.status).not.toHaveBeenCalled();
  });
});
