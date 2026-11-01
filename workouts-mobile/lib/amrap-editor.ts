import type { AuthoredWorkout, Workout } from "./models";
import { formatSeconds } from "./discover";
import { formatError, formatLabel, isTimedFormat } from "./timed-execution";
type Block = Workout["blocks"][number];

export function validTimeCap(seconds: unknown): seconds is number {
  return typeof seconds === "number" && Number.isInteger(seconds) && seconds >= 1 && seconds <= 86400;
}
export function executionError(block: Block) {
  if (!block.execution) return null;
  if (isTimedFormat(block.execution)) return formatError(block.execution, block);
  // A mode from a newer server stays readable and never blocks saving.
  if (block.execution.mode !== "amrap") return null;
  if (block.grouping !== "circuit")
    return "AMRAP execution requires a circuit block.";
  if (block.rounds != null) return "Choose fixed rounds or AMRAP, not both.";
  if (!validTimeCap(block.execution.time_cap_seconds))
    return "AMRAP time cap must be 1 second through 1440 minutes, in whole seconds.";
  return null;
}
export function amrapCap(block: Block | undefined) {
  return block?.grouping === "circuit" && block.execution?.mode === "amrap" && validTimeCap(block.execution.time_cap_seconds)
    ? block.execution.time_cap_seconds : null;
}
const groupingLabels: Record<Block["grouping"], string> = {
  sequential: "Straight sets", superset: "Superset", circuit: "Circuit", interval: "Intervals",
};
/** Human block summary, e.g. "Superset · 4 rounds". With `label`, a grouping word the label already says is left out. */
export function blockSummary(block: Block, label?: string) {
  const cap = amrapCap(block);
  if (cap != null) return `AMRAP · ${formatSeconds(cap)} time cap`;
  if (isTimedFormat(block.execution)) {
    const alternating = block.execution.mode === "emom" && block.execution.rotation === "alternating" && block.exercises.length > 1;
    const name = formatLabel(block);
    // A block already labelled "EMOM 20" doesn't need it twice.
    const named = !!label && !!name && label.toLowerCase().includes(name.toLowerCase());
    return [named ? null : name, alternating ? "alternating moves" : null].filter(Boolean).join(" · ");
  }
  const grouping = groupingLabels[block.grouping] ?? block.grouping;
  const repeated = !!label && label.toLowerCase().includes(grouping.toLowerCase());
  const mode = (block.execution as { mode?: unknown } | undefined)?.mode;
  const unknownMode = mode != null && mode !== "amrap" ? String(mode).replaceAll("_", " ") : null;
  return [repeated ? null : grouping, block.rounds != null ? `${block.rounds} round${block.rounds === 1 ? "" : "s"}` : null, unknownMode]
    .filter(Boolean)
    .join(" · ");
}
export function changeGrouping(workout: AuthoredWorkout, index: number, grouping: Block["grouping"]) {
  return { ...workout, blocks: workout.blocks.map((block, i) => i === index
    ? { ...block, grouping, ...(grouping !== "circuit" && block.execution?.mode === "amrap" ? { execution: undefined } : {}) } : block) };
}
export function changeExecution(workout: AuthoredWorkout, index: number, amrap: boolean) {
  return { ...workout, blocks: workout.blocks.map((block, i) => i === index
    ? { ...block, execution: amrap ? block.execution ?? { mode: "amrap" as const, time_cap_seconds: 0 } : undefined,
      ...(amrap ? { rounds: null } : {}) } : block) };
}
export function changeTimeCap(workout: AuthoredWorkout, index: number, seconds: number): AuthoredWorkout {
  const old = amrapCap(workout.blocks[index]);
  const inheritedEstimate = workout.estimated_minutes == null || (old != null && workout.estimated_minutes === old / 60);
  return { ...workout,
    ...(workout.blocks.length === 1 && inheritedEstimate && validTimeCap(seconds)
      ? { estimated_minutes: seconds % 60 === 0 ? seconds / 60 : null } : {}),
    blocks: workout.blocks.map((block, i) => i === index
      ? { ...block, rounds: null, execution: { mode: "amrap", time_cap_seconds: seconds } } : block),
  };
}
export function parseCap(text: string, units: "minutes" | "seconds") {
  const seconds = text.trim() ? Number(text) * (units === "minutes" ? 60 : 1) : 0;
  // Decimal minutes may have floating point noise; fractional seconds stay invalid.
  return Math.abs(seconds - Math.round(seconds)) < 1e-8 ? Math.round(seconds) : seconds;
}
