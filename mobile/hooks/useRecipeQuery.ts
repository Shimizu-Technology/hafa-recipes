import { CaptureAccountChangedError } from '@/lib/captureAccount';
import { useAuth } from '@clerk/expo';
import { api } from '@/lib/api';
import { useQuery as useRawQuery, useInfiniteQuery as useRawInfiniteQuery, useQueryClient as useRawQueryClient, useMutation as useRawMutation } from '@tanstack/react-query';
import { useMemo, useSyncExternalStore } from 'react';
import { offlineRecipes } from '@/lib/offlineRecipes';
import { assertRecipeScope, bindRecipeQueryClient, recipeScope, scopedRecipeKey, recipeOperation, ownerQueryClient } from '@/lib/recipeQueryScope';

export function useRecipeQueryClient() {
  const client = useRawQueryClient();
  const scope = useSyncExternalStore(offlineRecipes.subscribe, recipeScope, recipeScope);
  bindRecipeQueryClient(client);
  return useMemo(() => ownerQueryClient(client, scope), [client, scope]);
}

/** The request and its result belong to the authority captured at render time. */
function useScopedOptions(options: any) {
  const client = useRawQueryClient();
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
  // Capture at render/creation, never when a retained action is invoked later.
  const scope = useSyncExternalStore(offlineRecipes.subscribe, recipeScope, recipeScope);
  const client = useRawQueryClient();
  bindRecipeQueryClient(client);
  const wrap = (name: string) => options[name] && ((...args: any[]) => {
    const index = name === 'onMutate' ? 0 : name === 'onSettled' ? 2 : 1;
    const intent = args[index];
    if (intent.scope !== recipeScope() || intent.operation.signal.aborted) return;
    args[index] = intent.variables;
    const result = options[name](...args);
    return Promise.resolve(result).then(value => { intent.operation.assert(); return value; });
  });
  const mutation = useRawMutation<any, Error, { variables: any; scope: string }, any>({ ...options,
    retry: (count: number, error: Error) => {
      if (error instanceof CaptureAccountChangedError || scope !== recipeScope()) return false;
      const policy = options.retry ?? client.getDefaultOptions().mutations?.retry ?? false;
      return typeof policy === 'function' ? policy(count, error) : policy === true || typeof policy === 'number' && count < policy;
    },
    mutationFn: async (intent: any, context: any) => {
      intent.operation.assert();
      try {
        const result = await options.mutationFn(intent.variables, context);
        intent.operation.assert();
        return result;
      } catch (error) { intent.operation.assert(); throw error; }
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
      if (scope !== recipeScope()) return;
      const intent: any = { variables, scope };
      intent.operation = recipeOperation(scope, () => { intent.variables = undefined; });
      void mutation.mutateAsync(intent, callbacks(intent, options)).catch(() => undefined).finally(intent.operation.release);
    },
    mutateAsync: (variables: any, options: any) => {
      try { assertRecipeScope(scope); } catch (error) { return Promise.reject(error); }
      const intent: any = { variables, scope };
      intent.operation = recipeOperation(scope, () => { intent.variables = undefined; });
      return mutation.mutateAsync(intent, callbacks(intent, options)).finally(intent.operation.release);
    },
  };
}) as typeof useRawMutation;
