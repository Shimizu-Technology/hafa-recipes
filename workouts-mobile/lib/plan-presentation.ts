import type { ExercisePrescription } from "./models";

/** Plan lengths offered when building a plan. The API accepts 1–12 weeks. */
export const PLAN_WEEK_OPTIONS = ["2", "4", "6", "8", "12"] as const;

/** "2026-11-13" → "Fri, Nov 13" (the year is added when it isn't the current one). */
export function formatPlanDate(iso: string, now = new Date(), locale?: string) {
  const at = new Date(`${iso}T12:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso) || Number.isNaN(at.getTime())) return iso;
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

/** "3 sets · 8–12 reps · each side · 90s rest" for compact plan previews. */
export function exerciseTargets(e: ExercisePrescription, omitSets = false) {
  return [
    omitSets ? null : e.sets == null ? "Sets not specified" : `${e.sets} sets`,
    e.reps_min == null
      ? e.duration_seconds == null && e.distance_meters == null ? "Reps not specified" : null
      : e.reps_max != null && e.reps_max !== e.reps_min
        ? `${e.reps_min}–${e.reps_max} reps`
        : `${e.reps_min} reps`,
    e.per_side ? "each side" : null,
    e.duration_seconds != null ? `${e.duration_seconds}s target time` : null,
    e.distance_meters != null ? `${e.distance_meters}m target distance` : null,
    e.load != null
      ? `${e.load} ${e.load_unit ?? "unit not specified"} ${e.load_convention?.replaceAll("_", " ") ?? "· load convention not specified"}`
      : null,
    e.rest_seconds != null ? `${e.rest_seconds}s rest` : null,
    e.tempo ? `Tempo ${e.tempo}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

/** The effort note most exercises in a proposal share, shown once instead of on every exercise. */
export function sharedEffort(workouts: { blocks: { exercises: { effort?: string | null }[] }[] }[]) {
  const counts = new Map<string, number>();
  for (const w of workouts)
    for (const b of w.blocks) for (const e of b.exercises) if (e.effort) counts.set(e.effort, (counts.get(e.effort) ?? 0) + 1);
  let best: string | null = null;
  for (const [effort, count] of counts) if (count > 1 && (!best || count > counts.get(best)!)) best = effort;
  return best;
}
