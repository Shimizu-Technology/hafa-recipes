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

import { GroceryListChangedError, useGrocerySync, useRestoreGroceryItem, useToggleGroceryItem } from '@/hooks/useGrocery';

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

it('brings a deleted item back with its details, recipe and check', async () => {
  function Probe() { useRestoreGroceryItem(); return null; }
  const root = createRoot();
  try {
    await act(async () => root.render(<Probe />));
    const restore = state.mutationOptions[0];
    state.offline = true;
    const deleted = { id: 'gone', name: 'Vinegar', quantity: '1/3', unit: 'cup', notes: 'cane', checked: true, recipe_id: 'recipe-2', recipe_title: 'Adobo', added_by_name: 'Kami', created_at: '', updated_at: '' };
    const restored = await restore.mutationFn({ item: deleted, accountScopeId: 'gacct_synthetic', listId: 'list-1' });
    expect(restored.syncStatus).toBe('queued');

    // Deletes are final on the server, so it returns as a new item, then is checked.
    const [add, check] = state.queue.map((entry) => entry.mutation);
    expect(add).toMatchObject({ operation: 'add', item: { name: 'Vinegar', quantity: '1/3', unit: 'cup', notes: 'cane', recipe_id: 'recipe-2', recipe_title: 'Adobo' } });
    expect(add.item_id).not.toBe('gone');
    expect(check).toMatchObject({ operation: 'set_checked', item_id: add.item_id, checked: true });
    expect(restored.items.find((entry: any) => entry.id === add.item_id)).toMatchObject({ name: 'Vinegar', checked: true });
  } finally { await act(async () => root.unmount()); }
});

it('does not bring a deleted item back on a different list or account', async () => {
  function Probe() { useRestoreGroceryItem(); return null; }
  const root = createRoot();
  try {
    await act(async () => root.render(<Probe />));
    const restore = state.mutationOptions[0];
    state.offline = true;
    const deleted = { id: 'gone', name: 'Vinegar', quantity: null, unit: null, notes: null, checked: false, recipe_id: null, recipe_title: null, added_by_name: null, created_at: '', updated_at: '' };
    await expect(restore.mutationFn({ item: deleted, accountScopeId: 'gacct_synthetic', listId: 'list-other' })).rejects.toBeInstanceOf(GroceryListChangedError);
    await expect(restore.mutationFn({ item: deleted, accountScopeId: 'gacct_other', listId: 'list-1' })).rejects.toBeInstanceOf(GroceryListChangedError);
    expect(state.queue).toEqual([]);
  } finally { await act(async () => root.unmount()); }
});
