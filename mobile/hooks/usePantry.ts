import { useRecipeQueryClient as useQueryClient, useRecipeMutation as useMutation } from '@/hooks/useRecipeQuery';
import { useRecipeQuery as useQuery } from './useRecipeQuery';
import { replayPantryWrites, submitPantryWrite } from '@/lib/pantryWrites';
import { recipeScope, scopedRecipeKey } from '@/lib/recipeQueryScope';
import { useAuth } from '@clerk/expo';

import { api } from '@/lib/api';
import { assertGroceryStorageLease, getGroceryStorageLease } from '@/lib/offlineStorage';
import type { PantryItemFields, PantryTransferLine } from '@/types/pantry';

export const pantryKeys = {
  all: ['pantry'] as const,
  snapshot: (scope: 'active' | 'personal', userId: string | null | undefined) => scopedRecipeKey([...pantryKeys.all, scope, userId]),
};

export function usePantrySnapshot(scope: 'active' | 'personal' = 'active', enabled = true) {
  const { userId } = useAuth();
  return useQuery({
    queryKey: pantryKeys.snapshot(scope, userId),
    queryFn: async () => {
      const authority = recipeScope();
      await replayPantryWrites(authority);
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
    ) => submitPantryWrite('write', scope, input),
    onSuccess: (snapshot) => snapshot && queryClient.setQueryData(pantryKeys.snapshot(scope, userId), snapshot),
    onSettled: () => queryClient.invalidateQueries({ queryKey: pantryKeys.all }),
  });
}

export function useTransferGroceriesToPantry() {
  const queryClient = useQueryClient();
  const { userId } = useAuth();
  return useMutation({
    mutationFn: (items: PantryTransferLine[]) => submitPantryWrite('transfer', 'active', items),
    onSettled: () => queryClient.invalidateQueries({ queryKey: pantryKeys.all }),
  });
}

export function useCopyPersonalPantry() {
  const queryClient = useQueryClient();
  const { userId } = useAuth();
  return useMutation({
    mutationFn: () => submitPantryWrite('copy', 'active'),
    onSuccess: (snapshot) => snapshot && queryClient.setQueryData(pantryKeys.snapshot('active', userId), snapshot),
    onSettled: () => queryClient.invalidateQueries({ queryKey: pantryKeys.all }),
  });
}
