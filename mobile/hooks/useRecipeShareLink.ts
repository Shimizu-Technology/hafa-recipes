import { useEffect } from 'react';
import { api } from '@/lib/api';
import { forgetRecipeLink, readStoredRecipeLink, storeRecipeLink, type StoredRecipeLink } from '@/lib/recipeLinkStore';
import { useRecipeMutation as useMutation, useRecipeQuery as useQuery, useRecipeQueryClient as useQueryClient } from '@/hooks/useRecipeQuery';
import type { RecipeListItem, RecipeShareLinkStatus } from '@/types/recipe';

export const recipeShareLinkKeys = {
  all: ['recipeShareLink'] as const,
  status: (recipeId: string) => [...recipeShareLinkKeys.all, 'status', recipeId] as const,
  device: (recipeId: string) => [...recipeShareLinkKeys.all, 'device', recipeId] as const,
  active: () => [...recipeShareLinkKeys.all, 'active'] as const,
};

function httpStatus(error: unknown): number | undefined {
  return (error as { response?: { status?: number } } | null)?.response?.status;
}

/** The stored link is only usable while it is the server's current link. */
export function usableStoredLink(status: RecipeShareLinkStatus | undefined, stored: StoredRecipeLink | null | undefined): string | null {
  if (!status?.active || !stored) return null;
  return stored.createdAt === status.created_at ? stored.url : null;
}

/** Owner-only unlisted link for a private recipe: status, the link kept on this phone, create, replace and turn off. */
export function useRecipeShareLink(recipeId: string, enabled: boolean) {
  const queryClient = useQueryClient();
  const owner = api.getAuthScope().userId;
  const status = useQuery({
    queryKey: recipeShareLinkKeys.status(recipeId),
    queryFn: () => api.getRecipeShareLink(recipeId),
    enabled: enabled && !!owner,
    retry: (count: number, error: unknown) => count < 1 && ![403, 404, 503].includes(httpStatus(error) ?? 0),
  });
  const device = useQuery({
    queryKey: recipeShareLinkKeys.device(recipeId),
    queryFn: () => (owner ? readStoredRecipeLink(owner, recipeId) : null),
    enabled: enabled && !!owner,
    staleTime: Infinity,
  });
  const url = usableStoredLink(status.data, device.data);

  // Drop a link that was turned off or replaced elsewhere, so it can never be sent by mistake.
  useEffect(() => {
    if (!owner || !status.data || !device.data || url) return;
    void forgetRecipeLink(owner, recipeId);
    queryClient.setQueryData(recipeShareLinkKeys.device(recipeId), null);
  }, [owner, recipeId, status.data, device.data, url, queryClient]);

  const create = useMutation({
    mutationFn: async () => {
      const { url: created } = await api.createRecipeShareLink(recipeId);
      const fresh = await api.getRecipeShareLink(recipeId).catch(() => ({ active: true, created_at: null }));
      const stored = { url: created, createdAt: fresh.created_at };
      if (owner) await storeRecipeLink(owner, recipeId, stored);
      return { fresh, stored };
    },
    onSuccess: ({ fresh, stored }: { fresh: RecipeShareLinkStatus; stored: StoredRecipeLink }) => {
      queryClient.setQueryData(recipeShareLinkKeys.device(recipeId), stored);
      queryClient.setQueryData(recipeShareLinkKeys.status(recipeId), fresh);
      void queryClient.invalidateQueries({ queryKey: recipeShareLinkKeys.active() });
    },
  });

  const revoke = useRevokeRecipeLink();

  return {
    isLoading: status.isLoading || device.isLoading,
    /** Older API or a missing table: unlisted links can't be made yet. */
    isUnavailable: httpStatus(status.error) === 503,
    isError: !!status.error && httpStatus(status.error) !== 503,
    refetch: status.refetch,
    active: status.data?.active === true,
    createdAt: status.data?.created_at ?? null,
    url,
    create,
    revoke: () => revoke.mutateAsync(recipeId),
    isRevoking: revoke.isPending,
  };
}

export type ActiveRecipeLink = { recipe: RecipeListItem; createdAt: string | null };

async function mapLimit<T, R>(items: T[], limit: number, run: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await run(items[index]);
    }
  }));
  return results;
}

/**
 * Settings › Sharing links. The API has a per-recipe status endpoint only, so this checks each of the
 * owner's recipes a few at a time. A list endpoint would replace this (reported as an API gap).
 */
export async function findActiveRecipeLinks(): Promise<ActiveRecipeLink[]> {
  const owned: RecipeListItem[] = [];
  for (let offset = 0; ; ) {
    const page = await api.getRecipes(100, offset);
    owned.push(...page.items.filter(item => item.is_owner !== false));
    offset += page.items.length;
    if (!page.has_more || page.items.length === 0) break;
  }
  const statuses = await mapLimit(owned, 4, recipe => api.getRecipeShareLink(recipe.id)
    .then(status => ({ recipe, status }), error => {
      if (httpStatus(error) === 404) return { recipe, status: { active: false, created_at: null } };
      throw error;
    }));
  return statuses.filter(({ status }) => status.active).map(({ recipe, status }) => ({ recipe, createdAt: status.created_at }));
}

export function useActiveRecipeLinks(enabled: boolean) {
  return useQuery({
    queryKey: recipeShareLinkKeys.active(),
    queryFn: findActiveRecipeLinks,
    enabled,
    retry: (count: number, error: unknown) => count < 1 && httpStatus(error) !== 503,
  });
}

/** Turn off a link from Settings, forgetting the copy kept on this phone. */
export function useRevokeRecipeLink() {
  const queryClient = useQueryClient();
  const owner = api.getAuthScope().userId;
  return useMutation({
    mutationFn: async (recipeId: string) => {
      await api.revokeRecipeShareLink(recipeId);
      if (owner) await forgetRecipeLink(owner, recipeId);
    },
    onSuccess: (_: unknown, recipeId: string) => {
      queryClient.setQueryData(recipeShareLinkKeys.device(recipeId), null);
      queryClient.setQueryData(recipeShareLinkKeys.status(recipeId), { active: false, created_at: null });
      queryClient.setQueryData(recipeShareLinkKeys.active(), (links: ActiveRecipeLink[] | undefined) =>
        links?.filter(link => link.recipe.id !== recipeId));
    },
  });
}
