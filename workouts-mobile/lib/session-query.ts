import type { WorkoutsApi } from "./api";
import type { Enrollment } from "./models";

/** One cache entry for saved sessions, shared by Today, Plan, Progress and Training. */
export function sessionsQuery(api: Pick<WorkoutsApi, "sessions">, owner: string, enrollment: Pick<Enrollment, "enrolled" | "generation"> | null | undefined) {
  return {
    queryKey: [owner, "sessions", enrollment?.generation] as const,
    queryFn: () => api.sessions(),
    enabled: !!enrollment?.enrolled,
  };
}
