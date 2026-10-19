import { useCallback, useEffect, useState } from 'react';

export const MAX_LIST_ENTRANCE_DELAY_MS = 200;
/** Only the first screenful of rows plays an entrance. */
export const MAX_LIST_ENTRANCE_ITEMS = 8;

/** Keep initial polish without hiding far-down cells during fast scrolling. */
export function listEntranceDelay(
  index: number,
  delayPerItem: number,
  maxDelay = MAX_LIST_ENTRANCE_DELAY_MS,
): number {
  return Math.min(
    Math.max(0, index) * Math.max(0, delayPerItem),
    Math.max(0, maxDelay),
  );
}

/**
 * Lets only the first page of a list enter, and only the first time the
 * screen shows data. Rows mounted later by scrolling, filtering or a layout
 * switch appear in place. Call the returned function while rendering a row.
 */
export function useInitialListEntrance(hasData: boolean): () => boolean {
  // Render stays pure: only a committed render with data ends the entrance window.
  const [done, setDone] = useState(false);
  const entering = hasData && !done;
  useEffect(() => {
    if (entering) setDone(true);
  }, [entering]);
  return useCallback(() => entering, [entering]);
}
