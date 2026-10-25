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
  const stages = {
    reading_source: ["Reading the source", "Finding the source instructions"],
    reading_images: ["Reading images", "Looking for workout instructions in your images"],
    reading_document: ["Reading the document", "Finding workout instructions in your document"],
    listening_video: ["Listening to the video", "Reading spoken workout instructions"],
    reading_frames: ["Reading video frames", "Checking the workout shown in the video"],
    extracting_workout: ["Building your workout", "Putting the exercises and instructions together"],
    saving_workout: ["Saving the result", "Keeping your import ready to review"],
  };
  const stage = job.status === "processing" && job.current_stage ? stages[job.current_stage] : null;
  return {
    phase: stage?.[0] ?? (retrying || queuedRetry ? "Waiting to retry" : job.status === "queued" ? "Waiting to start" : job.attempt_count > 1 ? "Trying the source again" : "Reading the source"),
    title: stage?.[1] ?? (retrying || queuedRetry ? "Waiting for the next attempt" : job.status === "queued" ? "Your source is in the queue" : "Finding the workout instructions"),
    attempt: retrying ? `Next attempt ${job.attempt_count + 1}${total} · can start in ${waitLabel((retryAt! - now) / 1000)}`
      : queuedRetry ? `Next attempt ${job.attempt_count + 1}${total} · waiting in the queue`
      : job.attempt_count > 1 ? `Automatic retry · attempt ${job.attempt_count}${total}` : null,
    elapsed: created == null ? null : `Elapsed since queued · ${waitLabel((now - created) / 1000)}`,
    retrying,
  };
}
