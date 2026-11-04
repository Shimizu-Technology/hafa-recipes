import type { useBaby } from "./context";
import type { BabyRecord, DeviceState, FeedTimer } from "./models";
import { activeTimer, feedRecordData, startTimer, switchSide, type FeedSide } from "./feed-timer";
import { careWrite, logCare, updateCare } from "./quick-care";

type Account = Pick<ReturnType<typeof useBaby>, "commit" | "queue" | "state" | "sync" | "records">;

/** A feed nobody finished stops showing as running. It stays saved with a side and start time, and no duration. */
export const runningLimit = 60 * 60_000;

/**
 * The running breastfeed for one baby. This file is the only place that knows where a running feed lives:
 * for now the record is saved on tap and its side and times stay on this device, until `feed_action` syncs them.
 * A timer with no record is from an older build. It finishes the old way, on its own card.
 */
export function runningFeed(state: Pick<DeviceState, "feedTimer" | "bootstrap">, childId: string | null, now = new Date()) {
  const timer = activeTimer(state);
  if (!timer?.record_id || timer.child_id !== childId) return undefined;
  return now.getTime() - new Date(timer.started_at).getTime() < runningLimit ? timer : undefined;
}

/** Put a timer back only if the feed it belongs to is still the current one. */
const restoring = (recordId: string | undefined, before: FeedTimer | undefined) => (state: DeviceState): DeviceState => {
  if (state.feedTimer?.record_id !== recordId) return state;
  const { feedTimer: _, ...rest } = state;
  return before ? { ...rest, feedTimer: before } : rest;
};

/** Left or Right: the feed is saved as soon as the side is tapped. Undo removes it. */
export async function startFeed(b: Account, childId: string, side: FeedSide, now = new Date()) {
  const record = careWrite("feeding", childId, { method: "breast", side }, now),
    before = b.state.feedTimer;
  return logCare(b, record, (state) => ({
    ...state,
    feedTimer: { ...startTimer(childId, state.bootstrap!.generation, side, now), record_id: record.id },
  }), restoring(record.id, before?.record_id ? before : undefined));
}

export async function switchFeed(b: Account, timer: FeedTimer, now = new Date()) {
  await b.commit((state) => (state.feedTimer?.record_id === timer.record_id ? { ...state, feedTimer: switchSide(timer, now) } : state));
  return () => b.commit(restoring(timer.record_id, timer));
}

/** Done records how long it took. If the record is gone, only the timer goes with it. */
export async function finishFeed(b: Account, timer: FeedTimer, now = new Date()) {
  const clear = restoring(timer.record_id, undefined),
    record: BabyRecord | undefined = b.records.find((row) => row.id === timer.record_id);
  if (!record) { await b.commit(clear); return async () => undefined; }
  return updateCare(b, record, { ...record.data, ...feedRecordData(timer, now) }, clear, (state) => ({ ...state, feedTimer: timer }));
}
