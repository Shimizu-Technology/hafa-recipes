import type { DeviceState, RecordData } from "./models";
import { reminderNotificationData } from "./notification-route";

interface Scheduled {
  content: { data?: Record<string, unknown> | null };
}
/** Matches the API's `routine_schedule`: an edit that doesn't change when it fires doesn't change this. */
export const routineSchedule = (data: Pick<RecordData, "reminder_at" | "repeat" | "timezone">) =>
  `${data.reminder_at}|${data.repeat || "none"}|${data.timezone || ""}`;

/**
 * What this phone really has scheduled, read back rather than assumed, for routines the API has at the same schedule. A
 * routine with an edit still waiting here isn't claimed: the API doesn't know that time yet, and comparing it would be
 * comparing two different things.
 */
export function heldRoutines(scheduled: readonly Scheduled[], owner: string, generation: number, state: Pick<DeviceState, "records" | "outbox">) {
  const waiting = new Set(state.outbox.flatMap((m) => (m.type === "save" || m.type === "delete" ? [m.record.id] : []))),
    holds: Record<string, string> = {};
  for (const { content } of scheduled) {
    const data = content.data, id = data?.recordId;
    if (data?.babyOwner !== owner || data.generation !== generation || typeof id !== "string" || waiting.has(id)) continue;
    const record = state.records.find((row) => row.id === id && row.kind === "routine");
    if (record && reminderNotificationData(owner, generation, record).signature === data.signature) holds[id] = routineSchedule(record.data);
  }
  return holds;
}
