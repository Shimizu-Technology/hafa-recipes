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
export function scaleQuantity(quantity: string | null, scaleFactor: number): string | null {
  if (!quantity || scaleFactor === 1) return quantity;
  
  const unicodeFractions: Record<string, number> = {
    '¼': 1 / 4, '½': 1 / 2, '¾': 3 / 4, '⅓': 1 / 3, '⅔': 2 / 3,
    '⅛': 1 / 8, '⅜': 3 / 8, '⅝': 5 / 8, '⅞': 7 / 8,
  };
  const input = quantity.trim();
  const fraction = input.match(/^(?:(\d+)\s+)?(\d+)\/(\d+)$/);
  const unicode = input.match(/^(\d+)?\s*([¼½¾⅓⅔⅛⅜⅝⅞])$/);
  const parsed = fraction && Number(fraction[3]) !== 0
    ? Number(fraction[1] || 0) + Number(fraction[2]) / Number(fraction[3])
    : unicode ? Number(unicode[1] || 0) + unicodeFractions[unicode[2]]
      : /^\d+(?:\.\d+)?$/.test(input) ? Number(input) : NaN;
  if (Number.isFinite(parsed) && Number.isFinite(scaleFactor) && scaleFactor > 0) {
    const scaled = parsed * scaleFactor;
    const fractions: Record<string, string> = {
      '0.13': '⅛', '0.25': '¼', '0.33': '⅓', '0.38': '⅜', '0.50': '½',
      '0.63': '⅝', '0.67': '⅔', '0.75': '¾', '0.88': '⅞',
    };
    return (scaled < 1 ? fractions[scaled.toFixed(2)] : null)
      || String(Number(scaled < 0.01 ? scaled.toPrecision(4) : scaled.toFixed(2)));
  }

  return quantity;
}

/**
 * Scale an ingredient object with a given scale factor.
 */
export function scaleIngredient<T extends { quantity?: string | null; quantityEstimate?: QuantityEstimate | null; estimatedCost?: number | null }>(
  ingredient: T,
  scaleFactor: number
): T {
  if (scaleFactor === 1) return ingredient;
  
  return {
    ...ingredient,
    quantity: scaleQuantity(ingredient.quantity ?? null, scaleFactor),
    ...(ingredient.quantityEstimate ? { quantityEstimate: {
      ...ingredient.quantityEstimate,
      quantity: scaleQuantity(ingredient.quantityEstimate.quantity, scaleFactor)!,
    } } : {}),
    estimatedCost: ingredient.estimatedCost 
      ? ingredient.estimatedCost * scaleFactor 
      : ingredient.estimatedCost,
  };
}
