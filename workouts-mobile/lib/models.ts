import { contextErrors } from "./profile-context";
import { equipmentLocationErrors } from "./equipment";
import type { Organization } from "./organization";
export type Goal = "general_fitness" | "strength" | "body_composition" | "running" | "athletic_conditioning";
export type Experience = "new" | "returning" | "regular";
export interface EquipmentLocation {
  id: string;
  name: string;
  equipment: string[];
  available_loads_kg: number[];
}
export interface TrainingProfile {
  adult_confirmed: boolean;
  primary_goal: Goal;
  experience: Experience;
  equipment: string[] | null;
  equipment_locations?: EquipmentLocation[];
  active_equipment_location_id?: string | null;
  available_days: number[];
  session_minutes: number;
  timezone: string;
  movement_exclusions: string[];
  limitations: string[];
  readiness: "ready" | "unknown" | "limited";
  age_years?: number | null;
  weight_kg?: number | null;
  weight_recorded_at?: string | null;
  height_cm?: number | null;
  height_recorded_at?: string | null;
  secondary_goals?: Goal[];
  running_baseline?: {
    novice_start_confirmed: boolean;
    accepted_stage: number;
    comfortable_walk_minutes?: number | null;
    comfortable_run_minutes?: number | null;
    recent_weekly_minutes?: number | null;
    recent_runs_per_week?: number | null;
    event_distance_km?: number | null;
    event_date?: string | null;
  } | null;
  other_activities?: Array<{
    date: string;
    name: string;
    strenuous?: boolean | null;
    duration_minutes?: number | null;
    origin_id?: string | null;
  }>;
  body_composition_priority?: "maintain" | "fat_loss" | "muscle_gain" | null;
  strength_priority?: "strength" | "muscle" | "both" | null;
  activity_focus?: string | null;
  available_loads_kg?: number[];
  interrupted?: boolean;
}
export interface Workout {
  id: string;
  revision: number;
  generation: number;
  organization?: Organization;
  version?: number;
  parent_version_id?: string | null;
  title: string;
  kind: "exercise" | "accessory" | "session" | "program";
  provenance: "source" | "user" | "suggestion";
  equipment_required?: string[];
  equipment_optional?: string[];
  estimated_minutes?: number | null;
  blocks: Array<{
    id: string;
    label: string;
    grouping: "sequential" | "circuit" | "superset" | "interval";
    rounds?: number | null;
    rest_between_rounds_seconds?: number | null;
    exercises: ExercisePrescription[];
  }>;
  capture_kind?: "url" | "text" | "images" | "document" | "shared";
  source_url?: string | null;
  notes?: string[];
}
export interface ExercisePrescription {
  exercise_id?: string | null;
  name: string;
  provenance?: "source" | "user" | "suggestion";
  sets?: number | null;
  reps_min?: number | null;
  reps_max?: number | null;
  per_side?: boolean | null;
  duration_seconds?: number | null;
  distance_meters?: number | null;
  rest_seconds?: number | null;
  tempo?: string | null;
  load?: number | null;
  load_unit?: "kg" | "lb" | null;
  load_convention?: "total" | "per_hand" | "added" | "assistance" | null;
  effort?: string | null;
  notes?: string | null;
  evidence?: Array<{ field: string; wording: string; location?: string | null }>;
}
export type AuthoredWorkout = Omit<
  Workout,
  "id" | "revision" | "generation" | "version" | "parent_version_id" | "organization"
