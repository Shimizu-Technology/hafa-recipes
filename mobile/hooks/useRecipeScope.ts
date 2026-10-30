import { useEffect, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

export type RecipeScope = 'library' | 'discover';
export const recipeScopeKey = (owner: string) => `hafa_recipe_scope_v1:${encodeURIComponent(owner)}`;
export const validRecipeScope = (value: unknown): value is RecipeScope => value === 'library' || value === 'discover';

/** Stable application identity scopes this preference; guests start in Discover. */
export function useRecipeScope(owner: string | null, requested?: string) {
  const [state, setState] = useState<{ owner: string | null; scope: RecipeScope; ready: boolean }>({ owner: null, scope: 'discover', ready: false });
  const writes = useRef(Promise.resolve());
  const fallback: RecipeScope = owner ? 'library' : 'discover';
  const explicit = validRecipeScope(requested) ? requested : null;
  useEffect(() => {
    let active = true;
    if (!owner) {
      setState({ owner, scope: explicit ?? 'discover', ready: true });
      return;
    }
    void AsyncStorage.getItem(recipeScopeKey(owner)).then((stored) => {
      if (active) setState({ owner, scope: explicit ?? (validRecipeScope(stored) ? stored : 'library'), ready: true });
    }).catch(() => { if (active) setState({ owner, scope: explicit ?? 'library', ready: true }); });
    return () => { active = false; };
  }, [owner, explicit]);
  const select = (scope: RecipeScope) => {
    setState({ owner, scope, ready: true });
    if (owner) writes.current = writes.current.catch(() => undefined).then(() => AsyncStorage.setItem(recipeScopeKey(owner), scope)).catch(() => undefined);
  };
  return { scope: state.owner === owner ? state.scope : explicit ?? fallback, ready: state.owner === owner && state.ready, select };
}
