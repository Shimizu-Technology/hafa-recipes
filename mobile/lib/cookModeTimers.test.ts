import { describe, expect, it } from 'vitest';
import {
  findNewlyCompletedTimers,
  shouldAlertInApp,
  syncTimersToClock,
  type CookTimerMap,
} from './cookModeTimers';

const timers = (entries: [number, { remaining: number; endTime: number; isPaused?: boolean }][]): CookTimerMap =>
  new Map(entries.map(([step, t]) => [step, { total: 60, isPaused: false, ...t }]));

describe('syncTimersToClock', () => {
  it('returns the same map when nothing changed', () => {
    const prev = timers([[0, { remaining: 10, endTime: 10_000 }]]);
    expect(syncTimersToClock(prev, 0)).toBe(prev);
  });

  it('updates running timers without mutating the previous state and skips paused ones', () => {
    const prev = timers([
      [0, { remaining: 10, endTime: 10_000 }],
      [1, { remaining: 30, endTime: 5_000, isPaused: true }],
    ]);
    const next = syncTimersToClock(prev, 12_000);
    expect(next).not.toBe(prev);
    expect(next.get(0)?.remaining).toBe(0);
    expect(next.get(1)?.remaining).toBe(30);
    expect(prev.get(0)?.remaining).toBe(10);
  });
});

describe('findNewlyCompletedTimers', () => {
  it('reports each timer once, on the transition to zero', () => {
    const running = timers([[2, { remaining: 1, endTime: 1_000 }]]);
    const done = syncTimersToClock(running, 1_500);
    expect(findNewlyCompletedTimers(running, done)).toEqual([2]);
    // A later tick (or a duplicate updater invocation) does not re-report it.
    expect(findNewlyCompletedTimers(done, syncTimersToClock(done, 3_000))).toEqual([]);
  });

  it('ignores timers that were restarted rather than finished', () => {
    const prev = timers([[0, { remaining: 5, endTime: 5_000 }]]);
    const next = timers([[0, { remaining: 0, endTime: 9_000 }]]);
    expect(findNewlyCompletedTimers(prev, next)).toEqual([]);
  });
});

describe('shouldAlertInApp', () => {
  const scheduled = () => true;
  const unscheduled = () => false;

  it('alerts for timers that finish while the app is active', () => {
    expect(shouldAlertInApp([{ stepIndex: 0, endTime: 500 }], { leftAt: 1_000, returnedAt: 2_000 }, scheduled)).toBe(true);
    expect(shouldAlertInApp([{ stepIndex: 0, endTime: 500 }], { leftAt: null, returnedAt: null }, scheduled)).toBe(true);
  });

  it('does not double-alert when the scheduled notification already fired while away', () => {
    expect(shouldAlertInApp([{ stepIndex: 0, endTime: 1_500 }], { leftAt: 1_000, returnedAt: 2_000 }, scheduled)).toBe(false);
    expect(shouldAlertInApp([{ stepIndex: 0, endTime: 1_500 }], { leftAt: 1_000, returnedAt: null }, scheduled)).toBe(false);
  });

  it('still alerts on return when no notification was scheduled', () => {
    expect(shouldAlertInApp([{ stepIndex: 0, endTime: 1_500 }], { leftAt: 1_000, returnedAt: 2_000 }, unscheduled)).toBe(true);
  });
});
