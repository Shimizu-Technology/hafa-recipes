import { api } from '@/lib/api';
import { useEffect, useState } from 'react';
import { offlineRecipes, type OfflineRecipe } from '@/lib/offlineRecipes';
import type { Recipe } from '@/types/recipe';
import { canRetainRecipeOnError } from '@/lib/recipeDetailPresentation';

export function useOfflineRecipe(id: string, subject: string | null | undefined, live: Recipe | undefined, error: unknown, canVerify: boolean, refetch: () => Promise<unknown>) {
  const lease = offlineRecipes.lease(subject);
  const scope = lease ? `${lease.owner}:${lease.generation}:${id}` : null;
  const [cached, setCached] = useState<{ scope: string | null; row: OfflineRecipe | null }>({ scope: null, row: null });
  const allowed = !error || canRetainRecipeOnError(error);
  useEffect(() => {
    let active = true;
    if (!subject || !allowed) { setCached({ scope, row: null }); return; }
    void (async () => {
      let currentLease = lease;
      if (!currentLease && live && canVerify) {
        await api.getCurrentUserIdentity();
        currentLease = offlineRecipes.lease(subject);
        if (currentLease && active) await refetch();
      }
      if (!currentLease || !active) return;
      if (live && canVerify) {
        if (!live.is_owner) await api.checkRecipeSaved(id).catch(() => undefined);
      }
      const row = await offlineRecipes.read(currentLease, id);
      if (active) setCached({ scope: `${currentLease.owner}:${currentLease.generation}:${id}`, row });
    })().catch(() => { if (active) setCached({ scope, row: null }); });
    return () => { active = false; };
  }, [scope, subject, live, allowed, canVerify, refetch]);
  const row = allowed && scope && cached.scope === scope ? cached.row : null;
  return { recipe: row?.recipe, savedAt: row?.savedAt, loading: Boolean(scope && cached.scope !== scope), allowed };
}
