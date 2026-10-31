import React, { act } from 'react';
import { createRoot } from 'test-renderer';
import { expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({
  scope: {}, client: {}, lease: vi.fn(() => { throw new Error('Grocery storage identity is not bound.'); }),
  pending: vi.fn(),
  sync: vi.fn(), snapshot: vi.fn(), mutationOptions: null as any,
  probe: null as boolean | null,
  query: { isFetching: false, data: { items: [], freshness: 'confirmed', serverConfirmedAt: '2026-10-31T11:45:00Z' } } as any,
}));
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
vi.mock('@tanstack/react-query', () => ({ useQuery: () => state.query }));
vi.mock('@/lib/api', () => ({ api: { syncGroceryMutation: state.sync, getGrocerySnapshot: state.snapshot } }));
vi.mock('@/hooks/useRecipeQuery', () => ({ useRecipeQueryClient: () => state.client, useRecipeMutation: (options: any) => { state.mutationOptions = options; return options; } }));
vi.mock('@/lib/recipeQueryScope', () => ({ recipeScope: () => state.scope, assertRecipeScope: vi.fn() }));
vi.mock('@/hooks/usePantry', () => ({ pantryKeys: {} }));
vi.mock('@/hooks/useNetworkStatus', () => ({ useNetworkStatus: () => ({ isOnline: true, isApiReachable: state.probe }), useOnlineCallback: vi.fn() }));
vi.mock('@/lib/offlineStorage', () => ({ getGroceryStorageLease: state.lease, hasPendingSync: state.pending, assertGroceryStorageLease: vi.fn(), addToSyncQueue: vi.fn(async () => {}), removeFromSyncQueue: vi.fn(async () => {}), cacheGrocerySnapshot: vi.fn(async (value: any) => value), getPendingSyncQueue: vi.fn(async () => []) }));
vi.mock('@/lib/groceryWidget', () => ({ publishConfirmedGrocerySnapshot: vi.fn(async () => {}), requestGroceryWidgetRefresh: vi.fn() }));
vi.mock('expo-crypto', () => ({ randomUUID: () => 'synthetic-id' }));
import { useGrocerySync, useGroceryList, useAddGroceryItem } from '@/hooks/useGrocery';
it('contains an unbound identity while checking pending sync during account retirement', async () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const root = createRoot();
  function Probe() { useGrocerySync(true); return null; }
  try {
    await act(async () => { root.render(<Probe />); });
    expect(state.lease).toHaveBeenCalledOnce();
    expect(state.pending).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith('[Grocery Sync] Could not check pending changes:', expect.any(Error));
  } finally { await act(async () => root.unmount()); warn.mockRestore(); }
});

it('trusts a confirmed server snapshot while a connectivity probe is still unknown', async () => {
  const root = createRoot();
  let freshness: string | undefined;
  function Probe() { freshness = useGroceryList(true, true).freshness; return null; }
  try {
    state.probe = null;
    state.query = { isFetching: false, data: { items: [], freshness: 'confirmed', serverConfirmedAt: '2026-10-31T11:45:00Z' } };
    await act(async () => root.render(<Probe />));
    expect(freshness).toBe('confirmed');
    state.query = { ...state.query, isFetching: true };
    await act(async () => root.render(<Probe />));
    expect(freshness).toBe('checking');
    state.query = { isFetching: false, data: { items: [], freshness: 'stale' } };
    await act(async () => root.render(<Probe />));
    expect(freshness).toBe('stale');
    state.probe = false;
    await act(async () => root.render(<Probe />));
    expect(freshness).toBe('offline');
  } finally { state.probe = null; await act(async () => root.unmount()); }
});

it('keeps confirmation metadata when a saved mutation replaces the cached snapshot', async () => {
  const root = createRoot();
  const data = { list: { id: 'list-1' }, items: [], revision: 1, total: 0, checked: 0, unchecked: 0 };
  const setQueryData = vi.fn();
  state.client = { getQueryData: () => data, setQueryData, invalidateQueries: vi.fn(async () => {}) };
  state.lease.mockReturnValue({} as never);
  state.sync.mockResolvedValue({ snapshot: { ...data, revision: 2, items: [{ name: 'Limes' }], total: 1, unchecked: 1 } });
  function Probe() { useAddGroceryItem(); return null; }
  try {
    await act(async () => root.render(<Probe />));
    const result = await state.mutationOptions.mutationFn({ name: 'Limes' });
    expect(result.syncStatus).toBe('confirmed');
    const cached = setQueryData.mock.calls.at(-1)![1];
    expect(cached.items).toEqual([{ name: 'Limes' }]);
    expect(cached.freshness).toBe('confirmed');
    expect(Number.isFinite(Date.parse(cached.serverConfirmedAt))).toBe(true);
  } finally { await act(async () => root.unmount()); }
});
