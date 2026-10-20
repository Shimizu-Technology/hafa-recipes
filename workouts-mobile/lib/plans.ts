import type { Program, Workout } from "./models";
import { isISODate } from "./sharing";
export function programMoveError(error: unknown): string {
  const rejected = error as { status?: number; detail?: string } | null;
  if (rejected?.status === 409) {
    switch (rejected.detail) {
      case "Keep session spacing and avoid stacking training":
        return "Choose a date with a recovery day between demanding sessions.";
      case "Training availability or another activity conflicts with this date":
        return "Choose one of your available training days without another activity, or update your training profile.";
      case "Keep recovery around declared game days":
        return "Choose a date with recovery time around your game days.";
      case "Another plan already has a session on this date":
        return "Another plan already has a session that day. Choose a different date.";
      case "Confirm readiness before applying a training change":
        return "Confirm your current readiness in the date editor before moving this session.";
    }
  }
  return error instanceof Error ? error.message : "The session could not be moved. Try again.";
}
export interface ProgramReceipt {
  id: string;
  generation: number;
  profile_revision: number;
  proposal: Omit<Program, "id" | "title" | "revision" | "generation">;
  expires_at: string;
  accepted_record_id: string | null;
}
export interface SourceChoices {
  source_workout_ids: string[];
  source_mode: "mixed" | "selected";
  reviewed_custom_routines: boolean;
  source_minutes: Record<string, number>;
}
export interface SourceProgramDay {
  day_offset: number;
  block_ids: string[];
  label: string;
  duration_minutes: number;
}
export function sourceChoiceErrors(ids: string[], minutes: Record<string, string>) {
  const errors: string[] = [];
  if (ids.length > 10 || new Set(ids).size !== ids.length) errors.push("Select up to 10 distinct source workouts.");
  for (const id of ids) {
    const text = minutes[id]?.trim();
    if (text && (!Number.isInteger(Number(text)) || Number(text) < 5 || Number(text) > 180))
      errors.push("Reviewed session times must be whole minutes from 5 to 180.");
  }
  return errors;
}
export function sourceDayErrors(workout: Workout, start_date: string, days: SourceProgramDay[]) {
  const errors: string[] = [];
  if (!isISODate(start_date)) errors.push("Choose a valid calendar start date.");
  if (!days.length || days.length > 366) errors.push("Add at least one day assignment, up to 366 sessions.");
  const ids = new Set(workout.blocks.map((block) => block.id));
  for (const day of days) {
    if (
      !Number.isInteger(day.day_offset) ||
      day.day_offset < 0 ||
      day.day_offset > 365 ||
      !day.label.trim() ||
      day.label.length > 200 ||
      !Number.isInteger(day.duration_minutes) ||
      day.duration_minutes < 5 ||
      day.duration_minutes > 180
    )
      errors.push("Each session needs a date within a year of the start, a name, and 5–180 whole minutes.");
    if (
      !day.block_ids.length ||
      new Set(day.block_ids).size !== day.block_ids.length ||
      day.block_ids.some((id) => !ids.has(id))
    )
      errors.push("Pick at least one part of the workout for each session.");
  }
  return [...new Set(errors)];
}
