import type { DeviceState } from "./models";
import { pendingChanges, dayOverlay } from "./care-summary";
import { recordDay, type CareDay } from "./tracker";

/** One range as the API works it out. Every number here comes from `GET /care/stats`. */
export interface StatsDay extends Omit<CareDay, "dots" | "feeding" | "sleep"> {
  partial: boolean;
  feeding: { count: number; left: number; right: number; both: number; bottle_ml: number; bottle_oz: number; breast_minutes: number };
  sleep: { total_minutes: number; longest_minutes: number; spans?: NonNullable<CareDay["sleep"]["spans"]> };
  contractions: { count: number; timed: number; average_seconds: number | null };
  kicks: { sessions: number; movements: number };
}
export interface CareStats {
  range: { kind: string; start: string; end: string };
  complete: boolean;
  days: StatsDay[];
  feeding: { count: number; average_per_day: number | null; average_gap_minutes: number | null; left: number; right: number; both: number; bottle_count: number; bottle_ml: number; bottle_oz: number; breast_minutes: number; timed_breast_feeds: number; unknown_end_feeds: number; days_logged: number; days_total: number };
  diapers: { count: number; pee: number; poo: number; dry: number; average_per_day: number | null; days_logged: number; days_total: number };
  sleep: { total_minutes: number; average_minutes_per_day: number | null; longest_minutes: number; sleeps: number; open: { record_id: string; started_at: string }[]; unusable: number; days_logged: number; days_total: number };
  contractions: { count: number; timed: number; average_seconds: number | null };
  kicks: { sessions: number; movements: number };
}
export type StatsChoice = { range: "24h" | "7d" | "30d" } | { range: "custom"; from: string; to: string };

export const statsRanges = [{ label: "24 hours", value: "24h" }, { label: "7 days", value: "7d" }, { label: "30 days", value: "30d" }, { label: "Custom", value: "custom" }];
const maxCustomDays = 92;

/** "based on 6 logged days of 7". A day with nothing logged isn't a zero, so it's never in an average. */
export const basedOn = (logged: number, total: number) => `based on ${logged} logged day${logged === 1 ? "" : "s"} of ${total}`;

/** Why these dates can't be asked for, in the API's own words, or nothing. */
export function customProblem(from: string, to: string, today: string) {
  if (from > to) return "Choose a start before the end";
  if (from > today) return "Choose dates that have already started";
  const days = Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86_400_000);
  return days >= maxCustomDays ? `Choose ${maxCustomDays} days or fewer` : null;
}

/**
 * The API's numbers with this phone's queued changes laid over them, by the Day view's rules. Only what `dayOverlay`
 * can swap moves: each day's counts, sleep and sessions, and the totals of those. Averages, sides and amounts stay the
 * API's until the change arrives, and `pending` says so.
 */
export function overlayStats(stats: CareStats, state: DeviceState, childId: string | null, timeZone?: string | null, now = new Date()) {
  const since = stats.range.kind === "24h" ? stats.range.start : undefined,
    overlay = dayOverlay(state, childId, timeZone, now, since),
    { before, after } = pendingChanges(state, childId, since),
    sessions = (list: typeof after, key: string, kind: "contraction" | "kick_session") => list.filter((row) => row.kind === kind && recordDay(row.occurred_at, timeZone) === key),
    movements = (list: typeof after) => list.reduce((total, row) => total + (row.data.count ?? 0), 0);
  let pending = false;
  const days = stats.days.map((day): StatsDay => {
    const next = overlay({ ...day, dots: [] }, day.date),
      feeds = next.feeding.count, minutes = next.sleep.total_minutes,
      contractions = Math.max(0, day.contractions.count - sessions(before, day.date, "contraction").length + sessions(after, day.date, "contraction").length),
      kicksWere = sessions(before, day.date, "kick_session"), kicksNow = sessions(after, day.date, "kick_session"),
      kicks = { sessions: Math.max(0, day.kicks.sessions - kicksWere.length + kicksNow.length), movements: Math.max(0, day.kicks.movements - movements(kicksWere) + movements(kicksNow)) };
    if (feeds === day.feeding.count && minutes === day.sleep.total_minutes && contractions === day.contractions.count && kicks.sessions === day.kicks.sessions && kicks.movements === day.kicks.movements
      && (["count", "pee", "poo", "dry"] as const).every((key) => next.diapers[key] === day.diapers[key])) return day;
    pending = true;
    return { ...day, feeding: { ...day.feeding, count: feeds }, diapers: next.diapers, sleep: { ...day.sleep, total_minutes: minutes }, contractions: { ...day.contractions, count: contractions }, kicks };
  });
  if (!pending) return { stats, pending };
  const sum = (pick: (day: StatsDay) => number) => days.reduce((total, day) => total + pick(day), 0);
  return { pending, stats: { ...stats, days,
    feeding: { ...stats.feeding, count: sum((day) => day.feeding.count) },
    diapers: { ...stats.diapers, count: sum((day) => day.diapers.count), pee: sum((day) => day.diapers.pee), poo: sum((day) => day.diapers.poo), dry: sum((day) => day.diapers.dry) },
    sleep: { ...stats.sleep, total_minutes: sum((day) => day.sleep.total_minutes) },
    contractions: { ...stats.contractions, count: sum((day) => day.contractions.count) },
    kicks: { sessions: sum((day) => day.kicks.sessions), movements: sum((day) => day.kicks.movements) } } };
}
