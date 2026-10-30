import { authoredWorkout } from "./api";
import type { Workout } from "./models";
import { isISODate } from "./sharing";
// Existing /programs contract: source snapshots use the current rule envelope, without generated prescriptions.
export const scheduleRuleVersion = "hafa-general-2026-10-25.3";
export function scheduleOnceCommand(workout: Workout, date: string, time: string, request_id: string) {
  if (!isISODate(date)) throw Error("Choose a valid date.");
  if (time && !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw Error("Use a time like 18:30, or leave it blank.");
  return { request_id, title: workout.title, proposal: {
    status: "ready" as const, rule_version: scheduleRuleVersion, source_ids: [], questions: [], warnings: [], assumptions: [],
    progression_policy: "One saved workout scheduled once. No automatic progression.",
    sessions: [{ id: request_id, date, purpose: time ? `${workout.title} · ${time}` : workout.title, workout: authoredWorkout(workout) }],
  } };
}
export type ScheduleOnceCommand = ReturnType<typeof scheduleOnceCommand>;
