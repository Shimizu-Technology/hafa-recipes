import type { ActualSet, Workout } from "./models";
import { buyIn, classIntervals, isTimedPart, partKind, partStatus, resolve, type ClassRun, type RunEnvironment } from "./class-session";
import { hasOnceOnlyMoves, isUnknownMode, repsFor } from "./timed-execution";
import { visibleRuns } from "./class-view";

/**
 * Glue between the class runner model (`class-session.ts`) and the training draft. A class is a session of
 * several parts, or a timed part with a once-only buy-in, where every part with an execution has a clock the
 * runner can drive. Everything else keeps the single-part timer or set-by-set logging.
 */
type Block = Workout["blocks"][number];
type Step = { block_id: string; key: string };
type ClassDraft = { workout: Workout; class_run?: ClassRun; steps: Step[]; cursor: number; actuals: Array<{ block_id: string }> };

export function isClassWorkout(workout: Pick<Workout, "kind" | "blocks">) {
  if (workout.kind === "program" || !workout.blocks.length) return false;
  const runnable = (block: Block) => !block.execution || (!isUnknownMode(block.execution) && isTimedPart(partKind(block)));
  if (!workout.blocks.every(runnable) || !workout.blocks.some((block) => isTimedPart(partKind(block)))) return false;
  return workout.blocks.length > 1 || hasOnceOnlyMoves(workout.blocks[0]);
}
/** Set-by-set steps exist only for untimed parts; timed parts are scored by their clock and round taps. */
export const setsOnly = (workout: Workout): Workout => ({ ...workout, blocks: workout.blocks.filter((b) => !isTimedPart(partKind(b))) });

/** The class part on screen now, after moving past anything that ended while the app slept. */
export function currentPart(run: ClassRun, workout: Workout, now: number) {
  const resolved = resolve(run, workout, now);
  const part = resolved.parts[resolved.cursor];
  const block = workout.blocks.find((b) => b.id === part.block_id)!;
  return { run: resolved, part, block, index: resolved.cursor, status: partStatus(part, block, now) };
}
/** Every part has ended or was skipped: the class is ready to save. */
export function classOver(run: ClassRun, workout: Workout, now: number) {
  const { index, status } = currentPart(run, workout, now);
  return index === run.parts.length - 1 && (status === "done" || status === "skipped");
}

/**
 * Keeps the set cursor on the current set-by-set part: its first set not yet logged. Sets left behind by an
 * ended or skipped part are passed over, never logged for the person.
 */
export function alignCursor(d: ClassDraft, now: number, logged: (step: Step) => boolean) {
  if (!d.class_run) return;
  const { run } = currentPart(d.class_run, d.workout, now);
  const ahead = new Set(run.parts.slice(run.cursor).filter((p) => !p.skipped && p.ended_at == null).map((p) => p.block_id));
  const next = d.steps.findIndex((step) => ahead.has(step.block_id) && !logged(step));
  d.cursor = next < 0 ? d.steps.length : next;
}
/** True when every set of `blockId` is logged, so the set-by-set part is over. */
export const setsDone = (d: ClassDraft, blockId: string, logged: (step: Step) => boolean) =>
  d.steps.filter((step) => step.block_id === blockId).every(logged);

/**
 * Gives each run the remembered Outdoor/Treadmill choice when the person reaches it (the buy-in when the part
 * starts, the round's runs once the buy-in is done), unless it has a choice already. A switch on the buy-in
 * therefore carries to the runs after it.
 */
export function fillRunChoices(run: ClassRun, workout: Workout, environment: RunEnvironment) {
  for (const part of run.parts) {
    if (part.started_at == null || part.skipped) continue;
    const block = workout.blocks.find((b) => b.id === part.block_id)!;
    for (const index of visibleRuns(part, block)) if (!part.runs?.[index]) part.runs = { ...part.runs, [index]: { environment } };
  }
}
export const hasBuyIn = (block: Block) => buyIn(block) >= 0;

/** Active time for a class: each part's running spans, without rests and pauses. */
export function classActive(run: ClassRun, workout: Workout, now: number) {
  const spans = classIntervals(run, workout, now);
  const ms = spans.reduce((sum, s) => sum + (s.ended_at - s.started_at), 0);
  return { intervals: spans.map((s) => ({ started_at: new Date(s.started_at).toISOString(), ended_at: new Date(s.ended_at).toISOString() })),
    seconds: Math.floor(ms / 1000) };
}

/**
 * "End class": the part on screen ends now (or is skipped if its clock hasn't started), any rest ends, and parts
 * not started are skipped, never started, so they get no score and the class saves as partial.
 */
export function endClass(run: ClassRun, workout: Workout, now: number) {
  const next = resolve(run, workout, now);
  const part = next.parts[next.cursor];
  const status = partStatus(part, workout.blocks.find((b) => b.id === part.block_id)!, now);
  if (["pending", "lead_in", "running", "paused"].includes(status)) next.ended_early = true;
  if (status === "pending" || status === "lead_in") {
    Object.assign(part, { skipped: true, ended_at: now });
    delete part.started_at; delete part.lead_in_ms;
  } else if (status === "running" || status === "paused") {
    const open = part.pauses.find((p) => p.until == null);
    if (open) open.until = now;
    part.ended_at = now;
  }
  if (!part.skipped) part.rest_ended_at ??= now;
  for (const later of next.parts.slice(next.cursor + 1)) Object.assign(later, { skipped: true, ended_at: now });
  next.cursor = next.parts.length - 1;
  return next;
}

export type ClassLoad = { load: number | null; load_unit: "kg" | "lb"; load_convention?: ActualSet["load_convention"] };

/** A round tap records only repeating moves. Choices and relative weights need an explicit actual load. */
export function roundActuals(block: Block, round: number, loads: Record<number, ClassLoad> = {}): ActualSet[] {
  return block.exercises.flatMap((e, i) => {
    if (e.segment) return [];
    const chosen = loads[i] ?? (e.load != null && e.load_unit ? { load: e.load, load_unit: e.load_unit } : undefined);
    const weight = chosen?.load != null ? { ...chosen, load: chosen.load } : {};
    const sides = e.per_side ? ["left", "right"] as const : [null];
    return sides.map((side) => ({ block_id: block.id, exercise_index: i, set_index: 1, round_index: round,
      side, completed: true,
      reps: repsFor(e, round), duration_seconds: e.duration_seconds ?? null,
      distance_meters: e.distance_meters ?? null, ...weight,
      ...(Object.keys(weight).length ? { load_convention: chosen?.load_convention ?? e.load_convention ?? "total" as const } : {}) }));
  });
}
