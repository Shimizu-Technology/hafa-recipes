import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { PantrySnapshot } from '@/types/pantry';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  getPantrySnapshot: vi.fn(),
  syncPantryMutation: vi.fn(),
}));

vi.mock('@clerk/expo', () => ({ useAuth: () => ({ userId: 'clerk-alice' }) }));
vi.mock('expo-crypto', () => ({ randomUUID: () => 'test-mutation-id' }));
vi.mock('@/lib/offlineStorage', () => ({
  getGroceryStorageLease: () => ({ identityEpoch: 1, scopeEpoch: 1, identityHash: 'alice' }),
  assertGroceryStorageLease: () => undefined,
}));
vi.mock('@/lib/api', () => ({ api: mocks }));

import { pantryKeys, usePantryWrite } from './usePantry';

const snapshot = (revision: number): PantrySnapshot => ({
  space_id: 'space-1', scope: 'household', list_id: 'list-1', revision,
  items: [], transferred_grocery_item_ids: [], copied_personal_item_ids: [],
  server_time: '2026-09-29T00:00:00Z',
});

describe('usePantryWrite', () => {
  beforeEach(() => {
    mocks.getPantrySnapshot.mockReset();
    mocks.syncPantryMutation.mockReset();
    mocks.getPantrySnapshot.mockResolvedValue(snapshot(5));
    mocks.syncPantryMutation.mockResolvedValue(snapshot(6));
  });

  it('sends the revision captured by the editor even after a newer fetch', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    let write: ReturnType<typeof usePantryWrite> | undefined;
    function Harness() {
      write = usePantryWrite();
      return null;
    }
    let renderer: ReactTestRenderer | undefined;
    try {
      await act(async () => {
        renderer = create(<QueryClientProvider client={queryClient}><Harness /></QueryClientProvider>);
      });
      await act(async () => {
        await write!.mutateAsync({
          operation: 'update', item_id: 'rice-1', space_id: 'space-1',
          base_revision: 4, changes: { name: 'Brown rice' },
        });
      });
      expect(mocks.getPantrySnapshot).toHaveBeenCalledOnce();
      expect(mocks.syncPantryMutation).toHaveBeenCalledWith(
        expect.objectContaining({
          operation: 'update', space_id: 'space-1', base_revision: 4,
          changes: { name: 'Brown rice' },
        }),
        expect.any(Function),
      );
      expect(queryClient.getQueryData(pantryKeys.snapshot('active', 'clerk-alice')))
        .toEqual(snapshot(6));
    } finally {
      if (renderer) {
        const mountedRenderer = renderer;
        await act(async () => mountedRenderer.unmount());
      }
      queryClient.clear();
    }
  });
});
