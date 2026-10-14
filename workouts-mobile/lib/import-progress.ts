import type { ImportJob } from "./capture";
function timestamp(value?: string | null) { const parsed = Date.parse(value ?? ""); return Number.isFinite(parsed) ? parsed : null; }
export function waitLabel(seconds: number) {
  const rounded = Math.max(0, Math.floor(seconds));
  return rounded >= 3600 ? `${Math.floor(rounded / 3600)}h ${Math.floor(rounded % 3600 / 60)}m`
    : rounded >= 60 ? `${Math.floor(rounded / 60)}m ${rounded % 60}s` : `${rounded}s`;
}
export function importProgressState(job: ImportJob, now = Date.now()) {
  const created = timestamp(job.created_at), retryAt = timestamp(job.next_attempt_at);
  const retrying = job.status === "queued" && retryAt != null && retryAt > now;
  const queuedRetry = job.status === "queued" && job.attempt_count > 0;
  const total = job.max_attempts ? ` of ${job.max_attempts}` : "";
  return {
    phase: retrying || queuedRetry ? "Waiting to retry" : job.status === "queued" ? "Waiting to start" : job.attempt_count > 1 ? "Trying the source again" : "Reading the source",
    title: retrying || queuedRetry ? "Waiting for the next attempt" : job.status === "queued" ? "Your source is in the queue" : "Finding the workout instructions",
    attempt: retrying ? `Next attempt ${job.attempt_count + 1}${total} · can start in ${waitLabel((retryAt! - now) / 1000)}`
      : queuedRetry ? `Next attempt ${job.attempt_count + 1}${total} · waiting in the queue`
      : job.attempt_count > 1 ? `Automatic retry · attempt ${job.attempt_count}${total}` : null,
    elapsed: created == null ? null : `Elapsed since queued · ${waitLabel((now - created) / 1000)}`,
    retrying,
  };
}
