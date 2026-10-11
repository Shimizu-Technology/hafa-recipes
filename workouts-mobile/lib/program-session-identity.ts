/** A session identifier is only unique within its owning program. */
export function programSessionKey(programId: string | null | undefined, sessionId: string | null | undefined) {
  return programId && sessionId ? JSON.stringify([programId, sessionId]) : null;
}
export function completedProgramSessions(
  server: ReadonlyArray<{ content: { program_id?: string; program_session_id?: string } }> = [],
  local: ReadonlyArray<{ request: { program_id?: string; program_session_id?: string } }> = []
) {
  const result = new Set<string>();
  for (const record of [...server.map((x) => x.content), ...local.map((x) => x.request)]) {
    const key = programSessionKey(record.program_id, record.program_session_id);
    if (key) result.add(key);
  }
  return result;
}
