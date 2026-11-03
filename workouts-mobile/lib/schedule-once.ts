import { authoredWorkout } from "./api";
import type { AuthoredWorkout, Workout } from "./models";
import { isISODate } from "./sharing";
// Existing /programs contract: source snapshots use the current rule envelope, without generated prescriptions.
export const scheduleRuleVersion = "hafa-general-2026-10-25.3";
/** The server refuses to retain a source cover whose cleanup already ran; the only way forward is to schedule without it. */
export function isExpiredCoverError(error: unknown) {
  const { message, detail } = (error ?? {}) as { message?: unknown; detail?: unknown };
  return [message, detail].some((text) => typeof text === "string" && /source cover expired/i.test(text));
}
/** The workout as scheduled when its cover can't be kept: same prescription, no source cover or cover origin. */
function withoutCover(workout: AuthoredWorkout): AuthoredWorkout {
  const { source_thumbnail_url: _cover, cover_origin: _origin, ...rest } = workout;
  return rest;
}
export function scheduleOnceCommand(workout: Workout, date: string, time: string, request_id: string, options: { withoutCover?: boolean } = {}) {
  if (!isISODate(date)) throw Error("Choose a valid date.");
  if (time && !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw Error("Use a time like 18:30, or leave it blank.");
  return { request_id, title: workout.title, proposal: {
    status: "ready" as const, rule_version: scheduleRuleVersion, source_ids: [], questions: [], warnings: [], assumptions: [],
    progression_policy: "One saved workout scheduled once. No automatic progression.",
    sessions: [{ id: request_id, date, purpose: time ? `${workout.title} · ${time}` : workout.title, workout: options.withoutCover ? withoutCover(authoredWorkout(workout)) : authoredWorkout(workout) }],
  } };
}
export type ScheduleOnceCommand = ReturnType<typeof scheduleOnceCommand>;
