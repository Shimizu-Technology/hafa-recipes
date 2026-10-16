import type { AuthoredWorkout } from "./models";
import { drafts } from "./drafts";
import type { Storage } from "./drafts";
import { createPrivateDraftSlot, type PrivateDraftSnapshot } from "./private-form";
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
/** Match Recipes: social apps may share a link inside caption text or URL metadata. */
export function sharedWorkoutURL(webUrl?: string | null, text?: string | null, metadataUrl?: string | null) {
  const direct = webUrl?.trim() || metadataUrl?.trim();
  if (direct && /^https?:\/\//i.test(direct)) return direct;
  const match = text?.match(/https?:\/\/[^\s<>"']+/i);
  if (!match) return null;
  const wrapper = text?.[(match.index ?? 0) - 1];
  const suffix = wrapper === "(" ? match[0].match(/\)[.,!?;:]*$/) : wrapper === "[" ? match[0].match(/\][.,!?;:]*$/) : null;
  // Only remove an explicit outer wrapper. Bare terminal punctuation may be a valid URL character.
  return suffix ? match[0].slice(0, -suffix[0].length) : match[0];
}
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
  server_auto_save?: boolean;
  /** Exact native share visibility; never replace it with a later default. */
  is_public?: boolean;
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
  /** Optional on servers before import progress metadata was added. */
  created_at?: string | null;
  updated_at?: string | null;
  next_attempt_at?: string | null;
  max_attempts?: number | null;
  current_stage?: "reading_source" | "reading_images" | "reading_document" | "listening_video" | "reading_frames" | "extracting_workout" | "saving_workout" | null;
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
  source_is_public?: boolean | null;
  accepted_workout_id: string | null;
  replace_target?: { workout_id: string; expected_revision: number } | null;
}
export interface Capabilities {
  existing_workout_updates?: boolean;
  server_auto_save?: boolean;
  /** Absent on old servers; only an explicit true selects durable jobs. */
  export_jobs?: boolean;
  generation: number;
  public_beta: boolean;
  imports: boolean;
  coach: boolean;
  coach_cancellation?: boolean;
  coach_streaming?: boolean;
  coach_images?: boolean;
  health_sync: boolean;
  /** Absent on servers before Discover; only an explicit true shows Discover. */
  discover?: boolean;
  /** Explicit server readiness for registered custom covers (migration048). */
  cover_upload?: boolean;
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
  return !job.replace_target && !job.accepted_workout_id && job.status === "ready" && job.result?.status === "ready" &&
    !!job.result.workout && job.result.warnings.length === 0;
}
const sourceLifecycles = new Map<string, Promise<unknown>>();
function sourceLifecycle<T>(owner: string, generation: number, work: () => Promise<T>) {
  const key = JSON.stringify([owner, generation]);
  const next = (sourceLifecycles.get(key) ?? Promise.resolve()).catch(() => undefined).then(work);
  sourceLifecycles.set(key, next);
  void next.finally(() => { if (sourceLifecycles.get(key) === next) sourceLifecycles.delete(key); }).catch(() => undefined);
  return next;
}
// Keep top-level files under capture: so startup reconciliation and account erasure own them.
export const submittedCaptureScope = (generation: number, id: string) => `capture:${generation}:submitted:${id}`;
/** Commit the immutable source before releasing the composer. Failed writes keep the original slot. */
export function archiveCapturedImport(storage: Storage, owner: string, generation: number,
  original: PrivateDraftSnapshot<CaptureDraft>, guard: CaptureGuard, uuid: () => string) {
  return sourceLifecycle(owner, generation, async () => {
    guard();
    const slot = createPrivateDraftSlot<CaptureDraft>(storage, owner, `capture:${generation}`, uuid);
    const prior = await slot.load(guard); guard();
    if (!prior.value) return prior; // Completion or an earlier handoff already released this source.
    if (prior.revision !== original.revision || !prior.value?.job_id || prior.value.generation !== generation)
      throw Object.assign(Error("A newer source is saved. Load it before changing this draft."), { captureDraftConflict: true });
    const archive = createPrivateDraftSlot<CaptureDraft>(storage, owner, submittedCaptureScope(generation, prior.value.job_id), uuid);
    const archived = await archive.load(guard); guard();
    const plain = (value: CaptureDraft) => { const { _capture_revision: ignored, ...fields } = value as CaptureDraft & { _capture_revision?: string }; return fields; };
    if (archived.value && JSON.stringify(plain(archived.value)) !== JSON.stringify(plain(prior.value)))
      throw Error("The saved import source changed. Open that import before starting another source.");
    if (!archived.value) await archive.save(archived.revision, prior.value, guard);
    guard();
    const local = drafts(storage), source = prior.value, id = source.job_id!;
    await updateImportReferences(local, owner, generation, guard, items => {
      const priorReference = items.find(item => item.id === id);
      return [{ ...priorReference, id, generation,
        label: priorReference?.label ?? (source.source_url || "Submitted workout"),
        created_at: priorReference?.created_at ?? source.created_at,
        auto_save: source.auto_save ?? priorReference?.auto_save }, ...items.filter(item => item.id !== id)];
    });
    guard();
    // Original source visibility is immutable; later review choices use a different key.
    const visibilityScope = `import-source-visibility:${generation}:${id}`;
    const visibility = await local.load<boolean>(owner, visibilityScope); guard();
    if (typeof visibility !== "boolean" && typeof source.is_public === "boolean") {
      await local.save(owner, visibilityScope, source.is_public); guard();
    }
    if (!(await slot.remove(prior.revision, guard)))
      throw Object.assign(Error("A newer source is saved. Load it before changing this draft."), { captureDraftConflict: true });
    return { value: null, revision: null } satisfies PrivateDraftSnapshot<CaptureDraft>;
  });
}
export function loadCapturedImport(storage: Storage, owner: string, generation: number, id: string,
  guard: CaptureGuard, uuid: () => string) {
  return sourceLifecycle(owner, generation, async () => {
    guard();
    const archived = await createPrivateDraftSlot<CaptureDraft>(storage, owner, submittedCaptureScope(generation, id), uuid).load(guard);
    guard();
    if (archived.value?.job_id === id && archived.value.generation === generation) return archived;
    const current = await createPrivateDraftSlot<CaptureDraft>(storage, owner, `capture:${generation}`, uuid).load(guard);
    guard();
    return current;
  });
}
/** Call only after a saved outcome or confirmed cancellation. Retain exact failed cleanup receipts. */
export function retireCapturedImport(storage: Storage, owner: string, generation: number, id: string, guard: CaptureGuard,
  cleanup: (files: CaptureFile[], strict: boolean) => Promise<void>, uuid: () => string) {
  return sourceLifecycle(owner, generation, async () => {
    for (const scope of [submittedCaptureScope(generation, id), `capture:${generation}`]) {
      const slot = createPrivateDraftSlot<CaptureDraft>(storage, owner, scope, uuid);
      const prior = await slot.load(guard); guard();
      if (prior.value?.job_id !== id || prior.value.generation !== generation) continue;
      const retained = [...prior.value.files, ...(prior.value.cleanup_files ?? [])];
      try {
        const receipt = await slot.save(prior.revision, { ...prior.value, kind: "url", source_url: "", text: "", files: [], cleanup_files: retained }, guard);
        await cleanup(retained, true); guard();
        await slot.remove(receipt.revision, guard);
      } catch (error) { if (!(error as { captureDraftConflict?: boolean }).captureDraftConflict) throw error; }
    }
  });
}
