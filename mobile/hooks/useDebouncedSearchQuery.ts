import { useEffect, useState } from 'react';

export const SEARCH_DEBOUNCE_MS = 300;

/**
 * Debounce a search query for use in request/query keys while the text input
 * stays bound to the immediate value. Clearing the query applies immediately
 * so the unfiltered feed returns without waiting.
 */
export function useDebouncedSearchQuery(query: string, delayMs = SEARCH_DEBOUNCE_MS): string {
  const [debounced, setDebounced] = useState(query);
  const isCleared = query.trim() === '';

  useEffect(() => {
    if (isCleared) {
      setDebounced(query);
      return;
    }
    const timeout = setTimeout(() => setDebounced(query), delayMs);
    return () => clearTimeout(timeout);
  }, [query, isCleared, delayMs]);

  return isCleared ? query : debounced;
}
