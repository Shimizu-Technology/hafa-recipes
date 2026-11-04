import type { BabyRecord, DeviceState, Kind } from "./models";
import { mutationRecordId, pendingRecords } from "./outbox";
import { clockIn, dayRange, keyDate, recordDay, type CareDay } from "./tracker";

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

const statKinds: readonly Kind[] = ["feeding", "sleep", "diaper", "contraction", "kick_session"];
const time = (iso: string) => new Date(iso).getTime();

/**
 * How many queued entries could move these numbers: this baby's, in these days, as they were or as they'll be. Stats
 * never adds them in, since this phone can't tell what the API already has. One kept on this phone on purpose isn't waiting.
 */
export function waitingEntries(state: DeviceState, childId: string | null, stats: CareStats, timeZone?: string | null) {
  const from = time(stats.range.start),
    // A rolling range keeps moving, so what's been logged since it was read belongs to it too.
    to = stats.range.kind === "24h" ? Infinity : time(dayRange(stats.days[stats.days.length - 1].date, timeZone).to),
    inside = (row?: BabyRecord) => !!row && statKinds.includes(row.kind) && row.child_id === childId && time(row.occurred_at) < to
      // A sleep can run into the range from before it.
      && (row.kind === "sleep" && (!row.data.end_at || time(row.data.end_at) > from) || time(row.occurred_at) >= from),
    shown = pendingRecords(state), ids = new Set<string>();
  for (const change of state.outbox) {
    if (change.localOnly || change.type === "import" || change.type === "child_birth") continue;
    const id = mutationRecordId(change), find = (rows: BabyRecord[]) => rows.find((row) => row.id === id);
    if (id && (inside(find(state.records) ?? (change.type === "delete" ? change.record : undefined)) || inside(find(shown)))) ids.add(id);
  }
  return ids.size;
}

/** The one line that says these numbers may be behind, or nothing when they aren't. */
export function statsNote(fetchedAt: Date, behind: boolean, waiting: number, timeZone?: string | null, now = new Date()) {
  if (!behind && !waiting) return null;
  const day = recordDay(fetchedAt.toISOString(), timeZone),
    on = day === recordDay(now.toISOString(), timeZone) ? "" : `${keyDate(day).toLocaleDateString(undefined, { month: "short", day: "numeric" })}, `;
  return `Showing numbers from ${on}${clockIn(fetchedAt, timeZone)}.${waiting ? ` ${waiting} ${waiting === 1 ? "entry is" : "entries are"} still waiting to sync.` : ""}`;
}
