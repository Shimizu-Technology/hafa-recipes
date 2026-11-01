import { canRecoverResult, restoredPrescription, type ResultRecoveryCommand, type ResultRecoveryReceipt } from "./result-recovery";
import type { ActualSet, Workout, AuthoredWorkout, SessionRequest, TrainingSession, ExercisePrescription } from "./models";
import type { Storage } from "./drafts";
import { timedCircuit } from "./timed-circuit";
import { formatCapSeconds, intervalPosition, ladderReps, movesFor, openLadder, timedFormat, timedFormatProblem,
  trackedIntervalLimit, type TimedFormat } from "./timed-execution";
export type UnitSystem = "metric" | "imperial";
export type SessionSource =
  | { workout_id: string; workout_revision: number }
  | { program_id: string; program_revision: number; program_session_id: string };
export interface TrainingStep {
  key: string;
  block_id: string;
  block_label: string;
  grouping: string;
  exercise_index: number;
  round_index: number;
  set_index: number;
  target_set: number;
  side: "left" | "right" | null;
  exercise: ExercisePrescription;
}
export interface SessionDraft {
  id: string;
  cell_identity_version?: 2;
  generation: number;
  source: SessionSource;
  workout: Workout;
  started_at: string;
  actuals: ActualSet[];
  steps: TrainingStep[];
  cursor: number;
  rest_until: number | null;
  interval_started_at: number | null;
  /** Frozen timer values; optional for drafts saved by older app versions. */
  rest_remaining_milliseconds?: number | null;
  interval_elapsed_milliseconds?: number | null;
  paused: boolean;
  notes: string;
  input?: Record<string, string>;
  active_started_at: number | null;
  active_milliseconds: number;
  active_intervals?: Array<{ started_at: string; ended_at: string }>;
  checkpoint_at: number;
  activity_type: string | null;
  timed_circuit?: { time_cap_seconds: number; round_size: number; limit_reached?: boolean };
  /** EMOM, for-time or work/rest: the clock runs on real timestamps, and the person marks each interval or round. */
  timed_format?: TimedFormat;
  /** Started without fixed set/round counts; the person adds rounds and sets as they go. */
  open_ended?: boolean;
  /** `steps_length` restores steps a Death by session added after this point. */
  undo: Array<{ actuals: ActualSet[]; cursor: number; steps_length?: number }>;
}
/** How to track a workout whose source gives no fixed set or round counts. */
export type StartChoice = { log_as_you_go: true } | { rounds: number };
export interface RecoveryOrigin { request: SessionRequest; workout: Workout; previous?: RecoveryOrigin }
export interface SavedLocalSession {
  cell_identity_version?: 2;
  request: SessionRequest;
  workout: Workout;
  generation: number;
  synced_id?: string;
  synced_at?: number;
  problem?: string;
  rejection_status?: number;
  recovery?: ResultRecoveryCommand & { workout?: Workout };
  /** Original rejected bytes remain available with the explicitly recovered result. */
  recovery_origin?: RecoveryOrigin;
  recovered_with?: ResultRecoveryCommand;
  state: "queued" | "synced" | "blocked";
}
export interface TrainingState {
  version: 1;
  generation: number;
  active: SessionDraft | null;
  history: SavedLocalSession[];
  /** Bounded content-free receipts outlive normal synced-history pruning. */
  recovery_receipts?: ResultRecoveryReceipt[];
}
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
// Synced results live on the server. Keep only the newest few on the device so
// each local save stays small; queued and blocked results are always kept.
export const syncedHistoryLimit = 20;
export function pruneHistory(history: SavedLocalSession[]) {
  let synced = 0;
  return history.filter((item) => item.state !== "synced" || ++synced <= syncedHistoryLimit);
}
function rememberRecovery(state: TrainingState, original_id: string, command: ResultRecoveryCommand, saved_id: string) {
  state.recovery_receipts = [{ original_id, creation_key: command.creation_key,
    client_session_id: command.client_session_id, saved_id },
    ...(state.recovery_receipts ?? []).filter(item => item.original_id !== original_id)].slice(0, syncedHistoryLimit);
}
// Network failures, timeouts, rate limits, expired sign-in and server errors can
// succeed later. Any other 4xx will fail the same way on every retry.
export function isTransientSyncError(status: number | undefined) {
  return status == null || status === 0 || status === 401 || status === 408 || status === 429 || status >= 500 || status < 400;
}
function syncProblem(status: number | undefined, message: string) {
  if (status === 404 || status === 410)
    return "The original workout or plan may have been deleted. Your recorded result remains saved on this device.";
  return message;
}
export function hasUnloggedInput(input: Record<string, string> = {}) {
  return Object.entries(input).some(([key, value]) => !["load_unit", "convention"].includes(key) && value.trim());
}
export function trainingKey(owner: string, generation: number) {
  if (!owner || generation < 1) throw Error("A training draft needs an enrolled account generation.");
  return `hafa-workouts:training:v1:${encodeURIComponent(owner)}:${generation}`;
}
export function trackingPrescriptionWarning(workout: Workout): string | null {
  if (timedCircuit(workout) || timedFormat(workout)) return null;
  const formatProblem = timedFormatProblem(workout);
  if (formatProblem) return formatProblem;
  if (workout.blocks.some((block) => block.execution))
    return "Tracking currently supports one AMRAP circuit per session. Separate additional blocks or review the execution details before starting.";
  const sourceSession = workout.provenance === "source" && workout.kind !== "exercise";
  return workout.blocks.some(block =>
    (sourceSession || workout.estimated_minutes != null && block.grouping === "circuit") &&
    block.exercises.some(item => item.sets == null && block.rounds == null))
    ? "This workout has no set or round counts. Choose rounds or log as you go when you start, or edit the workout to add them."
    : null;
}
/** Applies a chosen round count to every block that lacks counts. The original workout is never changed. */
export function withChosenRounds(workout: Workout, rounds: number): Workout {
  if (!Number.isInteger(rounds) || rounds < 1 || rounds > 100) throw Error("Choose from 1 to 100 rounds.");
  const result = clone(workout);
  for (const block of result.blocks) {
    if (block.rounds != null || !block.exercises.some((item) => item.sets == null)) continue;
    if (block.grouping === "sequential") {
      // Straight sets: "3 rounds" means three sets of each exercise that has no count.
      for (const item of block.exercises) if (item.sets == null) item.sets = rounds;
    } else {
      block.rounds = rounds;
      delete block.execution;
    }
  }
  return result;
}
/** Steps for intervals `from`..`to`: the interval is the round, and each move in it is one step per side. */
export function intervalSteps(workout: Workout, from: number, to: number): TrainingStep[] {
  const block = workout.blocks[0];
  const execution = timedFormat(workout);
  if (!execution || execution.mode === "for_time") return [];
  const steps: TrainingStep[] = [];
  for (let round = from; round <= Math.min(to, trackedIntervalLimit); round++)
    for (const index of movesFor(execution, block, round)) {
      const exercise = block.exercises[index];
      for (const side of exercise.per_side ? (["left", "right"] as const) : [null]) {
        const cell = { block_id: block.id, exercise_index: index, round_index: round, set_index: 1, side };
        steps.push({ ...cell, key: actualIdentity(cell), block_label: block.label, grouping: block.grouping, target_set: 1, exercise: clone(exercise) });
      }
    }
  if (steps.length > 1000) throw Error("This workout has too many individual sets to log. Split it into shorter sessions first.");
  return steps;
}
export function stepsFor(workout: Workout): TrainingStep[] {
  const format = timedFormat(workout);
  if (format && format.mode !== "for_time") return intervalSteps(workout, 1, format.intervals ?? 1);
  const steps: TrainingStep[] = [];
  for (const block of workout.blocks) {
    const grouped = block.grouping !== "sequential";
    const append = (exercise: ExercisePrescription, index: number, round: number, set: number) => {
      for (const side of exercise.per_side ? (["left", "right"] as const) : [null]) {
        if (set > 100 || round > 100 || steps.length >= 1000)
          throw Error("This workout has too many individual sets to log. Split it into shorter sessions first.");
        steps.push({
          key: actualIdentity({ block_id: block.id, exercise_index: index, round_index: round, set_index: set, side }),
          block_id: block.id,
          block_label: block.label,
          grouping: block.grouping,
          exercise_index: index,
          round_index: round,
          set_index: set,
          target_set: set,
          side,
          exercise: clone(exercise),
        });
      }
    };
    for (let round = 1; round <= (block.rounds ?? 1); round++) {
      if (grouped) {
        for (let set = 1; set <= Math.max(1, ...block.exercises.map((e) => e.sets ?? 1)); set++)
          block.exercises.forEach((exercise, index) => {
            if (set <= (exercise.sets ?? 1)) append(exercise, index, round, set);
          });
      } else
        block.exercises.forEach((exercise, index) => {
          for (let set = 1; set <= (exercise.sets ?? 1); set++) append(exercise, index, round, set);
        });
    }
  }
  return steps;
}
type Cell = Pick<ActualSet, "block_id" | "exercise_index" | "round_index" | "set_index" | "side">;
// The wire/backend identity is round + set + side, never the UI's global position.
export function actualIdentity(cell: Cell) {
  return JSON.stringify([cell.block_id, cell.exercise_index, cell.round_index ?? 1, cell.set_index, cell.side ?? "both"]);
}
export function draftStructureWarning(draft: SessionDraft) {
  return draft.steps.some((step) => step.set_index !== step.target_set) ?
    "This draft used older set numbering. Recorded work has been kept unchanged. Undo recorded sets before reviewing the empty draft, or finish it as a partial session. Automatic progression cannot treat its older cells as prescribed completion." : null;
}
export function historicalStructureWarning(workout: Workout, actuals: ActualSet[], version?: 2) {
  if (version === 2) return null;
  const outsidePrescription = actuals.some((actual) => {
    const block = workout.blocks.find((b) => b.id === actual.block_id);
    const exercise = block?.exercises[actual.exercise_index];
    if (!block || !exercise) return true;
    return (!timedCircuit(workout) && !timedFormat(workout) && (actual.round_index ?? 1) > (block.rounds ?? 1)) || actual.set_index > (exercise.sets ?? 1) ||
      (exercise.per_side ? actual.side !== "left" && actual.side !== "right" : actual.side != null && actual.side !== "both");
  });
  return outsidePrescription ?
    "This result includes extra or older set numbering. Recorded history and its upload identity are unchanged; it does not establish exact prescribed completion for automatic progression." : null;
}
export function actualErrors(actual: ActualSet) {
  const errors: string[] = [];
  if (actual.reps != null && (!Number.isInteger(actual.reps) || actual.reps < 0 || actual.reps > 1000))
    errors.push("Reps must be a whole number between 0 and 1000.");
  if (
    actual.duration_seconds != null &&
    (!Number.isInteger(actual.duration_seconds) || actual.duration_seconds < 0 || actual.duration_seconds > 86400)
  )
    errors.push("Time must be a whole number of seconds from 0 to 86400.");
  if (
    actual.distance_meters != null &&
    (!Number.isFinite(actual.distance_meters) || actual.distance_meters < 0 || actual.distance_meters > 1000000)
  )
    errors.push("Enter a valid distance.");
  if (
    actual.load != null &&
    (!Number.isFinite(actual.load) ||
      actual.load < 0 ||
      actual.load > 2000 ||
      !actual.load_unit ||
      !actual.load_convention)
  )
    errors.push("Load needs a valid value, unit and load convention.");
  if (actual.effort != null && (!Number.isFinite(actual.effort) || actual.effort < 0 || actual.effort > 10))
    errors.push("Effort must be from 0 to 10.");
  if (actual.notes != null && actual.notes.length > 2000)
    errors.push("Set notes must be 2000 characters or fewer.");
  if (actual.completed && actual.reps == null && actual.duration_seconds == null && actual.distance_meters == null)
    errors.push("Record actual reps, time or distance before completing a set.");
  return errors;
}
export function dateInTimezone(date: Date, timezone: string) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}
export function remainingSeconds(until: number | null, now = Date.now()) {
  return until == null ? 0 : Math.max(0, Math.ceil((until - now) / 1000));
}
export function displayLoad(kg: number, units: UnitSystem) {
  return units === "imperial" ? kg / 0.45359237 : kg;
}
export function canonicalLoad(value: number, units: UnitSystem) {
  return units === "imperial" ? value * 0.45359237 : value;
}
export function displayHeight(cm: number, units: UnitSystem) {
  return units === "imperial" ? cm / 2.54 : cm;
}
export function canonicalHeight(value: number, units: UnitSystem) {
  return units === "imperial" ? value * 2.54 : value;
}
export function summaryOf(actual: ActualSet) {
  const chunks = [];
  if (actual.reps != null) chunks.push(`${actual.reps} reps`);
  if (actual.duration_seconds != null) chunks.push(`${actual.duration_seconds}s`);
  if (actual.distance_meters != null) chunks.push(`${actual.distance_meters}m`);
  if (actual.load != null)
    chunks.push(`${actual.load} ${actual.load_unit} (${actual.load_convention?.replace("_", " ")})`);
  if (actual.side) chunks.push(actual.side);
  return chunks.join(" · ") || "Skipped";
}
/** Freeze subordinate clocks at the same instant as the session clock. */
function freezeTimers(d: SessionDraft, now: number) {
  now = effectiveActiveEnd(d, now);
  if (d.rest_until != null) d.rest_remaining_milliseconds = Math.max(0, d.rest_until - now);
  if (d.interval_started_at != null) d.interval_elapsed_milliseconds = Math.max(0, now - d.interval_started_at);
  d.rest_until = null;
  d.interval_started_at = null;
}
function clearTimers(d: SessionDraft) {
  d.rest_until = null;
  d.rest_remaining_milliseconds = null;
  d.interval_started_at = null;
  d.interval_elapsed_milliseconds = null;
}
export function exerciseElapsedSeconds(d: SessionDraft, now = Date.now()) {
  return Math.floor(Math.max(0, d.interval_started_at == null
    ? d.interval_elapsed_milliseconds ?? 0 : now - d.interval_started_at) / 1000);
}
export function restRemainingSeconds(d: SessionDraft, now = Date.now()) {
  return d.rest_until == null ? Math.ceil((d.rest_remaining_milliseconds ?? 0) / 1000) : remainingSeconds(d.rest_until, now);
}
/** The AMRAP cap, or a timed format's whole clock (a for-time cap, or interval length × count). */
function capSeconds(d: SessionDraft) {
  return d.timed_circuit?.time_cap_seconds ?? (d.timed_format ? formatCapSeconds(d.timed_format) : null);
}
/** Active time on the session clock, stopped at the cap and while paused. */
export function sessionElapsedMilliseconds(d: SessionDraft, now = Date.now()) {
  const cap = capSeconds(d);
  return Math.min((d.active_milliseconds ?? 0) + (d.active_started_at == null ? 0 : Math.max(0, now - d.active_started_at)),
    cap == null ? Infinity : cap * 1000);
}
export function capRemainingSeconds(d: SessionDraft, now = Date.now()) {
  const cap = capSeconds(d);
  return cap == null ? null : Math.max(0, Math.ceil(cap - sessionElapsedMilliseconds(d, now) / 1000));
}
/**
 * Rest after `step`: between rounds, or after a superset/circuit pass (A1 then A2, then rest),
 * the block's rest applies; otherwise the exercise's own rest.
 */
