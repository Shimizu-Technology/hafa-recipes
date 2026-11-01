import type { ActualSet, ExercisePrescription, RepLadder, Workout, WorkoutExecution } from "./models";
import { formatSeconds } from "./discover";

/**
 * EMOM, for-time and work/rest formats. Pure helpers: the clock comes from real
 * timestamps, and completed work always comes from what the person marked.
 */
type Block = Workout["blocks"][number];
export type TimedFormat = Extract<WorkoutExecution, { mode: "emom" | "for_time" | "work_rest" }>;
export type IntervalFormat = Extract<WorkoutExecution, { mode: "emom" | "work_rest" }>;

const whole = (value: unknown, min: number, max: number): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= min && value <= max;
const optionalWhole = (value: unknown, min: number, max: number) => value == null || whole(value, min, max);

/** The same limits the API enforces. AMRAP keeps its own rules in `executionError`. */
export function formatError(execution: TimedFormat, block: Pick<Block, "rounds">) {
  if (execution.mode === "emom") {
    if (!whole(execution.interval_seconds, 1, 3600)) return "Each interval must be 1 second through 60 minutes, in whole seconds.";
    if (!optionalWhole(execution.intervals, 1, 1440)) return "Use 1 to 1440 intervals, or leave the count blank.";
    if (![null, undefined, "alternating", "together"].includes(execution.rotation)) return "Choose how the moves rotate.";
  } else if (execution.mode === "work_rest") {
    if (!whole(execution.work_seconds, 1, 3600)) return "Work must be 1 second through 60 minutes, in whole seconds.";
    if (!whole(execution.rest_seconds, 0, 3600)) return "Rest must be 0 seconds through 60 minutes, in whole seconds.";
    if (!optionalWhole(execution.intervals, 1, 1000)) return "Use 1 to 1000 intervals, or leave the count blank.";
  } else if (!optionalWhole(execution.time_cap_seconds, 1, 86400))
    return "A time cap must be 1 second through 1440 minutes, or blank.";
  // Interval formats count intervals; a round count beside them would be ambiguous.
  if (execution.mode !== "for_time" && block.rounds != null) return "Interval workouts count intervals, not rounds. Clear the rounds.";
  return null;
}
export function isTimedFormat(execution: Block["execution"]): execution is TimedFormat {
  return execution?.mode === "emom" || execution?.mode === "for_time" || execution?.mode === "work_rest";
}
/** Reps for interval or round `index` (1-based) of a ladder, or null past its end. */
export function ladderReps(ladder: RepLadder, index: number) {
  if (!ladder.step) return index === 1 ? ladder.start : null;
  const reps = ladder.start + ladder.step * (index - 1);
  if (reps < 1) return null;
  if (ladder.end != null && (ladder.step > 0 ? reps > ladder.end : reps < ladder.end)) return null;
  return reps;
}
/** "Ladder · 1 rep, +1 each interval until you stop" / "Ladder · 10 down to 1 reps". */
export function ladderText(ladder: RepLadder) {
  if (ladder.end == null) return `Ladder · ${ladder.start} ${ladder.start === 1 ? "rep" : "reps"}, ${ladder.step > 0 ? "+" : ""}${ladder.step} each interval until you stop`;
  return `Ladder · ${ladder.start} ${ladder.step > 0 ? "up" : "down"} to ${ladder.end} reps`;
}
/** "21-15-9 reps" or "1, 2, 3… reps"; null without a rep scheme or ladder. */
export function repPattern(e: Pick<ExercisePrescription, "rep_scheme" | "ladder">) {
  if (e.rep_scheme?.length) return `${e.rep_scheme.join("-")} reps`;
  if (!e.ladder) return null;
  const first = [1, 2, 3].map((i) => ladderReps(e.ladder!, i)).filter((n) => n != null);
  return e.ladder.end == null ? `${first.join(", ")}… reps` : `${e.ladder.start} to ${e.ladder.end} reps`;
}
export const openLadder = (block: Pick<Block, "exercises">) =>
  block.exercises.length > 0 && block.exercises.every((e) => e.ladder != null && e.ladder.end == null);
/** The prescribed reps for one round or interval; never invented when the source gave none. */
export function repsFor(exercise: ExercisePrescription, index: number) {
  if (exercise.rep_scheme?.length) return exercise.rep_scheme[index - 1] ?? null;
  if (exercise.ladder) return ladderReps(exercise.ladder, index);
  return exercise.reps_min ?? exercise.reps_max ?? null;
}
/** "10 Burpees", "45s Plank", "Burpees" when the dose is unknown. */
export function moveText(exercise: ExercisePrescription, index: number) {
  const reps = repsFor(exercise, index);
  const dose = reps != null ? `${reps}` : exercise.duration_seconds != null ? formatSeconds(exercise.duration_seconds)
    : exercise.distance_meters != null ? `${exercise.distance_meters} m` : null;
  return [dose, exercise.name, exercise.per_side ? "each side" : null].filter(Boolean).join(" ");
}

