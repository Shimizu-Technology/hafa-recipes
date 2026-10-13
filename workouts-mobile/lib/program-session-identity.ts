import type { TrainingSession } from "./models";
import type { SavedLocalSession } from "./training";
import { effectiveTrainingHistory } from "./progress-selection";

/** A session identifier is only unique within its owning program. */
export function programSessionKey(programId: string | null | undefined, sessionId: string | null | undefined) {
  return programId && sessionId ? JSON.stringify([programId, sessionId]) : null;
}
export function completedProgramSessions(
  server: readonly TrainingSession[] | undefined,
  local: readonly SavedLocalSession[] = [],
  generation = 1,
  serverReadAt = Infinity
) {
  return new Set([...programSessionStates(server, local, generation, serverReadAt)].filter(([, status]) => status === "completed").map(([key]) => key));
}

export function programSessionStates(server: readonly TrainingSession[] | undefined, local: readonly SavedLocalSession[] = [], generation = 1, serverReadAt = Infinity) {
  const result = new Map<string, "completed" | "partial" | "skipped">();
  for (const { request } of effectiveTrainingHistory(local, server, generation, serverReadAt)) {
    const key = programSessionKey(request.program_id, request.program_session_id);
    if (!key || result.get(key) === "completed") continue;
    const status = request.actuals.some((actual) => actual.completed)
      ? request.status === "completed" ? "completed" : "partial" : "skipped";
    // A separate partial retry never undoes an earlier complete session.
    // Corrections have already replaced their originals in the effective view.
    if (status !== "skipped" || !result.has(key)) result.set(key, status);
  }
  return result;
}
