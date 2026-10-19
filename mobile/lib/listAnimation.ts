import { useCallback, useEffect, useRef } from 'react';

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
  const phase = useRef<'waiting' | 'entering' | 'done'>('waiting');
  if (phase.current === 'waiting' && hasData) phase.current = 'entering';
  useEffect(() => {
    if (phase.current === 'entering') phase.current = 'done';
  });
  return useCallback(() => phase.current === 'entering', []);
}
