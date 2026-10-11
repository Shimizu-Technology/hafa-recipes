import { it, expect, vi } from "vitest";
import { canAcceptCoach, coachFocusErrors, needsReturnConfirmation, type CoachAction } from "./coach";
import { createWorkoutsApi } from "./api";
const action = {
  id: "proposal",
  kind: "schedule",
  proposal: { status: "ready", operation: "return", confirmation_required: true },
  profile_revision: 7,
  target_id: "program",
  target_revision: 3,
  expires_at: "2027-01-01T00:00:00Z",
} as CoachAction;
it("requires an explicit comfortable-baseline confirmation for a reviewed return and refuses expired/not-ready actions", () => {
  expect(needsReturnConfirmation(action)).toBe(true);
  expect(canAcceptCoach(action, true, false, 0)).toBe(false);
  expect(canAcceptCoach(action, true, true, 0)).toBe(true);
  expect(
    canAcceptCoach({ ...action, proposal: { ...action.proposal, status: "needs_information" } }, true, true, 0)
  ).toBe(false);
  expect(canAcceptCoach(action, true, true, Date.parse("2028-01-01"))).toBe(false);
});
it("does not mix focus IDs or attach a revision to a session/general conversation", () => {
  expect(coachFocusErrors({ context_workout_id: "workout", context_program_id: "program" })).toHaveLength(1);
  expect(coachFocusErrors({ context_session_id: "actual", context_revision: 1 })).toHaveLength(1);
  expect(coachFocusErrors({ context_workout_id: "workout", context_revision: 3 })).toEqual([]);
  expect(coachFocusErrors({})).toEqual([]);
});
it("replays the identical message identity/focus/original generation after an uncertain response", async () => {
  const transport = vi.fn().mockRejectedValueOnce(Error("offline")).mockResolvedValueOnce(new Response("{}"));
  const api = createWorkoutsApi("https://example.test", async () => "token", transport);
  const focus = { context_program_id: "program", context_revision: 3 };
  await expect(api.coachMessage("request", "Help me return", focus, 2)).rejects.toThrow();
  await api.coachMessage("request", "Help me return", focus, 2);
  expect(transport.mock.calls[0][1].body).toBe(transport.mock.calls[1][1].body);
  expect(transport.mock.calls[1][1].headers["X-Workouts-Generation"]).toBe("2");
  expect(JSON.parse(transport.mock.calls[1][1].body).context_revision).toBe(3);
});
it("return acceptance uses the coach receipt endpoint and only sends the strict confirmation when explicitly true", async () => {
  const transport = vi.fn().mockImplementation(async () => new Response("{}"));
  const api = createWorkoutsApi("https://example.test", async () => "token", transport);
  await api.acceptCoachAction("proposal", "My return", true, 2);
  await api.acceptCoachAction("different", "My plan", false, 2);
  expect(transport.mock.calls[0][0]).toContain("/coach/actions/proposal/accept");
  expect(JSON.parse(transport.mock.calls[0][1].body).confirm_return_baseline).toBe(true);
  expect(JSON.parse(transport.mock.calls[1][1].body)).not.toHaveProperty("confirm_return_baseline");
});
it("reads paused queue metadata outside proposal.sessions and never forwards it into a generic proposal update", async () => {
  const row = {
    id: "program",
    generation: 2,
    revision: 3,
    content: {
      title: "Paused plan",
      proposal: {
        status: "ready",
        sessions: [],
        questions: [],
        warnings: [],
        assumptions: [],
        source_ids: [],
        rule_version: "rules",
      },
      schedule_state: { status: "paused", paused_sessions: [{ id: "future", date: "2026-11-01" }] },
    },
  };
  const transport = vi.fn().mockImplementation(async () => new Response(JSON.stringify(row)));
  const api = createWorkoutsApi("https://example.test", async () => "token", transport);
  const program = await api.program("program");
  expect(program.schedule_state?.paused_sessions?.[0].id).toBe("future");
  await api.updateProgram(program);
  expect(JSON.parse(transport.mock.calls[1][1].body).proposal).not.toHaveProperty("schedule_state");
});
