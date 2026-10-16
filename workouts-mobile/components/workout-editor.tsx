import { useEffect, useState } from "react";
import { View } from "react-native";
import { Button, Card, Choice, Copy, Field, Notice } from "./ui";
import { SavedSourceText } from "./workout-source";
import { prescriptionLine } from "@/lib/discover";
import type { AuthoredWorkout, ExercisePrescription } from "@/lib/models";
import { blockSummary, changeExecution, changeGrouping, changeTimeCap, executionError, parseCap } from "@/lib/amrap-editor";
function invalidBlockSettings(block: AuthoredWorkout["blocks"][number]) {
  return !!executionError(block) || !block.label.trim() || block.label.length > 200 ||
    (block.rounds != null && (!Number.isInteger(block.rounds) || block.rounds < 1 || block.rounds > 100)) ||
    (block.rest_between_rounds_seconds != null && (!Number.isInteger(block.rest_between_rounds_seconds) || block.rest_between_rounds_seconds < 0 || block.rest_between_rounds_seconds > 7200));
}
function invalidExerciseDetails(e: ExercisePrescription) {
  return (e.load != null && (!Number.isFinite(e.load) || e.load < 0 || e.load > 2000 || !e.load_unit || !e.load_convention)) ||
    (e.rest_seconds != null && (!Number.isInteger(e.rest_seconds) || e.rest_seconds < 0 || e.rest_seconds > 7200)) ||
    (e.instructions?.length ?? 0) > 2000 || (e.notes?.length ?? 0) > 2000 || (e.tempo?.length ?? 0) > 100 || (e.effort?.length ?? 0) > 500;
}
function retainExpanded(current: string[], revealed: string[]) {
  const missing = revealed.filter(key => !current.includes(key));
  return missing.length ? [...current, ...missing] : current;
}
export function WorkoutEditor({
  value,
  onChange,
  disabled = false,
  context = "edit"
}: {
  value: AuthoredWorkout;
  onChange(value: AuthoredWorkout): void;
  disabled?: boolean;
  context?: "create" | "edit";
}) {
  const [expandedBlocks, setExpandedBlocks] = useState<string[]>([]);
  const [expandedExercises, setExpandedExercises] = useState<string[]>([]);
  const [removingBlock, setRemovingBlock] = useState<string | null>(null);
  function update(next: AuthoredWorkout) {
    if (disabled) return;
    // Keep automatically revealed fields mounted when a correction clears their error.
    setExpandedBlocks(current => retainExpanded(current, value.blocks.filter(invalidBlockSettings).map(block => block.id)));
    setExpandedExercises(current => retainExpanded(current, value.blocks.flatMap(block =>
      block.exercises.flatMap((e, index) => invalidExerciseDetails(e) ? [`${block.id}:${index}`] : []))));
    onChange(next);
  }
  function toggle(key: string, selected: string[], set: (keys: string[]) => void) {
    if (!disabled) set(selected.includes(key) ? selected.filter((item) => item !== key) : [...selected, key]);
  }
  function exercise(block: number, index: number, change: Partial<ExercisePrescription>) {
    update({
      ...value,
      blocks: value.blocks.map((b, i) =>
        i === block
          ? { ...b, exercises: b.exercises.map((e, j) => (j === index ? { ...e, ...change, provenance: "user" } : e)) }
          : b
      )
    });
  }
  return (
    <View style={{ gap: 16 }}>
      <Field
        disabled={disabled}
        label="Workout title"
        value={value.title}
        onChange={(title) => update({ ...value, title })}
      />
      <NumberField
        disabled={disabled}
        label="Estimated duration · minutes"
        value={value.estimated_minutes}
        onChange={(estimated_minutes) => update({ ...value, estimated_minutes })}
      />
      <Field
        disabled={disabled}
        label="Workout instructions · included when sharing"
        multiline
        optional
        value={value.instructions?.join("\n") ?? ""}
        onChange={(text) => update({ ...value, instructions: text.split("\n") })}
      />
      <Field disabled={disabled} label="Private notes · only you" multiline optional
        value={value.notes?.join("\n") ?? ""}
        onChange={text => update({ ...value, notes: text.split("\n") })} />
      {!!value.notes?.length && !value.instructions?.some(line => line.trim()) &&
        <Button title="Move private notes to shared instructions" variant="ghost" disabled={disabled}
          onPress={() => update({ ...value, instructions: value.notes, notes: [] })} />}
      <Field
        disabled={disabled}
        label="Required equipment · comma separated"
        optional
        value={value.equipment_required?.join(", ") ?? ""}
        onChange={(text) =>
          update({
            ...value,
            equipment_required: text
              .split(",")
              .map((x) => x.trim())
              .filter(Boolean)
          })
        }
      />
      {value.source_context && <Card compact>
        <SavedSourceText context={value.source_context} />
        <Button title="Clear saved source text" variant="ghost" disabled={disabled}
          onPress={() => update({ ...value, source_context: null })} />
        <Copy kind="small" tone="muted">Save changes to clear it from this version. Earlier versions keep their original text.</Copy>
      </Card>}
      <Notice>
        {context === "create"
          ? "Use the details you know. Sets, reps and other targets can stay blank. Open block settings for circuits, rounds or AMRAP."
          : "Missing facts can remain blank. Changes below are your corrections; they are not newly discovered creator instructions."}
      </Notice>
      {value.blocks.map((block, bi) => {
        const blockExpanded = expandedBlocks.includes(block.id) || invalidBlockSettings(block);
        return (
        <Card key={block.id}>
          <Copy kind="heading">{block.label || "Workout block"}</Copy>
          <Copy kind="small" tone="muted">{blockSummary(block)}</Copy>
          <Button title={`${blockExpanded ? "Hide" : "Show"} block settings: ${block.label || "Workout block"}`} variant="ghost" disabled={disabled} onPress={() => toggle(block.id, expandedBlocks, setExpandedBlocks)} />
          {blockExpanded && <>
          <Field
            disabled={disabled}
            label="Block name"
            value={block.label}
            onChange={(label) =>
              update({ ...value, blocks: value.blocks.map((b, i) => (i === bi ? { ...b, label } : b)) })
            }
          />
          {(["sequential", "circuit", "superset", "interval"] as const).map((grouping) => (
            <Choice
              disabled={disabled}
              key={grouping}
              label={grouping}
              selected={block.grouping === grouping}
              onPress={() =>
                update(changeGrouping(value, bi, grouping))
              }
            />
          ))}
          {block.grouping === "circuit" && <>
            <Choice label="Fixed rounds" selected={!block.execution} disabled={disabled}
              onPress={() => update(changeExecution(value, bi, false))} />
            <Choice label="AMRAP · repeat until the time cap" selected={block.execution?.mode === "amrap"} disabled={disabled}
              onPress={() => update(changeExecution(value, bi, true))} />
          </>}
          {block.execution?.mode === "amrap" ? <>
            <TimeCapField seconds={block.execution.time_cap_seconds} disabled={disabled}
              onChange={(seconds) => update(changeTimeCap(value, bi, seconds))} />
            <Copy kind="small" tone="muted">This sets the timer; review written instructions if you change it.</Copy>
          </> : <NumberField
            disabled={disabled}
            label="Rounds · separate from exercise sets"
            value={block.rounds}
            onChange={(rounds) =>
              update({ ...value, blocks: value.blocks.map((b, i) => (i === bi ? { ...b, rounds } : b)) })
            }
          />}
          <NumberField disabled={disabled} label="Rest between rounds · seconds" value={block.rest_between_rounds_seconds}
            onChange={(rest_between_rounds_seconds) => update({ ...value, blocks: value.blocks.map((b, i) => i === bi ? { ...b, rest_between_rounds_seconds } : b) })} />
          </>}
          {block.exercises.map((e, ei) => {
            const key = `${block.id}:${ei}`;
            const expanded = expandedExercises.includes(key) || invalidExerciseDetails(e);
            const range = e.reps_max != null && e.reps_max !== e.reps_min;
            return (
            <Card key={key} tone="sunken" compact>
              <Copy kind="small" tone="muted">{prescriptionLine(e)}</Copy>
              <Field
                disabled={disabled}
                label="Exercise name"
                value={e.name}
                onChange={(name) => exercise(bi, ei, { name })}
              />
              <NumberField
                disabled={disabled}
                label="Sets"
                value={e.sets}
                onChange={(sets) => exercise(bi, ei, { sets })}
              />
              <NumberField
                disabled={disabled}
                label={range ? "Minimum reps" : "Reps"}
                value={e.reps_min}
                onChange={(reps_min) => exercise(bi, ei, { reps_min, ...(!range && e.reps_max != null ? { reps_max: reps_min } : {}) })}
              />
              {(range || expanded) && <NumberField
                disabled={disabled}
                label="Maximum reps"
                value={e.reps_max}
                onChange={(reps_max) => exercise(bi, ei, { reps_max })}
              />}
              {(e.duration_seconds != null || expanded) && <NumberField
                disabled={disabled}
                label="Time · seconds"
                value={e.duration_seconds}
                onChange={(duration_seconds) => exercise(bi, ei, { duration_seconds })}
              />}
              {(e.distance_meters != null || expanded) && <NumberField
                disabled={disabled}
                label="Distance · metres"
                value={e.distance_meters}
                onChange={(distance_meters) => exercise(bi, ei, { distance_meters })}
              />}
              <Button title={`${expanded ? "Hide" : "More"} details for ${e.name || "exercise"}`} variant="ghost" disabled={disabled} onPress={() => toggle(key, expandedExercises, setExpandedExercises)} />
              {expanded && <>
              <NumberField
                disabled={disabled}
                label="Rest · seconds"
                value={e.rest_seconds}
                onChange={(rest_seconds) => exercise(bi, ei, { rest_seconds })}
              />
              <Choice
                disabled={disabled}
                label="Prescription is per side"
                selected={e.per_side === true}
                onPress={() => exercise(bi, ei, { per_side: e.per_side === true ? false : true })}
              />
              <Field
                disabled={disabled}
                label="Tempo"
                optional
                value={e.tempo ?? ""}
                onChange={(tempo) => exercise(bi, ei, { tempo: tempo || null })}
              />
              <Field
                disabled={disabled}
                label="Instructions or cues · included when sharing"
                optional
                multiline
                value={e.instructions ?? ""}
                onChange={(instructions) => exercise(bi, ei, { instructions: instructions || null })}
              />
              <Field disabled={disabled} label="Private exercise notes · only you" optional multiline
                value={e.notes ?? ""} onChange={notes => exercise(bi, ei, { notes: notes || null })} />
              {!!e.notes && !e.instructions && <Button title={`Move private notes to shared instructions for ${e.name || "exercise"}`}
                variant="ghost" disabled={disabled} onPress={() => exercise(bi, ei, { instructions: e.notes, notes: null })} />}
              <NumberField
                disabled={disabled}
                label={`${context === "create" ? "Load" : "Source load"} · ${e.load_unit ?? "select a unit"}`}
                value={e.load}
                onChange={(load) => exercise(bi, ei, { load })}
              />
              {e.load != null && (
                <>
                  {(["kg", "lb"] as const).map((load_unit) => (
                    <Choice
                      disabled={disabled}
                      key={load_unit}
                      label={load_unit}
                      selected={e.load_unit === load_unit}
                      onPress={() => exercise(bi, ei, { load_unit })}
                    />
                  ))}
                  {(["total", "per_hand", "added", "assistance"] as const).map((load_convention) => (
                    <Choice
                      disabled={disabled}
                      key={load_convention}
                      label={load_convention.replaceAll("_", " ")}
                      selected={e.load_convention === load_convention}
                      onPress={() => exercise(bi, ei, { load_convention })}
                    />
                  ))}
                </>
              )}
              </>}
              {block.exercises.length > 1 && (
                <Button
                  disabled={disabled}
                  title={`Remove ${e.name || "exercise"}`}
                  secondary
                  onPress={() =>
                    update({
                      ...value,
                      blocks: value.blocks.map((b, i) =>
                        i === bi ? { ...b, exercises: b.exercises.filter((_, j) => j !== ei) } : b
                      )
                    })
                  }
                />
              )}
            </Card>
          ); })}
          <Button
            disabled={disabled || block.exercises.length >= 100}
            title="Add exercise to this block"
            secondary
            onPress={() => {
              if (block.exercises.length >= 100) return;
              update({
                ...value,
                blocks: value.blocks.map((b, i) =>
                  i === bi ? { ...b, exercises: [...b.exercises, { name: "", provenance: "user" }] } : b
                )
              });
            }}
          />
          {removingBlock === block.id ? <Card tone="sunken" compact>
            <Copy>Remove this block and all its exercises from this draft?</Copy>
            <Button title="Keep this block" secondary disabled={disabled} onPress={() => { if (!disabled) setRemovingBlock(null); }} />
            <Button title="Remove this block" variant="destructive" disabled={disabled} onPress={() => {
              if (disabled) return;
              update({ ...value, blocks: value.blocks.filter((_, index) => index !== bi) });
              setRemovingBlock(null);
            }} />
          </Card> : <Button title={`Remove block: ${block.label || "Workout block"}`} secondary disabled={disabled}
            onPress={() => { if (!disabled) setRemovingBlock(block.id); }} />}
        </Card>
      ); })}
      <Button
        disabled={disabled || value.blocks.length >= 100}
        title={value.blocks.length ? "Add another block" : "Add exercises"}
        secondary
        onPress={() => {
          if (value.blocks.length >= 100) return;
          update({
            ...value,
            blocks: [
              ...value.blocks,
              {
                id: `block-${Date.now()}-${value.blocks.length}`,
                label: value.blocks.length ? "Additional work" : "Main session",
                grouping: "sequential",
                exercises: [{ name: "", provenance: "user" }]
              }
            ]
          });
        }}
      />
    </View>
  );
}
function TimeCapField({ seconds, onChange, disabled }: {
  seconds: number; onChange(seconds: number): void; disabled: boolean;
}) {
  const [units, setUnits] = useState<"minutes" | "seconds">(seconds % 60 ? "seconds" : "minutes");
  const display = (value: number, unit: typeof units) => value == null || value === 0 ? "" : String(value / (unit === "minutes" ? 60 : 1));
  const [text, setText] = useState(() => display(seconds, units));
  useEffect(() => {
    if (!Object.is(parseCap(text, units), seconds)) setText(display(seconds, units));
  }, [seconds]);
  return <>
    <View style={{ flexDirection: "row", gap: 12 }}>
      {(["minutes", "seconds"] as const).map(unit => <View key={unit} style={{ flex: 1 }}><Choice label={unit === "minutes" ? "Minutes" : "Seconds"}
        selected={units === unit} disabled={disabled} onPress={() => {
          if (!disabled) { setUnits(unit); setText(display(seconds, unit)); }
        }} /></View>)}
    </View>
    <Field label={`AMRAP time cap · ${units}`} value={text} numeric disabled={disabled}
      onChange={next => { if (!disabled) { setText(next); onChange(parseCap(next, units)); } }} />
  </>;
}
function NumberField({
  label,
  value,
  onChange,
  disabled
}: {
  disabled?: boolean;
  label: string;
  value?: number | null;
  onChange(value: number | null): void;
}) {
  const [text, setText] = useState(value == null ? "" : String(value));
  useEffect(() => {
    if (value == null) {
      if (text.trim() !== "") setText("");
      return;
    }
    if (Number(text) !== value) setText(String(value));
  }, [value]);
  return (
    <Field
      disabled={disabled}
      label={label}
      optional
      numeric
      value={text}
      onChange={(v) => {
        if (disabled) return;
        setText(v);
        onChange(v.trim() === "" ? null : Number(v));
      }}
    />
  );
}
