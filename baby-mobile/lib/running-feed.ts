import * as Crypto from "expo-crypto";
import type { useBaby } from "./context";
import type { FeedAction, Mutation } from "./models";
import type { RunningFeed } from "./feed-reducer";
import type { FeedSide } from "./feed-timer";
import { careWrite, logCare } from "./quick-care";

type Account = Pick<ReturnType<typeof useBaby>, "commit" | "queue" | "state" | "sync" | "records">;

/**
 * How long a Switch or Done stays on this phone before it syncs, so Undo can take it back. The finish a server has
 * accepted is terminal, by contract. It is durable the moment it's tapped, and keeps the time she tapped.
 */
export const undoWindow = 6500;

function queueAction(b: Account, recordId: string, action: Omit<FeedAction, "id">, hold = undoWindow) {
  const id = Crypto.randomUUID();
  const mutation: Mutation = { id, generation: b.state.bootstrap!.generation, type: "feed_action", record_id: recordId, action: { ...action, id },
    ...(hold ? { hold_until: new Date(Date.now() + hold).toISOString() } : {}) };
  return b.queue(mutation).then(() => id);
}

/** Take back an action still on this phone. False once it has reached the server. */
async function cancelAction(b: Account, id: string) {
  let cancelled = false;
  await b.commit((state) => {
    cancelled = state.outbox.some((change) => change.id === id);
    return cancelled ? { ...state, outbox: state.outbox.filter((change) => change.id !== id) } : state;
  });
  return cancelled;
}

/** Left or Right: the record is created with its start, so it's saved and synced as soon as the side is tapped. */
export function startFeed(b: Account, childId: string, side: FeedSide, now = new Date()) {
  const at = now.toISOString(),
    action: FeedAction = { id: Crypto.randomUUID(), action: "start", at, side };
  return logCare(b, careWrite("feeding", childId, { method: "breast", side, state: "running", actions: [action] }, now));
}

export async function switchFeed(b: Account, feed: RunningFeed, now = new Date()) {
  const from = feed.segments[feed.segments.length - 1].side,
    id = await queueAction(b, feed.record.id, { action: "switch", at: now.toISOString(), side: from === "left" ? "right" : "left" });
  return async () => {
    // Too late to take back: switching back is the same as tapping Switch again.
    if (!(await cancelAction(b, id))) await queueAction(b, feed.record.id, { action: "switch", at: new Date().toISOString(), side: from }, 0);
  };
}

export async function finishFeed(b: Account, feed: RunningFeed, now = new Date()) {
  const id = await queueAction(b, feed.record.id, { action: "finish", at: now.toISOString() });
  return async () => {
    if (!(await cancelAction(b, id))) throw Error("This feed is already finished. You can change it in Tracker.");
  };
}
