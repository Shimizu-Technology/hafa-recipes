import { missingDetails, type MissingDetail } from "@/lib/missing-details";
import { useEffect, useState, type PropsWithChildren } from "react";
import { View } from "react-native";
import { Button, Card, Choice, Copy, Field } from "./ui";
import { SavedSourceText } from "./workout-source";
import { useTraining } from "@/lib/context";
import type { AuthoredWorkout, ExercisePrescription } from "@/lib/models";
import { blockSummary, changeExecution, changeGrouping, changeTimeCap, executionError, parseCap } from "@/lib/amrap-editor";
import { defaultLoadUnit, distanceText, distanceUnit, typedDistance } from "@/lib/workout-units";
const groupings = [["sequential", "One after another"], ["circuit", "Circuit"], ["superset", "Superset"], ["interval", "Intervals"]] as const;
const conventions = [["total", "Total"], ["per_hand", "Per hand"], ["added", "Added"], ["assistance", "Assistance"]] as const;
/** Lays out short fields or choices side by side, wrapping on narrow screens and large text. */
function Columns({ children }: PropsWithChildren) {
  return <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12 }}>{children}</View>;
}
function Column({ children }: PropsWithChildren) {
  return <View style={{ flexBasis: 140, flexGrow: 1 }}>{children}</View>;
}
function Disclosure({ title, open, disabled, onPress }: { title: string; open: boolean; disabled?: boolean; onPress(): void }) {
  return <Button title={title} variant="ghost" size="sm" inline icon={open ? "chevron-up" : "chevron-down"} disabled={disabled} onPress={onPress} />;
}
const hasText = (lines?: string[] | null) => !!lines?.some(line => line.trim());
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
function invalidWorkoutDetails(w: AuthoredWorkout) {
  const lines = (list?: string[] | null) => list ?? [];
  return lines(w.instructions).filter(line => line.trim()).length > 100 || lines(w.instructions).some(line => line.length > 4000) ||
    lines(w.notes).filter(line => line.trim()).length > 100 || lines(w.notes).some(line => line.length > 4000) ||
    (w.equipment_required?.length ?? 0) > 100 || lines(w.equipment_required).some(item => item.length > 4000);
}
function retainExpanded(current: string[], revealed: string[]) {
  const missing = revealed.filter(key => !current.includes(key));
  return missing.length ? [...current, ...missing] : current;
}
export function WorkoutEditor({
  value,
  onChange,
  disabled = false,
  context = "edit",
  review = false,
  onReviewTarget,
}: {
  value: AuthoredWorkout;
  onChange(value: AuthoredWorkout): void;
  disabled?: boolean;
  context?: "create" | "edit";
  review?: boolean;
  onReviewTarget?(): void;
}) {
  const { units } = useTraining();
  const [target, setTarget] = useState<MissingDetail | null>(null);
  const [fullEditor, setFullEditor] = useState(!review);
  const unknown = missingDetails(value);
  const reviewing = review && !fullEditor;
  const targetExercise = target?.block == null || target.exercise == null ? null : value.blocks.find(b => b.id === target.block)?.exercises[target.exercise];
  function focus(next: MissingDetail | null) { setTarget(next); onReviewTarget?.(); }

  const [showMore, setShowMore] = useState(() => hasText(value.instructions) || hasText(value.notes) ||
    !!value.equipment_required?.length || !!value.source_context);
  // Fields with a validation problem stay visible so they can be corrected.
  const moreOpen = target?.key === "equipment" || showMore || invalidWorkoutDetails(value);
  const [expandedBlocks, setExpandedBlocks] = useState<string[]>([]);
  const [expandedExercises, setExpandedExercises] = useState<string[]>([]);
  const [removingBlock, setRemovingBlock] = useState<string | null>(null);
  function update(next: AuthoredWorkout, removedExercise?: { blockId: string; index: number }) {
    if (disabled) return;
    // Keep automatically revealed fields mounted when a correction clears their error.
    setExpandedBlocks(current => retainExpanded(current, value.blocks.filter(invalidBlockSettings).map(block => block.id)));
    setExpandedExercises(current => {
      const retained = retainExpanded(current, value.blocks.flatMap(block =>
        block.exercises.flatMap((e, index) => invalidExerciseDetails(e) ? [`${block.id}:${index}`] : [])));
      if (!removedExercise) return retained;
      const prefix = `${removedExercise.blockId}:`;
      return retained.flatMap(key => {
        if (!key.startsWith(prefix)) return [key];
        const index = Number(key.slice(prefix.length));
        return index === removedExercise.index ? [] : [`${prefix}${index > removedExercise.index ? index - 1 : index}`];
      });
    });
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
      {reviewing && <Card compact>
        <Copy kind="heading">{target ? target.label : `${unknown.length} things to check`}</Copy>
        <Copy kind="small">Only add details supported by the source. Unknown values can stay blank.</Copy>
        {!target ? unknown.map(item => <Button key={item.key} title={item.label} secondary onPress={() => focus(item)} />) : <>
          <Button title="Back to review summary" secondary onPress={() => focus(null)} />
          <Copy kind="label">Source evidence</Copy>
          {targetExercise?.evidence?.map((item, index) => <Copy key={index} kind="small">{item.location ? `${item.location}: ` : ""}{item.wording}</Copy>)}
          <SavedSourceText context={value.source_context} />
          {!targetExercise?.evidence?.length && !value.source_context && <Copy kind="small">No saved wording for this detail. Check the original source or leave it unknown.</Copy>}
          <Button title="Leave unknown" secondary onPress={() => focus(null)} />
        </>}
        <Button title="Open full editor" secondary onPress={() => { setFullEditor(true); focus(null); }} />
      </Card>}
      {(!reviewing || target?.key === "equipment") && <>
      <Field
        disabled={disabled}
        label="Workout title"
        value={value.title}
        onChange={(title) => update({ ...value, title })}
      />
      <NumberField
        disabled={disabled}
        label="Duration · minutes"
        value={value.estimated_minutes}
        onChange={(estimated_minutes) => update({ ...value, estimated_minutes })}
      />
      {/* New Workout already says blanks are fine above the form. */}
      {context === "edit" && <Copy kind="small" tone="muted">Fix what you need. Anything unknown can stay blank.</Copy>}
      {/* Viewing hidden details is allowed even while a save is pending; the fields themselves stay disabled. */}
      <Disclosure title={`${moreOpen ? "Hide" : "Show"} instructions, notes and equipment`} open={moreOpen}
        onPress={() => setShowMore(!moreOpen)} />
      {moreOpen && <>
      <Field
        disabled={disabled}
        label="Instructions · shown when shared"
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
        label="Equipment · separate with commas"
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
        <Copy kind="small" tone="muted">It's removed when you save. Earlier saves keep their original text.</Copy>
      </Card>}
      </>}
      </>}
      {value.blocks.map((block, bi) => {
        if (reviewing && (!target?.block || block.id !== target.block)) return null;
        const blockExpanded = (reviewing && target?.block === block.id && target.exercise == null) || expandedBlocks.includes(block.id) || invalidBlockSettings(block);
        return (
        <Card key={block.id}>
          <Copy kind="heading">{block.label || "Workout block"}</Copy>
          <Copy kind="small" tone="muted">{blockSummary(block)}</Copy>
          <Disclosure title={`${blockExpanded ? "Hide" : "Show"} block settings: ${block.label || "Workout block"}`} open={blockExpanded} disabled={disabled} onPress={() => toggle(block.id, expandedBlocks, setExpandedBlocks)} />
          {blockExpanded && <>
          <Field
            disabled={disabled}
            label="Block name"
            value={block.label}
            onChange={(label) =>
              update({ ...value, blocks: value.blocks.map((b, i) => (i === bi ? { ...b, label } : b)) })
            }
          />
          <Copy kind="label">How it runs</Copy>
          <Columns>
            {groupings.map(([grouping, label]) => (
              <Column key={grouping}><Choice role="radio" disabled={disabled} label={label} selected={block.grouping === grouping}
                onPress={() => update(changeGrouping(value, bi, grouping))} /></Column>
            ))}
          </Columns>
          {block.grouping === "circuit" && <Columns>
            <Column><Choice role="radio" label="Set number of rounds" selected={!block.execution} disabled={disabled}
              onPress={() => update(changeExecution(value, bi, false))} /></Column>
            <Column><Choice role="radio" label="As many rounds as possible" selected={block.execution?.mode === "amrap"} disabled={disabled}
              onPress={() => update(changeExecution(value, bi, true))} /></Column>
          </Columns>}
          {block.execution?.mode === "amrap" ? <>
            <TimeCapField seconds={block.execution.time_cap_seconds} disabled={disabled}
              onChange={(seconds) => update(changeTimeCap(value, bi, seconds))} />
            <Copy kind="small" tone="muted">This sets the timer; review written instructions if you change it.</Copy>
          </> : <NumberField
            disabled={disabled}
            label="Rounds"
            value={block.rounds}
            onChange={(rounds) =>
              update({ ...value, blocks: value.blocks.map((b, i) => (i === bi ? { ...b, rounds } : b)) })
            }
          />}
          <NumberField disabled={disabled} label="Rest between rounds · seconds" value={block.rest_between_rounds_seconds}
            onChange={(rest_between_rounds_seconds) => update({ ...value, blocks: value.blocks.map((b, i) => i === bi ? { ...b, rest_between_rounds_seconds } : b) })} />
          </>}
          {block.exercises.map((e, ei) => {
            if (reviewing && target?.exercise !== ei) return null;
            const key = `${block.id}:${ei}`;
            const expanded = (reviewing && target?.exercise === ei) || expandedExercises.includes(key) || invalidExerciseDetails(e);
            const range = e.reps_max != null && e.reps_max !== e.reps_min;
            return (
            <Card key={key} tone="sunken" compact>
              <Field
                disabled={disabled}
                label="Exercise name"
                value={e.name}
                onChange={(name) => exercise(bi, ei, { name })}
              />
              <Columns>
                <Column><NumberField disabled={disabled} label="Sets" value={e.sets} onChange={(sets) => exercise(bi, ei, { sets })} /></Column>
                <Column><NumberField
                  disabled={disabled}
                  label={range ? "Minimum reps" : "Reps"}
                  value={e.reps_min}
                  onChange={(reps_min) => exercise(bi, ei, { reps_min, ...(!range && e.reps_max != null ? { reps_max: reps_min } : {}) })}
                /></Column>
                {(range || expanded) && <Column><NumberField disabled={disabled} label="Maximum reps" value={e.reps_max}
                  onChange={(reps_max) => exercise(bi, ei, { reps_max })} /></Column>}
              </Columns>
              {(e.duration_seconds != null || e.distance_meters != null || expanded) && <Columns>
                {(e.duration_seconds != null || expanded) && <Column><NumberField disabled={disabled} label="Time · seconds"
                  value={e.duration_seconds} onChange={(duration_seconds) => exercise(bi, ei, { duration_seconds })} /></Column>}
                {(e.distance_meters != null || expanded) && <Column><NumberField disabled={disabled} label={`Distance · ${distanceUnit(units)}`}
                  value={e.distance_meters} format={(meters) => distanceText(meters, units)} parse={(text) => typedDistance(text, units)}
                  onChange={(distance_meters) => exercise(bi, ei, { distance_meters })} /></Column>}
              </Columns>}
              <Disclosure title={`${expanded ? "Hide" : "More"} details for ${e.name || "exercise"}`} open={expanded} disabled={disabled} onPress={() => toggle(key, expandedExercises, setExpandedExercises)} />
              {expanded && <>
              <Columns>
                <Column><NumberField disabled={disabled} label="Rest · seconds" value={e.rest_seconds}
                  onChange={(rest_seconds) => exercise(bi, ei, { rest_seconds })} /></Column>
                <Column><Field disabled={disabled} label="Tempo" optional value={e.tempo ?? ""}
                  onChange={(tempo) => exercise(bi, ei, { tempo: tempo || null })} /></Column>
              </Columns>
              <Choice
                disabled={disabled}
                label="Each side separately"
                detail="For example, 10 reps per arm or leg"
                selected={e.per_side === true}
                onPress={() => exercise(bi, ei, { per_side: e.per_side === true ? false : true })}
              />
              <Field
                disabled={disabled}
                label="Cues · shown when shared"
                optional
                multiline
                value={e.instructions ?? ""}
                onChange={(instructions) => exercise(bi, ei, { instructions: instructions || null })}
              />
              <Field disabled={disabled} label="Private notes · only you" optional multiline
                value={e.notes ?? ""} onChange={notes => exercise(bi, ei, { notes: notes || null })} />
              {!!e.notes && !e.instructions && <Button title={`Move private notes to shared instructions for ${e.name || "exercise"}`}
                variant="ghost" disabled={disabled} onPress={() => exercise(bi, ei, { instructions: e.notes, notes: null })} />}
              <NumberField
                disabled={disabled}
                label={`Weight · ${e.load_unit ?? "select a unit"}`}
                value={e.load}
                onChange={(load) => exercise(bi, ei, {
                  load,
                  // A new weight starts in the person's units, counted as the total, so it can be saved straight away.
                  ...(load != null && e.load == null ? { load_unit: e.load_unit ?? defaultLoadUnit(units), load_convention: e.load_convention ?? "total" } : {}),
                })}
              />
              {e.load != null && (
                <>
                  <Columns>
                    {(["kg", "lb"] as const).map((load_unit) => (
                      <Column key={load_unit}><Choice role="radio" disabled={disabled} label={load_unit} selected={e.load_unit === load_unit}
                        onPress={() => exercise(bi, ei, { load_unit })} /></Column>
                    ))}
                  </Columns>
                  <Columns>
                    {conventions.map(([load_convention, label]) => (
                      <Column key={load_convention}><Choice role="radio" disabled={disabled} label={label} selected={e.load_convention === load_convention}
                        onPress={() => exercise(bi, ei, { load_convention })} /></Column>
                    ))}
                  </Columns>
                </>
              )}
              </>}
              {block.exercises.length > 1 && (
                <Button
                  disabled={disabled}
                  title={`Remove ${e.name || "exercise"}`}
                  variant="ghost"
                  size="sm"
                  inline
                  icon="trash-outline"
                  onPress={() =>
                    update({
                      ...value,
                      blocks: value.blocks.map((b, i) =>
                        i === bi ? { ...b, exercises: b.exercises.filter((_, j) => j !== ei) } : b
                      )
                    }, { blockId: block.id, index: ei })
                  }
                />
              )}
            </Card>
          ); })}
          <Button
            disabled={disabled || block.exercises.length >= 100}
            title="Add exercise to this block"
            secondary
            size="sm"
            inline
            icon="add"
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
          </Card> : <Button title={`Remove block: ${block.label || "Workout block"}`} variant="ghost" size="sm" inline icon="trash-outline" disabled={disabled}
            onPress={() => { if (!disabled) setRemovingBlock(block.id); }} />}
        </Card>
      ); })}
      {!reviewing && <>      <Button
        disabled={disabled || value.blocks.length >= 100}
        title={value.blocks.length ? "Add another block" : "Add exercises"}
        secondary
        icon="add"
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
      </>}
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
      {(["minutes", "seconds"] as const).map(unit => <View key={unit} style={{ flex: 1 }}><Choice role="radio" label={unit === "minutes" ? "Minutes" : "Seconds"}
        selected={units === unit} disabled={disabled} onPress={() => {
          if (!disabled) { setUnits(unit); setText(display(seconds, unit)); }
        }} /></View>)}
    </View>
    <Field label={`AMRAP time cap · ${units}`} value={text} numeric disabled={disabled}
      onChange={next => { if (!disabled) { setText(next); onChange(parseCap(next, units)); } }} />
  </>;
}
const plainNumber = (text: string) => text.trim() === "" ? null : Number(text);
function NumberField({
  label,
  value,
  onChange,
  disabled,
  format = String,
  parse = plainNumber,
}: {
  disabled?: boolean;
  label: string;
  value?: number | null;
  onChange(value: number | null): void;
  /** Stored value to display text, for fields shown in another unit. */
  format?(value: number): string;
  /** Display text to stored value; blank is null. */
  parse?(text: string): number | null;
}) {
  const [text, setText] = useState(value == null ? "" : format(value));
  useEffect(() => {
    if (value == null) {
      if (text.trim() !== "") setText("");
      return;
    }
    if (!Object.is(parse(text), value)) setText(format(value));
    // The label names the unit, so a units change re-formats the text too.
  }, [value, label]);
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
        onChange(parse(v));
      }}
    />
  );
}