export function restAfter(workout: Workout, step: Pick<TrainingStep, "block_id" | "round_index" | "set_index" | "grouping" | "exercise">,
  next: Pick<TrainingStep, "block_id" | "round_index" | "set_index"> | undefined) {
  const sameBlock = next?.block_id === step.block_id;
  const passEnds = sameBlock && (next.round_index !== step.round_index || (step.grouping !== "sequential" && next.set_index !== step.set_index));
  const block = workout.blocks.find((b) => b.id === step.block_id);
  return passEnds ? (block?.rest_between_rounds_seconds ?? step.exercise.rest_seconds) : step.exercise.rest_seconds;
}
function effectiveActiveEnd(d: SessionDraft, now: number) {
  if (d.active_started_at == null) return now;
  const cap = capSeconds(d);
  const capEnd = cap != null ? d.active_started_at + Math.max(0, cap * 1000 - d.active_milliseconds) : Infinity;
  return Math.max(d.active_started_at, Math.min(now, capEnd));
}
function closeActive(d: SessionDraft, now: number) {
  if (d.active_started_at == null) return;
  const end = effectiveActiveEnd(d, now);
  if (end > d.active_started_at && d.active_intervals)
    d.active_intervals.push({
      started_at: new Date(d.active_started_at).toISOString(),
      ended_at: new Date(end).toISOString(),
    });
  d.active_milliseconds = (d.active_milliseconds ?? 0) + (end - d.active_started_at);
  d.active_started_at = null;
}
export function createTrainingStore(
  storage: Storage,
  owner: string,
  generation: number,
  clock: () => number = Date.now
) {
  let state: TrainingState = { version: 1, generation, active: null, history: [] };
  let loaded = false;
  let operations = Promise.resolve();
  let syncing: Promise<void> | null = null;
  let transport = Promise.resolve();
  const recoveries = new Map<string, Promise<string>>();
  function exclusive<T>(work: () => Promise<T>) {
    const next = transport.catch(() => undefined).then(work);
    transport = next.then(() => undefined, () => undefined);
    return next;
  }
  const listeners = new Set<() => void>();
  const key = trainingKey(owner, generation);
  function update(work: (previous: TrainingState) => TrainingState) {
    const result = operations
      .catch(() => undefined)
      .then(async () => {
        if (!loaded) throw Error("Wait for your saved training to load.");
        const next = work(clone(state));
        next.history = pruneHistory(next.history);
        if (next.active && !next.active.paused && capRemainingSeconds(next.active, clock()) === 0) {
          freezeTimers(next.active, clock());
          closeActive(next.active, clock());
          next.active.paused = true;
        }
        if (next.active)
          next.active.checkpoint_at = Math.max(clock(), next.active.checkpoint_at, next.active.active_started_at ?? 0);
        await storage.setItem(key, JSON.stringify(next));
        state = next;
        listeners.forEach((fn) => fn());
      });
    operations = result;
    return result;
  }
  async function run(send: (request: SessionRequest, originalGeneration: number) => Promise<TrainingSession>) {
    await operations;
    const queue = state.history.filter((x) => x.state === "queued" && !x.recovery);
    let previousRejection: number | null = null;
    for (const item of queue) {
      try {
        const saved = await send(clone(item.request), item.generation);
        if (item.recovered_with && (saved.generation !== item.generation ||
          saved.client_session_id?.toLowerCase() !== item.request.client_session_id.toLowerCase()))
          throw Object.assign(Error("The saved recovery response changed. Retry after refreshing your account."), { local: true });
        previousRejection = null;
        await update((s) => {
          const local = s.history.find((x) => x.request.client_session_id === item.request.client_session_id);
          if (local) {
            local.state = "synced";
            local.synced_id = saved.id;
            local.synced_at = clock();
            if (local.recovery_origin && local.recovered_with)
              rememberRecovery(s, local.recovery_origin.request.client_session_id, local.recovered_with, saved.id);
            delete local.rejection_status;
            const warning = historicalStructureWarning(local.workout, local.request.actuals, local.cell_identity_version);
            if (warning) local.problem = warning;
            else delete local.problem;
          }
          return s;
        });
      } catch (e) {
        const { status, local: stoppedHere } = e as { status?: number; local?: boolean };
        // Two results rejected the same way in a row look like a service-wide problem,
        // not a problem with each result; keep the rest queued for a later retry.
        const transient = stoppedHere === true || isTransientSyncError(status) || previousRejection === status;
        await update((s) => {
          const local = s.history.find((x) => x.request.client_session_id === item.request.client_session_id);
          if (local) {
            local.problem = syncProblem(status, e instanceof Error ? e.message : "Could not sync");
            if (!transient) { local.state = "blocked"; local.rejection_status = status; }
          }
          return s;
        });
        // A permanent rejection only needs attention for this result; keep sending the rest.
        if (transient) break;
        previousRejection = status ?? null;
      }
    }
  }
  function logActuals(actuals: ActualSet[], now: number) {
    return update((s) => {
      const d = s.active;
      if (!d) throw Error("No session is active.");
      const warning = draftStructureWarning(d);
      if (warning) throw Error(warning);
      if (!actuals.length) throw Error("Choose what to record first.");
      if (d.timed_circuit && d.paused && capRemainingSeconds(d, now) !== 0)
        throw Error("Resume the circuit before logging more work.");
      const first = d.steps[d.cursor];
      // An interval can be marked once it starts (finishing early leaves the rest of it as rest), never before.
      if (d.timed_format && d.timed_format.mode !== "for_time" && first &&
        first.round_index > intervalPosition(d.timed_format, sessionElapsedMilliseconds(d, now)).index)
        throw Error("This interval hasn't started yet.");
      if (!d.timed_circuit) d.undo.push({ actuals: clone(d.actuals), cursor: d.cursor, ...(d.timed_format ? { steps_length: d.steps.length } : {}) });
      let step = first;
      for (const actual of actuals) {
        step = d.steps[d.cursor];
        if (
          !step ||
          actual.block_id !== step.block_id ||
          actual.exercise_index !== step.exercise_index ||
          actual.set_index !== step.set_index ||
          actual.round_index !== step.round_index ||
          actual.side !== step.side
        )
          throw Error("This set changed. Review it before logging.");
        if (d.actuals.some((prior) => actualIdentity(prior) === actualIdentity(actual)))
          throw Error("This round, set and side already has a recorded result. Undo it before recording again.");
        const errors = actualErrors(actual);
        if (errors.length) throw Error(errors.join(" "));
        d.actuals.push(clone(actual));
        d.cursor++;
      }
      d.input = {};
      clearTimers(d);
      if (d.timed_format) {
        const done = d.cursor === d.steps.length;
        if (done && d.timed_format.mode === "for_time") {
          // The last movement stops the clock: the finish time is when the work ended, not when Save is tapped.
          closeActive(d, now);
          d.paused = true;
        } else if (done && openLadder(d.workout.blocks[0]) && d.actuals.every((a) => a.round_index !== step.round_index || a.completed)) {
          // Death by continues while each interval is finished; a missed interval ends it.
          const round = step.round_index + 1;
          if (d.workout.blocks[0].exercises.every((e) => e.ladder && ladderReps(e.ladder, round) != null))
            d.steps.push(...intervalSteps(d.workout, round, round));
        }
        return s;
      }
      if (d.timed_circuit && d.cursor === d.steps.length && capRemainingSeconds(d, now)! > 0) {
        const round = step.round_index + 1;
        if (round <= 100 && d.steps.length + d.timed_circuit.round_size <= 1000) {
          d.steps.push(...d.steps.slice(0, d.timed_circuit.round_size).map((first) => {
            const repeated = { ...clone(first), round_index: round };
            return { ...repeated, key: actualIdentity(repeated) };
          }));
        } else d.timed_circuit.limit_reached = true;
      }
      const rest = restAfter(d.workout, step, d.steps[d.cursor]);
      const completed = actuals.at(-1)!.completed;
      d.rest_until = completed && rest && !d.paused ? now + rest * 1000 : null;
      d.rest_remaining_milliseconds = completed && rest && d.paused ? rest * 1000 : null;
      return s;
    });
  }
  return {
    subscribe(fn: () => void) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    snapshot: () => state,
    async load() {
      const raw = await storage.getItem(key);
      if (raw) {
        const value = JSON.parse(raw) as TrainingState;
        if (
          value.version !== 1 ||
          value.generation !== generation ||
          !Array.isArray(value.history) ||
          (value.active != null && value.active.generation !== generation) ||
          value.history.some((h) => h.generation !== generation)
        )
          throw Error("The local training record needs recovery. It has not been overwritten.");
        state = { ...value, history: pruneHistory(value.history) };
        for (const item of state.history) {
          const warning = historicalStructureWarning(item.workout, item.request.actuals, item.cell_identity_version);
          if (warning) item.problem = warning;
        }
        if (state.active && !state.active.paused) {
          const d = state.active;
          const checkpoint = d.checkpoint_at ?? new Date(d.started_at).getTime();
          freezeTimers(d, checkpoint);
          closeActive(d, checkpoint);
          d.paused = true;
        }
      }
      loaded = true;
      listeners.forEach((fn) => fn());
    },
    /** `choice` lets a workout without fixed counts start open-ended or with chosen rounds. */
    start(workout: Workout, source: SessionSource, id: string, now = clock(), choice?: StartChoice) {
      return update((s) => {
        if (s.active) throw Error("Finish or discard your current session before starting another.");
        if (workout.generation !== generation)
          throw Error("This workout belongs to an older account generation. Reload your library.");
        const warning = trackingPrescriptionWarning(workout);
        if (warning && !choice) throw Error(warning);
        if (choice && workout.kind === "program") throw Error("Start a plan session instead of the whole program.");
        if (choice && "rounds" in choice) workout = withChosenRounds(workout, choice.rounds);
        const steps = stepsFor(workout);
        const execution = choice ? null : timedCircuit(workout);
        const format = choice || execution ? null : timedFormat(workout);
        if (!steps.length) throw Error("Add at least one exercise before training.");
        s.active = {
          id,
          cell_identity_version: 2,
          generation,
          source,
          workout: clone(workout),
          started_at: new Date(now).toISOString(),
          actuals: [],
          steps,
          cursor: 0,
          rest_until: null,
          interval_started_at: null,
          paused: false,
          notes: "",
          undo: [],
          active_started_at: now,
          active_milliseconds: 0,
          active_intervals: [],
          checkpoint_at: now,
          activity_type: null,
          ...(execution ? { timed_circuit: {
            time_cap_seconds: execution.time_cap_seconds, round_size: steps.length,
          } } : {}),
          ...(format ? { timed_format: clone(format) } : {}),
          ...(choice ? { open_ended: true } : {}),
        };
        return s;
      });
    },
    log(actual: ActualSet, now = clock()) {
      return logActuals([actual], now);
    },
    /** Records consecutive steps at once: every move in an interval, or the rest of a for-time round. */
    logGroup(actuals: ActualSet[], now = clock()) {
      return logActuals(actuals, now);
    },
    undo() {
      return update((s) => {
        const d = s.active;
        if (d?.timed_circuit) {
          if (!d.actuals.length) throw Error("There is no set to undo.");
          d.actuals.pop();
          d.cursor--;
          d.input = {};
          clearTimers(d);
          return s;
        }
        const prior = d?.undo.pop();
        if (!d || !prior) throw Error("There is no set to undo.");
        d.actuals = prior.actuals;
        d.cursor = prior.cursor;
        if (prior.steps_length != null) d.steps.splice(prior.steps_length);
        clearTimers(d);
        return s;
      });
    },
    timer(kind: "rest" | "interval", seconds = 60, now = clock()) {
      return update((s) => {
        if (!s.active) throw Error("No session is active.");
        const d = s.active;
        if (kind === "rest") {
          d.rest_until = !d.paused && seconds > 0 ? now + seconds * 1000 : null;
          d.rest_remaining_milliseconds = d.paused && seconds > 0 ? seconds * 1000 : null;
        } else {
          d.interval_started_at = !d.paused && seconds > 0 ? now : null;
          d.interval_elapsed_milliseconds = d.paused && seconds > 0 ? 0 : null;
        }
        return s;
      });
    },
    checkpoint() {
      return update((s) => s);
    },
    pause(paused: boolean, now = clock()) {
      return update((s) => {
        const d = s.active;
        if (d && d.paused !== paused) {
          now = Math.max(now, d.checkpoint_at);
          if (paused) {
            freezeTimers(d, now);
            closeActive(d, now);
          } else {
            d.active_started_at = now;
            if (d.rest_remaining_milliseconds != null) d.rest_until = now + d.rest_remaining_milliseconds;
            if (d.interval_elapsed_milliseconds != null) d.interval_started_at = now - d.interval_elapsed_milliseconds;
            d.rest_remaining_milliseconds = null;
            d.interval_elapsed_milliseconds = null;
          }
          d.paused = paused;
        }
        return s;
      });
    },
    notes(notes: string) {
      return update((s) => {
        if (s.active) s.active.notes = notes;
        return s;
      });
    },
    input(input: Record<string, string>) {
      return update((s) => {
        if (s.active) s.active.input = clone(input);
        return s;
      });
    },
    activityType(type: string) {
      return update((s) => {
        if (s.active) s.active.activity_type = type;
        return s;
      });
    },
    reviewEmptyDraft() {
      return update((s) => {
        const d = s.active;
        if (!d) throw Error("No session is active.");
        if (d.actuals.length) throw Error("Undo recorded sets first. Existing actuals cannot be renumbered.");
        d.steps = stepsFor(d.workout);
        d.cursor = 0;
        d.undo = [];
        d.input = {};
        clearTimers(d);
        d.cell_identity_version = 2;
        return s;
      });
    },
    addSet() {
      return update((s) => {
        const d = s.active;
        if (!d) throw Error("No session is active.");
        const warning = draftStructureWarning(d);
        if (warning) throw Error(warning);
        if (d.timed_circuit) throw Error("This timed circuit repeats whole rounds. Extra fixed sets would change its instructions.");
        if (d.timed_format) throw Error("This timed workout sets its own intervals and rounds.");
        const previous = d.steps[Math.min(d.cursor, d.steps.length - 1)];
        if (!previous) throw Error("Choose an exercise first.");
        const set = Math.max(...d.steps.filter((x) =>
          x.block_id === previous.block_id && x.exercise_index === previous.exercise_index &&
          x.round_index === previous.round_index).map((x) => x.set_index)) + 1;
        const sides = previous.exercise.per_side ? ["left", "right"] as const : [null];
        if (set > 100 || d.steps.length + sides.length > 1000) throw Error("This session has reached its set limit.");
        const added = sides.map((side): TrainingStep => {
          const step = { ...clone(previous), side, set_index: set, target_set: set };
          return { ...step, key: actualIdentity(step) };
        });
        // Keep the current left/right pair together before the deliberate extra pair.
        let insertion = Math.min(d.cursor + 1, d.steps.length);
        while (insertion < d.steps.length && d.steps[insertion].block_id === previous.block_id &&
          d.steps[insertion].exercise_index === previous.exercise_index &&
          d.steps[insertion].round_index === previous.round_index)
          insertion++;
        d.steps.splice(insertion, 0, ...added);
        return s;
      });
    },
    /**
     * Repeats a block's latest round once more, right after that block. At a block boundary
     * it repeats the block just finished, not the one not yet started. Straight-set blocks
     * repeat one set of each exercise.
     */
    addRound() {
      return update((s) => {
        const d = s.active;
        if (!d) throw Error("No session is active.");
        const warning = draftStructureWarning(d);
        if (warning) throw Error(warning);
        if (d.timed_circuit) throw Error("This timed circuit already repeats rounds until the time cap.");
        if (d.timed_format) throw Error("This timed workout sets its own intervals and rounds.");
        const boundary = d.cursor > 0 && d.cursor < d.steps.length && d.steps[d.cursor - 1].block_id !== d.steps[d.cursor].block_id;
        const current = d.steps[boundary ? d.cursor - 1 : Math.min(d.cursor, d.steps.length - 1)];
        if (!current) throw Error("Choose an exercise first.");
        const block = d.steps.filter((x) => x.block_id === current.block_id);
        const latest = Math.max(...block.map((x) => x.round_index));
        const round = latest + 1;
        const template = block.filter((x) => x.round_index === latest && (x.grouping !== "sequential" || x.set_index === 1));
        if (round > 100 || d.steps.length + template.length > 1000) throw Error("This session has reached its round limit.");
        const added = template.map((first): TrainingStep => {
          const step = { ...clone(first), round_index: round };
          return { ...step, key: actualIdentity(step) };
        });
        // The cursor is inside or just past this block, so the new round never lands before it.
        let insertion = d.steps.length;
        while (insertion > 0 && d.steps[insertion - 1].block_id !== current.block_id) insertion--;
        d.steps.splice(insertion, 0, ...added);
        return s;
      });
    },
    discard() {
      return update((s) => {
        s.active = null;
        return s;
      });
    },
    /** `activityFallback` is used only when no type was chosen; it is never stored on the draft. */
    finish(status: "completed" | "partial", now = clock(), unloggedInput: "keep" | "discard" = "keep", activityFallback?: string) {
      return update((s) => {
        const d = s.active;
        if (!d) throw Error("No session is active.");
        if (hasUnloggedInput(d.input) && unloggedInput !== "discard")
          throw Error("Log or discard the current entry before finishing.");
        if (status === "completed" && draftStructureWarning(d)) throw Error("Older set numbering needs review. Keep this result as a partial session.");
        if (status === "completed") {
          // Death by ends at the first missed interval, so only that final interval may be unfinished.
          const failureEnds = !!d.timed_format && openLadder(d.workout.blocks[0]);
          const lastRound = Math.max(0, ...d.actuals.map((a) => a.round_index));
          if (d.timed_circuit) {
            if (capRemainingSeconds(d, now)! > 0 || d.timed_circuit.limit_reached || !d.actuals.some((a) => a.completed))
              throw Error("Reach the source time cap with recorded work, or save this as a partial session.");
          } else if (!failureEnds && d.cursor !== d.steps.length)
            throw Error(d.timed_format ? "Mark every interval or round first, or save this as a partial session."
              : "Some sets were not completed. Save this as a partial session.");
          if (d.actuals.some((a) => !a.completed && !(failureEnds && a.round_index === lastRound)))
            throw Error("Skipped work stays partial. Save this as a partial session.");
        }
        const activity_type = d.activity_type ?? activityFallback;
        if (!activity_type) throw Error("Choose the activity type before saving.");
        if (!d.actuals.length) throw Error("Log at least one set, or discard the session.");
        now = Math.max(now, d.checkpoint_at);
        closeActive(d, now);
        const request: SessionRequest = {
          ...(d.active_intervals ? { active_intervals: clone(d.active_intervals) } : {}),
          client_session_id: d.id,
          ...d.source,
          started_at: d.started_at,
          finished_at: new Date(Math.max(now, new Date(d.started_at).getTime())).toISOString(),
          status,
          activity_type,
          active_seconds: Math.floor(
            Math.min(
              Math.max(0, now - new Date(d.started_at).getTime()),
              d.active_milliseconds + (d.active_started_at == null ? 0 : Math.max(0, now - d.active_started_at))
            ) / 1000
          ),
          actuals: clone(d.actuals),
          notes: d.notes || null,
        };
        const warning = historicalStructureWarning(d.workout, request.actuals, d.cell_identity_version);
        s.history.unshift({ request, workout: d.workout, generation: d.generation, state: "queued",
          ...(d.cell_identity_version ? { cell_identity_version: d.cell_identity_version } : {}),
          ...(warning ? { problem: warning } : {}) });
        s.active = null;
        return s;
      });
    },
    sync(send: (request: SessionRequest, originalGeneration: number) => Promise<TrainingSession>) {
      // Concurrent callers wait for the same pass, so follow-up work sees its result.
      syncing ??= exclusive(() => run(send)).finally(() => {
        syncing = null;
      });
      return syncing;
    },
    recoverResult(
      id: string, command: ResultRecoveryCommand,
      saveWorkout: (workout: AuthoredWorkout, key: string, generation: number) => Promise<Workout>,
      send: (request: SessionRequest, generation: number) => Promise<TrainingSession>,
      current: () => boolean
    ) {
      const existing = recoveries.get(id);
      if (existing) return existing;
      const guard = () => { if (!current()) throw Error("Your account changed. Recovery stopped; the original result stays saved."); };
      let acceptedDuringSend: string | undefined;
      const sendCurrent = async (request: SessionRequest, epoch: number) => {
        guard();
        const saved = await send(request, epoch); guard();
        if (saved.generation !== generation || saved.client_session_id?.toLowerCase() !== request.client_session_id.toLowerCase())
          throw Object.assign(Error("The saved result response changed. Retry the same recovery after refreshing your account."), { local: true });
        if (request.client_session_id.toLowerCase() === command.client_session_id.toLowerCase()) acceptedDuringSend = saved.id;
        return saved;
      };
      const result = exclusive(async () => {
        await operations.catch(() => undefined); guard();
        const receipt = state.recovery_receipts?.find(item => item.original_id === id);
        if (receipt) {
          if (receipt.creation_key !== command.creation_key || receipt.client_session_id !== command.client_session_id)
            throw Error("Reload the existing recovery before trying again.");
          return receipt.saved_id;
        }
        if (command.client_session_id === id) throw Error("Recovery needs a new result identity.");
        let original = state.history.find(item => item.request.client_session_id === id);
        const replacement = state.history.find(item => item.recovery_origin?.request.client_session_id === id);
        if (replacement) {
          if (replacement.request.client_session_id !== command.client_session_id)
            throw Error("Reload the existing recovery before trying again.");
          if (replacement.state !== "synced") {
            if (replacement.state === "blocked" && !isTransientSyncError(replacement.rejection_status))
              throw Error(replacement.problem || "The recovered result needs review before saving again.");
            await update(s => { s.history.find(item => item.request.client_session_id === command.client_session_id)!.state = "queued"; return s; });
            await run(sendCurrent);
          }
        } else {
          if (!original) throw Error("This local result is no longer available.");
          if (original.state === "synced") return original.synced_id!;
          if (original.request.supersedes_session_id) throw Error("A correction must stay linked to its original saved session.");
          if (!original.recovery) {
            if (!canRecoverResult(original)) throw Error("Try saving the original result again before recovering a missing source.");
            try {
              // Idempotency replay precedes source lookup on the server. A lost
              // acceptance must resolve here before any new workout is created.
              const saved = await sendCurrent(clone(original.request), generation);
              await update(s => { const item = s.history.find(h => h.request.client_session_id === id)!;
                item.state = "synced"; item.synced_id = saved.id; item.synced_at = clock();
                delete item.rejection_status; delete item.problem;
                rememberRecovery(s, id, command, saved.id); return s; });
              return saved.id;
            } catch (error) {
              guard();
              const failure = error as { status?: number; local?: boolean };
              if (failure.local || ![404, 410].includes(failure.status ?? 0)) throw error;
            }
            await update(s => { const item = s.history.find(h => h.request.client_session_id === id);
              if (!item) throw Error("This local result was removed before recovery started.");
              item.state = "blocked"; item.recovery = clone(command); return s; });
          }
          original = state.history.find(item => item.request.client_session_id === id)!;
          if (original.recovery!.creation_key !== command.creation_key || original.recovery!.client_session_id !== command.client_session_id)
            throw Error("Retry the original recovery command before starting another.");
          if (!original.recovery!.workout) {
            guard();
            const saved = await saveWorkout(restoredPrescription(original.workout), command.creation_key, generation); guard();
            if (saved.generation !== generation) throw Error("The recovered workout belongs to another account generation.");
            await update(s => { s.history.find(h => h.request.client_session_id === id)!.recovery!.workout = saved; return s; });
          }
          guard();
          await update(s => {
            const item = s.history.find(h => h.request.client_session_id === id)!;
            const workout = item.recovery!.workout!;
            const { workout_id: _workout, workout_revision: _revision, program_id: _program,
              program_revision: _programRevision, program_session_id: _slot, ...actuals } = item.request;
            s.history = s.history.map(h => h !== item ? h : { request: { ...actuals,
              client_session_id: command.client_session_id, workout_id: workout.id, workout_revision: workout.revision },
              workout, generation, state: "queued", cell_identity_version: item.cell_identity_version,
              recovery_origin: { request: item.request, workout: item.workout,
                ...(item.recovery_origin ? { previous: item.recovery_origin } : {}) }, recovered_with: clone(command) });
            return s;
          });
          await run(sendCurrent);
        }
        guard();
        const accepted = state.recovery_receipts?.find(item => item.original_id === id);
        if (accepted) return accepted.saved_id;
        const recovered = state.history.find(item => item.request.client_session_id === command.client_session_id);
        if (!recovered && acceptedDuringSend) return acceptedDuringSend;
        if (recovered?.state !== "synced") throw Error(recovered?.problem || "The private workout is restored. Your result stays on this device until sync succeeds.");
        return recovered.synced_id!;
      });
      recoveries.set(id, result);
      void result.finally(() => { recoveries.delete(id); }).catch(() => undefined);
      return result;
    },
    correct(saved: TrainingSession, actuals: ActualSet[], notes: string, id: string) {
      return update((s) => {
        if (saved.generation !== generation) throw Error("This result belongs to an older account generation.");
        const errors = actuals.flatMap(actualErrors);
        if (errors.length) throw Error(errors.join(" "));
        const { prescription_snapshot: _snapshot, ...prior } = saved.content;
        const request: SessionRequest = {
          ...prior,
          client_session_id: id,
          actuals: clone(actuals),
          // A correction can remove completed work; editing recorded cells cannot
          // prove that unrecorded work from a partial session was performed.
          status: prior.status === "completed" && actuals.length > 0 && actuals.every((actual) => actual.completed)
            ? "completed" : "partial",
          notes,
          supersedes_session_id: saved.id,
        };
        s.history.unshift({ request, workout: saved.content.prescription_snapshot, generation, state: "queued" });
        return s;
      });
    },
    // Only a result the server permanently rejected can be removed; queued work is never dropped.
    dismiss(id: string) {
      return update((s) => {
        const item = s.history.find((x) => x.request.client_session_id === id);
        if (!item || item.state !== "blocked") throw Error("Only results that need attention can be discarded.");
        if (recoveries.has(id) || item.recovery) throw Error("Finish this recovery before discarding its result.");
        s.history = s.history.filter((x) => x !== item);
        return s;
      });
    },
    retry(id: string) {
      return update((s) => {
        const item = s.history.find((x) => x.request.client_session_id === id);
        if (item && item.state !== "synced") {
          if (recoveries.has(id) || item.recovery) throw Error("Continue this recovery before retrying the original result.");
          delete item.rejection_status;
          item.state = "queued";
          const warning = historicalStructureWarning(item.workout, item.request.actuals, item.cell_identity_version);
          if (warning) item.problem = warning;
          else delete item.problem;
        }
        return s;
      });
    },
  };
}
export type TrainingStore = ReturnType<typeof createTrainingStore>;
export function previousActual(
  workout: Workout,
  step: TrainingStep,
  history: Array<{ workout: Workout; actuals: ActualSet[] }>
) {
  for (const session of history) {
    const matching = session.actuals.filter((actual) => {
      if (!actual.completed || (actual.side ?? null) !== step.side) return false;
      const prior = session.workout.blocks.find((b) => b.id === actual.block_id)?.exercises[actual.exercise_index];
      if (!prior) return false;
      if (step.exercise.exercise_id && prior.exercise_id) return step.exercise.exercise_id === prior.exercise_id;
      return (
        workout.id === session.workout.id &&
        actual.block_id === step.block_id &&
        actual.exercise_index === step.exercise_index &&
        prior.name === step.exercise.name &&
        prior.per_side === step.exercise.per_side
      );
    });
    if (matching.length) return matching[matching.length - 1];
  }
  return null;
}
