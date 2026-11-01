import type { AuthoredWorkout, Workout } from "./models";
import { formatSeconds } from "./discover";
import { formatCapSeconds, formatError, formatLabel, isTimedFormat, type TimedFormat } from "./timed-execution";
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
/** The block's timer sets its own rounds or intervals, so "rounds not specified" and set counts don't apply. */
export const timedBlock = (block: Block) => amrapCap(block) != null || isTimedFormat(block.execution);
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
    // A block already labelled "EMOM 20" or "21-15-9 for time" doesn't repeat that part; "cap 12" still shows.
    // Whole parts only: a block called "EMOM 2" still shows "EMOM 20".
    const said = label?.trim() ?? "";
    const mentioned = (part: string) => new RegExp(`(^|[^\\w-])${part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}($|[^\\w-])`, "i").test(said);
    const rest = (name ?? "").split(" · ").filter((part) => part && !mentioned(part)).join(" · ");
    return [rest || null, alternating ? "alternating moves" : null].filter(Boolean).join(" · ");
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

export type FormatChoice = "none" | "amrap" | "emom" | "for_time" | "work_rest";
/** The editor's timer choice for a block; a mode from a newer server reads as no timer and is kept untouched. */
export function formatChoice(block: Block): FormatChoice {
  const mode = block.execution?.mode;
  return mode === "amrap" || mode === "emom" || mode === "for_time" || mode === "work_rest" ? mode : "none";
}
/**
 * Switches a block's timer. Interval formats count intervals, so their rounds are cleared.
 * Only Tabata's own definition is filled in; an EMOM count or a cap is left for the person to enter.
 */
export function changeFormat(workout: AuthoredWorkout, index: number, choice: FormatChoice): AuthoredWorkout {
  const old = workout.blocks[index];
  if (!old || formatChoice(old) === choice) return workout;
  const next = switchFormat(workout, index, choice);
  // A length that came from the old clock follows the new one; a length the person typed stays.
  const before = clockMinutes(old), after = clockMinutes(next.blocks[index]);
  const inherited = workout.blocks.length === 1 && (workout.estimated_minutes == null || (before != null && workout.estimated_minutes === before));
  return inherited && (after != null || before != null) ? { ...next, estimated_minutes: after } : next;
}
function clockMinutes(block: Block) {
  const seconds = amrapCap(block) ?? (isTimedFormat(block.execution) && !formatError(block.execution, block) ? formatCapSeconds(block.execution) : null);
  // Rounded up, as planning counts a timed block's length.
  return seconds != null && seconds <= 86400 ? Math.ceil(seconds / 60) : null;
}
function switchFormat(workout: AuthoredWorkout, index: number, choice: FormatChoice): AuthoredWorkout {
  if (choice === "amrap") return { ...workout, blocks: workout.blocks.map((b, i) => i === index
    ? { ...b, grouping: "circuit", rounds: null, execution: { mode: "amrap", time_cap_seconds: 0 } } : b) };
  return { ...workout, blocks: workout.blocks.map((block, i) => {
    if (i !== index || formatChoice(block) === choice) return block;
    const several = block.exercises.length > 1;
    if (choice === "none") return { ...block, execution: undefined };
    if (choice === "emom") return { ...block, grouping: "interval", rounds: null,
      execution: { mode: "emom", interval_seconds: 60, intervals: null, rotation: several ? "alternating" : null } };
    if (choice === "work_rest") return { ...block, grouping: "interval", rounds: null,
      execution: { mode: "work_rest", work_seconds: 20, rest_seconds: 10, intervals: 8 } };
    return { ...block, ...(several ? { grouping: "circuit" as const } : {}), execution: { mode: "for_time", time_cap_seconds: null } };
  }) };
}
/** Edits EMOM, for-time or work/rest values. A single-block workout's length follows the clock unless the person set another. */
export function changeFormatFields(workout: AuthoredWorkout, index: number, patch: Partial<Record<string, number | string | null>>): AuthoredWorkout {
  const block = workout.blocks[index];
  if (!isTimedFormat(block?.execution)) return workout;
  const next = { ...block.execution, ...patch } as TimedFormat;
  const before = clockMinutes(block);
  // While a field is cleared mid-edit there is no clock, so the length still follows the next value typed.
  const inherited = workout.blocks.length === 1 && (workout.estimated_minutes == null || before == null || workout.estimated_minutes === before);
  const after = clockMinutes({ ...block, execution: next });
  return { ...workout, ...(inherited && after != null ? { estimated_minutes: after } : {}),
    blocks: workout.blocks.map((b, i) => (i === index ? { ...b, execution: next } : b)) };
}
/** "21-15-9" → [21, 15, 9]; blank clears it. Anything else is kept as typed so the field can show an error. */
export function parseRepScheme(text: string): number[] | null | undefined {
  if (!text.trim()) return null;
  const parts = text.split(/[\s,\-–]+/).filter(Boolean).map(Number);
  return parts.length >= 2 && parts.length <= 100 && parts.every((n) => Number.isInteger(n) && n >= 1 && n <= 1000) ? parts : undefined;
}
