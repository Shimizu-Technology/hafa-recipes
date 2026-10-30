import { useAuth } from '@clerk/expo';
import { api } from '@/lib/api';
import { useQuery as useRawQuery, useInfiniteQuery as useRawInfiniteQuery, useQueryClient, useMutation as useRawMutation } from '@tanstack/react-query';
import { useSyncExternalStore } from 'react';
import { offlineRecipes } from '@/lib/offlineRecipes';
import { assertRecipeScope, bindRecipeQueryClient, recipeScope, scopedRecipeKey } from '@/lib/recipeQueryScope';

/** The request and its result belong to the authority captured at render time. */
function useScopedOptions(options: any) {
  const client = useQueryClient();
  bindRecipeQueryClient(client);
  const scope = useSyncExternalStore(offlineRecipes.subscribe, recipeScope, recipeScope);
  const { userId, isLoaded } = useAuth();
  const lease = offlineRecipes.lease(userId);
  useRawQuery({ queryKey: ['currentUserIdentity', userId, scope], queryFn: () => api.getCurrentUserIdentity(),
    enabled: isLoaded && !!userId && !lease, staleTime: Infinity });
  const allowed = isLoaded && (!userId || !!lease);
  const queryFn = options.queryFn;
  return { ...options, enabled: allowed && options.enabled !== false, queryKey: scopedRecipeKey(options.queryKey),
    // A previous observer's placeholder must never bridge an account boundary.
    placeholderData: undefined,
    queryFn: async (context: any) => {
      assertRecipeScope(scope);
      const data = await queryFn(context);
      assertRecipeScope(scope);
      return data;
    },
  };
}
// Preserve TanStack's overloads/inference for all existing recipe hooks.
export const useRecipeQuery: typeof useRawQuery = ((options: any) => useRawQuery(useScopedOptions(options))) as typeof useRawQuery;
export const useRecipeInfiniteQuery: typeof useRawInfiniteQuery = ((options: any) => useRawInfiniteQuery(useScopedOptions(options))) as typeof useRawInfiniteQuery;

/** Late mutations must not publish or roll back private data into a new owner. */
export const useRecipeMutation: typeof useRawMutation = ((options: any) => {
  const wrap = (name: string) => options[name] && ((...args: any[]) => {
    const index = name === 'onMutate' ? 0 : name === 'onSettled' ? 2 : 1;
    const intent = args[index];
    if (intent.scope !== recipeScope()) return;
    args[index] = intent.variables;
    return options[name](...args);
  });
  const mutation = useRawMutation<any, Error, { variables: any; scope: string }, any>({ ...options,
    mutationFn: async (intent: any, context: any) => {
      assertRecipeScope(intent.scope);
      const result = await options.mutationFn(intent.variables, context);
      assertRecipeScope(intent.scope);
      return result;
    },
    onMutate: wrap('onMutate'), onSuccess: wrap('onSuccess'), onError: wrap('onError'), onSettled: wrap('onSettled'),
  });
  const callbacks = (intent: any, options: any) => options && Object.fromEntries(
    Object.entries(options).map(([name, callback]: any) => [name, (...args: any[]) => {
      if (intent.scope !== recipeScope()) return;
      args[name === 'onSettled' ? 2 : 1] = intent.variables;
      return callback(...args);
    }]),
  );
  return { ...mutation, variables: (mutation.variables as any)?.variables,
    mutate: (variables: any, options: any) => {
      const intent = { variables, scope: recipeScope() };
      return mutation.mutate(intent, callbacks(intent, options));
    },
    mutateAsync: (variables: any, options: any) => {
      const intent = { variables, scope: recipeScope() };
      return mutation.mutateAsync(intent, callbacks(intent, options));
    },
  };
}) as typeof useRawMutation;
