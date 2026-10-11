import type { ActualSet, Workout, SessionRequest, TrainingSession, ExercisePrescription } from "./models";
import type { Storage } from "./drafts";
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
  paused: boolean;
  notes: string;
  input?: Record<string, string>;
  active_started_at: number | null;
  active_milliseconds: number;
  active_intervals?: Array<{ started_at: string; ended_at: string }>;
  checkpoint_at: number;
  activity_type: string | null;
  undo: Array<{ actuals: ActualSet[]; cursor: number }>;
}
export interface SavedLocalSession {
  cell_identity_version?: 2;
  request: SessionRequest;
  workout: Workout;
  generation: number;
  synced_id?: string;
  problem?: string;
  state: "queued" | "synced" | "blocked";
}
export interface TrainingState {
  version: 1;
  generation: number;
  active: SessionDraft | null;
  history: SavedLocalSession[];
}
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
export function trainingKey(owner: string, generation: number) {
  if (!owner || generation < 1) throw Error("A training draft needs an enrolled account generation.");
  return `hafa-workouts:training:v1:${encodeURIComponent(owner)}:${generation}`;
}
export function stepsFor(workout: Workout): TrainingStep[] {
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
    return (actual.round_index ?? 1) > (block.rounds ?? 1) || actual.set_index > (exercise.sets ?? 1) ||
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
function closeActive(d: SessionDraft, now: number) {
  if (d.active_started_at == null) return;
  const end = Math.max(d.active_started_at, now);
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
  let syncing = false;
  const listeners = new Set<() => void>();
  const key = trainingKey(owner, generation);
  function update(work: (previous: TrainingState) => TrainingState) {
    const result = operations
      .catch(() => undefined)
      .then(async () => {
        if (!loaded) throw Error("Wait for your saved training to load.");
        const next = work(clone(state));
        if (next.active)
          next.active.checkpoint_at = Math.max(clock(), next.active.checkpoint_at, next.active.active_started_at ?? 0);
        await storage.setItem(key, JSON.stringify(next));
        state = next;
        listeners.forEach((fn) => fn());
      });
    operations = result;
    return result;
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
        state = value;
        for (const item of state.history) {
          const warning = historicalStructureWarning(item.workout, item.request.actuals, item.cell_identity_version);
          if (warning) item.problem = warning;
        }
        if (state.active && !state.active.paused) {
          const d = state.active;
          closeActive(d, d.checkpoint_at ?? new Date(d.started_at).getTime());
          d.paused = true;
          d.interval_started_at = null;
        }
      }
      loaded = true;
      listeners.forEach((fn) => fn());
    },
    start(workout: Workout, source: SessionSource, id: string, now = clock()) {
      return update((s) => {
        if (s.active) throw Error("Finish or discard your current session before starting another.");
        if (workout.generation !== generation)
          throw Error("This workout belongs to an older account generation. Reload your library.");
        const steps = stepsFor(workout);
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
        };
        return s;
      });
    },
    log(actual: ActualSet, now = clock()) {
      return update((s) => {
        const d = s.active;
        if (!d) throw Error("No session is active.");
        const warning = draftStructureWarning(d);
        if (warning) throw Error(warning);
        const step = d.steps[d.cursor];
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
        d.undo.push({ actuals: clone(d.actuals), cursor: d.cursor });
        d.actuals.push(clone(actual));
        d.cursor++;
        d.input = {};
        d.interval_started_at = null;
        const next = d.steps[d.cursor];
        const betweenRounds = next?.block_id === step.block_id && next.round_index !== step.round_index;
        const block = d.workout.blocks.find((b) => b.id === step.block_id);
        const rest = betweenRounds
          ? (block?.rest_between_rounds_seconds ?? step.exercise.rest_seconds)
          : step.exercise.rest_seconds;
        d.rest_until = actual.completed && rest ? now + rest * 1000 : null;
        return s;
      });
    },
    undo() {
      return update((s) => {
        const d = s.active;
        const prior = d?.undo.pop();
        if (!d || !prior) throw Error("There is no set to undo.");
        d.actuals = prior.actuals;
        d.cursor = prior.cursor;
        d.rest_until = null;
        d.interval_started_at = null;
        return s;
      });
    },
    timer(kind: "rest" | "interval", seconds = 60, now = clock()) {
      return update((s) => {
        if (!s.active) throw Error("No session is active.");
        if (kind === "rest") s.active.rest_until = seconds > 0 ? now + seconds * 1000 : null;
        else s.active.interval_started_at = seconds === 0 ? null : now;
        return s;
      });
    },
    pause(paused: boolean, now = clock()) {
      return update((s) => {
        if (s.active) {
          now = Math.max(now, s.active.checkpoint_at);
          if (paused && s.active.active_started_at != null) {
            closeActive(s.active, now);
          }
          if (!paused && s.active.paused) s.active.active_started_at = now;
          s.active.paused = paused;
          s.active.rest_until = null;
          s.active.interval_started_at = null;
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
        d.rest_until = null;
        d.interval_started_at = null;
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
    discard() {
      return update((s) => {
        s.active = null;
        return s;
      });
    },
    finish(status: "completed" | "partial", now = clock()) {
      return update((s) => {
        const d = s.active;
        if (!d) throw Error("No session is active.");
        if (status === "completed" && draftStructureWarning(d)) throw Error("Older set numbering needs review. Keep this result as a partial session.");
        if (status === "completed" && (d.cursor !== d.steps.length || d.actuals.some((a) => !a.completed)))
          throw Error("Some sets were not completed. Save this as a partial session.");
        if (!d.activity_type) throw Error("Choose the activity type before saving.");
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
          activity_type: d.activity_type,
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
    async sync(send: (request: SessionRequest, originalGeneration: number) => Promise<TrainingSession>) {
      if (syncing) return;
      syncing = true;
      try {
        await operations;
        const queue = state.history.filter((x) => x.state === "queued");
        for (const item of queue) {
          try {
            const saved = await send(clone(item.request), item.generation);
            await update((s) => {
              const local = s.history.find((x) => x.request.client_session_id === item.request.client_session_id);
              if (local) {
                local.state = "synced";
                local.synced_id = saved.id;
                const warning = historicalStructureWarning(local.workout, local.request.actuals, local.cell_identity_version);
                if (warning) local.problem = warning;
                else delete local.problem;
              }
              return s;
            });
          } catch (e) {
            const status = (e as { status?: number }).status;
            await update((s) => {
              const local = s.history.find((x) => x.request.client_session_id === item.request.client_session_id);
              if (local) {
                local.problem = e instanceof Error ? e.message : "Could not sync";
                if (status === 403 || status === 409 || status === 422) local.state = "blocked";
              }
              return s;
            });
            break;
          }
        }
      } finally {
        syncing = false;
      }
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
          notes,
          supersedes_session_id: saved.id,
        };
        s.history.unshift({ request, workout: saved.content.prescription_snapshot, generation, state: "queued" });
        return s;
      });
    },
    retry(id: string) {
      return update((s) => {
        const item = s.history.find((x) => x.request.client_session_id === id);
        if (item && item.state !== "synced") {
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
      if (!actual.completed || actual.side !== step.side) return false;
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
