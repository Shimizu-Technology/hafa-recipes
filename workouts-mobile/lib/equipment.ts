import type { TrainingProfile, EquipmentLocation } from "./models";
export function selectEquipmentLocation(profile: TrainingProfile, id: string): TrainingProfile {
  const selected = profile.equipment_locations?.find((location) => location.id === id);
  if (!selected) throw Error("Choose a saved equipment location.");
  return {
    ...profile,
    active_equipment_location_id: id,
    equipment: [...selected.equipment],
    available_loads_kg: [...selected.available_loads_kg],
  };
}
export function changeEquipment(
  profile: TrainingProfile,
  patch: Pick<Partial<TrainingProfile>, "equipment" | "available_loads_kg">
): TrainingProfile {
  const selected = profile.equipment_locations?.find(
    (location) => location.id === profile.active_equipment_location_id
  );
  if (!selected) return { ...profile, ...patch };
  if (patch.equipment === null) throw Error("Choose the current location’s equipment explicitly.");
  const location = {
    ...selected,
    ...(patch.equipment !== undefined ? { equipment: [...patch.equipment] } : {}),
    ...(patch.available_loads_kg !== undefined ? { available_loads_kg: [...patch.available_loads_kg] } : {}),
  };
  return {
    ...profile,
    ...patch,
    equipment_locations: profile.equipment_locations!.map((item) => (item.id === selected.id ? location : item)),
  };
}
export function removeEquipmentLocation(profile: TrainingProfile, id: string): TrainingProfile {
  const remaining = profile.equipment_locations?.filter((item) => item.id !== id) ?? [];
  const selected = profile.active_equipment_location_id === id;
  return {
    ...profile,
    equipment_locations: remaining,
    active_equipment_location_id: selected ? null : profile.active_equipment_location_id,
    ...(selected && remaining.length ? { equipment: null, available_loads_kg: [] } : {}),
  };
}
export function equipmentLocationErrors(locations: EquipmentLocation[], selected: string | null | undefined) {
  const errors: string[] = [];
  if (locations.length > 10 || new Set(locations.map((item) => item.id)).size !== locations.length)
    errors.push("Use up to 10 equipment locations with unique identifiers.");
  if ((locations.length && !locations.some((location) => location.id === selected)) || (!locations.length && selected))
    errors.push("Choose the location available for your next training plan.");
  if (
    locations.some(
      (location) =>
        !location.name.trim() ||
        location.name.length > 80 ||
        location.equipment.length > 100 ||
        location.equipment.some((item) => !item.trim()) ||
        location.available_loads_kg.length > 100 ||
        location.available_loads_kg.some((load) => !Number.isFinite(load) || load <= 0 || load > 2000)
    )
  )
    errors.push(
      "Check location names (up to 80 characters), equipment and available loads (up to 100 positive values, at most 2000 kg)."
    );
  return errors;
}
