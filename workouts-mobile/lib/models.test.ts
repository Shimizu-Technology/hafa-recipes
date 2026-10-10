import { describe, it, expect } from "vitest";
import { initialProfile, profileErrors } from "./models";
import { manualWorkout, blankWorkout } from "./manual";
describe("training input invariants", () => {
  it("requires adult enrollment while preserving unknown equipment separately from none", () => {
    const p = initialProfile();
    expect(p.equipment).toBeNull();
    expect(profileErrors(p)).toContain("Confirm you are 18 or older to continue.");
    expect(profileErrors({ ...p, adult_confirmed: true, equipment: [] })).toEqual([]);
  });
  it("rejects impossible measurements and invalid timezone without making optional values required", () => {
    const p = { ...initialProfile(), adult_confirmed: true };
    expect(
      profileErrors({ ...p, age_years: 17, weight_kg: NaN, timezone: "invalid", available_days: [] })
    ).toHaveLength(4);
    expect(profileErrors({ ...p, age_years: null, weight_kg: null, height_cm: null })).toEqual([]);
  });
  it("preserves missing sets and reps instead of inventing a prescription", () => {
    const w = manualWorkout({
      title: " My workout ",
      equipment: "",
      exercises: [{ name: " Squat ", sets: "", reps: "" }],
    });
    expect(w.provenance).toBe("user");
    expect(w.blocks[0].exercises[0]).toEqual({ name: "Squat", sets: null, reps_min: null, reps_max: null });
  });
  it("rejects empty exercises and negative or fractional prescriptions", () => {
    expect(() => manualWorkout(blankWorkout())).toThrow();
    expect(() =>
      manualWorkout({ title: "Legs", equipment: "", exercises: [{ name: "Squat", sets: "2.5", reps: "-1" }] })
    ).toThrow("whole number");
  });
});
