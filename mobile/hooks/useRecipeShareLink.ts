import { useEffect } from 'react';
import { api } from '@/lib/api';
import { forgetRecipeLink, readStoredRecipeLink, storeRecipeLink, type StoredRecipeLink } from '@/lib/recipeLinkStore';
import { scopedRecipeKey } from '@/lib/recipeQueryScope';
import { useRecipeMutation as useMutation, useRecipeQuery as useQuery, useRecipeQueryClient as useQueryClient } from '@/hooks/useRecipeQuery';
import type { RecipeShareLinkStatus } from '@/types/recipe';

// Owner-scoped like every recipe query, so setQueryData reaches the queries the sheet observes.
export const recipeShareLinkKeys = {
  all: ['recipeShareLink'] as const,
  status: (recipeId: string) => scopedRecipeKey([...recipeShareLinkKeys.all, 'status', recipeId]),
  device: (recipeId: string) => scopedRecipeKey([...recipeShareLinkKeys.all, 'device', recipeId]),
  active: () => scopedRecipeKey([...recipeShareLinkKeys.all, 'active']),
};

function httpStatus(error: unknown): number | undefined {
  return (error as { response?: { status?: number } } | null)?.response?.status;
}

/**
 * The stored link is only usable while it is the server's current link. A link stored without a date
 * (an older API, and the follow-up status check failed) is adopted as the current one rather than
 * thrown away: discarding it would make the next Send replace a link people already have.
 */
export function usableStoredLink(status: RecipeShareLinkStatus | undefined, stored: StoredRecipeLink | null | undefined): string | null {
  if (!status?.active || !stored) return null;
  return stored.createdAt === null || stored.createdAt === status.created_at ? stored.url : null;
}

/**
 * Whether a status read after an older-API create describes a later link than the one just made: none
 * active, or created more than a second after the create response (the HTTP Date header has whole-second
 * precision). Without a server time, a dated status can't be checked and is accepted.
 */
export function replacedAfter(status: RecipeShareLinkStatus, respondedAt: string | null): boolean {
  if (!status.active) return true;
  const created = status.created_at ? Date.parse(status.created_at) : NaN;
  const responded = respondedAt ? Date.parse(respondedAt) : NaN;
  return Number.isFinite(created) && Number.isFinite(responded) && created > responded + 1000;
}

