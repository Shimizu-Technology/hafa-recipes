import * as Crypto from 'expo-crypto';

import type {
  GroceryItem,
  GroceryItemChanges,
  GroceryItemCreate,
  GroceryMutationRequest,
  GrocerySnapshot,
} from '@/types/recipe';

function orderedItems(items: GroceryItem[]): GroceryItem[] {
  return [...items].sort((left, right) => {
    if (left.checked !== right.checked) return left.checked ? 1 : -1;
    const createdOrder = right.created_at.localeCompare(left.created_at);
    return createdOrder || left.id.localeCompare(right.id);
  });
}

function withCounts(snapshot: GrocerySnapshot, items: GroceryItem[]): GrocerySnapshot {
  const ordered = orderedItems(items);
  const checked = ordered.filter((item) => item.checked).length;
  return {
    ...snapshot,
    items: ordered,
    total: ordered.length,
    checked,
    unchecked: ordered.length - checked,
  };
}

export function applyOptimisticGroceryMutation(
  snapshot: GrocerySnapshot,
  mutation: GroceryMutationRequest,
  now = new Date().toISOString(),
): GrocerySnapshot {
  if (snapshot.list.id !== mutation.list_id) {
    throw new Error('Grocery list scope changed; refresh before making changes.');
  }

  if (mutation.operation === 'add') {
    if (!mutation.item) throw new Error('Add mutation is missing item data.');
    if (snapshot.items.some((item) => item.id === mutation.item_id)) return snapshot;
    return withCounts(snapshot, [
      {
        id: mutation.item_id,
        name: mutation.item.name,
        quantity: mutation.item.quantity ?? null,
        unit: mutation.item.unit ?? null,
        notes: mutation.item.notes ?? null,
        checked: false,
        recipe_id: mutation.item.recipe_id ?? null,
        recipe_title: mutation.item.recipe_title ?? null,
        added_by_name: null,
        created_at: now,
        updated_at: now,
      },
      ...snapshot.items,
    ]);
  }

  if (mutation.operation === 'update') {
    if (!mutation.changes) throw new Error('Update mutation is missing changes.');
    return withCounts(
      snapshot,
      snapshot.items.map((item) =>
        item.id === mutation.item_id
          ? { ...item, ...mutation.changes, updated_at: now }
          : item,
      ),
    );
  }

  if (mutation.operation === 'set_checked') {
    if (mutation.checked === undefined) {
      throw new Error('Checked mutation is missing the desired state.');
    }
    const desiredCheckedState = mutation.checked;
    return withCounts(
      snapshot,
      snapshot.items.map((item) =>
        item.id === mutation.item_id
          ? { ...item, checked: desiredCheckedState, updated_at: now }
          : item,
      ),
    );
  }

  return withCounts(
    snapshot,
    snapshot.items.filter((item) => item.id !== mutation.item_id),
  );
}

export function createAddMutation(
  listId: string,
  item: GroceryItemCreate,
): GroceryMutationRequest {
  return {
    mutation_id: Crypto.randomUUID(),
    operation: 'add',
    list_id: listId,
    item_id: Crypto.randomUUID(),
    item,
  };
}

export function createUpdateMutation(
  listId: string,
  itemId: string,
  changes: GroceryItemChanges,
): GroceryMutationRequest {
  return {
    mutation_id: Crypto.randomUUID(),
    operation: 'update',
    list_id: listId,
    item_id: itemId,
    changes,
  };
}

export function createCheckedMutation(
  listId: string,
  itemId: string,
  checked: boolean,
): GroceryMutationRequest {
  return {
    mutation_id: Crypto.randomUUID(),
    operation: 'set_checked',
    list_id: listId,
    item_id: itemId,
    checked,
  };
}

export function createDeleteMutation(
  listId: string,
  itemId: string,
): GroceryMutationRequest {
  return {
    mutation_id: Crypto.randomUUID(),
    operation: 'delete',
    list_id: listId,
    item_id: itemId,
  };
}

export function isRetryableGroceryError(error: unknown): boolean {
  const status = (error as { response?: { status?: number } })?.response?.status;
  return status === undefined || status === 408 || status === 429 || status >= 500;
}

export async function sendGroceryMutationWithRetry<T>(
  mutation: GroceryMutationRequest,
  send: (request: GroceryMutationRequest) => Promise<T>,
): Promise<T> {
  try {
    return await send(mutation);
  } catch (error) {
    if (!isRetryableGroceryError(error)) throw error;
    return send(mutation);
  }
}
