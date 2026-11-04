import type { BabyRecord, FeedAction, RecordData } from "./models";

type Side = "left" | "right";
export interface FeedSegment { side: Side; started_at: string; ended_at?: string }
export interface ReducedFeed {
  state: "running" | "finished";
  /** Where the feed started: what the next side is the opposite of. */
  start_side: Side;
  side: Side | "both";
  segments: FeedSegment[];
  end_at?: string;
  duration_minutes?: number;
}

const minute = 60_000;
const time = (iso: string) => new Date(iso).getTime();

/** The one order, whatever order actions arrive in: by time, then id. */
export function orderActions(actions: readonly FeedAction[]) {
  return [...actions].sort((a, b) => time(a.at) - time(b.at) || a.id.localeCompare(b.id));
}

/**
 * Mirror of the API's reducer. The earliest finish is terminal, and a switch before it applies even if it arrived
 * later; anything after it is kept but has no effect. Duration comes from the segments, only when finished.
 */
export function reduceFeed(actions: readonly FeedAction[] | undefined): ReducedFeed | undefined {
  const ordered = orderActions(actions ?? []),
    start = ordered.find((action) => action.action === "start" && action.side);
  if (!start) return undefined;
  const finish = ordered.find((action) => action.action === "finish" && time(action.at) >= time(start.at)),
    segments: FeedSegment[] = [{ side: start.side!, started_at: start.at }];
  for (const action of ordered) {
    if (finish && (time(action.at) > time(finish.at) || action === finish)) break;
    const open = segments[segments.length - 1];
    if (action.action === "switch" && action.side && action.side !== open.side && time(action.at) >= time(open.started_at)) {
      open.ended_at = action.at;
      segments.push({ side: action.side, started_at: action.at });
    }
  }
  const sides = new Set(segments.map((segment) => segment.side)),
    side = sides.size > 1 ? "both" : start.side!;
  if (!finish) return { state: "running", start_side: start.side!, side, segments };
  segments[segments.length - 1].ended_at = finish.at;
  return { state: "finished", start_side: start.side!, side, segments, end_at: finish.at,
    duration_minutes: Math.max(1, Math.round((time(finish.at) - time(start.at)) / minute)) };
}

/** A record's data with one more action. Applying the same action twice changes nothing. */
export function withFeedAction(data: RecordData, action: FeedAction): RecordData {
  if (data.actions?.some((known) => known.id === action.id)) return data;
  const actions = [...(data.actions ?? []), action], reduced = reduceFeed(actions);
  if (!reduced) return { ...data, actions };
  const { end_at: _, duration_minutes: __, ...rest } = data;
  return { ...rest, actions, state: reduced.state, side: reduced.side,
    ...(reduced.end_at ? { end_at: reduced.end_at, duration_minutes: reduced.duration_minutes } : {}) };
}

/** A running feed nobody finished stops showing as running. It stays saved with a side and start time, and no duration. */
export const runningLimit = 60 * minute;

export interface RunningFeed extends ReducedFeed { record: BabyRecord; started_at: string }

/** Per child, the newest start is the running feed, whatever order they arrived in. Ties go to the higher record id. */
export function runningFeed(rows: readonly BabyRecord[], childId: string | null, now = new Date()): RunningFeed | undefined {
  const starts = rows.flatMap((record) => {
    if (record.kind !== "feeding" || record.child_id !== childId) return [];
    const reduced = reduceFeed(record.data.actions);
    return reduced ? [{ record, reduced, started_at: reduced.segments[0].started_at }] : [];
  }).sort((a, b) => time(b.started_at) - time(a.started_at) || b.record.id.localeCompare(a.record.id));
  const newest = starts[0];
  if (!newest || newest.reduced.state !== "running" || newest.record.data.state === "unknown_end") return undefined;
  return now.getTime() - time(newest.started_at) < runningLimit ? { ...newest.reduced, record: newest.record, started_at: newest.started_at } : undefined;
}
