export const importFinished = (status: string) =>
  ["saved", "ready", "incomplete", "complete", "completed", "failed", "cancelled", "canceled"].includes(status);
export const importRetryable = (status: string, error?: string | null) =>
  status === "incomplete" ? !!error : ["failed", "cancelled", "canceled"].includes(status);
export const importCardVisible = (status: string, error?: string | null) =>
  !importFinished(status) || importRetryable(status, error) || !!error;
export function importLabel(status: string, error?: string | null) {
  if (status === "incomplete" && !error) return "Source organized · see processing notes";
  if (["ready", "complete", "completed"].includes(status) && !error) return "Source organized";
  if (error || ["incomplete", "failed"].includes(status)) return "Original saved · processing needs attention";
  if (["cancelled", "canceled"].includes(status)) return "Processing cancelled";
  if (status === "saved") return "Original saved";
  return status === "queued" || status === "deferred" ? "Waiting to process" : "Processing your source";
}

export const dailyAiLimitMessage =
  "Daily AI limit reached. Your originals and available text are saved. Try again later.";
const aiUnavailableMessage =
  "AI processing is temporarily unavailable. Your originals and available text are saved. Try again later.";
export function importProblem(error?: string | null) {
  if (error === dailyAiLimitMessage) return dailyAiLimitMessage;
  if (error === aiUnavailableMessage) return aiUnavailableMessage;
  return "Some information could not be extracted. Your original source is kept.";
}
