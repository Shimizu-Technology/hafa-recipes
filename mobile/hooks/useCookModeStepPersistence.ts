import { useEffect, useState } from 'react';
import { cookModeStepKey, readCookModeStep, writeCookModeStep, currentCookModeScope } from '@/lib/cookModeProgress';
import { useRecipeOwnerGeneration } from './useOfflineLease';
import { assertRecipeScope } from '@/lib/recipeQueryScope';

export const COOK_MODE_STEP_KEY = cookModeStepKey;

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
  const generation = useRecipeOwnerGeneration();
  const scope = currentCookModeScope();
  const [restoredFor, setRestoredFor] = useState<string | null>(null);
  const isRestored = !!recipeId && restoredFor === recipeId;

  useEffect(() => {
    if (!recipeId || stepCount === 0 || restoredFor === recipeId) return;
    let cancelled = false;
    // A different recipe in the same screen instance starts from its own saved
    // step (or the first step), never the previous recipe's position.
    if (restoredFor !== null) setCurrentStepIndex(0);

    (async () => {
      try {
        const savedStep = await readCookModeStep(recipeId, scope);
        if (cancelled) return;
        assertRecipeScope(scope);
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
      if (!cancelled && scope === currentCookModeScope()) setRestoredFor(recipeId);
    })();

    return () => {
      cancelled = true;
    };
  }, [recipeId, stepCount, restoredFor, setCurrentStepIndex, generation]);

  useEffect(() => {
    if (!recipeId || !isRestored) return;
    writeCookModeStep(recipeId, currentStepIndex.toString(), scope).catch((error) => {
      console.warn('Failed to save cook mode step:', error);
    });
  }, [recipeId, isRestored, currentStepIndex, generation]);

  return { isRestored };
}
