import type { QueryClient, QueryKey } from '@tanstack/react-query';
import { offlineRecipes } from './offlineRecipes';
import { CaptureAccountChangedError } from './captureAccount';

const clients = new WeakSet<QueryClient>();
/** Retire memory before notifying mounted observers or starting disk cleanup. */
export function bindRecipeQueryClient(client: QueryClient) {
  if (clients.has(client)) return;
  clients.add(client);
  offlineRecipes.onRetire(() => {
    void client.cancelQueries();
    client.clear();
  });
}
export const recipeScope = () => offlineRecipes.scope();
export const assertRecipeScope = (scope: string) => {
  if (scope !== recipeScope()) throw new CaptureAccountChangedError();
};
const marker = 'recipe-owner-generation';
/** Keep family prefixes usable for invalidation; exact keys carry authority. */
export function scopedRecipeKey<T extends QueryKey>(key: T): QueryKey {
  return key.includes(marker) ? key : [...key, marker, recipeScope()];
}
export function isCurrentRecipeKey(key: QueryKey) {
  const position = key.indexOf(marker);
  return position >= 0 && key[position + 1] === recipeScope();
}

/** A cancellable operation owns its original authority until it settles. */
export function recipeOperation(scope = recipeScope(), discard?: () => void) {
  const controller = new AbortController();
  const cancel = () => { controller.abort(); discard?.(); };
  const unsubscribe = offlineRecipes.onRetire(cancel);
  return {
    signal: controller.signal, cancel,
    assert() {
      if (controller.signal.aborted) throw new CaptureAccountChangedError();
      assertRecipeScope(scope);
    },
    release: unsubscribe,
  };
}

/** Guard every client access, including continuations after a callback yields. */
export function ownerQueryClient(client: QueryClient, scope: string): QueryClient {
  return new Proxy(client, { get(target, property) {
    const value = Reflect.get(target, property);
    if (typeof value !== 'function') return value;
    return (...args: any[]) => {
      assertRecipeScope(scope);
      if (Array.isArray(args[0]) && args[0].includes(marker) && args[0][args[0].indexOf(marker) + 1] !== scope) throw new CaptureAccountChangedError();
      if (['getQueriesData', 'setQueriesData', 'invalidateQueries', 'cancelQueries', 'removeQueries', 'refetchQueries'].includes(String(property))) {
        const filter = args[0] || {};
        args[0] = { ...filter, predicate: (query: { queryKey: QueryKey }) => {
          const index = query.queryKey.indexOf(marker);
          return (index < 0 || query.queryKey[index + 1] === scope) && (!filter.predicate || filter.predicate(query));
        } };
      }
      return value.apply(target, args);
    };
  } });
}
