/**
 * Hook for persisting scaled servings per recipe.
 * 
 * Stores the user's preferred serving size for each recipe,
 * so when they return to a recipe, the scaling is remembered.
 */

import { useState, useEffect, useCallback } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

const SCALED_SERVINGS_KEY_PREFIX = 'scaled_servings_';

/**
 * Hook to manage persisted scaled servings for a specific recipe.
 */
export function useScaledServings(recipeId: string, originalServings: number) {
  const [scaledServings, setScaledServingsState] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const storageKey = `${SCALED_SERVINGS_KEY_PREFIX}${recipeId}`;

  // Load persisted value on mount
  useEffect(() => {
    loadPersistedServings();
  }, [recipeId]);

  const loadPersistedServings = async () => {
    setIsLoading(true);
    try {
      const stored = await AsyncStorage.getItem(storageKey);
      if (stored) {
        const parsed = parseInt(stored, 10);
        if (!isNaN(parsed) && parsed > 0) {
          setScaledServingsState(parsed);
        }
      }
    } catch {
      // Non-critical - use default
    } finally {
      setIsLoading(false);
    }
  };

  const setScaledServings = useCallback(async (servings: number | null) => {
    setScaledServingsState(servings);
    try {
      if (servings === null || servings === originalServings) {
        // Clear storage if reset to original
        await AsyncStorage.removeItem(storageKey);
      } else {
        await AsyncStorage.setItem(storageKey, servings.toString());
      }
    } catch {
      // Non-critical
    }
  }, [storageKey, originalServings]);

  const resetServings = useCallback(async () => {
    setScaledServingsState(null);
    try {
      await AsyncStorage.removeItem(storageKey);
    } catch {
      // Non-critical
    }
  }, [storageKey]);

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
  
  // Try to parse the quantity as a number or fraction
  const parsed = parseFloat(quantity);
  if (!isNaN(parsed)) {
    const scaled = parsed * scaleFactor;
    // Format nicely: show fractions for small numbers, decimals for larger
    if (scaled < 1) {
      // Convert to common fractions
      const fractions: Record<string, string> = {
        '0.25': '¼', '0.33': '⅓', '0.5': '½', '0.67': '⅔', '0.75': '¾',
      };
      const key = scaled.toFixed(2);
      return fractions[key] || scaled.toFixed(1);
    }
    return scaled % 1 === 0 ? scaled.toString() : scaled.toFixed(1);
  }
  
  // Handle fraction strings like "1/2", "3/4"
  const fractionMatch = quantity.match(/^(\d+)\/(\d+)$/);
  if (fractionMatch) {
    const numerator = parseInt(fractionMatch[1], 10);
    const denominator = parseInt(fractionMatch[2], 10);
    if (denominator !== 0) {
      const scaled = (numerator / denominator) * scaleFactor;
      if (scaled < 1) {
        const fractions: Record<string, string> = {
          '0.25': '¼', '0.33': '⅓', '0.5': '½', '0.67': '⅔', '0.75': '¾',
        };
        const key = scaled.toFixed(2);
        return fractions[key] || scaled.toFixed(2);
      }
      return scaled % 1 === 0 ? scaled.toString() : scaled.toFixed(1);
    }
  }
  
  return quantity;
}

/**
 * Scale an ingredient object with a given scale factor.
 */
export function scaleIngredient<T extends { quantity?: string | null; estimatedCost?: number | null }>(
  ingredient: T,
  scaleFactor: number
): T {
  if (scaleFactor === 1) return ingredient;
  
  return {
    ...ingredient,
    quantity: scaleQuantity(ingredient.quantity ?? null, scaleFactor),
    estimatedCost: ingredient.estimatedCost 
      ? ingredient.estimatedCost * scaleFactor 
      : ingredient.estimatedCost,
  };
}
