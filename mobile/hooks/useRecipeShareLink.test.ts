import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({ getRecipes: vi.fn(), status: vi.fn() }));
vi.mock('@/lib/api', () => ({ api: { getRecipes: m.getRecipes, getRecipeShareLink: m.status, getAuthScope: () => ({ userId: 'user_a' }) } }));
vi.mock('@/hooks/useRecipeQuery', () => ({ useRecipeQuery: vi.fn(), useRecipeMutation: vi.fn(), useRecipeQueryClient: vi.fn() }));
vi.mock('expo-secure-store', () => ({ WHEN_UNLOCKED_THIS_DEVICE_ONLY: 1, getItemAsync: vi.fn(), setItemAsync: vi.fn(), deleteItemAsync: vi.fn() }));

import { findActiveRecipeLinks, usableStoredLink } from './useRecipeShareLink';

const item = (id: string, is_owner = true) => ({ id, title: id, is_owner }) as any;

beforeEach(() => vi.clearAllMocks());

describe('link kept on this phone', () => {
  const stored = { url: 'https://hafa-recipes.com/r/key', createdAt: '2026-11-16T03:00:00Z' };
  it('is used only while it is the server’s current link', () => {
    expect(usableStoredLink({ active: true, created_at: '2026-11-16T03:00:00Z' }, stored)).toBe(stored.url);
    expect(usableStoredLink({ active: true, created_at: '2026-11-17T09:00:00Z' }, stored)).toBeNull();
    expect(usableStoredLink({ active: false, created_at: null }, stored)).toBeNull();
    expect(usableStoredLink(undefined, stored)).toBeNull();
    expect(usableStoredLink({ active: true, created_at: '2026-11-16T03:00:00Z' }, null)).toBeNull();
  });
});

describe('Settings › Sharing links', () => {
  it('pages through owned recipes and keeps only those with an active link', async () => {
    m.getRecipes
      .mockResolvedValueOnce({ items: [item('a'), item('saved', false), item('b')], has_more: true })
      .mockResolvedValueOnce({ items: [item('c')], has_more: false });
    m.status.mockImplementation(async (id: string) => (id === 'b' ? { active: true, created_at: '2026-11-16T03:00:00Z' } : { active: false, created_at: null }));
    await expect(findActiveRecipeLinks()).resolves.toEqual([{ recipe: item('b'), createdAt: '2026-11-16T03:00:00Z' }]);
    expect(m.getRecipes).toHaveBeenNthCalledWith(2, 100, 3);
    expect(m.status.mock.calls.map(([id]) => id).sort()).toEqual(['a', 'b', 'c']);
  });

  it('skips a recipe deleted mid-check but surfaces other failures', async () => {
    m.getRecipes.mockResolvedValue({ items: [item('gone'), item('b')], has_more: false });
    m.status.mockImplementation(async (id: string) => {
      if (id === 'gone') throw { response: { status: 404 } };
      return { active: true, created_at: null };
    });
    await expect(findActiveRecipeLinks()).resolves.toEqual([{ recipe: item('b'), createdAt: null }]);
    m.status.mockRejectedValue({ response: { status: 503 } });
    await expect(findActiveRecipeLinks()).rejects.toEqual({ response: { status: 503 } });
  });

  it('checks a few recipes at a time', async () => {
    m.getRecipes.mockResolvedValue({ items: Array.from({ length: 10 }, (_, i) => item(`r${i}`)), has_more: false });
    let running = 0;
    let peak = 0;
    m.status.mockImplementation(async () => {
      running += 1;
      peak = Math.max(peak, running);
      await new Promise(resolve => setTimeout(resolve, 1));
      running -= 1;
      return { active: false, created_at: null };
    });
    await findActiveRecipeLinks();
    expect(m.status).toHaveBeenCalledTimes(10);
    expect(peak).toBeLessThanOrEqual(4);
  });
});
