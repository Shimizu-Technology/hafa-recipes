import type { AuthoredWorkout } from "./models";
import type { drafts } from "./drafts";
export interface ImportReference { id: string; generation?: number; label: string; created_at?: string; auto_save?: boolean }
const referenceWrites = new Map<string, Promise<void>>();
/** Intake and completion share one queue so finishing A cannot erase a newer import B. */
export function updateImportReferences(storage: ReturnType<typeof drafts>, owner: string, generation: number,
  guard: CaptureGuard, update: (items: ImportReference[]) => ImportReference[]) {
  const key = JSON.stringify([owner, generation]);
  const next = (referenceWrites.get(key) ?? Promise.resolve()).catch(() => undefined).then(async () => {
    guard();
    const prior = await storage.load<ImportReference[]>(owner, `imports:${generation}`) ?? [];
    guard();
    await storage.save(owner, `imports:${generation}`, update(prior));
    guard();
  });
  referenceWrites.set(key, next);
  void next.finally(() => { if (referenceWrites.get(key) === next) referenceWrites.delete(key); }).catch(() => undefined);
  return next;
}
export type CaptureKind = "url" | "text" | "images" | "document";
export interface CaptureFile {
  uri: string;
  mime_type: string;
  name: string;
  owned: boolean;
}
export interface CaptureDraft {
  request_id: string;
  generation: number;
  kind: CaptureKind;
  text: string;
  source_url: string;
  files: CaptureFile[];
  cleanup_files?: CaptureFile[];
  job_id?: string;
  pending_import?: boolean;
  auto_save?: boolean;
  created_at: string;
}
/** Supplied by the original account/enrollment/screen; native helpers stay UI-free. */
export type CaptureGuard = () => void;
export interface ExtractionRequest {
  kind: CaptureKind;
  text?: string;
  source_url?: string;
  images?: Array<{ base64_data: string; mime_type: string }>;
  document_base64?: string;
  document_mime?: string;
  ai_consent: boolean;
}
export interface Evidence {
  field: string;
  wording: string;
  location?: string | null;
}
export interface ImportJob {
  id: string;
  generation: number;
  status: "queued" | "processing" | "ready" | "incomplete" | "failed" | "cancelled" | "expired";
  attempt_count: number;
  result: {
    status: "ready" | "incomplete" | "failed";
    workout: AuthoredWorkout | null;
    evidence: Evidence[];
    warnings: string[];
    source: {
      url?: string | null;
      canonical_key?: string | null;
      platform: string;
      title?: string | null;
      creator?: string | null;
      duration_seconds?: number | null;
      channels: string[];
      coverage_notes: string[];
    };
    error_code?: string | null;
  } | null;
  expires_at: string;
  accepted_workout_id: string | null;
}
export interface Capabilities {
  /** Absent on old servers; only an explicit true selects durable jobs. */
  export_jobs?: boolean;
  generation: number;
  public_beta: boolean;
  imports: boolean;
  coach: boolean;
  health_sync: boolean;
  /** Absent on servers before Discover; only an explicit true shows Discover. */
  discover?: boolean;
  limits: { successful_or_pending_imports_per_rolling_day: number; coach_messages_per_rolling_day: number };
  billing_active: boolean;
}
export function captureErrors(draft: CaptureDraft): string[] {
  const errors: string[] = [];
  if (draft.kind === "url") {
    try {
      const url = new URL(draft.source_url.trim());
      if (!["https:", "http:"].includes(url.protocol) || url.username || url.password || !url.hostname) throw Error();
    } catch {
      errors.push("Paste a complete http or https source link without account credentials.");
    }
  }
  if (draft.kind === "text" && (!draft.text.trim() || draft.text.length > 30000))
    errors.push("Paste workout text between 1 and 30,000 characters.");
  if ((draft.kind === "images" || draft.kind === "document") && !draft.files.length)
    errors.push("Choose a source file first.");
  if (draft.kind === "images" && draft.files.length > 4) errors.push("Choose up to four clear images.");
  return errors;
}
export function boundedSource(source: ExtractionRequest): ExtractionRequest {
  const bytes = new TextEncoder().encode(JSON.stringify(source)).byteLength;
  if (bytes > 3 * 1024 * 1024)
    throw Error("These files are too large together. Use fewer images or paste the workout text.");
  return source;
}
export function importIsTerminal(status: ImportJob["status"]) {
  return !["queued", "processing"].includes(status);
}
/** Only an unchanged complete extraction can skip the missing-details review. */
export function canSaveAutomatically(job: ImportJob) {
  return !job.accepted_workout_id && job.status === "ready" && job.result?.status === "ready" &&
    !!job.result.workout && job.result.warnings.length === 0;
}
