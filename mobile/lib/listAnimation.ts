export const MAX_LIST_ENTRANCE_DELAY_MS = 200;

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
