import type { CareStats, StatsDay } from "./care-stats";

/** Hand-written API answers for tests. */
export function day(date: string, partial = false, changes: Partial<StatsDay> = {}): StatsDay {
  return { date, partial,
    feeding: { count: 0, left: 0, right: 0, both: 0, bottle_ml: 0, bottle_oz: 0, breast_minutes: 0 },
    diapers: { count: 0, pee: 0, poo: 0, dry: 0 },
    sleep: { total_minutes: 0, longest_minutes: 0, spans: [] },
    contractions: { count: 0, timed: 0, average_seconds: null }, kicks: { sessions: 0, movements: 0 }, ...changes };
}
export function answer(days: StatsDay[], kind = "7d"): CareStats {
  const sum = (pick: (one: StatsDay) => number) => days.reduce((total, one) => total + pick(one), 0);
  return { range: { kind, start: "2026-11-03T20:00:00+10:00", end: "2026-11-04T20:00:00+10:00" }, complete: true, days,
    feeding: { count: sum((one) => one.feeding.count), average_per_day: 4.5, average_gap_minutes: null, left: 0, right: 0, both: 0, bottle_count: 0, bottle_ml: 0, bottle_oz: 0, breast_minutes: 0, timed_breast_feeds: 0, unknown_end_feeds: 0, days_logged: 1, days_total: 1 },
    diapers: { count: sum((one) => one.diapers.count), pee: sum((one) => one.diapers.pee), poo: sum((one) => one.diapers.poo), dry: sum((one) => one.diapers.dry), average_per_day: null, days_logged: 0, days_total: 1 },
    sleep: { total_minutes: sum((one) => one.sleep.total_minutes), average_minutes_per_day: null, longest_minutes: 0, sleeps: 0, open: [], unusable: 0, days_logged: 0, days_total: 1 },
    contractions: { count: sum((one) => one.contractions.count), timed: 0, average_seconds: null }, kicks: { sessions: sum((one) => one.kicks.sessions), movements: sum((one) => one.kicks.movements) } };
}
