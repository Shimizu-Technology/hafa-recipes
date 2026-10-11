import { describe, it, expect } from "vitest";
import { initialProfile, profileErrors } from "./models";
import { changeEquipment, selectEquipmentLocation, removeEquipmentLocation } from "./equipment";
function fixture() {
  return {
    ...initialProfile(),
    adult_confirmed: true,
    equipment_locations: [
      { id: "home", name: "Home", equipment: ["bands"], available_loads_kg: [5] },
      { id: "gym", name: "Gym", equipment: ["barbell"], available_loads_kg: [20, 40] },
    ],
    active_equipment_location_id: "home",
    equipment: ["bands"],
    available_loads_kg: [5],
  };
}
describe("explicit equipment locations", () => {
  it("uses exactly one declared inventory and never unions home and gym", () => {
    const profile = fixture();
    const selected = selectEquipmentLocation(profile, "gym");
    expect(selected.equipment).toEqual(["barbell"]);
    expect(selected.available_loads_kg).toEqual([20, 40]);
    expect(profile.equipment).toEqual(["bands"]);
    expect(() => selectEquipmentLocation(profile, "unknown")).toThrow();
  });
  it("edits only the selected location while preserving the other inventory", () => {
    const profile = fixture();
    const edited = changeEquipment(profile, { equipment: ["bands", "bench"], available_loads_kg: [10] });
    expect(edited.equipment_locations?.[0].equipment).toEqual(["bands", "bench"]);
    expect(edited.equipment_locations?.[1]).toEqual(profile.equipment_locations[1]);
    expect(profile.equipment_locations[0].equipment).toEqual(["bands"]);
  });
  it("requires a fresh explicit selection after deleting the active location instead of silently switching", () => {
    const removed = removeEquipmentLocation(fixture(), "home");
    expect(removed.active_equipment_location_id).toBeNull();
    expect(removed.equipment).toBeNull();
    expect(profileErrors(removed)).toContain("Choose the location available for your next training plan.");
    expect(profileErrors(selectEquipmentLocation(removed, "gym"))).toEqual([]);
  });
  it("preserves the global inventory when no locations are configured and validates bad location loads", () => {
    const profile = changeEquipment({ ...initialProfile(), adult_confirmed: true }, { equipment: [] });
    expect(profileErrors(profile)).toEqual([]);
    const bad = fixture();
    bad.equipment_locations[0].available_loads_kg = [NaN];
    expect(profileErrors(bad).some((error) => error.includes("location names"))).toBe(true);
  });
});
