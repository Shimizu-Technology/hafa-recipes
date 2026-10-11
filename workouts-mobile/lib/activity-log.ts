import { isISODate } from "./sharing";
import { dateInTimezone } from "./training";
export type ActivityKind = "run" | "walk" | "basketball" | "other";
export const activityLabels: Record<ActivityKind, string> = {
  run: "Run",
  walk: "Walk",
  basketball: "Basketball",
  other: "Other activity",
};
export interface ActivityContent {
  kind: ActivityKind;
  date: string;
  name: string;
  duration_minutes: number | null;
  strenuous: boolean | null;
  distance_km: number | null;
  notes: string | null;
}
export interface ActivityRecord {
  id: string;
  generation: number;
  revision: number;
  status: "active" | "removed";
  content: ActivityContent | null;
  source: "user" | "external";
  read_only: boolean;
  legacy: boolean;
  completed_confirmed: true | null;
  origin_id: string | null;
  created_at: string;
  updated_at: string;
}
export interface ActivityPage {
  items: ActivityRecord[];
  has_more: boolean;
  timezone: string;
  today: string;
  limit: number;
  offset: number;
}
export interface ActivityWrite {
  request_id: string;
  kind: ActivityKind;
  date: string;
  duration_minutes: number;
  name?: string | null;
  strenuous: boolean | null;
  distance_km?: number | null;
  notes?: string | null;
  expected_revision?: number;
}
export interface ActivityMutation extends ActivityRecord {
  profile_revision: number;
}
export interface ActivityOperation {
  owner: string;
  generation: number;
  target_id: string | null;
  action: "save" | "remove";
  body: ActivityWrite | { request_id: string; expected_revision: number };
}
export interface ActivityDraft {
  owner: string;
  generation: number;
  target_id: string | null;
  kind: ActivityKind;
  date: string;
  name: string;
  duration: string;
  distance: string;
  distance_unit: "km" | "mi";
  notes: string;
  strenuous: boolean | null;
  expected_revision?: number;
  confirm_completed: boolean;
  operation?: ActivityOperation;
}
export function activityQuery(offset = 0, from?: string, to?: string) {
  const q = new URLSearchParams({ limit: "50", offset: String(offset) });
  if (from) q.set("from_date", from);
  if (to) q.set("to_date", to);
  return q.toString();
}
export function activityErrors(draft: ActivityDraft, today: string) {
  const errors: string[] = [];
  if (!isISODate(draft.date) || !isISODate(today)) errors.push("Choose a valid completed activity date.");
  else {
    const first = new Date(today + "T12:00:00Z");
    first.setUTCDate(first.getUTCDate() - 3650);
    if (draft.date > today || draft.date < first.toISOString().slice(0, 10))
      errors.push("Choose today or a past activity within ten years, in your training timezone.");
  }
  if (!draft.confirm_completed)
    errors.push("Confirm this activity already happened. Future plans belong in schedule declarations.");
  if (!/^\d+$/.test(draft.duration) || Number(draft.duration) < 1 || Number(draft.duration) > 1440)
    errors.push("Enter whole minutes from 1 to 1440.");
  if (draft.name.trim().length > 200) errors.push("Keep the activity name within 200 characters.");
  if (draft.notes.length > 2000) errors.push("Keep notes within 2000 characters.");
  if (draft.distance.trim()) {
    const value = Number(draft.distance);
    const km = draft.distance_unit === "mi" ? value * 1.609344 : value;
    if (!/^\d+(?:\.\d*)?$|^\.\d+$/.test(draft.distance.trim()) || !Number.isFinite(km) || km <= 0 || km > 500)
      errors.push("Enter a positive distance of at most 500 km (310.69 miles).");
    if (!["run", "walk"].includes(draft.kind)) errors.push("Distance is optional for a run or walk only.");
  }
  return errors;
}
export function activityBody(draft: ActivityDraft, requestId: string): ActivityWrite {
  return {
    request_id: requestId,
    kind: draft.kind,
    date: draft.date,
    duration_minutes: Number(draft.duration),
    name: draft.name.trim() || null,
    strenuous: draft.strenuous,
    distance_km: draft.distance.trim()
      ? draft.distance_unit === "mi"
        ? Number(draft.distance) * 1.609344
        : Number(draft.distance)
      : null,
    notes: draft.notes.trim() || null,
    ...(draft.target_id ? { expected_revision: draft.expected_revision } : {}),
  };
}
export function operationIsCurrent(
  operation: ActivityOperation,
  owner: string,
  generation: number,
  target: string | null,
  storageCurrent: boolean
) {
  return (
    storageCurrent && operation.owner === owner && operation.generation === generation && operation.target_id === target
  );
}
export function activityFrequency(
  entries: ActivityRecord[],
  sessions: Array<{ started_at: string; recorded: boolean }>,
  timezone: string,
  from: string,
  to: string
) {
  const days = new Set<string>();
  let activityCount = 0,
    sessionCount = 0;
  for (const entry of entries) {
    if (
      entry.status === "active" &&
      !entry.read_only &&
      entry.source === "user" &&
      entry.completed_confirmed === true &&
      entry.content &&
      entry.content.date >= from &&
      entry.content.date <= to
    ) {
      activityCount++;
      days.add(entry.content.date);
    }
  }
  for (const session of sessions) {
    if (!session.recorded || !Number.isFinite(Date.parse(session.started_at))) continue;
    const date = dateInTimezone(new Date(session.started_at), timezone);
    if (date >= from && date <= to) {
      sessionCount++;
      days.add(date);
    }
  }
  return { days: days.size, activities: activityCount, sessions: sessionCount };
}

export async function weekActivity(load: (offset: number, from?: string, to?: string) => Promise<ActivityPage>) {
  const initial = await load(0);
  if (!isISODate(initial.today))
    throw Error("The training calendar could not be read. Refresh before counting activity.");
  const date = new Date(initial.today + "T12:00:00Z");
  date.setUTCDate(date.getUTCDate() - 6);
  const from = date.toISOString().slice(0, 10);
  const items: ActivityRecord[] = [];
  let page: ActivityPage;
  for (let offset = 0; offset <= 10000; offset += 50) {
    page = await load(offset, from, initial.today);
    if (page.timezone !== initial.timezone)
      throw Error("Your training timezone changed. Refresh before counting activity.");
    items.push(...page.items);
    if (!page.has_more)
      return {
        items: [...new Map(items.map((item) => [item.id, item])).values()],
        from,
        to: initial.today,
        timezone: initial.timezone,
        complete: true,
      };
  }
  return {
    items: [...new Map(items.map((item) => [item.id, item])).values()],
    from,
    to: initial.today,
    timezone: initial.timezone,
    complete: false,
  };
}
