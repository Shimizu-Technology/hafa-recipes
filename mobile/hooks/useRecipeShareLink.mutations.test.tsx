import React, { act } from 'react';
import { createRoot } from 'test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const m = vi.hoisted(() => ({
  create: vi.fn(), status: vi.fn(), revoke: vi.fn(), store: vi.fn(), forget: vi.fn(),
  calls: [] as string[], mutations: [] as any[],
}));
vi.mock('@/lib/api', () => ({ api: {
  createRecipeShareLink: m.create, getRecipeShareLink: m.status, revokeRecipeShareLink: m.revoke, getAuthScope: () => ({ userId: 'user_a' }),
} }));
vi.mock('@/lib/recipeLinkStore', () => ({ readStoredRecipeLink: vi.fn(), storeRecipeLink: m.store, forgetRecipeLink: m.forget }));
vi.mock('@/lib/recipeQueryScope', () => ({ scopedRecipeKey: (key: unknown[]) => key }));
vi.mock('@/hooks/useRecipeQuery', () => ({
  useRecipeQuery: () => ({ data: undefined, error: null, isLoading: false, refetch: vi.fn() }),
  useRecipeMutation: (options: any) => { m.mutations.push(options); return { ...options, isPending: false, mutateAsync: options.mutationFn }; },
  useRecipeQueryClient: () => ({
    cancelQueries: vi.fn(async ({ queryKey }: any) => { m.calls.push(`cancel:${queryKey.join('/')}`); }),
    setQueryData: vi.fn((key: any) => { m.calls.push(`set:${key.join('/')}`); }),
    invalidateQueries: vi.fn(),
  }),
}));

import { replacedAfter, useRecipeShareLink } from './useRecipeShareLink';

function Harness() { useRecipeShareLink('r1', true); return null; }

beforeEach(async () => {
  vi.clearAllMocks();
  m.calls = []; m.mutations = [];
  await act(async () => createRoot().render(<Harness />));
});
const [create, revoke] = [() => m.mutations[0], () => m.mutations[1]];

describe('creating and turning off a link', () => {
  it('keeps the link with the date from the create response, without a second request', async () => {
    m.create.mockResolvedValue({ url: 'https://hafa-recipes.com/r/k', created_at: '2026-11-16T03:00:00Z' });
    const result = await create().mutationFn();
    expect(m.status).not.toHaveBeenCalled();
    expect(m.store).toHaveBeenCalledWith('r1', { url: 'https://hafa-recipes.com/r/k', createdAt: '2026-11-16T03:00:00Z' });
    expect(result.fresh).toEqual({ active: true, created_at: '2026-11-16T03:00:00Z' });
  });

  it('asks the status endpoint on an older API, and keeps the link undated if that fails', async () => {
    m.create.mockResolvedValue({ url: 'https://hafa-recipes.com/r/k', created_at: null, responded_at: 'Mon, 16 Nov 2026 03:00:00 GMT' });
    m.status.mockRejectedValue(new Error('offline'));
    await create().mutationFn();
    expect(m.status).toHaveBeenCalledTimes(1);
    expect(m.store).toHaveBeenCalledWith('r1', { url: 'https://hafa-recipes.com/r/k', createdAt: null });
  });

  it('cancels an in-flight status fetch before writing the new status', async () => {
    await create().onSuccess({ fresh: { active: true, created_at: 'd' }, stored: { url: 'u', createdAt: 'd' } });
    expect(m.calls.slice(0, 2)).toEqual(['cancel:recipeShareLink/status/r1', 'set:recipeShareLink/device/r1']);
    expect(m.calls).toContain('set:recipeShareLink/status/r1');
    m.calls = [];
    await revoke().onSuccess(undefined, 'r1');
    expect(m.calls[0]).toBe('cancel:recipeShareLink/status/r1');
    expect(m.calls.indexOf('set:recipeShareLink/status/r1')).toBeGreaterThan(0);
  });

  it('on an older API, refuses a URL whose link another phone replaced between the POST and the GET', async () => {
    m.create.mockResolvedValue({ url: 'https://hafa-recipes.com/r/A', created_at: null, responded_at: 'Mon, 16 Nov 2026 03:00:00 GMT' });
    m.status.mockResolvedValue({ active: true, created_at: '2026-11-16T03:00:05.123Z' });
    await expect(create().mutationFn()).rejects.toMatchObject({ code: 'LINK_REPLACED_ELSEWHERE' });
    expect(m.store).not.toHaveBeenCalled();
    m.status.mockResolvedValue({ active: false, created_at: null });
    await expect(create().mutationFn()).rejects.toMatchObject({ code: 'LINK_REPLACED_ELSEWHERE' });
    expect(m.store).not.toHaveBeenCalled();
  });

  it('on an older API, keeps a URL whose status is from the same second as the create', async () => {
    m.create.mockResolvedValue({ url: 'https://hafa-recipes.com/r/A', created_at: null, responded_at: 'Mon, 16 Nov 2026 03:00:00 GMT' });
    m.status.mockResolvedValue({ active: true, created_at: '2026-11-16T03:00:00.640Z' });
    await create().mutationFn();
    expect(m.store).toHaveBeenCalledWith('r1', { url: 'https://hafa-recipes.com/r/A', createdAt: '2026-11-16T03:00:00.640Z' });
  });
});

describe('replacedAfter', () => {
  const at = 'Mon, 16 Nov 2026 03:00:00 GMT';
  it.each([
    [{ active: false, created_at: null }, at, true],
    [{ active: true, created_at: '2026-11-16T03:00:01.500Z' }, at, true],
    [{ active: true, created_at: '2026-11-16T03:00:00.999Z' }, at, false],
    [{ active: true, created_at: '2026-11-16T02:59:59Z' }, at, false],
    [{ active: true, created_at: '2026-11-16T03:00:09Z' }, null, false],
    [{ active: true, created_at: null }, at, false],
  ])('%j after %s → %s', (status, respondedAt, expected) => {
    expect(replacedAfter(status, respondedAt)).toBe(expected);
  });
});
