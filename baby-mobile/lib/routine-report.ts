import type { DeviceState, RecordData } from "./models";
import { reminderNotificationData } from "./notification-route";
import { pendingRecords } from "./outbox";

interface Scheduled {
  content: { data?: Record<string, unknown> | null };
}
/** Matches the API's `routine_schedule`: an edit that doesn't change when it fires doesn't change this. */
export const routineSchedule = (data: Pick<RecordData, "reminder_at" | "repeat" | "timezone">) =>
  `${data.reminder_at}|${data.repeat || "none"}|${data.timezone || ""}`;

/**
 * What this phone really has scheduled, read back rather than assumed, for routines the API has at the same schedule. An
 * edit still waiting here counts only if it leaves the time alone: a new title changes nothing about what the phone holds,
 * and leaving it out would have the API send a second one. A new time isn't claimed, since the API doesn't know it yet.
 */
export function heldRoutines(scheduled: readonly Scheduled[], owner: string, generation: number, state: Pick<DeviceState, "records" | "outbox">) {
  const shown = new Map(pendingRecords(state as DeviceState).map((row) => [row.id, row])), holds: Record<string, string> = {};
  for (const { content } of scheduled) {
    const data = content.data, id = data?.recordId;
    if (data?.babyOwner !== owner || data.generation !== generation || typeof id !== "string") continue;
    const saved = state.records.find((row) => row.id === id && row.kind === "routine"), waiting = shown.get(id);
    if (!saved || !waiting || routineSchedule(waiting.data) !== routineSchedule(saved.data)) continue;
    const fired = [saved, waiting].some((row) => reminderNotificationData(owner, generation, row).signature === data.signature);
    if (fired) holds[id] = routineSchedule(saved.data);
  }
  return holds;
}
