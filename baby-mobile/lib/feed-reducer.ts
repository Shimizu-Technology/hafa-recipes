import type { BabyRecord, FeedAction, RecordData } from "./models";

type Side = "left" | "right";
export interface FeedSegment { side: Side; started_at: string; ended_at?: string }
export interface ReducedFeed {
  state: "running" | "finished";
  /** When the feed started: its start action, or the first side named. A segment can begin earlier if clocks differ. */
  started_at?: string;
  /** Where the feed started: what the next side is the opposite of. */
  start_side?: Side;
  side?: Side | "both";
  segments: FeedSegment[];
  end_at?: string;
  duration_minutes?: number;
}

/** A time in whole microseconds, the precision the API compares at. A `Date` would stop at milliseconds. */
export function instant(iso: string) {
  const parts = /^(.*T\d{2}:\d{2}(?::\d{2})?)(?:\.(\d+))?(.*)$/.exec(iso);
  if (!parts) return new Date(iso).getTime() * 1000;
  return new Date(parts[1] + parts[3]).getTime() * 1000 + Number((parts[2] ?? "").slice(0, 6).padEnd(6, "0"));
}
/** IDs order as their lowercase text, as the API's UUIDs do. */
const byId = (a: string, b: string) => {
  const x = a.toLowerCase(), y = b.toLowerCase();
  return x < y ? -1 : x > y ? 1 : 0;
};
/** The API's "newest": by instant, then the higher record id. */
export const newestFirst = (a: Pick<BabyRecord, "id" | "occurred_at">, b: Pick<BabyRecord, "id" | "occurred_at">) =>
  instant(b.occurred_at) - instant(a.occurred_at) || byId(b.id, a.id);
/** The API's bound: longer can't be one feed, so it gets no duration. */
const longestMinutes = 1440;

/**
 * Python's `round(value, 2)`, so both sides store the same duration. `toFixed` already rounds the value's exact binary
 * form; it differs only on a true tie, which Python sends to the even digit. Only eighths can tie at two places.
 */
export function roundMinutes(value: number) {
  if (Number.isInteger(value * 8) && !Number.isInteger(value * 4)) {
    const below = Math.floor(value * 100);
    return (below % 2 ? below + 1 : below) / 100;
  }
  return Number(value.toFixed(2));
}

/** The one order, whatever order actions arrive in: by instant, then id as plain text. */
export function orderActions(actions: readonly FeedAction[]) {
  return [...actions].sort((a, b) => instant(a.at) - instant(b.at) || byId(a.id, b.id));
}

/**
 * Mirror of `reduce_feed` in the API's feeds.py. The earliest finish is terminal, and a switch before it applies even
 * if it arrived later; anything after it is kept but has no effect. The first action naming a side opens the first
 * segment, so phones whose clocks differ still give one result. Duration comes from the segments, only when finished.
 */
export function reduceFeed(actions: readonly FeedAction[] | undefined): ReducedFeed | undefined {
  const ordered = orderActions(actions ?? []);
  if (!ordered.length) return undefined;
  const end = ordered.findIndex((action) => action.action === "finish"),
    finish = end < 0 ? undefined : ordered[end],
    segments: FeedSegment[] = [];
  for (const action of end < 0 ? ordered : ordered.slice(0, end)) {
    const open = segments[segments.length - 1];
    if (!action.side || open?.side === action.side) continue;
    if (open) open.ended_at = action.at;
    segments.push({ side: action.side, started_at: action.at });
  }
  const start = ordered.find((action) => action.action === "start"),
    sides = new Set(segments.map((segment) => segment.side)),
    side = sides.size > 1 ? "both" : segments[0]?.side,
    start_side = start?.side ?? segments[0]?.side,
    started_at = start?.at ?? segments[0]?.started_at;
  if (!finish) return { state: "running", started_at, start_side, side, segments };
  if (segments.length) segments[segments.length - 1].ended_at = finish.at;
  const minutes = segments.length ? roundMinutes((instant(finish.at) - instant(segments[0].started_at)) / 1e6 / 60) : undefined;
  return { state: "finished", started_at, start_side, side, segments, end_at: finish.at,
    ...(minutes !== undefined && minutes <= longestMinutes ? { duration_minutes: minutes } : {}) };
}

/** A record's data with one more action. Applying the same action twice changes nothing. */
export function withFeedAction(data: RecordData, action: FeedAction): RecordData {
  if (data.actions?.some((known) => known.id === action.id)) return data;
  const actions = orderActions([...(data.actions ?? []), action]), reduced = reduceFeed(actions)!;
  const { end_at: _, duration_minutes: __, ...rest } = data;
  // Never the side stored before: that would depend on the order the taps arrived in.
  return { ...rest, actions, side: reduced.side ?? reduced.start_side ?? data.side,
    state: reduced.state === "finished" ? "finished" : data.state === "unknown_end" ? "unknown_end" : "running",
    ...(reduced.end_at ? { end_at: reduced.end_at } : {}),
    ...(reduced.duration_minutes !== undefined ? { duration_minutes: reduced.duration_minutes } : {}) };
}

