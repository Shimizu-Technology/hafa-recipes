import { useState } from "react";
import * as Crypto from "expo-crypto";
import { Button, Card, Choice, Copy, Field, Notice } from "./ui";
import { useTraining } from "@/lib/context";
import { changeEquipment, removeEquipmentLocation, selectEquipmentLocation } from "@/lib/equipment";
import { canonicalLoad, displayLoad } from "@/lib/training";
import type { TrainingProfile } from "@/lib/models";
export function EquipmentLocations({
  value,
  update,
}: {
  value: TrainingProfile;
  update(value: TrainingProfile): void;
}) {
  const { units } = useTraining();
  const [name, setName] = useState("");
  const [load, setLoad] = useState("");
  const [custom, setCustom] = useState("");
  const [error, setError] = useState("");
  const locations = value.equipment_locations ?? [];
  const active = locations.find((location) => location.id === value.active_equipment_location_id);
  const loads = value.available_loads_kg ?? [];
  function create() {
    const title = name.trim();
    if (!title || title.length > 80) {
      setError("Use a location name of 1–80 characters.");
      return;
    }
    if (value.equipment == null) {
      setError("Choose available equipment or Bodyweight before creating a location.");
      return;
    }
    const location = {
      id: Crypto.randomUUID(),
      name: title,
      equipment: [...value.equipment],
      available_loads_kg: [...loads],
    };
    update({ ...value, equipment_locations: [...locations, location], active_equipment_location_id: location.id });
    setName("");
    setError("");
  }
  function addLoad() {
    const number = Number(load);
    const kg = canonicalLoad(number, units);
    if (!load.trim() || !Number.isFinite(kg) || kg <= 0 || kg > 2000) {
      setError("Enter a positive available load, up to 2000 kg in your selected unit.");
      return;
    }
    if (loads.length >= 100) {
      setError("Keep up to 100 available loads.");
      return;
    }
    update(changeEquipment(value, { available_loads_kg: [...new Set([...loads, kg])].sort((a, b) => a - b) }));
    setLoad("");
    setError("");
  }
  function addEquipment() {
    const item = custom.trim();
    if (!item || item.length > 100) {
      setError("Use a short, nonblank equipment name.");
      return;
    }
    const equipment = value.equipment ?? [];
    if (equipment.length >= 100) {
      setError("Keep up to 100 equipment items per location.");
      return;
    }
    update(changeEquipment(value, { equipment: [...new Set([...equipment, item])] }));
    setCustom("");
    setError("");
  }
  return (
    <>
      <Card>
        <Copy kind="heading">Where will you train?</Copy>
        <Copy>Locations stay separate. The selected location supplies the equipment and loads for your next plan.</Copy>
        {locations.map((location) => (
          <Choice
            key={location.id}
            label={location.name}
            detail={location.equipment.length ? location.equipment.join(" · ") : "Bodyweight / no equipment"}
            selected={value.active_equipment_location_id === location.id}
            onPress={() => update(selectEquipmentLocation(value, location.id))}
          />
        ))}
        {locations.length > 0 && !active && (
          <Notice>Choose a location before saving your profile or building a plan.</Notice>
        )}
        {active && (
          <>
            <Field
              label="Selected location name"
              value={active.name}
              onChange={(name) =>
                update({
                  ...value,
                  equipment_locations: locations.map((location) =>
                    location.id === active.id ? { ...location, name } : location
                  ),
                })
              }
            />
            <Button
              title={`Remove ${active.name} location`}
              secondary
              onPress={() => update(removeEquipmentLocation(value, active.id))}
            />
          </>
        )}
        <Field label="New location name" value={name} onChange={setName} placeholder="Home, Gym, Outdoors…" />
        <Copy kind="small">
          A new location starts with the equipment selected below. Choose Bodyweight or your available equipment first,
          then save the profile.
        </Copy>
        <Button
          title="Add equipment location"
          secondary
          disabled={locations.length >= 10 || !name.trim() || value.equipment == null}
          onPress={create}
        />
      </Card>
      <Card>
        <Copy kind="heading">{active ? `${active.name} inventory` : "Your available equipment"}</Copy>
        <Field
          label="Other equipment item"
          value={custom}
          onChange={setCustom}
          optional
          placeholder="Resistance machine, medicine ball…"
        />
        <Button title="Add this equipment item" secondary disabled={!custom.trim()} onPress={addEquipment} />
        {value.equipment
          ?.filter(
            (item) =>
              !["dumbbells", "barbell", "bench", "pull_up_bar", "bands", "kettlebell", "machines"].includes(item)
          )
          .map((item) => (
            <Button
              key={item}
              title={`Remove ${item}`}
              secondary
              onPress={() =>
                update(changeEquipment(value, { equipment: value.equipment!.filter((value) => value !== item) }))
              }
            />
          ))}
        <Field
          label={`Available load · ${units === "imperial" ? "lb" : "kg"}`}
          value={load}
          onChange={setLoad}
          numeric
          optional
        />
        <Copy kind="small">
          Add only loads you can actually use. These are equipment options, not an assigned training load.
        </Copy>
        <Button title="Add available load" secondary disabled={!load.trim()} onPress={addLoad} />
        {loads.map((kg) => (
          <Button
            key={kg}
            title={`Remove ${Number(displayLoad(kg, units).toFixed(3))} ${units === "imperial" ? "lb" : "kg"} option`}
            secondary
            onPress={() =>
              update(changeEquipment(value, { available_loads_kg: loads.filter((value) => value !== kg) }))
            }
          />
        ))}
      </Card>
      {!!error && <Notice error>{error}</Notice>}
    </>
  );
}
