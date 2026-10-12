import type { Program, Workout } from "./models";
import { isISODate } from "./sharing";
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
      errors.push("Each session needs a day offset from 0 to 365, a label and 5–180 whole minutes.");
    if (
      !day.block_ids.length ||
      new Set(day.block_ids).size !== day.block_ids.length ||
      day.block_ids.some((id) => !ids.has(id))
    )
      errors.push("Choose valid original source blocks once per session.");
  }
  return [...new Set(errors)];
}
