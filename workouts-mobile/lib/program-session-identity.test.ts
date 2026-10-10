import { expect, it } from "vitest";
import { completedProgramSessions, programSessionKey } from "./program-session-identity";
it("server completion of source-day-0 in one plan does not suppress the same day id in another", () => {
  const completed = completedProgramSessions([{ content: { program_id: "P1", program_session_id: "source-day-0" } }]);
  expect(completed.has(programSessionKey("P1", "source-day-0")!)).toBe(true);
  expect(completed.has(programSessionKey("P2", "source-day-0")!)).toBe(false);
});
it("combines offline and synced pairs without changing immutable history or matching incomplete identities", () => {
  const local = [{ request: { program_id: "P2", program_session_id: "source-day-0" } }, { request: { program_session_id: "source-day-0" } }];
  const before = JSON.stringify(local);
  const result = completedProgramSessions([{ content: { program_id: "P1", program_session_id: "source-day-0" } }, { content: {} }], local);
  expect(result.size).toBe(2); expect(JSON.stringify(local)).toBe(before); expect(programSessionKey(null, "source-day-0")).toBeNull();
});
it("edit selection is scoped to one program even with identical day ids and delimiter-like names", () => {
  const editing = programSessionKey("P1", "source-day-0");
  expect(editing).not.toBe(programSessionKey("P2", "source-day-0"));
  expect(programSessionKey("P:1", "day")).not.toBe(programSessionKey("P", "1:day"));
});
