import { canRecoverResult, restoredPrescription, type ResultRecoveryCommand, type ResultRecoveryReceipt } from "./result-recovery";
import type { ActualSet, Workout, AuthoredWorkout, SessionRequest, TrainingSession, SessionSaveResult, ExercisePrescription } from "./models";
import type { Storage } from "./drafts";
import { timedCircuit } from "./timed-circuit";
import { formatCapSeconds, intervalPosition, isDeathBy, ladderReps, movesFor, timedFormat, timedFormatProblem,
  trackedIntervalLimit, type TimedFormat } from "./timed-execution";
import { endPart, isTimedPart, partKind, planClass, resolve, startPart, type ClassRun, type PartResult, type Segment, type RunEnvironment } from "./class-session";
import { carriesResults, classPayload, cleanScore, scoreProblem, withoutResults } from "./class-scores";
import { alignCursor, classActive, classOver, currentPart, fillRunChoices, isClassWorkout, setsDone, setsOnly, roundActuals, type ClassLoad } from "./class-training";
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
  class_loads?: Record<string, Record<number, ClassLoad>>;
  /** Actual identities whose weight came from Rx rather than an athlete entry, retained across reloads. */
  class_prescribed_loads?: string[];
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
  /** A class run part by part (A, rest, B, C, D): each part's clock lives here, not in the session clock. */
  class_run?: ClassRun;
  /** Scores the person reviewed or corrected, by part; parts without one keep the clock's score. */
  class_scores?: Record<string, PartResult>;
  /** Started without fixed set/round counts; the person adds rounds and sets as they go. */
  open_ended?: boolean;
  /**
   * "wall": a timed clock that only an explicit pause stops; lock, app switch and relaunch don't.
   * Drafts saved by older versions have no policy and keep pausing on relaunch.
   */
  clock_policy?: "wall" | "pausable";
  /** The 3-2-1 lead-in ends here; `active_started_at` is set to the same moment, so the lead-in never counts as work. */
  lead_in_until?: number | null;
  /** The app reopened with this wall clock still running; the person confirms it or says when they stopped. */
  clock_kept_running?: { left_at: number };
  /**
   * `steps_length` restores steps a Death by session added after this point. `clock` is the running clock
   * a final for-time tick or Death by miss stopped, so undoing that tick restarts it as if it never stopped.
   */
  undo: Array<{ actuals: ActualSet[]; cursor: number; steps_length?: number;
    clock?: { active_started_at: number; active_milliseconds: number; intervals: number };
    /** A class's parts before this log, restored by undo only while nothing else changed them since. */
    class_run?: ClassRun; class_after?: string }>;
}
/** How to track a workout whose source gives no fixed set or round counts. */
export type StartChoice = { log_as_you_go: true } | { rounds: number };
export interface RecoveryOrigin { request: SessionRequest; workout: Workout; previous?: RecoveryOrigin }
export interface SavedLocalSession {
  watch?: import("./watch-sync").WatchDetails;
  watch_quick?: boolean;
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
  /** The session ran on the EMOM, for-time or work/rest clock (not logged as you go or with chosen rounds). */
  timed_format?: true;
  /** The server refused this session's scores or splits; the session saved without them, and they are kept here. */
  unsent_results?: { reason: string; results?: PartResult[]; segments?: SessionRequest["segments"] };
}
export interface TrainingState {
  watch_imported?: string[];
  version: 1;
  generation: number;
  active: SessionDraft | null;
  history: SavedLocalSession[];
  /** Bounded content-free receipts outlive normal synced-history pruning. */
  recovery_receipts?: ResultRecoveryReceipt[];
  /** The last Outdoor/Treadmill choice for a run, used for the next one. */
  run_environment?: RunEnvironment;
}
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
// Synced results live on the server. Keep only the newest few on the device so
// each local save stays small; queued, blocked, and locally retained scores are always kept.
export const syncedHistoryLimit = 20;
/**
 * Whether this device ran the session on the format clock. The server keeps no such fact, so a synced
 * session without its local record (another device, or pruned) is not scored.
 */
