import type { CoachSummary } from "./coach";
import type { Workout } from "./models";
import { hasWorkoutSource } from "./workout-presentation";

/** Plain-English labels for values the API stores as codes. Never show the raw code to people. */

/** Fallback for codes we don't know yet: "needs_information" → "Needs information". */
export function humanize(code: string) {
  const words = code.replaceAll("_", " ").trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : "";
}

export const workoutKindLabels: Record<Workout["kind"], string> = {
  session: "Workout",
  exercise: "Exercise",
  program: "Program",
  accessory: "Accessory",
};
export function workoutKindLabel(kind: string) {
  return workoutKindLabels[kind as Workout["kind"]] ?? humanize(kind);
}

const sourceSites: Array<[RegExp, string]> = [
  [/(^|\.)tiktok\.com$/, "TikTok"],
  [/(^|\.)instagram\.com$/, "Instagram"],
  [/(^|\.)(youtube\.com|youtu\.be)$/, "YouTube"],
  [/(^|\.)facebook\.com$/, "Facebook"],
  [/(^|\.)(x\.com|twitter\.com)$/, "X"],
  [/(^|\.)pinterest\.com$/, "Pinterest"],
];
const captureLabels: Record<NonNullable<Workout["capture_kind"]>, string> = {
  url: "Saved from the web",
  shared: "Saved from a share",
  images: "Saved from photos",
  document: "Saved from a document",
  text: "Saved from your notes",
};
type Origin = Pick<Workout, "provenance" | "source_url" | "source_creator" | "capture_kind" | "revision" | "blocks">;
/** Where a workout came from, in a few words: "Saved from TikTok", "Made by you", "Suggested by Coach". */
export function workoutOrigin(workout: Origin) {
  if (workout.provenance === "suggestion") return "Suggested by Coach";
  if (!hasWorkoutSource(workout)) return "Made by you";
  let host = "";
  try {
    host = workout.source_url ? new URL(workout.source_url).hostname.toLowerCase() : "";
  } catch {
    host = "";
  }
  const site = sourceSites.find(([pattern]) => pattern.test(host))?.[1];
  if (site) return `Saved from ${site}`;
  return (workout.capture_kind && captureLabels[workout.capture_kind]) || (host ? "Saved from the web" : "Saved from a source");
}

const sessionStatusLabels: Record<string, string> = {
  completed: "Completed",
  partial: "Partly done",
  in_progress: "In progress",
};
export function sessionStatusLabel(status: string) {
  return sessionStatusLabels[status] ?? humanize(status);
}

/** Noun used in "Review plan suggestion". */
export const coachActionNouns: Record<CoachSummary["kind"], string> = {
  program: "plan",
  adaptation: "workout",
  profile: "preferences",
  schedule: "schedule",
  progression: "progression",
};
export function coachActionNoun(kind: string) {
  return coachActionNouns[kind as CoachSummary["kind"]] ?? humanize(kind).toLowerCase();
}

const proposalStatusLabels: Record<string, string> = {
  ready: "Ready to review",
  needs_information: "Needs more information",
  proposed_only: "Suggestion only",
  conflicts: "Conflicts with your plan",
  unsupported: "Can’t be applied",
};
export function proposalStatusLabel(status: string) {
  return proposalStatusLabels[status] ?? humanize(status);
}
