import { formatQuantity, parseQuantity } from '@/lib/quantityPresentation';
import { useRecipeOwnerGeneration } from './useOfflineLease';
import { recipeScope } from '@/lib/recipeQueryScope';
/**
 * Hook for persisting scaled servings per recipe.
 * 
 * Stores the user's preferred serving size for each recipe,
 * so when they return to a recipe, the scaling is remembered.
 */

import type { QuantityEstimate } from '@/types/recipe';
import { useState, useEffect, useCallback, useRef } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

const SCALED_SERVINGS_KEY_PREFIX = 'scaled_servings_';
let writes: Promise<unknown> = Promise.resolve();
function commitServing(key: string, value: string | null, authority: string) {
  const run = async () => {
    if (authority !== recipeScope()) return;
    const previous = await AsyncStorage.getItem(key);
    if (authority !== recipeScope()) return;
    if (value === null) await AsyncStorage.removeItem(key); else await AsyncStorage.setItem(key, value);
    if (authority !== recipeScope() && await AsyncStorage.getItem(key) === value) {
      if (previous === null) await AsyncStorage.removeItem(key); else await AsyncStorage.setItem(key, previous);
    }
  };
  const result = writes.then(run); writes = result.catch(() => undefined); return result;
}

/**
 * Hook to manage persisted scaled servings for a specific recipe.
 */
export function useScaledServings(recipeId: string, originalServings: number) {
  const authority = useRecipeOwnerGeneration();
  const owner = JSON.parse(authority)[1] as string | null;
  const [selection, setSelection] = useState<{ recipeId: string; authority: string; servings: number | null }>({ recipeId, authority, servings: null });
  const [isLoading, setIsLoading] = useState(true);
  const editRevision = useRef(0);
  const storageKey = `${SCALED_SERVINGS_KEY_PREFIX}${encodeURIComponent(owner ?? 'guest')}:${recipeId}`;
  const scaledServings = selection.recipeId === recipeId && selection.authority === authority ? selection.servings : null;

  useEffect(() => {
    let cancelled = false;
    const revision = editRevision.current;
    setIsLoading(true);
    void AsyncStorage.getItem(storageKey).then(stored => {
      if (authority !== recipeScope() || cancelled || revision !== editRevision.current) return;
      const parsed = stored === null ? NaN : Number(stored);
      setSelection({ recipeId, authority, servings: Number.isInteger(parsed) && parsed > 0 ? parsed : null });
    }).catch(() => {
      // Storage is optional; use this recipe's original servings.
    }).finally(() => {
      if (!cancelled && authority === recipeScope()) setIsLoading(false);
    });
    return () => { cancelled = true; };
  }, [recipeId, storageKey, authority]);

  const setScaledServings = useCallback(async (servings: number | null) => {
    if (authority !== recipeScope()) return;
    editRevision.current += 1;
    const next = servings !== null && Number.isInteger(servings) && servings > 0 ? servings : null;
    setSelection({ recipeId, authority, servings: next });
    try {
      if (next === null || next === originalServings) {
        await commitServing(storageKey, null, authority);
      } else {
        await commitServing(storageKey, next.toString(), authority);
      }
    } catch {
      // Non-critical
    }
  }, [recipeId, storageKey, originalServings, authority]);

  const resetServings = useCallback(async () => {
    if (authority !== recipeScope()) return;
    editRevision.current += 1;
    setSelection({ recipeId, authority, servings: null });
    try {
      await commitServing(storageKey, null, authority);
    } catch {
      // Non-critical
    }
  }, [recipeId, storageKey, authority]);

  // Computed values
  const currentServings = scaledServings ?? originalServings;
  const scaleFactor = currentServings / originalServings;
  const isScaled = scaledServings !== null && scaledServings !== originalServings;

  return {
    scaledServings,
    setScaledServings,
    resetServings,
    currentServings,
    scaleFactor,
    isScaled,
    isLoading,
  };
}

/**
 * Utility to scale a quantity string by a factor.
 */
export function scaleQuantity(quantity: string | null, scaleFactor: number, unit?: string | null): string | null {
  if (!quantity) return quantity;
  const parsed = parseQuantity(quantity);
  if (parsed === null || !Number.isFinite(scaleFactor) || scaleFactor <= 0) return quantity;
  return formatQuantity(String(parsed * scaleFactor), unit);
}

/**
 * Scale an ingredient object with a given scale factor.
 */
export function scaleIngredient<T extends { unit?: string | null; quantity?: string | null; quantityEstimate?: QuantityEstimate | null; estimatedCost?: number | null }>(
  ingredient: T,
  scaleFactor: number
): T {
  if (scaleFactor === 1) return ingredient;
  
  return {
    ...ingredient,
    quantity: scaleStoredQuantity(ingredient.quantity ?? null, scaleFactor),
    ...(ingredient.quantityEstimate ? { quantityEstimate: {
      ...ingredient.quantityEstimate,
      quantity: scaleStoredQuantity(ingredient.quantityEstimate.quantity, scaleFactor)!,
    } } : {}),
    estimatedCost: ingredient.estimatedCost 
      ? ingredient.estimatedCost * scaleFactor 
      : ingredient.estimatedCost,
  };
}

function scaleStoredQuantity(quantity: string | null, factor: number): string | null {
  if (!quantity) return quantity;
  const value = parseQuantity(quantity);
  return value === null || !Number.isFinite(factor) || factor <= 0 ? quantity : String(Number((value * factor).toPrecision(12)));
}
