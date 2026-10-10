import { collectSnapshotExport, type ExportManifest, type SnapshotPage } from "./account";
import { createExportJobStore, type ExportCommand, type ExportScope } from "./export-job-store";
import type { Storage } from "./drafts";

export type ExportJobStatus = "queued" | "running" | "cancel_requested" | "ready" | "cancelled" | "failed" | "expired";
export type ExportFailure = "interrupted" | "privacy_changed" | "deadline_exceeded" | "too_large" | "export_failed";
export interface ExportJob {
  schema_version: 1;
  id: string;
  request_id: string;
  generation: number;
  status: ExportJobStatus;
  admitted_at: string;
  deadline_at: string;
  expires_at: string;
  started_at: string | null;
  finished_at: string | null;
  failure_code: ExportFailure | null;
  cleanup_pending: boolean;
  manifest: ExportManifest | null;
}
export interface ExportJobApi {
  createExportJob(requestId: string, generation: number, signal?: AbortSignal): Promise<ExportJob>;
  exportJob(id: string, generation: number, signal?: AbortSignal): Promise<ExportJob>;
  exportJobByRequest(requestId: string, generation: number, signal?: AbortSignal): Promise<ExportJob>;
  cancelExportJob(id: string, generation: number, signal?: AbortSignal): Promise<ExportJob>;
  exportSnapshotPage(id: string, page: number, generation: number, signal?: AbortSignal): Promise<SnapshotPage>;
}
const statuses: readonly string[] = ["queued", "running", "cancel_requested", "ready", "cancelled", "failed", "expired"];
const failures: readonly string[] = ["interrupted", "privacy_changed", "deadline_exceeded", "too_large", "export_failed"];
export function validateExportJob(value: ExportJob, command: ExportCommand): ExportJob {
  const date = (v: unknown) => typeof v === "string" && Number.isFinite(Date.parse(v));
  if (!value || value.schema_version !== 1 || value.generation !== command.generation ||
    value.request_id !== command.request_id || typeof value.id !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(value.id) ||
    (command.job_id !== null && value.id !== command.job_id) || !statuses.includes(value.status) ||
    !date(value.admitted_at) || !date(value.deadline_at) || !date(value.expires_at) ||
    !(value.started_at === null || date(value.started_at)) || !(value.finished_at === null || date(value.finished_at)) ||
    !(value.failure_code === null || failures.includes(value.failure_code)) || typeof value.cleanup_pending !== "boolean")
    throw Error("The service returned a different or invalid export handle. Keep the original request and check again.");
  const manifest = value.manifest;
  if ((value.status !== "ready" && manifest !== null) ||
    (value.status === "ready" && (!manifest || value.cleanup_pending || manifest.generation !== command.generation ||
      manifest.schema_version !== 1 || manifest.page_size !== 10 || !Number.isInteger(manifest.page_count) ||
      manifest.page_count < 1 || manifest.page_count > 512 || typeof manifest.id !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(manifest.id) ||
      !date(manifest.created_at) || !date(manifest.expires_at) || !manifest.totals ||
      !Object.values(manifest.totals).every((n) => Number.isSafeInteger(n) && n >= 0))))
    throw Error("The private export is not ready to download. Check its status again.");
  return value;
}
export const terminalExport = (job: ExportJob) => ["cancelled", "failed", "expired"].includes(job.status);
export function exportJobDescription(job: ExportJob, cancellationRequested = false) {
  if (job.cleanup_pending) return "The export cannot be opened. Server cleanup is still being checked; no release time is promised.";
  if (cancellationRequested && !terminalExport(job) && job.status !== "cancel_requested")
    return "Cancellation or temporary-record cleanup has not been acknowledged. Retry cleanup for this same export; it will not be opened again automatically.";
  if (job.status === "queued") return "Your private export is queued. You can leave this screen and check the same request later.";
  if (job.status === "running") return "Preparing your private records. The server allows up to two minutes from admission.";
  if (job.status === "cancel_requested") return "Cancellation was requested. Checking that the worker and temporary records have finished cleanup.";
  if (job.status === "ready") return "Your private export is ready. Choose Save to download the complete file and open your device’s save options.";
  if (job.status === "cancelled") return "The export was cancelled and its temporary server records were removed.";
  if (job.status === "expired") return "This export expired. Start a fresh export deliberately when you are ready.";
  const messages: Record<ExportFailure, string> = {
    interrupted: "Preparation was interrupted. This request will not restart automatically.",
    privacy_changed: "Saved privacy choices or data were removed while preparing. This export cannot be opened.",
    deadline_exceeded: "Preparation did not finish within two minutes. This request will not restart automatically.",
    too_large: "These records exceed the export limits. Contact support for help with a complete export.",
    export_failed: "The server could not prepare this export. Your saved records remain available.",
  };
  return messages[job.failure_code ?? "export_failed"];
}
export interface ExportJobView {
  phase: "loading" | "idle" | "uncertain" | "preparing" | "ready" | "downloading" | "saving" | "cancelling" | "terminal";
  command: ExportCommand | null;
  job: ExportJob | null;
  busy: boolean;
  error: string;
  message: string;
  pages: number;
  invalidated: boolean;
}
const activeOperations = new Set<string>();
export function createExportController(options: {
  scope: ExportScope;
  storage: Storage;
  api: ExportJobApi;
  isCurrent(): boolean;
  newRequestId(): string;
  save(data: Awaited<ReturnType<typeof collectSnapshotExport>>, owner: string, guard: () => void): Promise<void>;
}) {
  let disposed = false;
  let sequence = 0;
  let abort: AbortController | null = null;
  let view: ExportJobView = { phase: "loading", command: null, job: null, busy: false, error: "", message: "", pages: 0, invalidated: false };
  const listeners = new Set<(state: ExportJobView) => void>();
  const operationKey = JSON.stringify(options.scope);
  const scopeGuard = () => { if (disposed || !options.isCurrent()) throw Error("This private export belongs to a retired account or enrollment."); };
  const store = createExportJobStore(options.storage, options.scope, scopeGuard);
  const publish = (patch: Partial<ExportJobView>) => {
    scopeGuard(); view = { ...view, ...patch }; listeners.forEach((listener) => listener(view));
  };
  const statusOf = (error: unknown) => typeof error === "object" && error !== null && "status" in error ? error.status : null;
  async function run(work: (guard: () => void, signal: AbortSignal) => Promise<void>) {
    if (activeOperations.has(operationKey)) return;
    if (disposed || !options.isCurrent()) return;
    activeOperations.add(operationKey);
    const current = ++sequence;
    const controller = new AbortController(); abort = controller;
    const guard = () => { scopeGuard(); if (sequence !== current || controller.signal.aborted) throw Error("Export checking was paused."); };
    publish({ busy: true, error: "" });
    try { await work(guard, controller.signal); }
    catch (error) {
      if (sequence === current && !disposed && options.isCurrent()) {
        const invalidated = [404, 409, 410].includes(Number(statusOf(error))) && view.job !== null;
        publish({ error: statusOf(error) === 429 ? "The export service is busy. Check or retry this same export later." :
          error instanceof Error ? error.message : "The private export could not be checked. Try this same request again.",
          invalidated: view.invalidated || invalidated,
          phase: view.command ? (view.command.cancel_requested ? "cancelling" : view.job ? view.phase === "saving" || view.phase === "downloading" ? "ready" : view.phase : "uncertain") : "idle" });
      }
    } finally {
      activeOperations.delete(operationKey);
      if (sequence === current && !disposed && options.isCurrent()) publish({ busy: false });
      if (abort === controller) abort = null;
    }
  }
  async function receive(job: ExportJob, command: ExportCommand, guard: () => void) {
    guard(); validateExportJob(job, command);
    const attached = await store.attach(command.request_id, job.id); guard();
    publish({ command: attached, job, invalidated: false,
      phase: terminalExport(job) ? "terminal" : attached.cancel_requested || job.status === "cancel_requested" ? "cancelling" : job.status === "ready" ? "ready" : "preparing" });
  }
  async function lookup(command: ExportCommand, guard: () => void, signal: AbortSignal) {
    guard();
    const job = command.job_id ? await options.api.exportJob(command.job_id, command.generation, signal) :
      await options.api.exportJobByRequest(command.request_id, command.generation, signal);
    guard(); await receive(job, command, guard);
  }
  async function cancelCurrent(command: ExportCommand, guard: () => void, signal?: AbortSignal) {
    const pending = await store.requestCancel(command.request_id); guard();
    publish({ command: pending, phase: "cancelling" });
    if (!pending.job_id) { await lookup(pending, guard, signal ?? new AbortController().signal); guard(); }
    const identified = view.command;
    if (!identified?.job_id) throw Error("Check the original admission before cancelling this export.");
    const job = await options.api.cancelExportJob(identified.job_id, identified.generation, signal);
    guard(); await receive(job, identified, guard);
  }
  return {
    state: () => view,
    subscribe(listener: (state: ExportJobView) => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    pause() { ++sequence; abort?.abort(); if (!disposed && options.isCurrent()) publish({ busy: false }); },
    dispose() { disposed = true; ++sequence; abort?.abort(); listeners.clear(); },
    restore: () => run(async (guard, signal) => {
      const command = await store.load(); guard();
      if (!command || command.retired) { publish({ phase: "idle", command: null, job: null }); return; }
      publish({ command, phase: command.cancel_requested ? "cancelling" : "uncertain" });
      await lookup(command, guard, signal);
    }),
    check: () => run(async (guard, signal) => {
      const command = await store.load(); guard();
      if (!command || command.retired) return;
      publish({ command }); await lookup(command, guard, signal);
    }),
    start: () => run(async (guard, signal) => {
      const current = await store.load(); guard();
      if (current && !current.retired) {
        if (!view.job || view.job.request_id !== current.request_id || !terminalExport(view.job) || view.job.cleanup_pending)
          throw Error("Resolve the existing export before starting a fresh one.");
        await store.retire(current.request_id); guard();
      }
      const command = await store.begin(options.newRequestId()); guard();
      publish({ command, job: null, phase: "uncertain", invalidated: false, message: "", pages: 0 });
      const job = await options.api.createExportJob(command.request_id, command.generation, signal);
      guard(); await receive(job, command, guard);
    }),
    retryAdmission: () => run(async (guard, signal) => {
      const command = await store.load(); guard();
      if (!command || command.retired || command.job_id)
        throw Error("Check the existing export handle before retrying admission.");
      publish({ command });
      const job = await options.api.createExportJob(command.request_id, command.generation, signal);
      guard(); await receive(job, command, guard);
      if (command.cancel_requested) await cancelCurrent(view.command!, guard, signal);
    }),
    cancel: () => run(async (guard, signal) => {
      const command = await store.load(); guard();
      if (command && !command.retired) await cancelCurrent(command, guard, signal);
    }),
    save: () => run(async (guard, signal) => {
      const command = await store.load(); guard();
      if (!command?.job_id || command.retired || command.cancel_requested || view.invalidated)
        throw Error("Check the original export before saving.");
      // A fresh server read fences privacy/expiry even when the ready UI was restored from memory.
      await lookup(command, guard, signal); guard();
      const job = view.job;
      if (!job || job.status !== "ready" || !job.manifest || job.cleanup_pending)
        throw Error("The export is not ready to save.");
      const manifest = job.manifest;
      publish({ phase: "downloading", pages: 0 });
      const data = await collectSnapshotExport(manifest, (page) =>
        options.api.exportSnapshotPage(manifest.id, page, command.generation, signal), guard,
        (pages) => { guard(); publish({ pages }); });
      guard();
      // Persist cleanup intent before presenting the OS sheet. Cold restart never opens it again automatically.
      const cleanupCommand = await store.requestCancel(command.request_id); guard();
      publish({ phase: "saving", command: cleanupCommand });
      let saveFailed = false;
      let saveError: unknown;
      try {
        await options.save(data, command.owner, guard); guard();
        publish({ message: "The export file was opened for saving. The app cannot tell whether you saved it or closed the save options. Keep any copy private." });
      } catch (error) {
        saveFailed = true;
        saveError = error;
      }
      let cleanupFailed = false;
      let cleanupError: unknown;
      try {
        // Scope retirement prevents new-owner writes; pause aborts this same request.
        scopeGuard();
        const receipt = await options.api.cancelExportJob(job.id, command.generation, signal);
        guard(); await receive(receipt, cleanupCommand, guard);
      } catch (error) {
        cleanupFailed = true;
        cleanupError = error;
      }
      if (saveFailed) throw saveError;
      if (cleanupFailed) throw cleanupError;
    }),
  };
}