export function ranFormatTimer(history: readonly SavedLocalSession[], clientSessionId: string) {
  return history.some((item) => item.request.client_session_id === clientSessionId && item.timed_format === true);
}
export function pruneHistory(history: SavedLocalSession[], now = Date.now()) {
  let synced = 0, watch = 0;
  return history.flatMap(item => {
    // Never discard the only copy of unsynced work or rejected scores.
    if (item.state !== "synced" || item.unsent_results) return [item];
    if (item.watch && ++watch <= 60 && Date.parse(item.request.started_at) >= now - 90 * 86400000) return [item];
    if (++synced > syncedHistoryLimit) return [];
    // Older sessions in the normal short history need only their watch HR summary.
    return [item.watch ? { ...item, watch: { heart_rate: item.watch.heart_rate, parts: [] } } : item];
  });
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
  if (timedCircuit(workout) || timedFormat(workout) || isClassWorkout(workout)) return null;
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
      for (const item of block.exercises) if (item.sets == null && !item.segment) item.sets = rounds;
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
    // A buy-in is done once before the first round and a cash-out once after the last.
    const once = (exercise: ExercisePrescription, round: number) =>
      exercise.segment === "buy_in" ? round === 1 : exercise.segment === "cash_out" ? round === (block.rounds ?? 1) : true;
    for (let round = 1; round <= (block.rounds ?? 1); round++) {
      if (grouped) {
        for (let set = 1; set <= Math.max(1, ...block.exercises.map((e) => e.sets ?? 1)); set++)
          block.exercises.forEach((exercise, index) => {
            if (set <= (exercise.sets ?? 1) && once(exercise, round)) append(exercise, index, round, set);
          });
      } else
        block.exercises.forEach((exercise, index) => {
          if (once(exercise, round)) for (let set = 1; set <= (exercise.sets ?? 1); set++) append(exercise, index, round, set);
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
const logged = (d: Pick<SessionDraft, "actuals">) => (step: { key: string }) => d.actuals.some((a) => actualIdentity(a) === step.key);
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
    return (!isTimedPart(partKind(block)) && !timedCircuit(workout) && !timedFormat(workout) && (actual.round_index ?? 1) > (block.rounds ?? 1)) || actual.set_index > (exercise.sets ?? 1) ||
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
/** The phone's timezone: the training day until the person saves a profile with their own. */
export function deviceTimezone() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}
/** A saved profile's timezone, else the phone's. A missing profile is not an error. */
export function trainingTimezone(profile: { timezone?: string | null } | null | undefined) {
  return profile?.timezone || deviceTimezone();
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
/** The clock as its screen shows it: an AMRAP counts down to its cap; other timed clocks show time elapsed. */
export function displayedClockSeconds(d: SessionDraft, now = Date.now()) {
  return d.timed_circuit ? capRemainingSeconds(d, now)! : Math.floor(sessionElapsedMilliseconds(d, now) / 1000);
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
export const isWallClock = (d: Pick<SessionDraft, "clock_policy">) => d.clock_policy === "wall";
/** Milliseconds left in the lead-in, or 0 once the clock is running. */
export function leadInRemaining(d: Pick<SessionDraft, "lead_in_until" | "paused">, now = Date.now()) {
  return d.lead_in_until == null || d.paused ? 0 : Math.max(0, d.lead_in_until - now);
}
/**
 * Stops the clock at `at`, which may be earlier than now: "I stopped at…" after a relaunch. A clock the cap
 * already froze is trimmed back instead.
 */
function stopAt(d: SessionDraft, at: number) {
  if (d.active_started_at != null) {
    at = Math.max(at, d.active_started_at);
    freezeTimers(d, at);
    closeActive(d, at);
  } else {
    const last = d.active_intervals?.at(-1);
    const end = last ? Date.parse(last.ended_at) : NaN;
    if (last && at < end) {
      at = Math.max(at, Date.parse(last.started_at));
      d.active_milliseconds = Math.max(0, d.active_milliseconds - (end - at));
      last.ended_at = new Date(at).toISOString();
    }
  }
  d.paused = true;
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
  clock: () => number = Date.now,
  saveWatchWorkout?: (workout: AuthoredWorkout, key: string, generation: number) => Promise<Workout>
) {
  let state: TrainingState = { version: 1, generation, active: null, history: [] };
  let loaded = false;
  // The device's countdown choice, mirrored in by the reminders provider; none until it says.
  let leadInSeconds = 0;
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
        if (next.watch_imported) next.watch_imported = [...new Set(next.watch_imported)].slice(-500);
        if (next.active && !next.active.paused && capRemainingSeconds(next.active, clock()) === 0) {
          freezeTimers(next.active, clock());
          closeActive(next.active, clock());
          next.active.paused = true;
        }
        // A clock still in its lead-in starts in the future; the checkpoint stays at the present.
        if (next.active)
          next.active.checkpoint_at = Math.max(clock(), next.active.checkpoint_at,
            leadInRemaining(next.active, clock()) > 0 ? 0 : next.active.active_started_at ?? 0);
        await storage.setItem(key, JSON.stringify(next));
        state = next;
        listeners.forEach((fn) => fn());
      });
    operations = result;
    return result;
  }
  function acceptSaved(s: TrainingState, local: SavedLocalSession, saved: SessionSaveResult) {
    if (saved.unsent_results) {
      local.unsent_results = { ...saved.unsent_results, reason: "Class scores are not available on this server yet." };
      local.request = withoutResults(local.request);
    }
    local.state = "synced";
    local.synced_id = saved.id;
    local.synced_at = clock();
    if (local.recovery_origin && local.recovered_with)
      rememberRecovery(s, local.recovery_origin.request.client_session_id, local.recovered_with, saved.id);
    delete local.rejection_status;
    const warning = historicalStructureWarning(local.workout, local.request.actuals, local.cell_identity_version);
    if (warning) local.problem = warning;
    else if (local.unsent_results) local.problem = unsentProblem;
    else delete local.problem;
  }
  async function run(send: (request: SessionRequest, originalGeneration: number) => Promise<SessionSaveResult>) {
    await operations;
    const queue = state.history.filter((x) => x.state === "queued" && !x.recovery);
    let previousRejection: number | null = null;
    for (const item of queue) {
      try {
        let request = clone(item.request);
        if (item.watch_quick) {
          if (!saveWatchWorkout) throw Object.assign(Error("Wait for the phone to prepare this watch workout."), { local: true });
          let workout: Workout;
          try { workout = await saveWatchWorkout(item.workout, `watch-${request.client_session_id}`, generation); }
          catch (error) {
            throw Object.assign(Error(`Could not create this Open timer workout. Your watch result is still saved on this device. ${error instanceof Error ? error.message : "Retry when available."}`), { preparation: true, status: (error as { status?: number } | null)?.status });
          }
          if (workout.generation !== generation) throw Object.assign(Error("The account changed."), { local: true });
          await update(s => {
            const local = s.history.find(h => h.request.client_session_id === request.client_session_id)!;
            local.workout = workout; local.request.workout_id = workout.id; local.request.workout_revision = workout.revision;
            delete local.watch_quick; request = clone(local.request); return s;
          });
        }
        const saved = await send(request, item.generation);
        if (item.recovered_with && (saved.generation !== item.generation ||
          saved.client_session_id?.toLowerCase() !== item.request.client_session_id.toLowerCase()))
          throw Object.assign(Error("The saved recovery response changed. Retry after refreshing your account."), { local: true });
        previousRejection = null;
        await update((s) => {
          const local = s.history.find((x) => x.request.client_session_id === item.request.client_session_id);
          if (local) {
            acceptSaved(s, local, saved);
          }
          return s;
        });
      } catch (e) {
        const { status, local: stoppedHere, preparation } = e as { status?: number; local?: boolean; preparation?: boolean };
        // Two results rejected the same way in a row look like a service-wide problem,
        // not a problem with each result; keep the rest queued for a later retry.
        const transient = stoppedHere === true || isTransientSyncError(status) || (!preparation && previousRejection === status);
        // A 403 is about the scores only when heart rate went with them (its storage was turned off); otherwise it's the account.
        if (!preparation && !transient && (status === 422 || (status === 403 && item.request.heart_rate != null)) && carriesResults(item.request)) {
          // Never strand a session over its optional scores: save it without them now, and keep them on the
          // device so the person can see them and correct the score later.
          await update((s) => {
            const local = s.history.find((x) => x.request.client_session_id === item.request.client_session_id);
            if (local) {
              local.unsent_results = { reason: e instanceof Error ? e.message : "The scores could not be saved.",
                results: local.request.results, segments: local.request.segments };
              local.request = withoutResults(local.request);
            }
            return s;
          });
          return run(send);
        }
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
        // Quick-workout creation is a different request; only session uploads count toward the streak.
        if (!preparation) previousRejection = status ?? null;
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
      if (d.class_run && (!first || currentPart(d.class_run, d.workout, now).block.id !== first.block_id ||
        currentPart(d.class_run, d.workout, now).status !== "running"))
        throw Error("This part isn’t running. Start it, or wait for its rest to end.");
      // An interval can be marked once it starts (finishing early leaves the rest of it as rest), never before.
      if (d.timed_format && d.timed_format.mode !== "for_time" && first &&
        first.round_index > intervalPosition(d.timed_format, sessionElapsedMilliseconds(d, now)).index)
        throw Error("This interval hasn't started yet.");
      if (!d.timed_circuit) d.undo.push({ actuals: clone(d.actuals), cursor: d.cursor, ...(d.timed_format ? { steps_length: d.steps.length } : {}),
        ...(d.class_run ? { class_run: clone(d.class_run) } : {}) });
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
        const stopClock = () => {
          if (d.active_started_at != null) d.undo.at(-1)!.clock = { active_started_at: d.active_started_at,
            active_milliseconds: d.active_milliseconds, intervals: d.active_intervals?.length ?? 0 };
          closeActive(d, now);
          d.paused = true;
        };
        if (done && d.timed_format.mode === "for_time") {
          // The last movement stops the clock: the finish time is when the work ended, not when Save is tapped.
          stopClock();
        } else if (done && isDeathBy(d.timed_format, d.workout.blocks[0])) {
          // Death by continues while each interval is finished. A missed interval, the ladder's end or the
          // tracking limit ends it and stops the clock.
          const round = step.round_index + 1;
          const next = d.actuals.every((a) => a.round_index !== step.round_index || a.completed) &&
            d.workout.blocks[0].exercises.every((e) => e.ladder && ladderReps(e.ladder, round) != null)
            ? intervalSteps(d.workout, round, round) : [];
          if (next.length) d.steps.push(...next);
          else stopClock();
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
      if (d.class_run && setsDone(d, step.block_id, logged(d))) {
        // The part's last set ends the part; its rest before the next part (if any) takes over from set rest.
        d.class_run = endPart(d.class_run, d.workout, now);
        clearTimers(d);
      }
      syncClass(s, now);
      const entry = d.undo.at(-1);
      if (d.class_run && entry?.class_run) entry.class_after = JSON.stringify(d.class_run);
      return s;
    });
  }
  /** Keeps a class draft's set cursor and run choices in step with its parts. */
  function syncClass(s: TrainingState, now: number) {
    const d = s.active;
    if (!d?.class_run) return;
    fillRunChoices(d.class_run, d.workout, s.run_environment ?? "outdoor");
    alignCursor(d, now, logged(d));
  }
  return {
    importWatch(item: SavedLocalSession) {
      return update(s => {
        const id = item.request.client_session_id.toLowerCase();
        if (item.generation !== generation) throw Error("Watch result belongs to another account generation.");
        if (!s.watch_imported?.includes(id) && !s.history.some(h => h.request.client_session_id.toLowerCase() === id)) s.history.unshift(clone(item));
        s.watch_imported = [...new Set([...(s.watch_imported ?? []), id])];
        return s;
      });
    },
    subscribe(fn: () => void) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    snapshot: () => state,
    /** Countdown for timed starts on this device: 0 (off) to 10 seconds. */
    getLeadIn: () => leadInSeconds,
    setLeadIn(seconds: number) {
      const previous = leadInSeconds;
      leadInSeconds = Number.isFinite(seconds) ? seconds : 0;
      if (previous !== leadInSeconds) listeners.forEach(fn => fn());
    },
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
        state = { ...value, history: pruneHistory(value.history),
          ...(value.watch_imported ? { watch_imported: [...new Set(value.watch_imported)].slice(-500) } : {}) };
        for (const item of state.history) {
          const warning = historicalStructureWarning(item.workout, item.request.actuals, item.cell_identity_version);
          if (warning) item.problem = warning;
        }
        if (state.active && !state.active.paused) {
          const d = state.active;
          const checkpoint = d.checkpoint_at ?? new Date(d.started_at).getTime();
          // A class clock is a wall clock: it ran on while the app was closed. Keep it, and ask.
          // A class's parts keep their own timestamps: a part that capped while closed ended on time.
          if (d.class_run) d.checkpoint_at = checkpoint;
          else if (isWallClock(d)) d.clock_kept_running ??= { left_at: checkpoint };
          else {
            freezeTimers(d, checkpoint);
            closeActive(d, checkpoint);
            d.paused = true;
          }
        }
      }
      loaded = true;
      listeners.forEach((fn) => fn());
    },
    /**
     * `choice` lets a workout without fixed counts start open-ended or with chosen rounds. A timed workout
     * runs on a wall clock, after `lead_in_seconds` of countdown (by default the device's choice).
     */
    start(workout: Workout, source: SessionSource, id: string, now = clock(), choice?: StartChoice,
      options: { lead_in_seconds?: number } = {}) {
      return update((s) => {
        if (s.active) throw Error("Finish or discard your current session before starting another.");
        if (workout.generation !== generation)
          throw Error("This workout belongs to an older account generation. Reload your library.");
        const warning = trackingPrescriptionWarning(workout);
        if (warning && !choice) throw Error(warning);
        if (choice && workout.kind === "program") throw Error("Start a plan session instead of the whole program.");
        if (choice && "rounds" in choice) workout = withChosenRounds(workout, choice.rounds);
        const runsClass = !choice && isClassWorkout(workout);
        const steps = stepsFor(runsClass ? setsOnly(workout) : workout);
        const execution = choice || runsClass ? null : timedCircuit(workout);
        const format = choice || execution || runsClass ? null : timedFormat(workout);
        if (!steps.length && !runsClass) throw Error("Add at least one exercise before training.");
        const lead = execution || format ? Math.max(0, Math.min(10, options.lead_in_seconds ?? leadInSeconds)) * 1000 : 0;
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
          active_started_at: now + lead,
          active_milliseconds: 0,
          active_intervals: [],
          checkpoint_at: now,
          activity_type: null,
          ...(execution || format ? { clock_policy: "wall" as const } : {}),
          ...(lead ? { lead_in_until: now + lead } : {}),
          ...(execution ? { timed_circuit: {
            time_cap_seconds: execution.time_cap_seconds, round_size: steps.length,
          } } : {}),
          ...(format ? { timed_format: clone(format) } : {}),
          ...(choice ? { open_ended: true } : {}),
        };
        if (runsClass) {
          // Each part has its own clock and lead-in; the session clock is not used. A set-by-set first part
          // starts at once, and a timed one waits for Start.
          const d = s.active;
          const leadMs = Math.max(0, Math.min(10, options.lead_in_seconds ?? leadInSeconds)) * 1000;
          d.class_run = planClass(d.workout, leadMs);
          if (!isTimedPart(d.class_run.parts[0].kind)) d.class_run = startPart(d.class_run, d.workout, now);
          d.active_started_at = null;
          delete d.lead_in_until;
          syncClass(s, now);
        }
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
        // In a class, undo reaches only this part's sets, or the set that just ended this part.
        const last = d?.undo.at(-1);
        if (d?.class_run && last && JSON.stringify(d.class_run) !== last.class_after &&
          d.actuals.at(-1)?.block_id !== currentPart(d.class_run, d.workout, clock()).block.id) throw Error("There is no set to undo in this part.");
        const prior = d?.undo.pop();
        if (!d || !prior) throw Error("There is no set to undo.");
        d.actuals = prior.actuals;
        d.cursor = prior.cursor;
        if (d.class_run && prior.class_run && JSON.stringify(d.class_run) === prior.class_after) d.class_run = prior.class_run;
        if (prior.steps_length != null) d.steps.splice(prior.steps_length);
        if (prior.clock && d.paused && d.active_started_at == null) {
          // The undone tick stopped the clock. The work wasn't over, so the clock runs on from where it was,
          // counting the time since then too: the person kept working while the clock showed stopped.
          d.active_started_at = prior.clock.active_started_at;
          d.active_milliseconds = prior.clock.active_milliseconds;
          d.active_intervals?.splice(prior.clock.intervals);
          d.paused = false;
        }
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
    /** Starts the clock now instead of waiting out the lead-in. */
    skipLeadIn(now = clock()) {
      return update((s) => {
        const d = s.active;
        if (d && leadInRemaining(d, now) > 0) d.active_started_at = d.lead_in_until = now;
        return s;
      });
    },
    /**
     * One class runner action (Start, +1 round, buy-in done, rest +15 s, end or skip a part…), applied to the
     * part on screen. `environment` records an Outdoor/Treadmill choice and remembers it for the next run.
     */
    classAct(change: (run: ClassRun, workout: Workout, now: number) => ClassRun, now = clock(), environment?: RunEnvironment) {
      return update((s) => {
        const d = s.active;
        if (!d?.class_run) throw Error("This session isn’t a class.");
        const before = currentPart(d.class_run, d.workout, now).index;
        // A part that started on its own after a rest gets its run choices before this action can pass them by.
        d.class_run = resolve(d.class_run, d.workout, now);
        syncClass(s, now);
        const priorPart = currentPart(d.class_run, d.workout, now).part;
        d.class_run = change(d.class_run, d.workout, now);
        const changedPart = d.class_run.parts.find((p) => p.block_id === priorPart.block_id)!;
        if (changedPart.round_taps.length > priorPart.round_taps.length) {
          const block = d.workout.blocks.find((b) => b.id === priorPart.block_id)!;
          const actuals = roundActuals(block, changedPart.round_taps.length, d.class_loads?.[block.id]);
          if (changedPart.round_taps.length > 100 || d.actuals.length + actuals.length > 1000)
            throw Error("This session reached the tracking limit. Save it before logging more work.");
          d.class_prescribed_loads ??= d.actuals.filter((a) => a.load != null &&
            d.class_run?.parts.some((p) => p.block_id === a.block_id && ["amrap", "for_time"].includes(p.kind)) &&
            !d.class_loads?.[a.block_id]?.[a.exercise_index]).map(actualIdentity);
          d.class_prescribed_loads.push(...actuals.filter((a) => a.load != null &&
            !d.class_loads?.[a.block_id]?.[a.exercise_index]).map(actualIdentity));
          d.actuals.push(...actuals);
        } else if (changedPart.round_taps.length < priorPart.round_taps.length) {
          d.actuals = d.actuals.filter((a) => a.block_id !== priorPart.block_id || a.round_index !== priorPart.round_taps.length);
          d.class_prescribed_loads = d.class_prescribed_loads?.filter((key) => d.actuals.some((a) => actualIdentity(a) === key));
        }
        if (environment) s.run_environment = environment;
        // Set rest and set undo from the part just left don't carry into the next part.
        if (currentPart(d.class_run, d.workout, now).index !== before) { clearTimers(d); d.undo = []; }
        syncClass(s, now);
        return s;
      });
    },
    /** Weight used for subsequent round taps; previous rounds keep their recorded load. */
    classLoad(blockId: string, exerciseIndex: number, load: number | null, load_unit: "kg" | "lb", load_convention?: ActualSet["load_convention"]) {
      return update((s) => {
        const d = s.active;
        if (!d?.class_run || !d.workout.blocks.find((b) => b.id === blockId)?.exercises[exerciseIndex])
          throw Error("This movement isn’t in the class.");
        if (load != null && (!Number.isFinite(load) || load < 0 || load > 2000)) throw Error("Enter a weight from 0 to 2000.");
        d.class_loads ??= {}; d.class_loads[blockId] ??= {};
        const convention = load_convention ?? d.class_loads[blockId][exerciseIndex]?.load_convention;
        d.class_loads[blockId][exerciseIndex] = { load, load_unit, ...(convention ? { load_convention: convention } : {}) };
        return s;
      });
    },
    /** The person's score for a part (null goes back to the clock's score). Timestamps always stay the clock's. */
    classScore(blockId: string, result: PartResult | null) {
      return update((s) => {
        const d = s.active;
        if (!d?.class_run?.parts.some((p) => p.block_id === blockId)) throw Error("This part isn’t in the class.");
        if (result) {
          const clean = cleanScore({ ...result, block_id: blockId });
          const problem = scoreProblem(clean);
          if (problem) throw Error(problem);
          d.class_scores = { ...d.class_scores, [blockId]: clean };
        } else if (d.class_scores) delete d.class_scores[blockId];
        return s;
      });
    },
    /** A treadmill run's distance, edited after the part (an outdoor run's distance comes from GPS). */
    classRunDistance(blockId: string, exerciseIndex: number, meters: number) {
      return update((s) => {
        const part = s.active?.class_run?.parts.find((p) => p.block_id === blockId);
        const choice = part?.runs?.[exerciseIndex];
        if (!part || choice?.environment !== "treadmill") throw Error("Only a treadmill run’s distance can be edited.");
        if (!(meters >= 0 && meters <= 100000)) throw Error("Enter a distance from 0 to 100 km.");
        part.runs = { ...part.runs, [exerciseIndex]: { environment: "treadmill", distance_meters: meters } };
        return s;
      });
    },
    /** After a relaunch: the clock was right ("Keep"), or the person stopped at `at`, between leaving and now. */
    confirmKeptClock(stoppedAt?: number, now = clock()) {
      return update((s) => {
        const d = s.active;
        if (!d?.clock_kept_running) return s;
        if (stoppedAt != null) stopAt(d, Math.min(now, Math.max(stoppedAt, d.clock_kept_running.left_at)));
        delete d.clock_kept_running;
        return s;
      });
    },
    pause(paused: boolean, now = clock()) {
      return update((s) => {
        const d = s.active;
        if (d && paused && !d.paused && leadInRemaining(d, now) > 0) {
          // Pausing during the countdown cancels it; Resume starts the clock straight away.
          d.active_started_at = d.lead_in_until = null;
          d.checkpoint_at = now;
          d.paused = true;
        } else if (d && d.paused !== paused) {
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
        const template = block.filter((x) => x.round_index === latest && !x.exercise.segment && (x.grouping !== "sequential" || x.set_index === 1));
        if (round > 100 || d.steps.length + template.length > 1000) throw Error("This session has reached its round limit.");
        const added = template.map((first): TrainingStep => {
          const step = { ...clone(first), round_index: round };
          return { ...step, key: actualIdentity(step) };
        });
        // The cursor is inside or just past this block, so the new round never lands before it.
        let insertion = d.steps.length;
        while (insertion > 0 && d.steps[insertion - 1].block_id !== current.block_id) insertion--;
        // A cash-out comes after the last round, so the new round goes in before it.
        while (insertion > d.cursor && d.steps[insertion - 1].exercise.segment === "cash_out") insertion--;
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
        if (d.class_run) {
          // The part on screen ends now; a part that already ended keeps its own end.
          d.class_run = resolve(d.class_run, d.workout, now);
          syncClass(s, now);
          d.class_run = endPart(d.class_run, d.workout, now);
          if (!d.class_run.parts.some((p) => p.started_at != null && p.started_at <= now))
            throw Error("Start a part, or discard the session.");
          if (status === "completed" && (!classOver(d.class_run, d.workout, now) || d.class_run.ended_early || d.class_run.parts.some((p) => p.skipped) ||
            !d.steps.every(logged(d)) || d.actuals.some((a) => !a.completed)))
            throw Error("Some parts or sets were skipped or not finished. Save this as a partial session.");
        } else if (status === "completed") {
          // Death by ends at the first missed interval, so only that final interval may be unfinished.
          const failureEnds = !!d.timed_format && isDeathBy(d.timed_format, d.workout.blocks[0]);
          const lastRound = Math.max(0, ...d.actuals.map((a) => a.round_index));
          if (d.timed_circuit) {
            if (capRemainingSeconds(d, now)! > 0 || d.timed_circuit.limit_reached || !d.actuals.some((a) => a.completed))
              throw Error("Reach the source time cap with recorded work, or save this as a partial session.");
          } else if (d.cursor !== d.steps.length)
            // Death by adds the next interval after each finished one, so it is over only once one is missed
            // (or the ladder or tracking limit ends it).
            throw Error(failureEnds ? "Death by ends when you miss an interval. Keep going, or save this as a partial session."
              : d.timed_format ? "Mark every interval or round first, or save this as a partial session."
              : "Some sets were not completed. Save this as a partial session.");
          if (d.actuals.some((a) => !a.completed && !(failureEnds && a.round_index === lastRound)))
            throw Error("Skipped work stays partial. Save this as a partial session.");
        }
        const activity_type = d.activity_type ?? activityFallback;
        if (!activity_type) throw Error("Choose the activity type before saving.");
        if (!d.actuals.length && !d.class_run) throw Error("Log at least one set, or discard the session.");
        now = Math.max(now, d.checkpoint_at);
        closeActive(d, now);
        const classTime = d.class_run ? classActive(d.class_run, d.workout, now) : null;
        const scores = d.class_run ? classPayload(d.class_run, d.workout, now, d.actuals, d.class_scores) : null;
        if (classTime) { d.active_intervals = classTime.intervals; d.active_milliseconds = classTime.seconds * 1000; }
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
          actuals: clone(d.actuals).map((a) => {
            const scaled = scores?.results.some((r) => r.block_id === a.block_id && r.scaling === "scaled");
            const inferred = d.class_prescribed_loads ? d.class_prescribed_loads.includes(actualIdentity(a)) :
              d.class_run?.parts.some((p) => p.block_id === a.block_id && ["amrap", "for_time"].includes(p.kind)) &&
                !d.class_loads?.[a.block_id]?.[a.exercise_index];
            if (scaled && inferred) {
              delete a.load; delete a.load_unit; delete a.load_convention;
            }
            return a;
          }),
          notes: d.notes || null,
          ...(scores?.results.length ? { results: scores.results } : {}),
          ...(scores?.segments.length ? { segments: scores.segments } : {}),
          ...(scores ? { recorded_on: "phone" as const } : {}),
        };
        const warning = historicalStructureWarning(d.workout, request.actuals, d.cell_identity_version);
        s.history.unshift({ request, workout: d.workout, generation: d.generation, state: "queued",
          ...(d.cell_identity_version ? { cell_identity_version: d.cell_identity_version } : {}),
          ...(d.timed_format ? { timed_format: true as const } : {}),
          ...(warning ? { problem: warning } : {}) });
        s.active = null;
        return s;
      });
    },
    sync(send: (request: SessionRequest, originalGeneration: number) => Promise<SessionSaveResult>) {
      // Concurrent callers wait for the same pass, so follow-up work sees its result.
      syncing ??= exclusive(() => run(send)).finally(() => {
        syncing = null;
      });
      return syncing;
    },
    recoverResult(
      id: string, command: ResultRecoveryCommand,
      saveWorkout: (workout: AuthoredWorkout, key: string, generation: number) => Promise<Workout>,
      send: (request: SessionRequest, generation: number) => Promise<SessionSaveResult>,
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
                acceptSaved(s, item, saved);
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
              ...(item.watch ? { watch: clone(item.watch) } : {}),
              ...(item.timed_format ? { timed_format: true as const } : {}),
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
    correct(saved: TrainingSession, actuals: ActualSet[], notes: string, id: string, results?: PartResult[], segments?: Segment[]) {
      return update((s) => {
        if (saved.generation !== generation) throw Error("This result belongs to an older account generation.");
        const errors = actuals.flatMap(actualErrors);
        if (errors.length) throw Error(errors.join(" "));
        // Only fields the server accepts go back: it adds others (such as results_summary) to what it stores.
        const prior = Object.fromEntries(Object.entries(saved.content).filter(([key]) => requestFields.has(key))) as unknown as SessionRequest;
        const problems = (results ?? []).map((r) => scoreProblem(cleanScore(r))).filter(Boolean);
        if (problems.length) throw Error(problems[0]!);
        const request: SessionRequest = {
          ...prior,
          ...(results ? { results: results.map(cleanScore) } : {}),
          ...(segments ? { segments: clone(segments) } : {}),
          client_session_id: id,
          actuals: clone(actuals),
          // A correction can remove completed work; editing recorded cells cannot
          // prove that unrecorded work from a partial session was performed.
          status: prior.status === "completed" && actuals.every((actual) => actual.completed) &&
            (actuals.length > 0 || (prior.actuals.length === 0 && !!(results ?? prior.results)?.length))
            ? "completed" : "partial",
          notes,
          supersedes_session_id: saved.id,
        };
        s.history.unshift({ request, workout: saved.content.prescription_snapshot, generation, state: "queued",
          ...(s.history.find(h => h.synced_id === saved.id)?.watch ? { watch: clone(s.history.find(h => h.synced_id === saved.id)!.watch!) } : {}),
          // A corrected result was still recorded on the clock the original ran on.
          ...(ranFormatTimer(s.history, saved.content.client_session_id) ? { timed_format: true as const } : {}) });
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
export const unsentProblem = "Session saved, but its class scores weren’t accepted. Open the session and correct the scores to save them again.";
const requestFields = new Set(["client_session_id", "workout_id", "workout_revision", "program_id", "program_revision", "program_session_id",
  "started_at", "finished_at", "status", "active_seconds", "active_intervals", "activity_type", "actuals", "notes",
  "results", "segments", "heart_rate", "recorded_on", "apple_workout_uuid"]);
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
