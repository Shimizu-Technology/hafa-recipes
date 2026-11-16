import { useState } from "react";
import { View } from "react-native";
import * as Clipboard from "expo-clipboard";
import { Button, Card, Chip, ChipRow, Choice, Copy, Field, Row, Segmented, useToast } from "@/components/ui";
import { formatPartScore, type PartResult, type Segment } from "@/lib/class-session";
import { cleanScore, parseTime, scoreProblem, wodupText } from "@/lib/class-scores";
import { partTitle } from "@/lib/class-view";
import { hasBuyIn } from "@/lib/class-training";
import type { Workout } from "@/lib/models";

type Block = Workout["blocks"][number];
const num = (text: string) => (text.trim() === "" || !Number.isFinite(Number(text)) ? undefined : Number(text));
const clock = (s?: number) => (s == null ? "" : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`);
const span = (s: Segment) => clock(Math.round((Date.parse(s.ended_at) - Date.parse(s.started_at)) / 1000));

/**
 * One part's score: the clock's value to confirm or fix, Rx or Scaled chosen explicitly, and its splits. Text
 * stays as typed; `onChange` gets the parsed score, which the parent checks with `scoreProblem`.
 */
export function ScoreEditor({ block, result, segments = [], onChange, onRunDistance }: {
  block: Block; result: PartResult; segments?: Segment[]; onChange(next: PartResult): void;
  /** Edits a treadmill split's distance; absent where splits can't change (a correction). */
  onRunDistance?(exerciseIndex: number, meters: number): void;
}) {
  const [text, setText] = useState<Record<string, string>>(() => ({ rounds: String(result.rounds ?? ""), reps: String(result.reps ?? ""),
    time: clock(result.time_seconds), load: String(result.load ?? ""), distance: String(result.distance_meters ?? ""),
    run: String(segments.find((s) => s.kind === "buy_in")?.distance_meters ?? "") }));
  const set = (key: string, value: string, patch: (v: string) => Partial<PartResult>) => {
    setText((t) => ({ ...t, [key]: value }));
    onChange(cleanScore({ ...result, ...patch(value) }));
  };
  const problem = scoreProblem(result);
  const field = (key: "rounds" | "reps" | "load" | "distance", label: string, patch: (v: string) => Partial<PartResult>) =>
    <View style={{ flex: 1, minWidth: 140 }}><Field label={label} numeric value={text[key]} onChange={(v) => set(key, v, patch)} /></View>;
  const roundsReps = <Row gap={12} wrap align="flex-start">
    {field("rounds", "Rounds", (v) => ({ rounds: num(v) }))}
    {field("reps", "Extra reps", (v) => ({ reps: num(v) }))}
  </Row>;
  return (
    <Card>
      <Row gap={8} justify="space-between" wrap>
        <Copy kind="label">{partTitle(block)}</Copy>
        <Copy kind="numericSmall">{problem ? "—" : formatPartScore(result)}</Copy>
      </Row>
      {result.kind === "rounds_reps" && (result.buy_in_done === false
        ? field("distance", "Buy-in distance · m", (v) => ({ distance_meters: num(v) }))
        : roundsReps)}
      {result.kind === "rounds_reps" && hasBuyIn(block) && <Choice label="The cap came during the buy-in" selected={result.buy_in_done === false}
        onPress={() => onChange(cleanScore({ ...result, buy_in_done: result.buy_in_done === false, rounds: num(text.rounds) ?? 0,
          reps: num(text.reps) ?? 0, distance_meters: num(text.distance) ?? 0 }))} />}
      {result.kind === "time" && <>
        {result.capped ? roundsReps
          : <Field label="Time · m:ss" value={text.time} onChange={(v) => set("time", v, (t) => ({ time_seconds: parseTime(t) ?? undefined }))} />}
        <Choice label="Hit the time cap" selected={!!result.capped} onPress={() => onChange(cleanScore({ ...result, capped: !result.capped,
          rounds: num(text.rounds) ?? 0, reps: num(text.reps) ?? 0, time_seconds: parseTime(text.time) ?? undefined }))} />
      </>}
      {result.kind === "load" && <Row gap={12} wrap align="flex-end">
        {field("load", "Weight", (v) => ({ load: num(v), load_unit: result.load_unit ?? "kg" }))}
        <Segmented<"kg" | "lb"> label="Unit" value={result.load_unit ?? "kg"} options={[{ value: "kg", label: "kg" }, { value: "lb", label: "lb" }]}
          onChange={(unit) => onChange({ ...result, load_unit: unit })} />
      </Row>}
      {result.kind === "reps" && field("reps", "Reps", (v) => ({ reps: num(v) }))}
      {!!problem && <Copy kind="small" tone="error">{problem}</Copy>}
      <Copy kind="label">Rx or scaled?</Copy>
      <ChipRow>
        <Chip label="Rx" selected={result.scaling === "rx"} onPress={() => onChange({ ...result, scaling: "rx", scaling_note: undefined })} />
        <Chip label="Scaled" selected={result.scaling === "scaled"} onPress={() => onChange({ ...result, scaling: "scaled" })} />
      </ChipRow>
      {result.scaling === "scaled" && <Field label="What you scaled" optional value={result.scaling_note ?? ""}
        onChange={(v) => onChange({ ...result, scaling_note: v.slice(0, 200) || undefined })} />}
      {segments.filter((s) => s.kind !== "rest").map((s) => (
        <Row key={`${s.kind}${s.index}`} gap={8} justify="space-between" wrap>
          <Copy kind="small" tone="muted">{s.kind === "buy_in" ? `Buy-in · ${s.label ?? ""}` : `Round ${s.index}`}
            {s.run_environment ? ` · ${s.run_environment === "outdoor" ? "Outdoor" : `Treadmill${s.distance_meters != null ? ` ${s.distance_meters} m` : ""}`}` : ""}</Copy>
          <Copy kind="small">{span(s)}</Copy>
        </Row>
      ))}
      {!!onRunDistance && segments.some((s) => s.kind === "buy_in" && s.run_environment === "treadmill") &&
        <Field label="Treadmill buy-in distance · m" numeric value={text.run} onChange={(v) => {
          setText((t) => ({ ...t, run: v }));
          const meters = num(v);
          if (meters != null) onRunDistance(block.exercises.findIndex((e) => e.segment === "buy_in"), meters);
        }} />}
    </Card>
  );
}

/** Copies the day's scores for pasting into WodUp's Log Result. */
export function CopyForWodUp({ workout, results, segments }: { workout: Workout; results: PartResult[]; segments: Segment[] }) {
  const toast = useToast();
  return <Button title="Copy for WodUp" icon="copy-outline" variant="secondary" disabled={!results.length}
    accessibilityHint="Copies each part's score, Rx or scaled, and splits, to paste into Log Result"
    onPress={() => { void Clipboard.setStringAsync(wodupText(workout, results, segments)).then(() => toast("Copied. Paste it into WodUp’s Log Result.")); }} />;
}