>;
export interface ScheduledSession {
  id: string;
  date: string;
  purpose: string;
  workout: Workout;
}
export interface Program {
  schedule_state?: { status: "active" | "paused"; paused_at?: string; paused_sessions?: ScheduledSession[] };
  id: string;
  revision: number;
  generation: number;
  title: string;
  status: "ready" | "needs_information" | "conflicts" | "unsupported";
  sessions: ScheduledSession[];
  questions: string[];
  warnings: string[];
  assumptions: string[];
  source_ids: string[];
  rule_version: string;
}
export interface TrainingSession {
  id: string;
  generation: number;
  client_session_id: string;
  title: string;
  started_at: string;
  status: "in_progress" | "completed" | "partial";
  duration_minutes?: number;
  content: SessionRequest & { prescription_snapshot: Workout };
}
export interface Enrollment {
  enrolled: boolean;
  generation: number | null;
  disclosure_version: number;
  adult_confirmed: boolean;
  shared_account_deletion_acknowledged: boolean;
  enrolled_at: string | null;
}
export interface ActualSet {
  block_id: string;
  exercise_index: number;
  set_index: number;
  round_index: number;
  side?: "left" | "right" | "both" | null;
  reps?: number | null;
  duration_seconds?: number | null;
  distance_meters?: number | null;
  load?: number | null;
  load_unit?: "kg" | "lb" | null;
  load_convention?: "total" | "per_hand" | "added" | "assistance" | null;
  completed: boolean;
  difficulty?: "easy" | "manageable" | "hard" | null;
  effort?: number | null;
  pain_reported?: boolean | null;
  notes?: string | null;
}
export interface SessionRequest {
  client_session_id: string;
  workout_id?: string;
  workout_revision?: number;
  program_id?: string;
  program_revision?: number;
  program_session_id?: string;
  started_at: string;
  finished_at: string;
  status: "completed" | "partial";
  active_seconds?: number;
  active_intervals?: Array<{ started_at: string; ended_at: string }>;
  activity_type?: string;
  actuals: ActualSet[];
  notes?: string | null;
  supersedes_session_id?: string;
}
export const goalLabels: Record<Goal, string> = {
  general_fitness: "Feel stronger every day",
  strength: "Build strength",
  body_composition: "Body composition",
  running: "Run with a plan",
  athletic_conditioning: "Train for my activities",
};
export function initialProfile(): TrainingProfile {
  return {
    adult_confirmed: false,
    primary_goal: "general_fitness",
    experience: "new",
    equipment: null,
    available_days: [0, 2, 4],
    session_minutes: 30,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    movement_exclusions: [],
    limitations: [],
    readiness: "unknown",
  };
}
export function profileErrors(profile: TrainingProfile): string[] {
  const errors: string[] = [];
  if (!profile.adult_confirmed) errors.push("Confirm you are 18 or older to continue.");
  if (profile.available_days.length === 0) errors.push("Choose at least one training day.");
  if (profile.available_days.some((day) => !Number.isInteger(day) || day < 0 || day > 6))
    errors.push("Choose valid training days.");
  if (!Number.isInteger(profile.session_minutes) || profile.session_minutes < 5 || profile.session_minutes > 180)
    errors.push("Choose a whole number of minutes between 5 and 180.");
  try {
    new Intl.DateTimeFormat("en", { timeZone: profile.timezone });
  } catch {
    errors.push("Enter a valid timezone, such as Pacific/Guam.");
  }
  if (
    profile.age_years != null &&
    (!Number.isInteger(profile.age_years) || profile.age_years < 18 || profile.age_years > 120)
  )
    errors.push("Age must be between 18 and 120.");
  if (
    profile.weight_kg != null &&
    (!Number.isFinite(profile.weight_kg) || profile.weight_kg <= 0 || profile.weight_kg > 500)
  )
    errors.push("Enter a valid weight in kg.");
  if (
    profile.height_cm != null &&
    (!Number.isFinite(profile.height_cm) || profile.height_cm <= 0 || profile.height_cm > 300)
  )
    errors.push("Enter a valid height in cm.");
  errors.push(...equipmentLocationErrors(profile.equipment_locations ?? [], profile.active_equipment_location_id));
  if (
    (profile.available_loads_kg?.length ?? 0) > 100 ||
    profile.available_loads_kg?.some((load) => !Number.isFinite(load) || load <= 0 || load > 2000)
  )
    errors.push("Check your available equipment loads.");
  errors.push(...contextErrors(profile));
  return errors;
}
