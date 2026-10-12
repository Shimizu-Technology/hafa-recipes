import { it, expect, vi } from "vitest";
import { sourceChoiceErrors, sourceDayErrors } from "./plans";
import { createWorkoutsApi } from "./api";
import type { Workout } from "./models";
const source = {
  id: "source",
  generation: 2,
  revision: 3,
  title: "Creator program",
  kind: "program",
  provenance: "source",
  blocks: [
    {
      id: "strength",
      label: "Strength day",
      grouping: "superset",
      rounds: 2,
      exercises: [{ name: "Row", sets: null, reps_min: null }],
    },
  ],
} as Workout;
it("refuses fabricated or duplicate source block IDs and invalid day/duration assignments", () => {
  expect(
    sourceDayErrors(source, "2026-10-10", [
      { day_offset: 0, block_ids: ["strength"], label: "Day one", duration_minutes: 30 },
    ])
  ).toEqual([]);
  expect(
    sourceDayErrors(source, "2026-02-31", [
      { day_offset: 0, block_ids: ["invented"], label: "Day one", duration_minutes: 30 },
    ])
  ).toHaveLength(2);
  expect(
    sourceDayErrors(source, "2026-10-10", [
      { day_offset: 0, block_ids: ["strength", "strength"], label: "Day one", duration_minutes: 0 },
    ])
  ).toHaveLength(2);
  expect(sourceChoiceErrors(["same", "same"], {})).toHaveLength(1);
  expect(sourceChoiceErrors(["a"], { a: "" })).toEqual([]);
});
it("keeps source-only choice, reviewed estimates and original generation in the proposal request", async () => {
  const transport = vi.fn().mockResolvedValue(new Response("{}"));
  const api = createWorkoutsApi("https://example.test", async () => "token", transport);
  await api.proposeProgram("2026-10-10", 4, 7, 2, {
    source_workout_ids: ["source"],
    source_mode: "selected",
    source_minutes: { source: 30 },
    reviewed_custom_routines: true,
  });
  expect(JSON.parse(transport.mock.calls[0][1].body)).toMatchObject({
    profile_revision: 7,
    source_mode: "selected",
    source_minutes: { source: 30 },
  });
  expect(transport.mock.calls[0][1].headers["X-Workouts-Generation"]).toBe("2");
});
it("copied-plan review uses source program/profile revisions and receipt acceptance separately", async () => {
  const transport = vi.fn().mockResolvedValue(new Response("{}"));
  const api = createWorkoutsApi("https://example.test", async () => "token", transport);
  await api.reviewCopiedProgram("owned", 3, 7, { session: 30 }, true, 2);
  expect(transport.mock.calls[0][0]).toContain("/programs/owned/review-proposal");
  expect(JSON.parse(transport.mock.calls[0][1].body)).toEqual({
    program_revision: 3,
    profile_revision: 7,
    session_minutes: { session: 30 },
    reviewed_custom_routines: true,
  });
});
it('copied-calendar review sends only dates deliberately overridden by the recipient',async()=>{const transport=vi.fn().mockImplementation(async()=>new Response('{}'));const api=createWorkoutsApi('https://example.test',async()=> 'token',transport);await api.reviewCopiedProgram('owned',3,7,{},true,2,{edited:'2026-11-02'});expect(JSON.parse(transport.mock.calls[0][1].body).session_dates).toEqual({edited:'2026-11-02'});});
