import type { BabyRecord, DeviceState, Kind } from "./models";
import { mutationRecordId, pendingRecords } from "./outbox";
import { clockIn, dayRange, keyDate, recordDay, type CareDay } from "./tracker";
import { trackerFor } from "./trackers";

/** One range as the API works it out. Every number here comes from `GET /care/stats`. */
export interface StatsDay extends Omit<CareDay, "dots" | "feeding" | "sleep"> {
  partial: boolean;
  feeding: { count: number; left: number; right: number; both: number; bottle_ml: number; bottle_oz: number; breast_minutes: number };
  sleep: { total_minutes: number; longest_minutes: number; spans?: NonNullable<CareDay["sleep"]["spans"]> };
  contractions: { count: number; timed: number; average_seconds: number | null };
  kicks: { sessions: number; movements: number };
  /** Her own logs that day. From this release of the API on. */
  own?: { count: number };
}
export interface OwnLog { label: string; count: number; latest_title: string; latest_at: string }
export interface CareStats {
  range: { kind: string; start: string; end: string };
  complete: boolean;
  days: StatsDay[];
  feeding: { count: number; average_per_day: number | null; average_gap_minutes: number | null; left: number; right: number; both: number; bottle_count: number; bottle_ml: number; bottle_oz: number; breast_minutes: number; timed_breast_feeds: number; unknown_end_feeds: number; days_logged: number; days_total: number };
  diapers: { count: number; pee: number; poo: number; dry: number; average_per_day: number | null; days_logged: number; days_total: number };
  sleep: { total_minutes: number; average_minutes_per_day: number | null; longest_minutes: number; sleeps: number; open: { record_id: string; started_at: string }[]; unusable: number; days_logged: number; days_total: number };
  contractions: { count: number; timed: number; average_seconds: number | null };
  kicks: { sessions: number; movements: number };
  own?: { count: number; logs: OwnLog[] };
}
export type StatsChoice = { range: "24h" | "7d" | "30d" } | { range: "custom"; from: string; to: string };

export const statsRanges = [{ label: "24 hours", value: "24h" }, { label: "7 days", value: "7d" }, { label: "30 days", value: "30d" }, { label: "Custom", value: "custom" }];
const maxCustomDays = 92;

/** "based on 6 logged days of 7". A day with nothing logged isn't a zero, so it's never in an average. */
export const basedOn = (logged: number, total: number) => `based on ${logged} logged day${logged === 1 ? "" : "s"} of ${total}`;

const andList = (names: readonly string[]) => (names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}` : names[0] ?? "");
/** What Stats adds up, in words, for the ones with a button. */
function statWords(on: readonly string[], left: { feeds: boolean; diapers: boolean; sleep: boolean; kicks: boolean; contractions: boolean; own: boolean }) {
  const has = (...ids: string[]) => on.some((id) => ids.includes(id));
  return [left.feeds && has("breast", "bottle") && "feeds", left.diapers && has("diaper") && "diapers", left.sleep && has("sleep") && "sleep",
    left.kicks && has("kicks") && "kicks", left.contractions && has("contractions") && "contractions",
    left.own && has("feeling", "my_weight", "blood_pressure", "vitamins") && "your own logs"].filter(Boolean) as string[];
}
/** A blank range: what will fill it, by what she has a button for. */
export function blankStats(on: readonly string[]) {
  const words = statWords(on, { feeds: true, diapers: true, sleep: true, kicks: true, contractions: true, own: true });
  if (!words.length) return "What you log will add up here.";
  const said = andList(words);
  return `${said[0].toUpperCase()}${said.slice(1)} will add up here as you log them.`;
}
/** What has a button and nothing in these days, in place of an empty chart. A tracker she's switched off just isn't mentioned. */
export function nothingYet(stats: CareStats, on: readonly string[], rolling: boolean) {
  const words = statWords(on, { feeds: !stats.feeding.count, diapers: !stats.diapers.count, sleep: !stats.sleep.total_minutes && !stats.sleep.open.length && !stats.sleep.unusable,
    kicks: !stats.kicks.sessions, contractions: !stats.contractions.count, own: !stats.own?.count });
  return words.length ? `Nothing logged in ${rolling ? "the last 24 hours" : "these days"}: ${andList(words)}.` : "";
}

/** Why these dates can't be asked for, in the API's own words, or nothing. */
export function customProblem(from: string, to: string, today: string, limit = maxCustomDays) {
  if (from > to) return "Choose a start before the end";
  if (from > today) return "Choose dates that have already started";
  const days = Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86_400_000);
  return days >= limit ? `Choose ${limit} days or fewer` : null;
}

const statKinds: readonly Kind[] = ["feeding", "sleep", "diaper", "contraction", "kick_session", "custom"];
const time = (iso: string) => new Date(iso).getTime();

/**
 * How many queued entries could move these numbers: this baby's, in these days, as they were or as they'll be. Stats
 * never adds them in, since this phone can't tell what the API already has. One kept on this phone on purpose isn't waiting.
 */
export function waitingEntries(state: DeviceState, childId: string | null, stats: CareStats, timeZone?: string | null) {
  const from = time(stats.range.start),
    // A rolling range keeps moving, so what's been logged since it was read belongs to it too.
    to = stats.range.kind === "24h" ? Infinity : time(dayRange(stats.days[stats.days.length - 1].date, timeZone).to),
    // Her own logs have no baby, and count whichever baby is on screen. Nothing else of that kind is added up.
    mine = (row: BabyRecord) => row.kind === "custom" ? !row.child_id && trackerFor(row)?.about === "her" : row.child_id === childId,
    inside = (row?: BabyRecord) => !!row && statKinds.includes(row.kind) && mine(row) && time(row.occurred_at) < to
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
