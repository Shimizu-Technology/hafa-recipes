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
