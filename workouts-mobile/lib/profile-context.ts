import type { TrainingProfile } from "./models";
import { isISODate } from "./sharing";
export type DeclaredActivity = NonNullable<TrainingProfile["other_activities"]>[number];
export function optionalNumber(text: string) {
  if (!text.trim()) return null;
  return /^\d+(?:\.\d*)?$|^\.\d+$/.test(text.trim()) ? Number(text) : NaN;
}
export function displayedDistance(km: number, imperial: boolean) {
  return imperial ? km / 1.609344 : km;
}
export function canonicalDistance(value: number, imperial: boolean) {
  return imperial ? value * 1.609344 : value;
}
export function scheduleDate(timezone: string, now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const part = (type: string) => parts.find((p) => p.type === type)?.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}
export function contextErrors(profile: TrainingProfile) {
  const errors: string[] = [];
  const goals = profile.secondary_goals ?? [];
  if (goals.length > 5 || new Set(goals).size !== goals.length || goals.includes(profile.primary_goal))
    errors.push("Choose distinct secondary goals that differ from your main goal.");
  const baseline = profile.running_baseline;
  if (baseline) {
    if (!Number.isInteger(baseline.accepted_stage) || baseline.accepted_stage < 0 || baseline.accepted_stage > 8)
      errors.push("Your saved run/walk stage needs review before saving.");
    for (const [field, label, max] of [
      ["comfortable_walk_minutes", "Comfortable walking minutes", 1440],
      ["comfortable_run_minutes", "Comfortable running minutes", 1440],
      ["recent_weekly_minutes", "Recent weekly running minutes", 10080],
      ["recent_runs_per_week", "Recent runs per week", 14],
    ] as const) {
      const value = baseline[field];
      if (value != null && (!Number.isInteger(value) || value < 0 || value > max))
        errors.push(`${label} must be a whole number between 0 and ${max}.`);
    }
    if (
      baseline.event_distance_km != null &&
      (!Number.isFinite(baseline.event_distance_km) ||
        baseline.event_distance_km <= 0 ||
        baseline.event_distance_km > 500)
    )
      errors.push("Enter an event distance above zero and at most 500 km (310.69 miles).");
    if (baseline.event_date != null && !isISODate(baseline.event_date))
      errors.push("Choose a valid event date in YYYY-MM-DD format.");
  }
  const activities = profile.other_activities ?? [];
  if (activities.length > 500) errors.push("Keep no more than 500 activity declarations.");
  activities.forEach((activity, index) => {
    if (!isISODate(activity.date)) errors.push(`Activity ${index + 1} needs a valid calendar date.`);
    if (!activity.name.trim() || activity.name.length > 200)
      errors.push(`Activity ${index + 1} needs a name of 1–200 characters.`);
    if (
      activity.duration_minutes != null &&
      (!Number.isInteger(activity.duration_minutes) ||
        activity.duration_minutes < 0 ||
        activity.duration_minutes > 1440)
    )
      errors.push(`Activity ${index + 1} needs whole minutes from 0 to 1440, or an unspecified duration.`);
  });
  return errors;
}
