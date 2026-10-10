import { useEffect, useState } from "react";
import { View } from "react-native";
import { Button, Card, Choice, Copy, Field, Notice } from "./ui";
import type { AuthoredWorkout, ExercisePrescription } from "@/lib/models";
export function WorkoutEditor({ value, onChange }: { value: AuthoredWorkout; onChange(value: AuthoredWorkout): void }) {
  function exercise(block: number, index: number, change: Partial<ExercisePrescription>) {
    onChange({
      ...value,
      blocks: value.blocks.map((b, i) =>
        i === block
          ? { ...b, exercises: b.exercises.map((e, j) => (j === index ? { ...e, ...change, provenance: "user" } : e)) }
          : b
      ),
    });
  }
  return (
    <View style={{ gap: 16 }}>
      <Field label="Workout title" value={value.title} onChange={(title) => onChange({ ...value, title })} />
      <Field
        label="Required equipment · comma separated"
        optional
        value={value.equipment_required?.join(", ") ?? ""}
        onChange={(text) =>
          onChange({
            ...value,
            equipment_required: text
              .split(",")
              .map((x) => x.trim())
              .filter(Boolean),
          })
        }
      />
      <Notice>
        Missing facts can remain blank. Changes below are your corrections; they are not newly discovered creator
        instructions.
      </Notice>
      {value.blocks.map((block, bi) => (
        <Card key={block.id}>
          <Field
            label="Block name"
            value={block.label}
            onChange={(label) =>
              onChange({ ...value, blocks: value.blocks.map((b, i) => (i === bi ? { ...b, label } : b)) })
            }
          />
          {(["sequential", "circuit", "superset", "interval"] as const).map((grouping) => (
            <Choice
              key={grouping}
              label={grouping}
              selected={block.grouping === grouping}
              onPress={() =>
                onChange({ ...value, blocks: value.blocks.map((b, i) => (i === bi ? { ...b, grouping } : b)) })
              }
            />
          ))}
          <NumberField
            label="Rounds · separate from exercise sets"
            value={block.rounds}
            onChange={(rounds) =>
              onChange({ ...value, blocks: value.blocks.map((b, i) => (i === bi ? { ...b, rounds } : b)) })
            }
          />
          {block.exercises.map((e, ei) => (
            <Card key={`${block.id}:${ei}`}>
              <Field label="Exercise name" value={e.name} onChange={(name) => exercise(bi, ei, { name })} />
              <NumberField label="Sets" value={e.sets} onChange={(sets) => exercise(bi, ei, { sets })} />
              <NumberField
                label="Minimum reps"
                value={e.reps_min}
                onChange={(reps_min) => exercise(bi, ei, { reps_min })}
              />
              <NumberField
                label="Maximum reps"
                value={e.reps_max}
                onChange={(reps_max) => exercise(bi, ei, { reps_max })}
              />
              <NumberField
                label="Time · seconds"
                value={e.duration_seconds}
                onChange={(duration_seconds) => exercise(bi, ei, { duration_seconds })}
              />
              <NumberField
                label="Distance · metres"
                value={e.distance_meters}
                onChange={(distance_meters) => exercise(bi, ei, { distance_meters })}
              />
              <NumberField
                label="Rest · seconds"
                value={e.rest_seconds}
                onChange={(rest_seconds) => exercise(bi, ei, { rest_seconds })}
              />
              <Choice
                label="Prescription is per side"
                selected={e.per_side === true}
                onPress={() => exercise(bi, ei, { per_side: e.per_side === true ? false : true })}
              />
              <Field
                label="Tempo"
                optional
                value={e.tempo ?? ""}
                onChange={(tempo) => exercise(bi, ei, { tempo: tempo || null })}
              />
              <Field
                label="Instructions or cues"
                optional
                multiline
                value={e.notes ?? ""}
                onChange={(notes) => exercise(bi, ei, { notes: notes || null })}
              />
              <NumberField
                label={`Source load · ${e.load_unit ?? "select a unit"}`}
                value={e.load}
                onChange={(load) => exercise(bi, ei, { load })}
              />
              {e.load != null && (
                <>
                  {(["kg", "lb"] as const).map((load_unit) => (
                    <Choice
                      key={load_unit}
                      label={load_unit}
                      selected={e.load_unit === load_unit}
                      onPress={() => exercise(bi, ei, { load_unit })}
                    />
                  ))}
                  {(["total", "per_hand", "added", "assistance"] as const).map((load_convention) => (
                    <Choice
                      key={load_convention}
                      label={load_convention.replaceAll("_", " ")}
                      selected={e.load_convention === load_convention}
                      onPress={() => exercise(bi, ei, { load_convention })}
                    />
                  ))}
                </>
              )}
              {block.exercises.length > 1 && (
                <Button
                  title={`Remove ${e.name || "exercise"}`}
                  secondary
                  onPress={() =>
                    onChange({
                      ...value,
                      blocks: value.blocks.map((b, i) =>
                        i === bi ? { ...b, exercises: b.exercises.filter((_, j) => j !== ei) } : b
                      ),
                    })
                  }
                />
              )}
            </Card>
          ))}
          <Button
            title="Add exercise to this block"
            secondary
            onPress={() =>
              onChange({
                ...value,
                blocks: value.blocks.map((b, i) =>
                  i === bi ? { ...b, exercises: [...b.exercises, { name: "", provenance: "user" }] } : b
                ),
              })
            }
          />
        </Card>
      ))}
      <Button
        title="Add another block"
        secondary
        onPress={() =>
          onChange({
            ...value,
            blocks: [
              ...value.blocks,
              {
                id: `block-${Date.now()}-${value.blocks.length}`,
                label: "Additional work",
                grouping: "sequential",
                exercises: [{ name: "", provenance: "user" }],
              },
            ],
          })
        }
      />
    </View>
  );
}
function NumberField({
  label,
  value,
  onChange,
}: {
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
      label={label}
      optional
      numeric
      value={text}
      onChange={(v) => {
        setText(v);
        onChange(v.trim() === "" ? null : Number(v));
      }}
    />
  );
}