/** Interval and work/rest lengths in seconds; null when the source gave no count. */
export function intervalLength(execution: IntervalFormat) {
  return execution.mode === "emom" ? execution.interval_seconds : execution.work_seconds + execution.rest_seconds;
}
/** The format's whole clock, or null when it is open (no cap, no count). */
export function formatCapSeconds(execution: TimedFormat) {
  if (execution.mode === "for_time") return execution.time_cap_seconds ?? null;
  return execution.intervals == null ? null : intervalLength(execution) * execution.intervals;
}
export interface IntervalPosition {
  /** 1-based interval the clock is in (the last one once the clock has ended). */
  index: number;
  phase: "work" | "rest" | "ended";
  /** Seconds left in this phase. */
  remaining: number;
}
export function intervalPosition(execution: IntervalFormat, elapsedMilliseconds: number): IntervalPosition {
  const length = intervalLength(execution) * 1000;
  const index = Math.floor(Math.max(0, elapsedMilliseconds) / length) + 1;
  if (execution.intervals != null && index > execution.intervals) return { index: execution.intervals, phase: "ended", remaining: 0 };
  const into = Math.max(0, elapsedMilliseconds) - (index - 1) * length;
  const work = execution.mode === "work_rest" ? execution.work_seconds * 1000 : length;
  return into < work
    ? { index, phase: "work", remaining: Math.ceil((work - into) / 1000) }
    : { index, phase: "rest", remaining: Math.ceil((length - into) / 1000) };
}
/** Which moves run in interval `index`: one in rotation, or all of them. */
export function movesFor(execution: IntervalFormat, block: Pick<Block, "exercises">, index: number) {
  const count = block.exercises.length;
  const rotate = execution.mode === "emom" ? execution.rotation === "alternating" : count > 1;
  return rotate ? [(index - 1) % count] : block.exercises.map((_, i) => i);
}

/** Highest interval or round the player tracks; the session identity allows 100 rounds. */
export const trackedIntervalLimit = 100;
/** A single timed block the player can run, or null. AMRAP stays on its own path. */
export function timedFormat(workout: Pick<Workout, "kind" | "blocks">): TimedFormat | null {
  if (workout.kind === "program" || workout.blocks.length !== 1) return null;
  const block = workout.blocks[0];
  const execution = block.execution;
  if (!isTimedFormat(execution) || !block.exercises.length || formatError(execution, block)) return null;
  if (execution.mode === "for_time") return (block.rounds ?? 1) <= trackedIntervalLimit ? execution : null;
  if (execution.intervals == null) return execution.mode === "emom" && openLadder(block) ? execution : null;
  return execution.intervals <= trackedIntervalLimit ? execution : null;
}
/** Why a timed block can't run, in words the person can act on. */
export function timedFormatProblem(workout: Pick<Workout, "kind" | "blocks">) {
  const timed = workout.blocks.filter((block) => block.execution);
  if (!timed.length || timedFormat(workout)) return null;
  if (workout.blocks.length > 1)
    return `This workout has ${workout.blocks.length} parts, and the timer runs one timed part per session. Track every part without the timer, or edit the workout so the timed part is a workout of its own.`;
  const execution = timed[0].execution!;
  if (!isTimedFormat(execution)) return null;
  if (formatError(execution, timed[0])) return `${formatError(execution, timed[0])} Edit the workout before starting.`;
  if (execution.mode !== "for_time" && execution.intervals == null)
    return "The source doesn't say how many intervals to do. Edit the workout to add the count before starting.";
  return `The timer tracks up to ${trackedIntervalLimit} intervals or rounds. Split this workout into shorter sessions first.`;
}

