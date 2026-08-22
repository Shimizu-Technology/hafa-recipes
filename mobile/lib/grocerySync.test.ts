import { beforeEach, describe, expect, it, vi } from 'vitest';

const randomUUID = vi.hoisted(() => vi.fn());
vi.mock('expo-crypto', () => ({ randomUUID }));

import {
  applyOptimisticGroceryMutation,
  createAddMutation,
  createCheckedMutation,
  createDeleteMutation,
  sendGroceryMutationWithRetry,
} from './grocerySync';
import type { GroceryMutationRequest, GrocerySnapshot } from '../types/recipe';

function snapshot(): GrocerySnapshot {
  return {
    account_scope_id: 'account-scope-a',
    list: {
      id: 'list-a',
      name: 'My Grocery List',
      is_shared: false,
      members: [],
      revision: 3,
      created_at: '2026-08-20T00:00:00Z',
      updated_at: '2026-08-20T00:00:00Z',
    },
    items: [
      {
        id: 'item-a',
        name: 'Milk',
        quantity: null,
        unit: null,
        notes: null,
        checked: false,
        recipe_id: null,
        recipe_title: null,
        added_by_name: null,
        created_at: '2026-08-20T00:00:00Z',
        updated_at: '2026-08-20T00:00:00Z',
      },
    ],
    total: 1,
    checked: 0,
    unchecked: 1,
    server_time: '2026-08-20T00:00:00Z',
  };
}

describe('durable grocery mutations', () => {
  beforeEach(() => randomUUID.mockReset());

  it('uses stable client IDs for an optimistic add', () => {
    randomUUID.mockReturnValueOnce('mutation-add').mockReturnValueOnce('item-add');
    const mutation = createAddMutation('list-a', { name: 'Eggs' });
    const result = applyOptimisticGroceryMutation(snapshot(), mutation, '2026-08-21T00:00:00Z');

    expect(mutation).toMatchObject({ mutation_id: 'mutation-add', item_id: 'item-add' });
    expect(result.items[0]).toMatchObject({ id: 'item-add', name: 'Eggs', checked: false });
    expect(result).toMatchObject({ total: 2, checked: 0, unchecked: 2 });
  });

  it('sets a desired checked state idempotently instead of toggling', () => {
    randomUUID.mockReturnValue('mutation-check');
    const mutation = createCheckedMutation('list-a', 'item-a', true);
    const once = applyOptimisticGroceryMutation(snapshot(), mutation);
    const twice = applyOptimisticGroceryMutation(once, mutation);

    expect(once.items[0].checked).toBe(true);
    expect(twice.items[0].checked).toBe(true);
    expect(twice).toMatchObject({ checked: 1, unchecked: 0 });
  });

  it('treats deleting an already absent item as safe', () => {
    randomUUID.mockReturnValue('mutation-delete');
    const result = applyOptimisticGroceryMutation(
      snapshot(),
      createDeleteMutation('list-a', 'missing-item'),
    );
    expect(result.items).toHaveLength(1);
  });

  it('refuses to apply a mutation from another list scope', () => {
    randomUUID.mockReturnValue('mutation-other');
    expect(() =>
      applyOptimisticGroceryMutation(snapshot(), createDeleteMutation('list-b', 'item-a')),
    ).toThrow('scope changed');
  });

  it('retries a transient failure with the exact same mutation object', async () => {
    const mutation = { mutation_id: 'same-id' } as GroceryMutationRequest;
    const send = vi.fn().mockRejectedValueOnce(new Error('timeout')).mockResolvedValueOnce('ok');

    await expect(sendGroceryMutationWithRetry(mutation, send)).resolves.toBe('ok');
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[0][0]).toBe(mutation);
    expect(send.mock.calls[1][0]).toBe(mutation);
  });

  it('does not retry a permanent API rejection', async () => {
    const mutation = { mutation_id: 'bad-request' } as GroceryMutationRequest;
    const error = { response: { status: 409 } };
    const send = vi.fn().mockRejectedValue(error);

    await expect(sendGroceryMutationWithRetry(mutation, send)).rejects.toBe(error);
    expect(send).toHaveBeenCalledOnce();
  });
});
