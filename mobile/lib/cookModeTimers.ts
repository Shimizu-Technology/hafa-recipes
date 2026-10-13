/**
 * Pure cook-mode timer helpers.
 *
 * State updaters must stay free of side effects (React may invoke them more
 * than once), so countdown math lives here and the screen fires haptics,
 * vibration, and audio from an effect after the new state is committed.
 */

export interface CookTimerState {
  remaining: number;
  total: number;
  isPaused: boolean;
  endTime: number; // Unix timestamp (ms) when the timer will complete
}

export type CookTimerMap = Map<number, CookTimerState>;

/** Recompute remaining seconds for running timers. Returns `prev` when nothing changed. */
export function syncTimersToClock(prev: CookTimerMap, now: number): CookTimerMap {
  let next: CookTimerMap | null = null;
  prev.forEach((timer, stepIndex) => {
    if (timer.isPaused || timer.remaining <= 0) return;
    const remaining = Math.max(0, Math.floor((timer.endTime - now) / 1000));
    if (remaining === timer.remaining) return;
    if (!next) next = new Map(prev);
    next.set(stepIndex, { ...timer, remaining });
  });
  return next ?? prev;
}

/** Step indexes whose timer moved from running to finished between two committed states. */
export function findNewlyCompletedTimers(prev: CookTimerMap, next: CookTimerMap): number[] {
  const completed: number[] = [];
  next.forEach((timer, stepIndex) => {
    if (timer.remaining !== 0) return;
    const before = prev.get(stepIndex);
    if (before && before.remaining > 0 && before.endTime === timer.endTime) {
      completed.push(stepIndex);
    }
  });
  return completed;
}

export interface AwayWindow {
  /** When the app last left the active state, or null if it has not. */
  leftAt: number | null;
  /** When the app last returned to the active state (null while still away). */
  returnedAt: number | null;
}

/**
 * Decide whether finished timers need an in-app alert.
 *
 * A timer that finished while the app was away already alerted the cook via
 * its scheduled local notification, so replaying sound and vibration on
 * return would double-alert. If no notification was scheduled (for example,
 * notification permission was denied) the in-app alert is the only signal.
 */
export function shouldAlertInApp(
  completed: { stepIndex: number; endTime: number }[],
  away: AwayWindow,
  hasScheduledNotification: (stepIndex: number) => boolean,
): boolean {
  return completed.some(({ stepIndex, endTime }) => {
    if (!hasScheduledNotification(stepIndex)) return true;
    const finishedWhileAway = away.leftAt !== null
      && endTime >= away.leftAt
      && (away.returnedAt === null || endTime <= away.returnedAt);
    return !finishedWhileAway;
  });
}
