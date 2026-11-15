import { isClassPage } from "./class-import";
import type { ExtractionRequest, ImportJob } from "./capture";
import { boundedSource } from "./capture";

export function importPresentation(job?: ImportJob) {
  if (job?.accepted_workout_id) return { label: job.status === "incomplete" ? "Draft saved" : "Workout saved", action: "Open workout" };
  if (job && ["incomplete", "failed"].includes(job.status) && job.result?.error_code === "workouts_ai_budget_exceeded")
    return { label: "AI importing temporarily paused", action: "View recovery options" };
  switch (job?.status) {
    case "queued": return { label: "Waiting to start", action: "View progress" };
    case "processing": return { label: job.attempt_count > 1 ? `Trying again · attempt ${job.attempt_count}` : "Reading your workout", action: "View progress" };
    case "ready": return { label: "Ready to save", action: "Review workout" };
    case "incomplete":
      if (job.result?.error_code) return { label: "Processing did not finish", action: "Retry or add caption" };
      if (!job.result?.workout?.blocks.some(block => block.exercises.length)) return { label: "No exercises extracted", action: "Retry or add caption" };
      return { label: "Needs a few details", action: "Check details" };
    case "failed": return { label: "Could not read this source", action: "Retry or add caption" };
    case "cancelled": return { label: "Cancelled", action: "View options" };
    case "expired": return { label: "Import expired", action: "View options" };
    default: return { label: "Checking your import…", action: "Open import" };
  }
}

export function importSourceLabel(label: string) {
  try {
    const url = new URL(label);
    return `${url.hostname.replace(/^www\./, "")}${url.pathname.replace(/\/$/, "")}`;
  } catch { return label; }
}

/** Retry exact source material; never infer exercises or overwrite a saved workout. */
export function recoverySource(source: ExtractionRequest | null, sourceURL: string | undefined | null, caption: string, programming?: ExtractionRequest["programming"]): ExtractionRequest {
  const classPage = isClassPage(sourceURL);
  const safeURL = classPage ? (() => { const url = new URL(sourceURL!); url.search = ""; url.hash = ""; return url.href; })() : sourceURL;
  const fallback: ExtractionRequest | null = classPage || programming?.source_kind === "gym"
    ? { kind: "text", source_url: safeURL ?? undefined, ai_consent: true, class_parts: true, programming: programming ?? { source_kind: "gym", app_name: "WodUp" } }
    : sourceURL && /^https?:\/\//i.test(sourceURL) ? { kind: "url", source_url: sourceURL, ai_consent: true } : null;
  const original = source ?? fallback;
  if (!original && !caption.trim()) throw Error("This source is no longer available. Paste its caption or choose another source.");
  const text = [original?.text?.trim(), caption.trim()].filter(Boolean).join("\n\n");
  if ((classPage || original?.class_parts) && original?.kind === "text" && !text) throw Error("This class source expired. Paste the class instructions to retry; WodUp links cannot be fetched.");
  if (text.length > 30000) throw Error("Use up to 30,000 characters of source instructions.");
  // The retained server payload can include internal saving metadata. Forward
  // source fields only, so an earlier public choice cannot leak into the retry.
  return boundedSource({ kind: original?.kind ?? "text", source_url: original?.source_url,
    ...(original?.class_parts ? { class_parts: true, programming: original.programming } : {}),
    images: original?.images, document_base64: original?.document_base64,
    document_mime: original?.document_mime, ...(text ? { text } : {}), ai_consent: true, typed_formats: true });
}
