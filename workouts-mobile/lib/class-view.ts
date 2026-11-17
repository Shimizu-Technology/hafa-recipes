import type { Workout } from "./models";
import { buyIn, isRun, partCapMs, partElapsedMs, restEndsAt, type PartRun } from "./class-session";
import { formatLabel, intervalPosition, moveText, timedFormatFor, type IntervalFormat } from "./timed-execution";

/** What the class runner shows for the part on screen. Pure, so it can be tested without rendering. */
type Block = Workout["blocks"][number];
const roles = { warm_up: "Warm-up", main: null, accessory: "Accessory", cool_down: "Cool-down" } as const;
const groupings: Record<string, string> = { superset: "Superset", circuit: "Circuit" };

/** "A · AMRAP 15", "C · Cool-down", "D · Superset". */
export function partTitle(block: Block) {
  const kind = formatLabel(block, true) ?? (block.role ? roles[block.role] : null) ?? groupings[block.grouping] ?? null;
  return [block.label, kind].filter(Boolean).join(" · ");
}
/** "Rest 3:00, then B · AMRAP 15". */
export function restLine(next: Block | undefined) {
  return next ? `then ${partTitle(next)}` : "then you’re done";
}
/** The repeating moves of a round, without the buy-in: "15 Deadlift · 20 Burpee · 400 m Run". */
export function roundMoves(block: Block) {
  const skip = buyIn(block);
  return block.exercises.filter((e, i) => i !== skip && e.segment !== "cash_out").map((e) => moveText(e, 1)).join(" · ");
}
export const buyInMove = (block: Block) => (buyIn(block) >= 0 ? moveText(block.exercises[buyIn(block)], 1) : null);

export interface PartClock {
  /** Whole seconds shown on the big clock. */
  seconds: number;
  /** "left" counts down (AMRAP, interval, rest); "elapsed" counts up (for time, sets). */
  direction: "left" | "elapsed";
  /** 0–1 of the part's clock still to run, for the ring; null when the part has no fixed length. */
  progress: number | null;
  /** EMOM or work/rest: "Minute 3 of 10", and Work or Rest. */
  interval?: { index: number; label: string; phase: "work" | "rest" | "ended" };
}
export function partClock(part: PartRun, block: Block, now: number): PartClock {
  const elapsed = partElapsedMs(part, block, now);
  const cap = partCapMs(block);
  const format = timedFormatFor(block);
  if (part.kind === "emom" || part.kind === "work_rest") {
    const execution = format as IntervalFormat;
    const at = intervalPosition(execution, elapsed);
    const unit = execution.mode === "emom" && execution.interval_seconds === 60 ? "Minute" : "Interval";
    return { seconds: at.remaining, direction: "left", progress: cap ? Math.max(0, 1 - elapsed / cap) : null,
      interval: { index: at.index, label: `${unit} ${at.index}${execution.intervals != null ? ` of ${execution.intervals}` : ""}`, phase: at.phase } };
  }
  if (part.kind === "amrap" && cap != null)
    return { seconds: Math.max(0, Math.ceil((cap - elapsed) / 1000)), direction: "left", progress: Math.max(0, 1 - elapsed / cap) };
  return { seconds: Math.floor(elapsed / 1000), direction: "elapsed", progress: cap ? Math.max(0, 1 - elapsed / cap) : null };
}
/** Whole seconds left in the rest after `part`. */
export function restLeft(part: PartRun, block: Block, now: number) {
  const end = restEndsAt(part, block, now);
  return end == null ? 0 : Math.max(0, Math.ceil((end - now) / 1000));
}
/** Runs whose Outdoor/Treadmill choice the round screen offers: the buy-in until it's done, then the round's runs. */
export function visibleRuns(part: PartRun, block: Block) {
  const start = buyIn(block);
  if (start >= 0 && part.buy_in_done_at == null) return isRun(block.exercises[start]) ? [start] : [];
  return block.exercises.map((e, i) => (i !== start && isRun(e) ? i : -1)).filter((i) => i >= 0);
}
