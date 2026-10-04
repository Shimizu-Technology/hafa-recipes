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

/**
 * Hook to manage persisted scaled servings for a specific recipe.
 */
export function useScaledServings(recipeId: string, originalServings: number) {
  const [selection, setSelection] = useState<{ recipeId: string; servings: number | null }>({ recipeId, servings: null });
  const [isLoading, setIsLoading] = useState(true);
  const editRevision = useRef(0);
  const storageKey = `${SCALED_SERVINGS_KEY_PREFIX}${recipeId}`;
  const scaledServings = selection.recipeId === recipeId ? selection.servings : null;

  useEffect(() => {
    let cancelled = false;
    const revision = editRevision.current;
    setIsLoading(true);
    void AsyncStorage.getItem(storageKey).then(stored => {
      if (cancelled || revision !== editRevision.current) return;
      const parsed = stored === null ? NaN : Number(stored);
      setSelection({ recipeId, servings: Number.isInteger(parsed) && parsed > 0 ? parsed : null });
    }).catch(() => {
      // Storage is optional; use this recipe's original servings.
    }).finally(() => {
      if (!cancelled) setIsLoading(false);
    });
    return () => { cancelled = true; };
  }, [recipeId, storageKey]);

  const setScaledServings = useCallback(async (servings: number | null) => {
    editRevision.current += 1;
    const next = servings !== null && Number.isInteger(servings) && servings > 0 ? servings : null;
    setSelection({ recipeId, servings: next });
    try {
      if (next === null || next === originalServings) {
        await AsyncStorage.removeItem(storageKey);
      } else {
        await AsyncStorage.setItem(storageKey, next.toString());
      }
    } catch {
      // Non-critical
    }
  }, [recipeId, storageKey, originalServings]);

  const resetServings = useCallback(async () => {
    editRevision.current += 1;
    setSelection({ recipeId, servings: null });
    try {
      await AsyncStorage.removeItem(storageKey);
    } catch {
      // Non-critical
    }
  }, [recipeId, storageKey]);

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
