import type { WorkoutsApi } from "./api";
import type { Enrollment, TrainingSession } from "./models";

const readStartedAt = Symbol("session read started at");
type SessionRead = readonly TrainingSession[] & { [readStartedAt]?: number };
export function sessionReadStartedAt(data: readonly TrainingSession[] | undefined) {
  return (data as SessionRead | undefined)?.[readStartedAt] ?? 0;
}

/** One cache entry for saved sessions, shared by Today, Plan, Progress and Training. */
export function sessionsQuery(api: Pick<WorkoutsApi, "sessions">, owner: string, enrollment: Pick<Enrollment, "enrolled" | "generation"> | null | undefined) {
  return {
    queryKey: [owner, "sessions", enrollment?.generation] as const,
    queryFn: async () => {
      const started = Date.now();
      const records = [...await api.sessions()];
      // A read started before a save can settle after its acknowledgement.
      // Keep the array cache contract while recording the actual read boundary.
      Object.defineProperty(records, readStartedAt, { value: started });
      return records;
    },
    // Array structural sharing drops the non-enumerable read watermark and
    // can reuse an old [] even after a genuinely new authoritative read.
    structuralSharing: false,
    enabled: !!enrollment?.enrolled,
  };
}
