import type { Workout } from "./models";

export interface TimedCircuit {
  time_cap_seconds: number;
  instructions: string[];
}
/** Typed execution is authoritative; note matching only recovers older source records. */
export function timedCircuit(workout: Workout): TimedCircuit | null {
  if (workout.kind === "program" || workout.blocks.length !== 1) return null;
  const block = workout.blocks[0];
  if (block.grouping !== "circuit" || block.rounds != null || !block.exercises.length) return null;
  const instructions = (workout.notes ?? []).filter((note) => note.trim());
  if (block.execution) {
    const { mode, time_cap_seconds } = block.execution;
    return mode === "amrap" && Number.isInteger(time_cap_seconds) && time_cap_seconds > 0 && time_cap_seconds <= 86400
      ? { time_cap_seconds, instructions } : null;
  }
  if (workout.provenance !== "source" || !["session", "accessory"].includes(workout.kind) ||
    !Number.isInteger(workout.estimated_minutes) || workout.estimated_minutes! < 1 || workout.estimated_minutes! > 1440 ||
    block.exercises.some((exercise) => exercise.sets != null && exercise.sets !== 1)) return null;
  const wording = instructions.join("\n");
  if (/\b(?:emom|rft|for\s+time)\b/i.test(wording) ||
    /\b(?:not|no|without|avoid|never|don['’]t|isn['’]t|instead\s+of)\b[^.!?;\n]{0,40}\b(?:amrap|as many rounds|repeat)/i.test(wording)) return null;
  if (/\bamrap\b[^.!?;\n]{0,30}\b(?:not|never)\b/i.test(wording)) return null;
  const affirmative = /\bamrap\b|\bas many rounds as possible\b|\brepeat(?:ing)?\b[^.!?;\n]{0,100}\b(?:circuit|rounds?|exercises?)\b|\b(?:circuit|rounds?|exercises?)\b[^.!?;\n]{0,100}\brepeat(?:ing)?\b/i;
  if (!affirmative.test(wording)) return null;
  // The duration must appear in the retained source instructions as well.
  const durations = [...wording.matchAll(/\b(\d+)\s*[- ]?\s*(?:minutes?|mins?)\b/gi)].map((match) => Number(match[1]));
  if (!durations.length || durations.some((minutes) => minutes !== workout.estimated_minutes)) return null;
  return { time_cap_seconds: workout.estimated_minutes! * 60, instructions };
}

export interface TimedClock {
  active_milliseconds: number;
  active_started_at: number | null;
  timed_circuit?: { time_cap_seconds: number; round_size: number; limit_reached?: boolean };
}
export function activeMilliseconds(draft: TimedClock, now = Date.now()) {
  const elapsed = (draft.active_milliseconds ?? 0) +
    (draft.active_started_at == null ? 0 : Math.max(0, now - draft.active_started_at));
  return Math.min(elapsed, (draft.timed_circuit?.time_cap_seconds ?? Infinity) * 1000);
}
export function circuitRemaining(draft: TimedClock, now = Date.now()) {
  return draft.timed_circuit ? Math.max(0, Math.ceil(draft.timed_circuit.time_cap_seconds - activeMilliseconds(draft, now) / 1000)) : null;
}

export function completedCircuitRounds(actuals: readonly { round_index: number; completed: boolean }[], roundSize: number) {
  const rounds = new Map<number, { total: number; completed: number }>();
  for (const actual of actuals) {
    const round = rounds.get(actual.round_index) ?? { total: 0, completed: 0 };
    round.total++; if (actual.completed) round.completed++;
    rounds.set(actual.round_index, round);
  }
  return [...rounds.values()].filter((round) => round.total === roundSize && round.completed === roundSize).length;
}
