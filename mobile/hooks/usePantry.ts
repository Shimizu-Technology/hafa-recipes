import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { randomUUID } from 'expo-crypto';
import { useAuth } from '@clerk/expo';

import { api } from '@/lib/api';
import { assertGroceryStorageLease, getGroceryStorageLease } from '@/lib/offlineStorage';
import type { PantryItemFields, PantrySnapshot, PantryTransferLine } from '@/types/pantry';

export const pantryKeys = {
  all: ['pantry'] as const,
  snapshot: (scope: 'active' | 'personal', userId: string | null | undefined) => [...pantryKeys.all, scope, userId] as const,
};

let pantryWriteChain: Promise<unknown> = Promise.resolve();
function serializePantryWrite<T>(operation: () => Promise<T>): Promise<T> {
  const result = pantryWriteChain.then(operation, operation);
  pantryWriteChain = result.then(() => undefined, () => undefined);
  return result;
}

export function usePantrySnapshot(scope: 'active' | 'personal' = 'active', enabled = true) {
  const { userId } = useAuth();
  return useQuery({
    queryKey: pantryKeys.snapshot(scope, userId),
    queryFn: () => {
      const lease = getGroceryStorageLease();
      return api.getPantrySnapshot(scope, () => assertGroceryStorageLease(lease));
    },
    enabled: enabled && Boolean(userId),
    staleTime: 10_000,
    refetchOnMount: 'always',
  });
}

export function usePantryWrite(scope: 'active' | 'personal' = 'active') {
  const queryClient = useQueryClient();
  const { userId } = useAuth();
  return useMutation({
    mutationFn: (input:
      | { operation: 'add'; item: PantryItemFields }
      | { operation: 'update'; item_id: string; changes: Partial<PantryItemFields>; space_id: string; base_revision: number }
      | { operation: 'delete'; item_id: string; space_id: string; base_revision: number },
    ) => serializePantryWrite(async () => {
      const lease = getGroceryStorageLease();
      const guard = () => assertGroceryStorageLease(lease);
      const snapshot = await api.getPantrySnapshot(scope, guard);
      guard();
      if (input.operation !== 'add' && snapshot.space_id !== input.space_id) {
        throw new Error('Pantry scope changed; refresh before editing.');
      }
      const mutationId = randomUUID();
      const itemId = input.operation === 'add' ? randomUUID() : input.item_id;
      const request = {
        mutation_id: mutationId,
        space_id: input.operation === 'add' ? snapshot.space_id : input.space_id,
        scope,
        operation: input.operation,
        item_id: itemId,
        ...(input.operation === 'add' ? { item: input.item } : {}),
        ...(input.operation === 'update' ? { changes: input.changes } : {}),
        ...(input.operation !== 'add' ? { base_revision: input.base_revision } : {}),
      };
      const next = await api.syncPantryMutation(request, guard);
      guard();
      queryClient.setQueryData(pantryKeys.snapshot(scope, userId), next);
      return next;
    }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: pantryKeys.all }),
  });
}

export function useTransferGroceriesToPantry() {
  const queryClient = useQueryClient();
  const { userId } = useAuth();
  return useMutation({
    mutationFn: (items: PantryTransferLine[]) => serializePantryWrite(async () => {
      const lease = getGroceryStorageLease();
      const guard = () => assertGroceryStorageLease(lease);
      const snapshot = await api.getPantrySnapshot('active', guard);
      guard();
      if (!snapshot.list_id) throw new Error('Refresh your pantry and grocery list before transferring items.');
      let next = snapshot;
      for (let index = 0; index < items.length; index += 100) {
        next = await api.transferGroceriesToPantry({
          mutation_id: randomUUID(),
          space_id: snapshot.space_id,
          list_id: snapshot.list_id,
          items: items.slice(index, index + 100),
        }, guard);
        guard();
        queryClient.setQueryData(pantryKeys.snapshot('active', userId), next);
      }
      guard();
      return next;
    }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: pantryKeys.all }),
  });
}

export function useCopyPersonalPantry() {
  const queryClient = useQueryClient();
  const { userId } = useAuth();
  return useMutation({
    mutationFn: () => serializePantryWrite(async () => {
      const lease = getGroceryStorageLease();
      const guard = () => assertGroceryStorageLease(lease);
      const snapshot: PantrySnapshot = await api.getPantrySnapshot('active', guard);
      guard();
      if (snapshot.scope !== 'household') throw new Error('A shared household pantry is not active.');
      const result = await api.copyPersonalPantryToHousehold({
        mutation_id: randomUUID(),
        space_id: snapshot.space_id,
      }, guard);
      guard();
      return result;
    }),
    onSuccess: (snapshot) => queryClient.setQueryData(pantryKeys.snapshot('active', userId), snapshot),
    onSettled: () => queryClient.invalidateQueries({ queryKey: pantryKeys.all }),
  });
}
