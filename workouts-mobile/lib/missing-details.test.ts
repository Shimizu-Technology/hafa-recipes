import { expect, it } from "vitest";
import { missingDetails } from "./missing-details";
import type { AuthoredWorkout } from "./models";
it("does not ask for rest between rounds in a one-round block", () => {
 const w: AuthoredWorkout = { title: "One round", kind: "session", provenance: "user", blocks: [{ id: "b", label: "Main", grouping: "circuit", rounds: 1, exercises: [{ name: "Squat" }] }] };
 expect(missingDetails(w).some(x => x.key === "b:rest")).toBe(false);
 w.blocks[0].rounds = 2;
 expect(missingDetails(w).some(x => x.key === "b:rest")).toBe(true);
});
it("never asks for rest inside EMOM, Tabata or for-time, and asks for a missing interval count", () => {
  const emom: AuthoredWorkout = { title: "EMOM", kind: "session", provenance: "source", equipment_required: ["None"], blocks: [{ id: "e", label: "EMOM", grouping: "interval",
    execution: { mode: "emom", interval_seconds: 60, intervals: 20, rotation: "alternating" }, exercises: [{ name: "Burpees", reps_min: 10 }, { name: "Squats", reps_min: 15 }] }] };
  expect(missingDetails(emom)).toEqual([]);
  const tabata: AuthoredWorkout = { ...emom, blocks: [{ id: "t", label: "Tabata", grouping: "interval",
    execution: { mode: "work_rest", work_seconds: 20, rest_seconds: 10, intervals: null }, exercises: [{ name: "Squats" }] }] };
  expect(missingDetails(tabata).map((x) => x.label)).toEqual(["Tabata: number of intervals not specified"]);
  const forTime: AuthoredWorkout = { ...emom, blocks: [{ id: "f", label: "21-15-9", grouping: "circuit", rounds: 3,
    execution: { mode: "for_time", time_cap_seconds: null }, exercises: [{ name: "Thrusters", rep_scheme: [21, 15, 9] }] }] };
  expect(missingDetails(forTime)).toEqual([]);
  const deathBy: AuthoredWorkout = { ...emom, blocks: [{ id: "d", label: "Death by", grouping: "interval",
    execution: { mode: "emom", interval_seconds: 60, intervals: null, rotation: null }, exercises: [{ name: "Burpees", ladder: { start: 1, step: 1, end: null } }] }] };
  expect(missingDetails(deathBy)).toEqual([]);
});
