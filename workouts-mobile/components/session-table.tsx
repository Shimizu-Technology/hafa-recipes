import { View } from "react-native";
import { spacing } from "@/constants/theme";
import type { ActualSet, Workout } from "@/lib/models";
import type { UnitSystem } from "@/lib/training";
import { exerciseName, formatDistance, formatDuration, formatWeight } from "@/lib/progress-insights";
import { Card, Copy, useColors } from "./ui";

type Column = { title: string; value(set: ActualSet): string | null };
const feel = (a: ActualSet) => [
  a.effort != null ? `Effort ${a.effort}/10` : null,
  a.difficulty ? `Felt ${a.difficulty}` : null,
  a.pain_reported === true ? "Pain reported" : a.pain_reported === false ? "No pain" : null,
  a.notes?.trim() ? `“${a.notes.trim()}”` : null,
].filter(Boolean).join(" · ");

/** A recorded session as one compact table per exercise: set · reps · weight, with notes summarised below. */
export function SessionTable({ actuals, workout, units }: { actuals: ActualSet[]; workout: Workout; units: UnitSystem }) {
  const c = useColors();
  const groups = new Map<string, ActualSet[]>();
  for (const a of actuals) groups.set(`${a.block_id}:${a.exercise_index}`, [...(groups.get(`${a.block_id}:${a.exercise_index}`) ?? []), a]);
  return <>{[...groups.entries()].map(([key, sets]) => {
    const columns = ([
      { title: "Reps", value: (s) => (s.reps != null ? String(s.reps) : null) },
      { title: "Time", value: (s) => (s.duration_seconds != null ? formatDuration(s.duration_seconds) : null) },
      { title: "Distance", value: (s) => (s.distance_meters != null ? formatDistance(s.distance_meters, units) : null) },
      { title: "Weight", value: (s) => formatWeight(s) || null },
    ] as Column[]).filter((column) => sets.some((s) => s.completed && column.value(s) != null));
    const label = (s: ActualSet, i: number) => `${i + 1}${s.side ? (s.side === "left" ? "L" : "R") : ""}`;
    const notes = sets.flatMap((s, i) => (feel(s) ? [`Set ${label(s, i)} · ${feel(s)}`] : []));
    return (
      <Card key={key} compact>
        <Copy kind="subheading">{exerciseName(workout, sets[0])}</Copy>
        <View>
          <View style={{ flexDirection: "row", gap: spacing.sm, paddingBottom: 4, borderBottomWidth: 1, borderBottomColor: c.border }}>
            <Copy kind="caption" tone="muted" style={{ width: 40 }}>Set</Copy>
            {columns.map((column) => <Copy key={column.title} kind="caption" tone="muted" style={{ flex: 1 }}>{column.title}</Copy>)}
          </View>
          {sets.map((s, i) => (
            <View key={i} accessible
              accessibilityLabel={`Set ${label(s, i)}: ${s.completed ? columns.flatMap((column) => column.value(s) ? [`${column.value(s)} ${column.title.toLowerCase()}`] : []).join(", ") : "skipped"}`}
              style={{ flexDirection: "row", gap: spacing.sm, minHeight: 36, alignItems: "center" }}>
              <Copy kind="label" tone="muted" style={{ width: 40 }}>{label(s, i)}</Copy>
              {s.completed ? columns.map((column) => (
                <Copy key={column.title} kind="label" style={{ flex: 1, fontVariant: ["tabular-nums"] }}>{column.value(s) ?? "–"}</Copy>
              )) : <Copy tone="muted" style={{ flex: 1 }}>Skipped</Copy>}
            </View>
          ))}
        </View>
        {notes.map((note, i) => <Copy key={i} kind="small" tone="muted">{note}</Copy>)}
      </Card>
    );
  })}</>;
}
