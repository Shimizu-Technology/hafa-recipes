import { useLayoutEffect, useMemo, useRef } from 'react';
import { Alert } from 'react-native';
import { useIsFocused } from 'expo-router';
import { useAuth } from '@clerk/expo';
import { useDeleteRecipe } from './useRecipes';

/** Keep the detail screen available until deletion is acknowledged, including on retry. */
export function useRecipeDeletion(id: string, onDeleted: () => void) {
  const { userId } = useAuth();
  const mutation = useDeleteRecipe();
  const focused = useIsFocused();
  const scope = useMemo(() => ({ id, userId, focused, busy: false }), [id, userId, focused]);
  const committed = useRef<typeof scope | null>(null);
  useLayoutEffect(() => {
    committed.current = scope;
    return () => { if (committed.current === scope) committed.current = null; };
  }, [scope]);
  const current = () => !!scope.userId && scope.focused && committed.current === scope;

  return () => {
    if (!current() || scope.busy || mutation.isPending) return;
    Alert.alert('Delete Recipe', 'Are you sure you want to delete this recipe? This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive', onPress: () => {
          if (!current() || scope.busy || mutation.isPending) return;
          scope.busy = true;
          mutation.mutate(scope.id, {
            onSuccess: () => { if (current()) onDeleted(); },
            onError: () => {
              if (current()) Alert.alert('Error', 'Failed to delete recipe. Please try again.');
            },
            onSettled: () => { scope.busy = false; },
          });
        },
      },
    ]);
  };
}
