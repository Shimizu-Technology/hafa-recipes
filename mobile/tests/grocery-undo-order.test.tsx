import React, { act } from 'react';
import { createRoot } from 'test-renderer';
import { beforeEach, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  queue: [] as { mutation: any; queued_at: string }[],
  server: { checked: false, revision: 1 },
  offline: false,
  mutationOptions: [] as any[],
  ids: 0,
}));
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

function serverSnapshot() {
  return {
    account_scope_id: 'gacct_synthetic',
    list: { id: 'list-1' },
    revision: state.server.revision,
    items: [{ id: 'limes', name: 'Limes', checked: state.server.checked, created_at: '2026-11-17T00:00:00Z', updated_at: '2026-11-17T00:00:00Z' }],
    total: 1,
    checked: state.server.checked ? 1 : 0,
    unchecked: state.server.checked ? 0 : 1,
  };
}

const memory = vi.hoisted(() => ({ data: undefined as any }));
const client = vi.hoisted(() => ({
  getQueryData: () => memory.data,
  setQueryData: (_key: unknown, value: any) => { memory.data = value; },
  invalidateQueries: async () => {},
}));

vi.mock('@tanstack/react-query', () => ({ useQuery: () => ({ isFetching: false, data: memory.data }) }));
vi.mock('@/lib/api', () => ({
  api: {
    getGrocerySnapshot: vi.fn(async () => {
      if (state.offline) throw new Error('Network Error');
      return serverSnapshot();
    }),
    syncGroceryMutation: vi.fn(async (request: any) => {
      // No response at all: the request never reached the server.
      if (state.offline) throw new Error('Network Error');
      state.server = { checked: request.checked, revision: state.server.revision + 1 };
      return { replayed: false, snapshot: serverSnapshot() };
    }),
  },
}));
vi.mock('@/hooks/useRecipeQuery', () => ({
  useRecipeQueryClient: () => client,
  useRecipeMutation: (options: any) => { state.mutationOptions.push(options); return options; },
}));
vi.mock('@/lib/recipeQueryScope', () => ({ recipeScope: () => 'owner', assertRecipeScope: vi.fn() }));
vi.mock('@/hooks/usePantry', () => ({ pantryKeys: {} }));
vi.mock('@/hooks/useNetworkStatus', () => ({ useNetworkStatus: () => ({ isOnline: true, isApiReachable: true }), useOnlineCallback: vi.fn() }));
vi.mock('@/lib/offlineStorage', () => ({
  getGroceryStorageLease: () => ({}),
  assertGroceryStorageLease: vi.fn(),
  hasPendingSync: async () => state.queue.length > 0,
  addToSyncQueue: async (mutation: any) => { state.queue.push({ mutation, queued_at: new Date().toISOString() }); },
  removeFromSyncQueue: async (id: string) => { state.queue = state.queue.filter((entry) => entry.mutation.mutation_id !== id); },
  getPendingSyncQueue: async () => [...state.queue],
  cacheGrocerySnapshot: async () => {},
  cacheServerGrocerySnapshot: async (snapshot: any) => snapshot,
  getCachedGrocerySnapshot: async () => memory.data ?? null,
}));
vi.mock('@/lib/groceryWidget', () => ({ publishConfirmedGrocerySnapshot: vi.fn(async () => {}), requestGroceryWidgetRefresh: vi.fn() }));
vi.mock('expo-crypto', () => ({ randomUUID: () => `synthetic-${++state.ids}` }));

import { useGrocerySync, useToggleGroceryItem } from '@/hooks/useGrocery';

beforeEach(() => {
  state.queue = [];
  state.server = { checked: false, revision: 1 };
  state.offline = false;
  state.mutationOptions = [];
  memory.data = serverSnapshot();
});

it('keeps an item unchecked when Undo succeeds before the check it reverses was sent', async () => {
  let sync: ReturnType<typeof useGrocerySync> | undefined;
  function Probe() { useToggleGroceryItem(); sync = useGrocerySync(true); return null; }
  const root = createRoot();
  try {
    await act(async () => root.render(<Probe />));
    const toggle = state.mutationOptions[0];

    // Both attempts at the check fail without a response, so it stays queued
    // and the screen shows Undo.
    state.offline = true;
    const checked = await toggle.mutationFn({ id: 'limes', checked: true });
    expect(checked.syncStatus).toBe('queued');
    expect(state.queue).toHaveLength(1);

    // Connectivity returns before the user taps Undo.
    state.offline = false;
    const undone = await toggle.mutationFn({ id: 'limes', checked: false });
    expect(undone.syncStatus).toBe('confirmed');
    expect(state.server.checked).toBe(false);
    expect(undone.items[0].checked).toBe(false);

    // A later replay finds nothing older to apply over the Undo.
    expect(state.queue).toEqual([]);
    await act(async () => { await sync!.syncPendingChanges(); });
    expect(state.server.checked).toBe(false);
    expect(memory.data.items[0].checked).toBe(false);
  } finally { await act(async () => root.unmount()); }
});

it('queues Undo behind a pending check while still offline, then replays both in order', async () => {
  let sync: ReturnType<typeof useGrocerySync> | undefined;
  function Probe() { useToggleGroceryItem(); sync = useGrocerySync(true); return null; }
  const root = createRoot();
  try {
    await act(async () => root.render(<Probe />));
    const toggle = state.mutationOptions[0];
    state.offline = true;
    await toggle.mutationFn({ id: 'limes', checked: true });
    const undone = await toggle.mutationFn({ id: 'limes', checked: false });
    expect(undone.syncStatus).toBe('queued');
    expect(undone.items[0].checked).toBe(false);
    expect(state.queue.map((entry) => entry.mutation.checked)).toEqual([true, false]);

    state.offline = false;
    await act(async () => { await sync!.syncPendingChanges(); });
    expect(state.queue).toEqual([]);
    expect(state.server.checked).toBe(false);
  } finally { await act(async () => root.unmount()); }
});
