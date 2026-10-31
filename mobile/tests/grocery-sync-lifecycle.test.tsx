import React, { act } from 'react';
import { createRoot } from 'test-renderer';
import { expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({
  scope: {}, client: {}, lease: vi.fn(() => { throw new Error('Grocery storage identity is not bound.'); }),
  pending: vi.fn(),
}));
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
vi.mock('@/lib/api', () => ({ api: {} }));
vi.mock('@/hooks/useRecipeQuery', () => ({ useRecipeQueryClient: () => state.client, useRecipeMutation: vi.fn() }));
vi.mock('@/lib/recipeQueryScope', () => ({ recipeScope: () => state.scope, assertRecipeScope: vi.fn() }));
vi.mock('@/hooks/usePantry', () => ({ pantryKeys: {} }));
vi.mock('@/hooks/useNetworkStatus', () => ({ useNetworkStatus: () => ({ isOnline: true }), useOnlineCallback: vi.fn() }));
vi.mock('@/lib/offlineStorage', () => ({ getGroceryStorageLease: state.lease, hasPendingSync: state.pending }));
vi.mock('@/lib/groceryWidget', () => ({ publishConfirmedGrocerySnapshot: vi.fn(), requestGroceryWidgetRefresh: vi.fn() }));
vi.mock('expo-crypto', () => ({ randomUUID: vi.fn() }));
import { useGrocerySync } from '@/hooks/useGrocery';
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
