import type { BabyRecord, FeedAction, RecordData } from "./models";

type Side = "left" | "right";
export interface FeedSegment { side: Side; started_at: string; ended_at?: string }
export interface ReducedFeed {
  state: "running" | "finished";
  /** Where the feed started: what the next side is the opposite of. */
  start_side?: Side;
  side?: Side | "both";
  segments: FeedSegment[];
  end_at?: string;
  duration_minutes?: number;
}

const time = (iso: string) => new Date(iso).getTime();
/** The API's bound: longer can't be one feed, so it gets no duration. */
const longestMinutes = 1440;

/** The one order, whatever order actions arrive in: by instant, then id as plain text. */
export function orderActions(actions: readonly FeedAction[]) {
  return [...actions].sort((a, b) => time(a.at) - time(b.at) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
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
    start_side = start?.side ?? segments[0]?.side;
  if (!finish) return { state: "running", start_side, side, segments };
  if (segments.length) segments[segments.length - 1].ended_at = finish.at;
  const minutes = segments.length ? Math.round((time(finish.at) - time(segments[0].started_at)) / 600) / 100 : undefined;
  return { state: "finished", start_side, side, segments, end_at: finish.at,
    ...(minutes !== undefined && minutes <= longestMinutes ? { duration_minutes: minutes } : {}) };
}

/** A record's data with one more action. Applying the same action twice changes nothing. */
export function withFeedAction(data: RecordData, action: FeedAction): RecordData {
  if (data.actions?.some((known) => known.id === action.id)) return data;
  const actions = orderActions([...(data.actions ?? []), action]), reduced = reduceFeed(actions)!;
  const { end_at: _, duration_minutes: __, ...rest } = data;
  return { ...rest, actions, side: reduced.side ?? data.side,
    state: reduced.state === "finished" ? "finished" : data.state === "unknown_end" ? "unknown_end" : "running",
    ...(reduced.end_at ? { end_at: reduced.end_at } : {}),
    ...(reduced.duration_minutes !== undefined ? { duration_minutes: reduced.duration_minutes } : {}) };
}

/** Mirror of `retimed`: a parent correcting a feed's time moves its start. The other tap times are untouched. */
export function retimedActions(actions: readonly FeedAction[], at: string) {
  const ordered = orderActions(actions),
    named = ordered.find((action) => action.action === "start") ?? ordered.find((action) => action.action === "switch");
  return ordered.map((action) => (action === named ? { ...action, at } : action));
}

/** A running feed nobody finished stops showing as running. It stays saved with a side and start time, and no duration. */
export const runningLimit = 60 * 60_000;

export interface RunningFeed extends ReducedFeed { record: BabyRecord; started_at: string }

/**
 * Mirror of `settle_running_feeds`: per child, only the newest breastfeed can be running, ties going to the higher
 * record id. A Both tap or a finished feed ends an older one; a bottle doesn't, because it may be a top-up.
 */
export function runningFeed(rows: readonly BabyRecord[], childId: string | null, now = new Date()): RunningFeed | undefined {
  const newest = rows.filter((record) => record.kind === "feeding" && record.child_id === childId && record.data.method === "breast")
    .sort((a, b) => time(b.occurred_at) - time(a.occurred_at) || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0))[0];
  if (!newest || newest.data.state === "unknown_end") return undefined;
  const reduced = reduceFeed(newest.data.actions);
  if (reduced?.state !== "running" || !reduced.segments.length) return undefined;
  const started_at = reduced.segments[0].started_at;
  return now.getTime() - time(started_at) < runningLimit ? { ...reduced, record: newest, started_at } : undefined;
}
