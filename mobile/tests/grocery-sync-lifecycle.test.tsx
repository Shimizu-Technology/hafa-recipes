import React, { act } from 'react';
import { createRoot } from 'test-renderer';
import { expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({
  scope: {}, client: {}, lease: vi.fn(() => { throw new Error('Grocery storage identity is not bound.'); }),
  pending: vi.fn(),
  probe: null as boolean | null,
  query: { isFetching: false, data: { items: [], freshness: 'confirmed', serverConfirmedAt: '2026-10-31T11:45:00Z' } } as any,
}));
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
vi.mock('@tanstack/react-query', () => ({ useQuery: () => state.query }));
vi.mock('@/lib/api', () => ({ api: {} }));
vi.mock('@/hooks/useRecipeQuery', () => ({ useRecipeQueryClient: () => state.client, useRecipeMutation: vi.fn() }));
vi.mock('@/lib/recipeQueryScope', () => ({ recipeScope: () => state.scope, assertRecipeScope: vi.fn() }));
vi.mock('@/hooks/usePantry', () => ({ pantryKeys: {} }));
vi.mock('@/hooks/useNetworkStatus', () => ({ useNetworkStatus: () => ({ isOnline: true, isApiReachable: state.probe }), useOnlineCallback: vi.fn() }));
vi.mock('@/lib/offlineStorage', () => ({ getGroceryStorageLease: state.lease, hasPendingSync: state.pending }));
vi.mock('@/lib/groceryWidget', () => ({ publishConfirmedGrocerySnapshot: vi.fn(), requestGroceryWidgetRefresh: vi.fn() }));
vi.mock('expo-crypto', () => ({ randomUUID: vi.fn() }));
import { useGrocerySync, useGroceryList } from '@/hooks/useGrocery';
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
