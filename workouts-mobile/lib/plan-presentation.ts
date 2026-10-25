import { formatSeconds } from "./discover";
import type { ExercisePrescription, Program, ScheduledSession, Workout } from "./models";

/** Plan lengths offered when building a plan. The API accepts 1–12 weeks. */
export const PLAN_WEEK_OPTIONS = ["2", "4", "6", "8", "12"] as const;

/** A plan length to show and send: legacy free-text lengths keep any valid 1–12 value, otherwise 4 weeks. */
export function planWeeks(value: string | null | undefined) {
  const weeks = Number(value);
  return Number.isInteger(weeks) && weeks >= 1 && weeks <= 12 ? String(weeks) : "4";
}
/** Segments for the plan length, including a restored length that isn't one of the standard choices. */
export function planWeekOptions(current: string) {
  return [...new Set([...PLAN_WEEK_OPTIONS, planWeeks(current)])].sort((a, b) => Number(a) - Number(b));
}

/** Where a planned session's prescription came from, shown once per session. */
export const provenanceLabels: Record<Workout["provenance"], string> = {
  suggestion: "Suggested by Håfa",
  user: "From your saved workout",
  source: "From the original source",
};

/**
 * The next session still to train: the earliest scheduled today or later in a
 * ready plan that isn't paused or archived and hasn't been recorded.
 */
export function nextPlannedSession(programs: Program[] | undefined, today: string, recorded: (p: Program, s: ScheduledSession) => boolean) {
  return programs?.filter((p) => p.status === "ready" && !p.schedule_state?.archived_at && p.schedule_state?.status !== "paused")
    .flatMap((p) => p.sessions.filter((s) => s.date >= today && !recorded(p, s)).map((s) => ({ p, s })))
    .sort((a, b) => a.s.date.localeCompare(b.s.date))[0];
}

/** "2026-11-13" → "Fri, Nov 13" (the year is added when it isn't the current one). */
export function formatPlanDate(iso: string, now = new Date(), locale?: string) {
  const at = new Date(`${iso}T12:00:00Z`);
  // Shaped but impossible dates (2026-02-30) would roll into another month; keep them as written.
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso) || Number.isNaN(at.getTime()) || at.toISOString().slice(0, 10) !== iso) return iso;
  return new Intl.DateTimeFormat(locale, {
    weekday: "short",
    month: "short",
    day: "numeric",
    ...(at.getUTCFullYear() !== now.getFullYear() ? { year: "numeric" as const } : {}),
    timeZone: "UTC",
  }).format(at);
}

/** One quiet line under a workout title: "45 min · 4 exercises · Dumbbells, pull-up bar". */
export function workoutMeta({
  minutes,
  timeCap,
  exercises,
  equipment,
}: {
  minutes?: number | null;
  timeCap?: string | null;
  exercises: number;
  equipment?: string[] | null;
}) {
  return [
    timeCap ? `${timeCap} AMRAP` : minutes ? `${minutes} min` : null,
    `${exercises} ${exercises === 1 ? "exercise" : "exercises"}`,
    equipment?.length ? equipment.join(", ") : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

/** "3 sets · 8–12 reps · each side · 90s rest" for compact plan previews. Unknown targets are left out. */
export function exerciseTargets(e: ExercisePrescription, omitSets = false) {
  return [
    omitSets || e.sets == null ? null : `${e.sets} ${e.sets === 1 ? "set" : "sets"}`,
    e.reps_min == null
      ? null
      : e.reps_max != null && e.reps_max !== e.reps_min
        ? `${e.reps_min}–${e.reps_max} reps`
        : `${e.reps_min} ${e.reps_min === 1 ? "rep" : "reps"}`,
    e.per_side ? "each side" : null,
    e.duration_seconds != null ? formatSeconds(e.duration_seconds) : null,
    e.distance_meters != null ? `${e.distance_meters} m` : null,
    e.load != null
      ? [e.load, e.load_unit, e.load_convention?.replaceAll("_", " ")].filter((part) => part != null).join(" ")
      : null,
    e.rest_seconds != null ? `${e.rest_seconds}s rest` : null,
    e.tempo ? `Tempo ${e.tempo}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

/**
 * Effort guidance every exercise in a proposal shares, shown once instead of on
 * each exercise. Null when any exercise has no effort or a different one, so an
 * exercise without guidance never appears to carry it.
 */
export function sharedEffort(workouts: { blocks: { exercises: { effort?: string | null }[] }[] }[]) {
  const efforts = workouts.flatMap((w) => w.blocks.flatMap((b) => b.exercises.map((e) => e.effort ?? null)));
  const first = efforts[0];
  return efforts.length > 1 && first && efforts.every((effort) => effort === first) ? first : null;
}
