import type { BabyRecord, RecordData, SessionAction } from "./models";
import { instant } from "./feed-reducer";

/**
 * Mirror of `reduce_session` in the API's sessions.py. Each tap and stop has its own identity and needs no revision,
 * so two phones add up rather than conflict, and a retry changes nothing. It depends only on the set of actions.
 */
export function reduceSession(actions: readonly SessionAction[] = []) {
  const undone = new Set(actions.flatMap((action) => (action.action === "undo" && action.target ? [action.target] : []))),
    live = actions.filter((action) => action.action !== "undo" && !undone.has(action.id)),
    time = (a: SessionAction, b: SessionAction) => instant(a.at) - instant(b.at) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    taps = live.filter((action) => action.action === "tap").sort(time),
    stops = live.filter((action) => action.action === "finish").sort(time);
  return { taps, count: taps.length, end_at: stops[0]?.at };
}

/** A record with one more action, as the API will store it. Applying the same action twice changes nothing. */
export function withSessionAction(record: BabyRecord, action: SessionAction): BabyRecord {
  const known = record.data.session_actions ?? [];
  if (known.some((item) => item.id === action.id)) return record;
  const session_actions = [...known, action], { count, end_at } = reduceSession(session_actions);
  // A phone whose clock runs behind can stop a session before the start another phone gave it.
  const end = end_at && instant(end_at) < instant(record.occurred_at) ? record.occurred_at : end_at;
  const data: RecordData = { ...record.data, session_actions, end_at: end, ...(record.kind === "kick_session" ? { count } : {}) };
  return { ...record, data };
}
