export const WORKOUTS_APP_ID = "com.shimizutechnology.hafaworkouts";
export const SYNC_PREFIX = "hafa-workouts:";
export type HealthPlatform = "apple_health" | "health_connect" | "unavailable";
export type AiEligibility = "unknown" | "restricted" | "eligible";
export interface HealthAvailability {
  status: "available" | "unavailable" | "update_required" | "native_build_required";
  message: string;
}
export interface HealthAccess {
  read: "granted" | "denied" | "unknown";
  write: "granted" | "denied" | "not_requested";
  message: string;
}
export interface HealthObservation {
  source_id: string;
  provider: Exclude<HealthPlatform, "unavailable">;
  origin_id: string;
  started_at: string;
  ended_at: string;
  duration_seconds: number;
  duration_basis: "provider_reported" | "elapsed_interval";
  activity_type: string;
  updated_at?: string;
  ai_eligibility: AiEligibility;
  possible_duplicate_of?: string[];
}
export interface HealthCursor {
  provider: Exclude<HealthPlatform, "unavailable">;
  window_start: string;
  window_end: string;
  phase: "bootstrap" | "changes";
  anchor?: string;
  page_token?: string;
  changes_token?: string;
}
export interface HealthPage {
  observations: HealthObservation[];
  deleted_source_ids: string[];
  next_cursor: HealthCursor;
  has_more: boolean;
  reset_required: boolean;
  coverage_notes: string[];
}
export interface ActualWorkout {
  canonical_session_id: string;
  revision: number;
  status: "completed" | "partial";
  started_at: string;
  ended_at: string;
  active_seconds: number;
  active_intervals?: Array<{ started_at: string; ended_at: string }>;
  activity: "running" | "walking" | "strength" | "basketball" | "other";
}
export interface ExportReceipt {
  status: "written" | "already_written" | "unsupported";
  source_id?: string;
  canonical_session_id: string;
  revision: number;
  message?: string;
}
export interface HealthProvider {
  readonly platform: HealthPlatform;
  availability(): Promise<HealthAvailability>;
  requestAccess(options: { read: boolean; write: boolean }): Promise<HealthAccess>;
  access(): Promise<HealthAccess>;
  readPage(cursor: HealthCursor | null, window: { start: string; end: string }): Promise<HealthPage>;
  exportActual(workout: ActualWorkout): Promise<ExportReceipt>;
  deleteOwned(canonicalSessionId: string): Promise<void>;
  openSettings(): Promise<void>;
}
export class HealthError extends Error {
  constructor(
    readonly code: string,
    message: string
  ) {
    super(message);
  }
}