const minutes = (seconds: number) => (seconds % 60 ? formatSeconds(seconds) : String(seconds / 60));
/** Short format name for chips and summaries: "EMOM 20", "Tabata 4 min", "For time · cap 20". Null for untimed blocks. */
export function formatLabel(block: Pick<Block, "execution" | "rounds" | "exercises">, short = false) {
  const execution = block.execution;
  if (!execution) return null;
  switch (execution.mode) {
    case "amrap":
      return `AMRAP ${minutes(execution.time_cap_seconds)}`;
    case "emom": {
      if (openLadder(block)) return "Death by";
      const { interval_seconds: length, intervals } = execution;
      if (length === 60) return intervals == null ? "EMOM" : `EMOM ${intervals}`;
      const name = length % 60 === 0 ? `E${length / 60}MOM` : `Every ${formatSeconds(length)}`;
      return intervals == null ? name : `${name} × ${intervals}`;
    }
    case "for_time": {
      const schemes = block.exercises.map((e) => e.rep_scheme?.join("-") ?? null);
      const scheme = schemes[0] && schemes.every((s) => s === schemes[0]) ? schemes[0] : null;
      const name = short ? "For time" : scheme ? `${scheme} for time` : (block.rounds ?? 1) > 1 ? `${block.rounds} rounds for time` : "For time";
      return execution.time_cap_seconds != null ? `${name} · cap ${minutes(execution.time_cap_seconds)}` : name;
    }
    case "work_rest": {
      const { work_seconds: work, rest_seconds: rest, intervals } = execution;
      if (work === 20 && rest === 10 && intervals === 8) return "Tabata 4 min";
      return `${short ? `${work}/${rest}` : `${work}s on / ${rest}s off`}${intervals == null ? "" : ` × ${intervals}`}`;
    }
    default:
      return null; // A future mode stays readable as text elsewhere and never blocks saving.
  }
}
/** The card chip and meta length: the format for a single timed block ("EMOM 20"), otherwise "25 min". */
export function durationLabel(workout: { kind?: Workout["kind"]; estimated_minutes?: number | null; blocks?: Pick<Block, "execution" | "rounds" | "exercises">[] }) {
  const only = workout.kind !== "program" && workout.blocks?.length === 1 ? workout.blocks[0] : null;
  return (only && formatLabel(only, true)) || (workout.estimated_minutes ? `${workout.estimated_minutes} min` : null);
}
/** A longer description for detail screens: "Every minute for 20 minutes · alternate the moves". */
export function formatDescription(block: Pick<Block, "execution" | "rounds" | "exercises">) {
  const execution = block.execution;
  if (!isTimedFormat(execution)) return null;
  if (execution.mode === "emom") {
    const every = execution.interval_seconds === 60 ? "Every minute" : `Every ${formatSeconds(execution.interval_seconds)}`;
    const count = execution.intervals == null ? (openLadder(block) ? "add a rep each interval until you can't finish one" : "count not specified")
      : `${execution.intervals} intervals (${formatSeconds(execution.interval_seconds * execution.intervals)})`;
    const rotation = execution.rotation === "alternating" ? "alternate the moves" : execution.rotation === "together" ? "all moves each interval" : null;
    return [`${every} · ${count}`, rotation, "rest for what's left of each interval"].filter(Boolean).join(" · ");
  }
  if (execution.mode === "for_time")
    return [`${(block.rounds ?? 1) > 1 ? `${block.rounds} rounds` : "One pass"} as fast as you can`,
      execution.time_cap_seconds != null ? `${formatSeconds(execution.time_cap_seconds)} cap` : "no time cap"].join(" · ");
  return [`Work ${execution.work_seconds}s · rest ${execution.rest_seconds}s`,
    execution.intervals == null ? "interval count not specified" : `${execution.intervals} intervals (${formatSeconds(formatCapSeconds(execution)!)})`].join(" · ");
}

type Result = Pick<ActualSet, "round_index" | "completed" | "reps">;
function byRound(actuals: readonly Result[]) {
  const rounds = new Map<number, Result[]>();
  for (const actual of actuals) rounds.set(actual.round_index ?? 1, [...(rounds.get(actual.round_index ?? 1) ?? []), actual]);
  return rounds;
}
const reps = (items: readonly Result[]) => items.reduce((sum, item) => sum + (item.reps ?? 0), 0);
const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;
/**
 * The result in the format's own terms, from recorded actuals only:
 * intervals completed, finish time, "capped · 2 rounds + 12 reps", or Death by's last full interval.
 */
export function formatScore(workout: Pick<Workout, "kind" | "blocks">,
  request: { actuals: readonly Result[]; active_seconds?: number | null; status: "completed" | "partial" }) {
  const block = workout.blocks.length === 1 ? workout.blocks[0] : null;
  const execution = block?.execution;
  if (!block || !isTimedFormat(execution) || !request.actuals.length) return null;
  const rounds = byRound(request.actuals);
  const complete = [...rounds.values()].filter((items) => items.every((item) => item.completed)).length;
  if (execution.mode === "emom") {
    const unit = execution.interval_seconds === 60 ? "minute" : "interval";
    if (openLadder(block)) {
      let full = 0;
      while (rounds.get(full + 1)?.every((item) => item.completed)) full++;
      const extra = reps(rounds.get(full + 1) ?? []);
      return `${plural(full, `full ${unit}`)}${extra ? ` + ${plural(extra, "rep")}` : ""}`;
    }
    return `${complete} of ${plural(execution.intervals ?? rounds.size, unit)}`;
  }
  if (execution.mode === "work_rest") {
    const total = reps(request.actuals.filter((item) => item.completed));
    return [total ? plural(total, "rep") : null, `${complete} of ${plural(execution.intervals ?? rounds.size, "interval")}`].filter(Boolean).join(" · ");
  }
  const time = request.active_seconds ?? 0;
  const clock = `${Math.floor(time / 60)}:${String(time % 60).padStart(2, "0")}`;
  if (request.status === "completed") return `Time ${clock}`;
  const partial = [...rounds.entries()].find(([, items]) => !items.every((item) => item.completed))?.[1] ?? [];
  const done = reps(partial);
  const capped = execution.time_cap_seconds != null && time >= execution.time_cap_seconds;
  return `${capped ? "Capped" : `Stopped at ${clock}`} · ${plural(complete, "round")}${done ? ` + ${plural(done, "rep")}` : ""}`;
}