/** The same on the whole record: a feed's start is its time, as on the API. */
export function withRecordAction(record: BabyRecord, action: FeedAction): BabyRecord {
  const data = withFeedAction(record.data, action);
  return { ...record, data, occurred_at: reduceFeed(data.actions)?.started_at ?? record.occurred_at };
}

/** Mirror of `retimed`: a parent correcting a feed's time moves its start. The other tap times are untouched. */
export function retimedActions(actions: readonly FeedAction[], at: string) {
  const ordered = orderActions(actions),
    named = ordered.find((action) => action.action === "start") ?? ordered.find((action) => action.action === "switch");
  return ordered.map((action) => (action === named ? { ...action, at } : action));
}

/** After an hour, offer help recording a forgotten end without silently ending the feed. */
export const runningLimit = 60 * 60_000;

/** Mirror of `FEED_START_TOLERANCE`: a phone's clock can run a little ahead. Further ahead is a plan or a typo. */
const startTolerance = 5 * 60_000;

export interface RunningFeed extends ReducedFeed { record: BabyRecord; started_at: string }

/**
 * Mirror of `settle_running_feeds`: per child, only the newest breastfeed can be running, ties going to the higher
 * record id. A Both tap or a finished feed ends an older one; a bottle doesn't, because it may be a top-up. A feed dated
 * ahead neither runs nor ends one that does. Worked out from these rows and never from a stored state, so undoing the
 * newest feed gives the one before it back, offline too.
 */
export function runningFeed(rows: readonly BabyRecord[], childId: string | null, now = new Date()): RunningFeed | undefined {
  const latest = (now.getTime() + startTolerance) * 1000,
    newest = rows.filter((record) => record.kind === "feeding" && record.child_id === childId && record.data.method === "breast" && instant(record.occurred_at) <= latest).sort(newestFirst)[0];
  if (!newest) return undefined;
  const reduced = reduceFeed(newest.data.actions);
  if (reduced?.state !== "running" || !reduced.segments.length || !reduced.started_at) return undefined;
  return { ...reduced, record: newest, started_at: reduced.started_at };
}

/** What one timed feed is now, for any screen naming it: everything but the one running feed has an end or has none. */
export function feedProgress(record: BabyRecord, rows: readonly BabyRecord[], now = new Date()): "running" | "no_end" | "finished" | undefined {
  const reduced = reduceFeed(record.data.actions);
  if (!reduced) return undefined;
  if (reduced.state === "finished") return "finished";
  return runningFeed(rows, record.child_id, now)?.record.id === record.id ? "running" : "no_end";
}

/** A feed still running past `runningLimit`: screens ask when it ended instead of calling it "Feeding now". */
export function feedOverdue(record: BabyRecord, now = new Date()) {
  const started = reduceFeed(record.data.actions)?.started_at;
  return !!started && now.getTime() - new Date(started).getTime() >= runningLimit;
}
/** A side tapped this recently means she's probably still there, so the feed ended about now. */
export const recentFeedTouch = 15 * 60_000;
/** Whether a side was started or switched within `recentFeedTouch` of now. */
export function touchedRecently(record: BabyRecord, now = new Date()) {
  const times = (record.data.actions ?? []).map((action) => new Date(action.at).getTime()).filter(Number.isFinite);
  return !!times.length && now.getTime() - Math.max(...times) <= recentFeedTouch;
}
/**
 * Now, after a recent side tap. Otherwise a typical twenty minutes, bounded by now and the latest side tap
 * so no segment is lost.
 */
export function suggestedFeedEnd(record: BabyRecord, now = new Date()) {
  const actions = record.data.actions ?? [], times = actions.map((action) => new Date(action.at).getTime()).filter(Number.isFinite);
  const start = new Date(record.occurred_at).getTime();
  const end = touchedRecently(record, now) ? now.getTime() : Math.min(now.getTime(), Math.max(start + 20 * 60_000, ...times));
  // A side tapped in this very millisecond keeps its own text: the API's microseconds are what `validFeedEnd` compares.
  const tapped = actions.filter((action) => new Date(action.at).getTime() === end).sort((a, b) => instant(b.at) - instant(a.at))[0];
  return tapped ? tapped.at : new Date(end).toISOString();
}
/** How long the feed is if it ended at `at`, in minutes, the way it would be saved. */
export function feedLengthAt(record: BabyRecord, at: string) {
  return withFeedAction(record.data, { id: "preview", action: "finish", at }).duration_minutes;
}
export function validFeedEnd(record: BabyRecord, at: string, now = new Date()) {
  const end = new Date(at).getTime();
  return Number.isFinite(end) && end <= now.getTime() && end >= new Date(record.occurred_at).getTime()
    && (record.data.actions ?? []).every((action) => instant(at) >= instant(action.at));
}
