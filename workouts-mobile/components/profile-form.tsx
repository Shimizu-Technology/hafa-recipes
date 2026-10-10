import { ActivityContext } from "./activity-context";
import { OptionalNumber } from "./optional-number";
import { CalendarDate } from "./calendar-date";
import { displayedDistance, canonicalDistance } from "@/lib/profile-context";
import { EquipmentLocations } from "./equipment-locations";
import { changeEquipment } from "@/lib/equipment";
import { useEffect, useState } from "react";
import { useTraining } from "@/lib/context";
import { displayLoad, canonicalLoad, displayHeight, canonicalHeight, type UnitSystem } from "@/lib/training";
import { RecordedTime } from "./recorded-time";
import { View } from "react-native";
import { Button, Choice, Copy, Field } from "./ui";
import { goalLabels, type TrainingProfile, type Goal } from "@/lib/models";
const dayLabels = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const equipment = ["dumbbells", "barbell", "bench", "pull_up_bar", "bands", "kettlebell", "machines"];
export function ProfileForm({
  value,
  update,
  section,
  baseline,
  disabled = false
}: {
  disabled?: boolean;
  value: TrainingProfile;
  update(value: TrainingProfile): void;
  section?: number;
  baseline?: TrainingProfile | null;
}) {
  const { units, setUnits } = useTraining();
  const set = (change: Partial<TrainingProfile>) => {
    if (disabled) return;
    const merged = { ...value, ...change };
    update(
      change.equipment !== undefined || change.available_loads_kg !== undefined
        ? changeEquipment(merged, change)
        : merged
    );
  };
  function toggle(item: string) {
    const current = value.equipment ?? [];
    set({ equipment: current.includes(item) ? current.filter((x) => x !== item) : [...current, item] });
  }
  return (
    <View style={{ gap: 16 }}>
      {(section == null || section === 0) && (
        <>
          <Copy kind="heading">What matters most to you?</Copy>
          {(Object.entries(goalLabels) as Array<[Goal, string]>).map(([goal, label]) => (
            <Choice
              disabled={disabled}
              key={goal}
              label={label}
              selected={value.primary_goal === goal}
              onPress={() =>
                set({
                  primary_goal: goal,
                  secondary_goals: (value.secondary_goals ?? []).filter((item) => item !== goal)
                })
              }
            />
          ))}
          <Copy kind="heading">Anything else you want to work toward?</Copy>
          <Copy>Optional secondary goals help describe your priorities. Your main goal still guides the plan.</Copy>
          {(Object.entries(goalLabels) as Array<[Goal, string]>)
            .filter(([goal]) => goal !== value.primary_goal)
            .map(([goal, label]) => (
              <Choice
                disabled={disabled}
                key={`secondary:${goal}`}
                label={`Also: ${label}`}
                selected={!!value.secondary_goals?.includes(goal)}
                onPress={() =>
                  set({
                    secondary_goals: value.secondary_goals?.includes(goal)
                      ? value.secondary_goals.filter((item) => item !== goal)
                      : [...(value.secondary_goals ?? []), goal]
                  })
                }
              />
            ))}
          {!!value.secondary_goals?.length && (
            <Button
              disabled={disabled}
              title="Clear secondary goals"
              secondary
              onPress={() => set({ secondary_goals: [] })}
            />
          )}
          {(value.primary_goal === "strength" || value.secondary_goals?.includes("strength")) && (
            <>
              {(["strength", "muscle", "both"] as const).map((priority, index) => (
                <Choice
                  disabled={disabled}
                  key={priority}
                  label={["Focus on strength", "Focus on muscle", "A balance of both"][index]}
                  selected={value.strength_priority === priority}
                  onPress={() => set({ strength_priority: priority })}
                />
              ))}
            </>
          )}
          {(value.primary_goal === "body_composition" || value.secondary_goals?.includes("body_composition")) && (
            <>
              {(["maintain", "fat_loss", "muscle_gain"] as const).map((priority, index) => (
                <Choice
                  disabled={disabled}
                  key={priority}
                  label={["Maintain my current composition", "Work toward fat loss", "Work toward muscle gain"][index]}
                  selected={value.body_composition_priority === priority}
                  onPress={() => set({ body_composition_priority: priority })}
                />
              ))}
            </>
          )}
          {(value.primary_goal === "athletic_conditioning" ||
            value.secondary_goals?.includes("athletic_conditioning")) && (
            <Field
              disabled={disabled}
              label="Activities you train for"
              value={value.activity_focus ?? ""}
              onChange={(activity_focus) => set({ activity_focus })}
              placeholder="Basketball, hiking, or another activity"
            />
          )}
          {(value.primary_goal === "running" ||
            value.secondary_goals?.includes("running") ||
            value.running_baseline != null) && (
            <>
              <Copy kind="label">Your running starting point</Copy>
              {value.running_baseline != null && (
                <Button
                  disabled={disabled}
                  title="Clear my optional running context"
                  secondary
                  onPress={() => set({ running_baseline: null })}
                />
              )}
              <OptionalNumber
                disabled={disabled}
                label="Comfortable walking time · minutes"
                value={value.running_baseline?.comfortable_walk_minutes}
                onChange={(comfortable_walk_minutes) =>
                  set({
                    running_baseline: {
                      novice_start_confirmed: false,
                      accepted_stage: 0,
                      ...value.running_baseline,
                      comfortable_walk_minutes
                    }
                  })
                }
              />
              <OptionalNumber
                disabled={disabled}
                label="Comfortable running time · minutes"
                value={value.running_baseline?.comfortable_run_minutes}
                onChange={(comfortable_run_minutes) =>
                  set({
                    running_baseline: {
                      novice_start_confirmed: false,
                      accepted_stage: 0,
                      ...value.running_baseline,
                      comfortable_run_minutes
                    }
                  })
                }
              />
              <OptionalNumber
                disabled={disabled}
                label="Recent running volume · minutes per week"
                value={value.running_baseline?.recent_weekly_minutes}
                onChange={(recent_weekly_minutes) =>
                  set({
                    running_baseline: {
                      novice_start_confirmed: false,
                      accepted_stage: 0,
                      ...value.running_baseline,
                      recent_weekly_minutes
                    }
                  })
                }
              />
              <OptionalNumber
                disabled={disabled}
                label="Recent runs per week"
                value={value.running_baseline?.recent_runs_per_week}
                onChange={(recent_runs_per_week) =>
                  set({
                    running_baseline: {
                      novice_start_confirmed: false,
                      accepted_stage: 0,
                      ...value.running_baseline,
                      recent_runs_per_week
                    }
                  })
                }
              />
              <Copy kind="small">
                Use your recent comfortable routine, rather than a target you have not reached yet. Leave uncertain
                values unspecified.
              </Copy>
              <OptionalNumber
                disabled={disabled}
                label={`Optional event distance · ${units === "imperial" ? "miles" : "km"}`}
                value={value.running_baseline?.event_distance_km}
                toDisplay={(km) => displayedDistance(km, units === "imperial")}
                toCanonical={(n) => canonicalDistance(n, units === "imperial")}
                onChange={(event_distance_km) =>
                  set({
                    running_baseline: {
                      novice_start_confirmed: false,
                      accepted_stage: 0,
                      ...value.running_baseline,
                      event_distance_km
                    }
                  })
                }
              />
              <CalendarDate
                disabled={disabled}
                optional
                label="Target event date"
                value={value.running_baseline?.event_date}
                onChange={(event_date) =>
                  set({
                    running_baseline: {
                      novice_start_confirmed: false,
                      accepted_stage: 0,
                      ...value.running_baseline,
                      event_date
                    }
                  })
                }
              />
              <Copy kind="small">
                An event target does not automatically raise training volume. Review any proposed plan and its questions
                before accepting.
              </Copy>
              <Choice
                disabled={disabled}
                label="Use a conservative walking / running progression"
                detail={`Use this for a conservative starting routine. Saved stage ${(value.running_baseline?.accepted_stage ?? 0) + 1} advances only through a reviewed progression.`}
                selected={value.running_baseline?.novice_start_confirmed ?? false}
                onPress={() =>
                  set({
                    running_baseline: {
                      accepted_stage: 0,
                      ...value.running_baseline,
                      novice_start_confirmed: !value.running_baseline?.novice_start_confirmed
                    }
                  })
                }
              />
            </>
          )}
          <Copy kind="heading">Your training experience</Copy>
          {(["new", "returning", "regular"] as const).map((experience, index) => (
            <Choice
              disabled={disabled}
              key={experience}
              label={["Getting started", "Coming back to training", "Training regularly"][index]}
              selected={value.experience === experience}
              onPress={() => set({ experience })}
            />
          ))}
        </>
      )}
      {(section == null || section === 1) && (
        <>
          <EquipmentLocations disabled={disabled} value={value} update={update} />
          <Copy kind="heading">What can you train with?</Copy>
          <Choice
            disabled={disabled}
            label="Bodyweight / no equipment"
            selected={value.equipment?.length === 0}
            onPress={() => set({ equipment: [] })}
          />
          {!value.equipment_locations?.length && (
            <Choice
              disabled={disabled}
              label="Decide later"
              selected={value.equipment === null}
              onPress={() => set({ equipment: null })}
            />
          )}
          {equipment.map((item) => (
            <Choice
              disabled={disabled}
              key={item}
              label={item.replaceAll("_", " ")}
              selected={!!value.equipment?.includes(item)}
              onPress={() => toggle(item)}
            />
          ))}
          <Copy kind="heading">Days you can usually train</Copy>
          {dayLabels.map((label, day) => (
            <Choice
              disabled={disabled}
              key={label}
              label={label}
              selected={value.available_days.includes(day)}
              onPress={() =>
                set({
                  available_days: value.available_days.includes(day)
                    ? value.available_days.filter((x) => x !== day)
                    : [...value.available_days, day].sort()
                })
              }
            />
          ))}
          <Field
            disabled={disabled}
            label="Session length · minutes"
            numeric
            value={String(value.session_minutes)}
            onChange={(text) => set({ session_minutes: text === "" ? 0 : Number(text) })}
          />
          <Field
            disabled={disabled}
            label="Timezone"
            value={value.timezone}
            onChange={(timezone) => set({ timezone })}
          />
          <ActivityContext
            disabled={disabled}
            activities={value.other_activities ?? []}
            timezone={value.timezone}
            onChange={(other_activities) => set({ other_activities })}
          />
        </>
      )}
      {(section == null || section === 2) && (
        <>
          <Copy kind="heading">Personal context</Copy>
          <Copy>These details are optional. Your profile stays private and you can remove information later.</Copy>
          <Field
            disabled={disabled}
            label="Age · years"
            optional
            numeric
            value={value.age_years == null ? "" : String(value.age_years)}
            onChange={(text) => set({ age_years: text === "" ? null : Number(text) })}
          />
          <Copy kind="label">Display units</Copy>
          <Choice
            disabled={disabled}
            label="lb / inches / miles"
            selected={units === "imperial"}
            onPress={() => {
              void setUnits("imperial");
            }}
          />
          <Choice
            disabled={disabled}
            label="kg / cm / metres"
            selected={units === "metric"}
            onPress={() => {
              void setUnits("metric");
            }}
          />
          <MeasurementField
            disabled={disabled}
            kind="weight"
            units={units}
            value={value.weight_kg ?? null}
            onChange={(weight_kg) =>
              set({
                weight_kg,
                ...(weight_kg !== value.weight_kg
                  ? { weight_recorded_at: weight_kg == null ? null : new Date().toISOString() }
                  : {})
              })
            }
          />
          {value.weight_kg != null && (
            <RecordedTime
              label="Weight measurement date and time"
              disabled={disabled || value.weight_kg === baseline?.weight_kg}
              value={value.weight_recorded_at ?? null}
              onChange={(weight_recorded_at) => set({ weight_recorded_at })}
            />
          )}
          {value.weight_kg != null && value.weight_kg === baseline?.weight_kg && (
            <Copy>To correct only the date of this saved weight, use Measurement history.</Copy>
          )}
          <MeasurementField
            disabled={disabled}
            kind="height"
            units={units}
            value={value.height_cm ?? null}
            onChange={(height_cm) =>
              set({
                height_cm,
                ...(height_cm !== value.height_cm
                  ? { height_recorded_at: height_cm == null ? null : new Date().toISOString() }
                  : {})
              })
            }
          />
          {value.height_cm != null && (
            <RecordedTime
              label="Height measurement date and time"
              disabled={disabled || value.height_cm === baseline?.height_cm}
              value={value.height_recorded_at ?? null}
              onChange={(height_recorded_at) => set({ height_recorded_at })}
            />
          )}
          {value.height_cm != null && value.height_cm === baseline?.height_cm && (
            <Copy>To correct only the date of this saved height, use Measurement history.</Copy>
          )}
          <Field
            disabled={disabled}
            label="Limitations or instructions you follow"
            optional
            multiline
            value={value.limitations.join("\n")}
            onChange={(text) => set({ limitations: text.split("\n") })}
            placeholder="One per line. Keep any professional instructions in your own words."
          />
          <Field
            disabled={disabled}
            label="Movements to avoid"
            optional
            multiline
            value={value.movement_exclusions.join("\n")}
            onChange={(text) => set({ movement_exclusions: text.split("\n") })}
          />
          <Choice
            disabled={disabled}
            label="My comfortable training baseline is uncertain after a break"
            detail="Keep this selected until you have reviewed your current baseline. A paused-plan return also requires its own explicit confirmation."
            selected={value.interrupted ?? false}
            onPress={() => set({ interrupted: !value.interrupted })}
          />
          <Copy kind="heading">How are you feeling today?</Copy>
          {(["unknown", "ready", "limited"] as const).map((readiness, index) => (
            <Choice
              disabled={disabled}
              key={readiness}
              label={["Prefer not to say", "Ready to train", "Need to take it easier"][index]}
              selected={value.readiness === readiness}
              onPress={() => set({ readiness })}
            />
          ))}
        </>
      )}
    </View>
  );
}

function MeasurementField({
  kind,
  units,
  value,
  onChange,
  disabled
}: {
  disabled?: boolean;
  kind: "weight" | "height";
  units: UnitSystem;
  value: number | null;
  onChange(value: number | null): void;
}) {
  const display = kind === "weight" ? displayLoad : displayHeight;
  const canonical = kind === "weight" ? canonicalLoad : canonicalHeight;
  const format = () => (value == null ? "" : String(Math.round(display(value, units) * 100) / 100));
  const [text, setText] = useState(format);
  useEffect(() => {
    const expected = format();
    if (text === "" && value == null) return;
    if (value != null && Math.abs(Number(text) - display(value, units)) < 0.001) return;
    setText(expected);
  }, [value, units]);
  return (
    <Field
      disabled={disabled}
      label={`${kind === "weight" ? "Weight" : "Height"} · ${kind === "weight" ? (units === "imperial" ? "lb" : "kg") : units === "imperial" ? "inches" : "cm"}`}
      optional
      numeric
      value={text}
      onChange={(input) => {
        if (disabled) return;
        setText(input);
        onChange(input.trim() === "" ? null : canonical(Number(input), units));
      }}
    />
  );
}
