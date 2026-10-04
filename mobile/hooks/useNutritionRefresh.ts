import { useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { getApiErrorMessage } from '@/lib/apiErrorMessage';

const FALLBACK = 'Nutrition could not be estimated. Check the ingredient amounts and try again.';

/** Keep provider failures renderable and scoped to the recipe/account requesting them. */
export function useNutritionRefresh(recipeId: string | undefined, contentRevision: number | null | undefined,
  ownerKey: string | null | undefined, refetch: () => Promise<unknown>) {
  const key = JSON.stringify([recipeId, ownerKey, contentRevision]);
  const current = useRef({ key, mounted: true });
  current.current.key = key;
  const busy = useRef<string | null>(null);
  const generation = useRef(0);
  const [isRefreshingNutrition, setIsRefreshingNutrition] = useState(false);
  const [nutritionError, setNutritionError] = useState<string | null>(null);
  useEffect(() => {
    current.current.mounted = true;
    return () => { current.current.mounted = false; };
  }, []);
  useEffect(() => {
    generation.current += 1;
    busy.current = null;
    setIsRefreshingNutrition(false);
    setNutritionError(null);
  }, [key]);

  const refreshNutrition = async () => {
    if (!recipeId || !ownerKey || busy.current === key) return;
    const requestedGeneration = generation.current;
    const isCurrent = () => current.current.mounted && current.current.key === key && generation.current === requestedGeneration;
    if (!isCurrent()) return;
    busy.current = key;
    setIsRefreshingNutrition(true);
    setNutritionError(null);
    try {
      await api.refreshRecipeNutrition(recipeId, contentRevision ?? undefined);
      if (!isCurrent()) return;
      await refetch();
    } catch (error: unknown) {
      if (isCurrent()) setNutritionError(getApiErrorMessage(error, FALLBACK));
    } finally {
      if (isCurrent()) {
        busy.current = null;
        setIsRefreshingNutrition(false);
      }
    }
  };
  return { isRefreshingNutrition, nutritionError, refreshNutrition };
}
