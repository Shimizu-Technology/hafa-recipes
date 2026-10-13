import { useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

export const COOK_MODE_STEP_KEY = (recipeId: string) => `cook_mode_step_${recipeId}`;

/**
 * Restore and persist the cook-mode step for a recipe.
 *
 * Saving is held back until the saved step has been read for this recipe.
 * Otherwise the initial step (0) is written as soon as the screen mounts and
 * overwrites the saved progress before the recipe's steps finish loading.
 */
export function useCookModeStepPersistence(
  recipeId: string | undefined,
  stepCount: number,
  currentStepIndex: number,
  setCurrentStepIndex: (index: number) => void,
) {
  const [restoredFor, setRestoredFor] = useState<string | null>(null);
  const isRestored = !!recipeId && restoredFor === recipeId;

  useEffect(() => {
    if (!recipeId || stepCount === 0 || restoredFor === recipeId) return;
    let cancelled = false;

    (async () => {
      try {
        const savedStep = await AsyncStorage.getItem(COOK_MODE_STEP_KEY(recipeId));
        if (cancelled) return;
        if (savedStep !== null) {
          const stepIndex = parseInt(savedStep, 10);
          // Step 0 is the default, so only restore later valid steps.
          if (!Number.isNaN(stepIndex) && stepIndex > 0 && stepIndex < stepCount) {
            setCurrentStepIndex(stepIndex);
          }
        }
      } catch (error) {
        console.warn('Failed to load saved cook mode step:', error);
      }
      if (!cancelled) setRestoredFor(recipeId);
    })();

    return () => {
      cancelled = true;
    };
  }, [recipeId, stepCount, restoredFor, setCurrentStepIndex]);

  useEffect(() => {
    if (!recipeId || !isRestored) return;
    AsyncStorage.setItem(COOK_MODE_STEP_KEY(recipeId), currentStepIndex.toString()).catch((error) => {
      console.warn('Failed to save cook mode step:', error);
    });
  }, [recipeId, isRestored, currentStepIndex]);

  return { isRestored };
}
