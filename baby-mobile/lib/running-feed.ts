import { Alert } from "react-native";
import * as Crypto from "expo-crypto";
import type { useBaby } from "./context";
import type { BabyRecord, DeviceState, FeedAction, FeedTimer, Mutation } from "./models";
import { runningFeed, withFeedAction, type RunningFeed } from "./feed-reducer";
import { activeTimer, changeTimer, feedRecordData, type FeedSide } from "./feed-timer";
import { addMutation, laterChangesNotice, queuedChain, withoutChain } from "./outbox";
import { careSummary } from "./care-format";
import { careWrite, logCare } from "./quick-care";

type Account = Pick<ReturnType<typeof useBaby>, "commit" | "queue" | "state" | "sync" | "records">;

/** How long the saved row offers Undo. VoiceOver needs longer to reach it and read it. */
export const undoShown = (reader: boolean) => (reader ? 20_000 : 6000);
/**
 * How long a Switch or Done stays on this phone before it syncs, so Undo can take it back: as long as Undo is on
 * screen, and a little more. The finish a server has accepted is terminal, by contract. It is durable the moment it's
 * tapped, and keeps the time she tapped.
 */
export const undoWindow = (reader: boolean) => undoShown(reader) + 500;

function queueAction(b: Account, recordId: string, action: Omit<FeedAction, "id">, hold: number) {
  const id = Crypto.randomUUID();
  const mutation: Mutation = { id, generation: b.state.bootstrap!.generation, type: "feed_action", record_id: recordId, action: { ...action, id },
    ...(hold ? { hold_until: new Date(Date.now() + hold).toISOString() } : {}) };
  return b.queue(mutation).then(() => id);
}

function confirmLater(later: number) {
  return new Promise<boolean>((resolve) => Alert.alert("Undo this?", laterChangesNotice(later), [
    { text: "Keep it", style: "cancel", onPress: () => resolve(false) },
    { text: "Undo", style: "destructive", onPress: () => resolve(true) },
  ], { onDismiss: () => resolve(false) }));
}
const takeable = (state: DeviceState, id: string) => state.outbox.find((change) => change.id === id && !(change.type === "feed_action" && change.sent));

/**
 * Take back an action still on this phone, with what's queued after it on that record. She's asked first if anything is.
 * False once its request has begun, because the API may accept it.
 */
async function cancelAction(b: Account, id: string) {
  let later = 0, cancelled = false;
  await b.commit((state) => {
    const queued = takeable(state, id);
    later = queued ? queuedChain(state.outbox, queued).length - 1 : 0;
    return state;
  });
  if (later && !(await confirmLater(later))) throw Error("Nothing was undone.");
  await b.commit((state) => {
    const queued = takeable(state, id);
    cancelled = !!queued;
    return queued ? withoutChain(state, queued) : state;
  });
  return cancelled;
}

/** Left or Right: the record is created with its start, so it's saved and synced as soon as the side is tapped. */
export function feedWrite(childId: string, side: FeedSide, now = new Date()) {
  const action: FeedAction = { id: Crypto.randomUUID(), action: "start", at: now.toISOString(), side };
  return careWrite("feeding", childId, { method: "breast", side, state: "running", actions: [action] }, now);
}
/** One feed at a time per child, checked in the write: a timer from an older build finishes first, or it would become a second log. */
function noTimer(state: DeviceState, childId: string | null) {
  if (activeTimer(state)?.child_id === childId) throw Error("A feeding timer is running. Finish it from the timer above.");
  return state;
}
export function startFeed(b: Account, record: ReturnType<typeof careWrite>) {
  return logCare(b, record, (state) => noTimer(state, record.child_id));
}

export async function switchFeed(b: Account, feed: RunningFeed, now = new Date(), hold = undoWindow(false)) {
  const from = feed.segments[feed.segments.length - 1].side,
    id = await queueAction(b, feed.record.id, { action: "switch", at: now.toISOString(), side: from === "left" ? "right" : "left" }, hold);
  return async () => {
    // Too late to take back: switching back is the same as tapping Switch again.
    if (!(await cancelAction(b, id))) await queueAction(b, feed.record.id, { action: "switch", at: new Date().toISOString(), side: from }, 0);
  };
}

export async function finishFeed(b: Account, feed: RunningFeed, now = new Date(), hold = undoWindow(false)) {
  const id = await queueAction(b, feed.record.id, { action: "finish", at: now.toISOString() }, hold);
  return async () => {
    if (!(await cancelAction(b, id))) throw Error("This feed is already finished. You can change it in Tracker.");
  };
}

/** The record this timer's feed is already saved as, by its identity. A feed that merely began during it is someone else's. */
export function boundFeed(rows: readonly BabyRecord[], timer: FeedTimer, now = new Date()) {
  const feed = runningFeed(rows, timer.child_id, now);
  return timer.record_id && feed?.record.id === timer.record_id ? feed : undefined;
}

/** Finish a timer from an older build and clear it in one write: as a new entry, or on the record it's already bound to. */
export async function finishTimer(b: Account, timer: FeedTimer, now = new Date()) {
  const bound = boundFeed(b.records, timer, now), done = (state: DeviceState) => changeTimer(state, timer.started_at, () => undefined);
  if (bound) {
    const id = Crypto.randomUUID(), at = now.toISOString(),
      mutation: Mutation = { id, generation: b.state.bootstrap!.generation, type: "feed_action", record_id: bound.record.id, action: { id, action: "finish", at },
        hold_until: new Date(now.getTime() + undoWindow(false)).toISOString() };
    await b.commit((state) => addMutation(done(state), mutation));
    void b.sync();
    return { summary: careSummary("feeding", withFeedAction(bound.record.data, mutation.action), bound.started_at), undo: async () => {
      if (!(await cancelAction(b, id))) throw Error("This feed is already finished. You can change it in Tracker.");
      await b.commit((state) => ({ ...state, feedTimer: timer }));
    } };
  }
  const data = feedRecordData(timer, now), record = careWrite("feeding", timer.child_id, data, new Date(timer.started_at));
  return { summary: careSummary("feeding", data, record.occurred_at), undo: await logCare(b, record, done) };
}
