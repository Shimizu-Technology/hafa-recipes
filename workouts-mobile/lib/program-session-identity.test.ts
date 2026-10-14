import { expect, it } from "vitest";
import { completedProgramSessions, programSessionKey, programSessionStates } from "./program-session-identity";
import type { TrainingSession } from "./models";
import { createTrainingStore, type SavedLocalSession } from "./training";
function saved(program = "P1", status: "completed" | "partial" = "completed", completed = true): TrainingSession {
  return { id: program, client_session_id: program, generation: 1, title: "Strength", status, started_at: "2026-10-14T00:00:00Z",
    content: { program_id: program, program_session_id: "source-day-0", client_session_id: program, status,
      started_at: "2026-10-14T00:00:00Z", finished_at: "2026-10-14T00:01:00Z",
      actuals: [{ block_id: "main", exercise_index: 0, set_index: 1, round_index: 1, completed, reps: completed ? 8 : null }],
      prescription_snapshot: { id: "workout", title: "Strength", kind: "session", provenance: "user", revision: 1, generation: 1, blocks: [] } } };
}
function local(record: TrainingSession, state: SavedLocalSession["state"] = "queued"): SavedLocalSession {
  return { generation: 1, state, request: record.content, workout: record.content.prescription_snapshot };
}
it("server completion of source-day-0 in one plan does not suppress the same day id in another", () => {
  const completed = completedProgramSessions([saved()]);
  expect(completed.has(programSessionKey("P1", "source-day-0")!)).toBe(true);
  expect(completed.has(programSessionKey("P2", "source-day-0")!)).toBe(false);
});
it("combines offline and synced pairs without changing immutable history or matching incomplete identities", () => {
  const device = [local(saved("P2"))];
  const before = JSON.stringify(device);
  const result = completedProgramSessions([saved()], device);
  expect(result.size).toBe(2); expect(JSON.stringify(device)).toBe(before); expect(programSessionKey(null, "source-day-0")).toBeNull();
});
it("partial, skipped-only, rejected and old-generation results never complete a planned prescription", () => {
  const partial = saved("partial", "partial"), skipped = saved("skipped", "partial", false);
  const old = saved("old"); old.generation = 2;
  const device = [local(saved("blocked"), "blocked"), local(saved("queued"))];
  expect([...completedProgramSessions([partial, skipped, old], device)]).toEqual([programSessionKey("queued", "source-day-0")]);
  const states = programSessionStates([partial, skipped], device);
  expect(states.get(programSessionKey("partial", "source-day-0")!)).toBe("partial");
  expect(states.get(programSessionKey("skipped", "source-day-0")!)).toBe("skipped");
});
it("a separate partial repeat preserves completed work while an accepted correction can replace it", () => {
  const original = saved(), repeat = saved("P1", "partial");
  repeat.id = repeat.client_session_id = repeat.content.client_session_id = "repeat";
  repeat.content.started_at = "2026-10-15T00:00:00Z";
  expect(completedProgramSessions([repeat, original]).has(programSessionKey("P1", "source-day-0")!)).toBe(true);
  repeat.content.supersedes_session_id = original.id;
  expect(completedProgramSessions([repeat]).size).toBe(0);
});
it.each([false, true])("real training.correct changes completion from recorded actuals when allSkipped=%s", async (allSkipped) => {
  const original = saved();
  original.content.prescription_snapshot.blocks = [{ id: "main", label: "Strength", grouping: "sequential",
    exercises: [{ name: "Row", sets: 2, reps_min: 8 }] }];
  original.content.actuals.push({ ...original.content.actuals[0], set_index: 2 });
  const before = JSON.stringify(original), key = programSessionKey("P1", "source-day-0")!;
  const map = new Map<string, string>();
  const store = createTrainingStore({ getItem: async (key) => map.get(key) ?? null,
    setItem: async (key, value) => { map.set(key, value); }, removeItem: async (key) => { map.delete(key); } }, "owner", 1, () => 200);
  await store.load();
  const actuals = original.content.actuals.map((actual, index) => ({ ...actual,
    completed: !allSkipped && index === 0, reps: !allSkipped && index === 0 ? 8 : null }));
  await store.correct(original, actuals, "Corrected skipped work", "correction-client");
  expect(store.snapshot().history[0].request.status).toBe("partial");
  expect(completedProgramSessions([original], store.snapshot().history, 1, 100).has(key)).toBe(true);
  const accepted: TrainingSession = { ...original, id: "corrected", client_session_id: "correction-client",
    content: { ...store.snapshot().history[0].request, prescription_snapshot: original.content.prescription_snapshot } };
  await store.sync(async () => accepted);
  for (const [remote, readStarted] of [[[original], 100], [[accepted], 300]] as const) {
    expect(completedProgramSessions(remote, store.snapshot().history, 1, readStarted).has(key)).toBe(false);
    expect(programSessionStates(remote, store.snapshot().history, 1, readStarted).get(key)).toBe(allSkipped ? "skipped" : "partial");
  }
  expect(JSON.stringify(original)).toBe(before);
});
it("edit selection is scoped to one program even with identical day ids and delimiter-like names", () => {
  const editing = programSessionKey("P1", "source-day-0");
  expect(editing).not.toBe(programSessionKey("P2", "source-day-0"));
  expect(programSessionKey("P:1", "day")).not.toBe(programSessionKey("P", "1:day"));
});
