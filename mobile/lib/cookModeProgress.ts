import AsyncStorage from '@react-native-async-storage/async-storage';
import { offlineRecipes } from './offlineRecipes';
import { assertRecipeScope, recipeScope } from './recipeQueryScope';

let tail: Promise<unknown> = Promise.resolve();
const run = <T,>(job: () => Promise<T>) => { const next = tail.then(job); tail = next.catch(() => undefined); return next; };
export const cookModeStepKey = (id: string) => {
  const generation = offlineRecipes.ownerGeneration();
  return `cook_mode_step_${generation ? encodeURIComponent(generation) + ':' : ''}${id}`;
};
export function readCookModeStep(id: string, scope: string) {
  const key = cookModeStepKey(id);
  return run(async () => { assertRecipeScope(scope); const value = await AsyncStorage.getItem(key); assertRecipeScope(scope); return value; });
}
export function writeCookModeStep(id: string, value: string | null, scope: string) {
  // Freeze the key as well as authority before joining the serialized queue.
  const key = cookModeStepKey(id);
  return run(async () => {
    assertRecipeScope(scope);
    if (value === null) await AsyncStorage.removeItem(key); else await AsyncStorage.setItem(key, value);
    assertRecipeScope(scope);
  });
}
offlineRecipes.onRetire(previous => {
  if (!previous) return;
  void run(async () => {
    const keys = (await AsyncStorage.getAllKeys()).filter(key => key.startsWith('cook_mode_step_'));
    if (keys.length) await AsyncStorage.multiRemove(keys);
  }).catch(() => undefined);
});
export const currentCookModeScope = recipeScope;
