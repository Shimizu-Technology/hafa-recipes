import type { Collection } from '@/types/recipe';

/** Resolve a recipe's collection IDs against the user's canonical collection list. */
export function collectionsContainingRecipe(
  collections: readonly Collection[] | undefined,
  collectionIds: readonly string[] | undefined,
): Collection[] {
  if (!collections?.length || !collectionIds?.length) return [];
  const includedIds = new Set(collectionIds);
  return collections.filter((collection) => includedIds.has(collection.id));
}