/** Owner-only unlisted link for a private recipe: status, the link kept on this phone, create, replace and turn off. */
export function useRecipeShareLink(recipeId: string, enabled: boolean) {
  const queryClient = useQueryClient();
  const owner = api.getAuthScope().userId;
  const statusKey = recipeShareLinkKeys.status(recipeId);
  const deviceKey = recipeShareLinkKeys.device(recipeId);
  const status = useQuery({
    queryKey: recipeShareLinkKeys.status(recipeId),
    queryFn: () => api.getRecipeShareLink(recipeId),
    enabled: enabled && !!owner,
    retry: (count: number, error: unknown) => count < 1 && ![403, 404, 503].includes(httpStatus(error) ?? 0),
  });
  const device = useQuery({
    queryKey: recipeShareLinkKeys.device(recipeId),
    queryFn: () => readStoredRecipeLink(recipeId),
    enabled: enabled && !!owner,
    staleTime: Infinity,
  });
  const url = usableStoredLink(status.data, device.data);

  useEffect(() => {
    if (!status.data || !device.data) return;
    if (!url) {
      // Turned off or replaced elsewhere: drop it so it can never be sent by mistake.
      void forgetRecipeLink(recipeId);
      queryClient.setQueryData(deviceKey, null);
    } else if (device.data.createdAt === null && status.data.created_at) {
      // Record the server's date for a link kept without one, so later checks match exactly.
      const dated = { url, createdAt: status.data.created_at };
      void storeRecipeLink(recipeId, dated);
      queryClient.setQueryData(deviceKey, dated);
    }
  }, [recipeId, status.data, device.data, url, queryClient, deviceKey]);

  const create = useMutation({
    mutationFn: async () => {
      const created = await api.createRecipeShareLink(recipeId);
      // Newer APIs (#690) date the link in the create response; older ones need the status check.
      const fresh: RecipeShareLinkStatus = created.created_at
        ? { active: true, created_at: created.created_at }
        : await api.getRecipeShareLink(recipeId).catch(() => ({ active: true, created_at: null }));
      if (!created.created_at && replacedAfter(fresh, created.responded_at)) {
        // Another phone replaced or turned off this link between our POST and GET, so this URL is
        // already dead. Pairing it with the newer date would make a dead link look current.
        throw Object.assign(new Error('The link changed on another device.'), { code: 'LINK_REPLACED_ELSEWHERE' });
      }
      const stored = { url: created.url, createdAt: fresh.created_at };
      await storeRecipeLink(recipeId, stored);
      return { fresh, stored };
    },
    onError: (error: unknown) => {
      // Show the other device's link as active, so the next Send offers to replace it.
      if ((error as { code?: string })?.code === 'LINK_REPLACED_ELSEWHERE') void queryClient.invalidateQueries({ queryKey: statusKey });
    },
    onSuccess: async ({ fresh, stored }: { fresh: RecipeShareLinkStatus; stored: StoredRecipeLink }) => {
      // An in-flight status fetch from before the create must not overwrite the new link's status.
      await queryClient.cancelQueries({ queryKey: statusKey });
      queryClient.setQueryData(deviceKey, stored);
      queryClient.setQueryData(statusKey, fresh);
      void queryClient.invalidateQueries({ queryKey: recipeShareLinkKeys.active() });
    },
  });

  const revoke = useRevokeRecipeLink();

  return {
    isLoading: status.isLoading || device.isLoading,
    /** Older API or a missing table: unlisted links can't be made yet. */
    isUnavailable: httpStatus(status.error) === 503,
    /** No status yet because the check failed: the sheet keeps Send and Copy off until it's known. */
    isError: !!status.error && !status.data && httpStatus(status.error) !== 503,
    refetch: status.refetch,
    active: status.data?.active === true,
    createdAt: status.data?.created_at ?? null,
    url,
    create,
    revoke: () => revoke.mutateAsync(recipeId),
    isRevoking: revoke.isPending,
  };
}

export type ActiveRecipeLink = { recipe: { id: string; title: string; thumbnail_url: string | null }; createdAt: string | null };

const LINKS_PAGE = 100;

/** Settings › Sharing links: every recipe the owner has an active link for, public or private, newest first. */
export async function findActiveRecipeLinks(): Promise<ActiveRecipeLink[]> {
  const links: ActiveRecipeLink[] = [];
  for (let offset = 0; ; offset += LINKS_PAGE) {
    const page = await api.listRecipeShareLinks(LINKS_PAGE, offset);
    links.push(...page.map(link => ({
      recipe: { id: link.recipe_id, title: link.title, thumbnail_url: link.thumbnail_url },
      createdAt: link.created_at,
    })));
    if (page.length < LINKS_PAGE) return links;
  }
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
  return useMutation({
    mutationFn: async (recipeId: string) => {
      await api.revokeRecipeShareLink(recipeId);
      await forgetRecipeLink(recipeId);
    },
    onSuccess: async (_: unknown, recipeId: string) => {
      await queryClient.cancelQueries({ queryKey: recipeShareLinkKeys.status(recipeId) });
      queryClient.setQueryData(recipeShareLinkKeys.device(recipeId), null);
      queryClient.setQueryData(recipeShareLinkKeys.status(recipeId), { active: false, created_at: null });
      queryClient.setQueryData(recipeShareLinkKeys.active(), (links: ActiveRecipeLink[] | undefined) =>
        links?.filter(link => link.recipe.id !== recipeId));
    },
  });
}
