import { expect, it } from "vitest";
import { missingDetails } from "./missing-details";
import type { AuthoredWorkout } from "./models";
it("does not ask for rest between rounds in a one-round block", () => {
 const w: AuthoredWorkout = { title: "One round", kind: "session", provenance: "user", blocks: [{ id: "b", label: "Main", grouping: "circuit", rounds: 1, exercises: [{ name: "Squat" }] }] };
 expect(missingDetails(w).some(x => x.key === "b:rest")).toBe(false);
 w.blocks[0].rounds = 2;
 expect(missingDetails(w).some(x => x.key === "b:rest")).toBe(true);
});
