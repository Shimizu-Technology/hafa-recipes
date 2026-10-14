import { describe, it, expect, vi } from "vitest";
import {
  createTrainingStore,
  stepsFor,
  trackingPrescriptionWarning,
  remainingSeconds,
  canonicalLoad,
  displayLoad,
  canonicalHeight,
  displayHeight,
  historicalStructureWarning,
  type TrainingStore,
  actualIdentity,
  trainingKey,
} from "./training";
import type { Workout, ActualSet, TrainingSession } from "./models";
import { timedCircuit, circuitRemaining, completedCircuitRounds } from "./timed-circuit";
import { selectProgressSessions } from "./progress-selection";
function fixture(): Workout {
  return {
    id: "workout",
    revision: 3,
    generation: 1,
    title: "Unilateral strength",
    kind: "session",
    provenance: "user",
    blocks: [
      {
        id: "main",
        label: "Strength",
        grouping: "superset",
        rounds: 2,
        exercises: [
          {
            name: "Split squat",
            sets: 1,
            reps_min: 8,
            reps_max: 10,
            per_side: true,
            rest_seconds: 30,
            load: 10,
            load_unit: "lb",
            load_convention: "per_hand",
          },
          { name: "Row", sets: 1, reps_min: 8, reps_max: 10 },
        ],
      },
    ],
  };
}
function memory() {
  const data = new Map<string, string>();
  return {
    data,
    async getItem(key: string) {
      return data.get(key) ?? null;
    },
    async setItem(key: string, value: string) {
      data.set(key, value);
    },
    async removeItem(key: string) {
      data.delete(key);
    },
  };
}
function next(store: TrainingStore): ActualSet {
  const d = store.snapshot().active!;
  const s = d.steps[d.cursor];
  return {
    block_id: s.block_id,
    exercise_index: s.exercise_index,
    set_index: s.set_index,
    round_index: s.round_index,
    side: s.side,
    reps: 9,
    completed: true,
  };
}
describe("durable actual training", () => {
  it("orders supersets by round and preserves sides and source load units", () => {
    const w = fixture();
    const steps = stepsFor(w);
    expect(steps.map((s) => [s.exercise.name, s.round_index, s.side])).toEqual([
      ["Split squat", 1, "left"],
      ["Split squat", 1, "right"],
      ["Row", 1, null],
      ["Split squat", 2, "left"],
      ["Split squat", 2, "right"],
      ["Row", 2, null],
    ]);
    expect(steps[0].exercise.load_unit).toBe("lb");
    expect(w.blocks[0].exercises[0].sets).toBe(1);
  });
  it("saves actuals before acknowledgment, restores paused inputs, and undoes the last record", async () => {
    const storage = memory();
    let time = 10000;
    const store = createTrainingStore(storage, "owner", 1, () => time);
    await store.load();
    await store.start(fixture(), { workout_id: "workout", workout_revision: 3 }, "client");
    time = 11000;
    await store.input({ reps: "9" });
    await store.log(next(store));
    await store.input({ reps: "11" });
    const restarted = createTrainingStore(storage, "owner", 1, () => time + 60000);
    await restarted.load();
    expect(restarted.snapshot().active?.paused).toBe(true);
    expect(restarted.snapshot().active?.input?.reps).toBe("11");
    expect(restarted.snapshot().active?.actuals).toHaveLength(1);
    await restarted.undo();
    expect(restarted.snapshot().active?.actuals).toHaveLength(0);
    expect(restarted.snapshot().active?.cursor).toBe(0);
  });
  it("never marks a set complete from a timer and rejects empty actual completion", async () => {
    let time = 10000;
    const store = createTrainingStore(memory(), "owner", 1, () => time);
    await store.load();
    await store.start(fixture(), { workout_id: "workout", workout_revision: 3 }, "client");
    await store.timer("rest", 30);
    time = 90000;
    expect(remainingSeconds(40000, time)).toBe(0);
    expect(store.snapshot().active?.actuals).toHaveLength(0);
    await expect(store.log({ ...next(store), reps: null })).rejects.toThrow("Record actual");
  });
  it("finishes partial work into an atomic queue, excludes pauses, and preserves request identity on retry", async () => {
    let time = 10000;
    const storage = memory();
    const store = createTrainingStore(storage, "owner", 1, () => time);
    await store.load();
    await store.start(fixture(), { workout_id: "workout", workout_revision: 3 }, "same-client");
    await store.activityType("strength_training");
    time = 12000;
    await store.log(next(store));
    await store.pause(true);
    time = 20000;
    await store.pause(false);
    time = 23000;
    await store.finish("partial");
    const local = store.snapshot().history[0];
    expect(local.request.active_seconds).toBe(5);
    expect(local.request.active_intervals).toEqual([
      { started_at: new Date(10000).toISOString(), ended_at: new Date(12000).toISOString() },
      { started_at: new Date(20000).toISOString(), ended_at: new Date(23000).toISOString() },
    ]);
    expect(local.request.actuals).toHaveLength(1);
    expect(store.snapshot().active).toBeNull();
    expect(JSON.parse([...storage.data.values()][0]).history).toHaveLength(1);
    const send = vi.fn().mockRejectedValueOnce(Error("offline")).mockResolvedValue({ id: "cloud" });
    await store.sync(send);
    await store.sync(send);
    expect(send.mock.calls[0][0]).toEqual(send.mock.calls[1][0]);
    expect(send.mock.calls[0][0].client_session_id).toBe("same-client");
    expect(send.mock.calls[0][1]).toBe(1);
    expect(store.snapshot().history[0].state).toBe("synced");
  });
  it("blocks membership conflicts without replaying into a newer generation", async () => {
    const store = createTrainingStore(memory(), "owner", 1);
    await store.load();
    await store.start(fixture(), { workout_id: "workout", workout_revision: 3 }, "client");
    await store.activityType("general_fitness");
    await store.log(next(store));
    await store.finish("partial");
    const error = Object.assign(Error("deleted"), { status: 409 });
    const send = vi.fn().mockRejectedValue(error);
    await store.sync(send);
    await store.sync(send);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][1]).toBe(1);
    expect(store.snapshot().history[0].state).toBe("blocked");
  });
  it("refuses stale-generation sources and completed status while unlogged steps remain", async () => {
    const store = createTrainingStore(memory(), "owner", 2);
    await store.load();
    await expect(store.start(fixture(), { workout_id: "workout", workout_revision: 3 }, "client")).rejects.toThrow(
      "older account"
    );
    const fresh = createTrainingStore(memory(), "owner", 1);
    await fresh.load();
    await fresh.start(fixture(), { workout_id: "workout", workout_revision: 3 }, "client");
    await fresh.activityType("general_fitness");
    await fresh.log(next(fresh));
    await expect(fresh.finish("completed")).rejects.toThrow("partial");
  });
  it("does not change memory when local persistence fails", async () => {
    const storage = memory();
    const store = createTrainingStore(
      { ...storage, setItem: vi.fn().mockRejectedValue(Error("disk full")) },
      "owner",
      1
    );
    await store.load();
    await expect(store.start(fixture(), { workout_id: "workout", workout_revision: 3 }, "client")).rejects.toThrow(
      "disk full"
    );
    expect(store.snapshot().active).toBeNull();
  });
  it("creates a correction with a new identity while retaining the historical prescription reference", async () => {
    const store = createTrainingStore(memory(), "owner", 1);
    await store.load();
    const original = {
      id: "cloud-id",
      generation: 1,
      client_session_id: "old-client",
      title: "Older workout",
      started_at: "2026-10-10T00:00:00Z",
      status: "partial",
      content: {
        client_session_id: "old-client",
        workout_id: "workout",
        workout_revision: 2,
        started_at: "2026-10-10T00:00:00Z",
        finished_at: "2026-10-10T00:10:00Z",
        status: "partial",
        actuals: [],
        prescription_snapshot: fixture(),
      },
    } as TrainingSession;
    await store.correct(original, [], "Corrected note", "new-client");
    const request = store.snapshot().history[0].request;
    expect(request.client_session_id).toBe("new-client");
    expect(request.supersedes_session_id).toBe("cloud-id");
    expect(request.workout_revision).toBe(2);
    expect(request.status).toBe("partial");
    expect("prescription_snapshot" in request).toBe(false);
  });
  it("keeps imperial profile display reversible without modifying prescription values", () => {
    expect(canonicalLoad(displayLoad(72, "imperial"), "imperial")).toBeCloseTo(72, 10);
    expect(canonicalHeight(displayHeight(175, "imperial"), "imperial")).toBeCloseTo(175, 10);
    const w = fixture();
    expect(w.blocks[0].exercises[0].load).toBe(10);
    expect(w.blocks[0].exercises[0].load_unit).toBe("lb");
  });
});

it("crash recovery preserves last checkpoint timing and never counts the process downtime", async () => {
  const storage = memory();
  let now = 10000;
  const first = createTrainingStore(storage, "owner", 1, () => now);
  await first.load();
  await first.start(fixture(), { workout_id: "workout", workout_revision: 3 }, "session");
  await first.activityType("strength_training");
  now = 12000;
  await first.log(next(first));
  now = 100000;
  const recovered = createTrainingStore(storage, "owner", 1, () => now);
  await recovered.load();
  await recovered.finish("partial");
  expect(recovered.snapshot().history[0].request.active_intervals).toEqual([
    { started_at: new Date(10000).toISOString(), ended_at: new Date(12000).toISOString() },
  ]);
  expect(recovered.snapshot().history[0].request.active_seconds).toBe(2);
});

describe("sync queue and local history size", () => {
  async function queued(store: TrainingStore, id: string) {
    await store.start(fixture(), { workout_id: "workout", workout_revision: 3 }, id);
    await store.activityType("strength_training");
    await store.log(next(store));
    await store.finish("partial");
  }
  function failure(status: number) {
    return Object.assign(Error(`status ${status}`), { status });
  }
  it("marks a permanently rejected result for attention and keeps syncing the rest", async () => {
    const store = createTrainingStore(memory(), "owner", 1);
    await store.load();
    await queued(store, "older");
    await queued(store, "deleted-source");
    await queued(store, "newer");
    const send = vi.fn(async (request: { client_session_id: string }) => {
      if (request.client_session_id === "deleted-source") throw failure(404);
      return { id: `cloud-${request.client_session_id}` } as TrainingSession;
    });
    await store.sync(send);
    expect(send).toHaveBeenCalledTimes(3);
    const byId = (id: string) => store.snapshot().history.find((h) => h.request.client_session_id === id)!;
    expect(byId("older").state).toBe("synced");
    expect(byId("newer").state).toBe("synced");
    expect(byId("deleted-source").state).toBe("blocked");
    expect(byId("deleted-source").problem).toContain("may have been deleted");
    await expect(store.dismiss("older")).rejects.toThrow("Only results that need attention");
    await store.dismiss("deleted-source");
    expect(store.snapshot().history.map((h) => h.request.client_session_id)).toEqual(["newer", "older"]);
  });
  it("keeps results queued when two in a row are rejected the same way or the request stopped on this device", async () => {
    const store = createTrainingStore(memory(), "owner", 1);
    await store.load();
    await queued(store, "first");
    await queued(store, "second");
    await queued(store, "third");
    const outage = vi.fn().mockRejectedValue(failure(404));
    await store.sync(outage);
    expect(outage).toHaveBeenCalledTimes(2);
    expect(store.snapshot().history.map((h) => h.state)).toEqual(["blocked", "queued", "queued"]);
    expect(store.snapshot().history[0].problem).toContain("may have been deleted");
    await store.retry("third");
    const switched = vi.fn().mockRejectedValue(Object.assign(failure(409), { local: true }));
    await store.sync(switched);
    expect(switched).toHaveBeenCalledTimes(1);
    expect(store.snapshot().history.map((h) => h.state)).toEqual(["queued", "queued", "queued"]);
  });
  it("concurrent sync callers wait for the same pass", async () => {
    const store = createTrainingStore(memory(), "owner", 1);
    await store.load();
    await queued(store, "only");
    let release!: () => void;
    const send = vi.fn(() => new Promise<TrainingSession>((done) => { release = () => done({ id: "cloud" } as TrainingSession); }));
    const first = store.sync(send);
    const second = store.sync(send);
    await Promise.resolve(); await Promise.resolve();
    release();
    await second;
    expect(store.snapshot().history[0].state).toBe("synced");
    await first;
    expect(send).toHaveBeenCalledTimes(1);
  });
  it.each([0, 401, 408, 429, 500, 503])("stops on retryable status %i and keeps every result queued", async (status) => {
    const store = createTrainingStore(memory(), "owner", 1);
    await store.load();
    await queued(store, "first");
    await queued(store, "second");
    const send = vi.fn().mockRejectedValue(failure(status));
    await store.sync(send);
    expect(send).toHaveBeenCalledTimes(1);
    expect(store.snapshot().history.map((h) => h.state)).toEqual(["queued", "queued"]);
    expect(store.snapshot().history[0].problem).toBe(`status ${status}`);
  });
  it("keeps only recent synced history on load and on every save, never queued or blocked work", async () => {
    const storage = memory();
    const item = (id: string, state: "queued" | "synced" | "blocked") => ({
      generation: 1, workout: fixture(), state, cell_identity_version: 2 as const,
      request: { client_session_id: id, workout_id: "workout", workout_revision: 3, started_at: "2026-10-10T00:00:00Z",
        finished_at: "2026-10-10T00:10:00Z", status: "partial" as const, actuals: [] },
      ...(state === "synced" ? { synced_id: `cloud-${id}` } : {}),
    });
    const history = [
      item("queued", "queued"),
      ...Array.from({ length: 30 }, (_, i) => item(`synced-${i}`, "synced")),
      item("blocked", "blocked"),
    ];
    storage.data.set("hafa-workouts:training:v1:owner:1", JSON.stringify({ version: 1, generation: 1, active: null, history }));
    const store = createTrainingStore(storage, "owner", 1);
    await store.load();
    const ids = store.snapshot().history.map((h) => h.request.client_session_id);
    expect(ids).toHaveLength(22);
    expect(ids).toContain("queued");
    expect(ids).toContain("blocked");
    expect(ids).toContain("synced-19");
    expect(ids).not.toContain("synced-20");
    await store.notes("");
    expect(JSON.parse(storage.data.get("hafa-workouts:training:v1:owner:1")!).history).toHaveLength(22);
  });
});


describe("source circuits with open-ended rounds", () => {
  it("keeps a 20-minute source flow out of the one-pass session default", async () => {
    const workout = fixture();
    workout.provenance = "source";
    workout.estimated_minutes = 20;
    workout.notes = ["Repeat this flow for 20 minutes; rest 2–3 minutes between rounds."];
    workout.blocks[0].rounds = null;
    workout.blocks[0].exercises.forEach(item => { item.sets = null; });
    const storage = memory();
    const store = createTrainingStore(storage, "source-qa", 1);
    await store.load();
    expect(trackingPrescriptionWarning(workout)).toMatch(/edit the tracking prescription/);
    await expect(store.start(workout, { workout_id: workout.id, workout_revision: workout.revision }, "blocked"))
      .rejects.toThrow(/fixed sets or rounds/);
    expect(store.snapshot().active).toBeNull();
    expect(workout.notes[0]).toContain("20 minutes");
    workout.blocks[0].rounds = 3; // Explicitly confirmed adaptation, not an extracted guess.
    expect(trackingPrescriptionWarning(workout)).toBeNull();
    await store.start(workout, { workout_id: workout.id, workout_revision: workout.revision }, "confirmed");
    expect(store.snapshot().active?.steps).toHaveLength(9);
  });
  it("allows a timed warmup followed by an explicitly counted manual circuit", async () => {
    const workout = fixture();
    workout.estimated_minutes = 20;
    workout.blocks = [
      { id: "warmup", label: "Warmup", grouping: "sequential", exercises: [{ name: "Walking", duration_seconds: 180 }] },
      { id: "main", label: "Circuit", grouping: "circuit", rounds: 3, exercises: [{ name: "Squat", reps_min: 10 }] }
    ];
    expect(trackingPrescriptionWarning(workout)).toBeNull();
    const store = createTrainingStore(memory(), "mixed-block-qa", 1);
    await store.load();
    await store.start(workout, { workout_id: workout.id, workout_revision: workout.revision }, "mixed");
    expect(store.snapshot().active?.steps).toHaveLength(4);
  });
});


function amrap(exercises = 9, cap = 1200): Workout {
  return { id: "amrap", revision: 1, generation: 1, title: "Full-body kettlebell circuit", kind: "session", provenance: "source",
    blocks: [{ id: "circuit", label: "Circuit", grouping: "circuit", execution: { mode: "amrap", time_cap_seconds: cap },
      exercises: Array.from({ length: exercises }, (_, index) => ({ name: `Movement ${index + 1}`, reps_min: 10, per_side: index === 0 })) }] };
}
async function timedStore(workout = amrap()) {
  let time = 10000;
  const storage = memory(), store = createTrainingStore(storage, "owner", 1, () => time);
  await store.load(); await store.start(workout, { workout_id: workout.id, workout_revision: 1 }, "timed-client");
  await store.activityType("strength_training");
  return { store, storage, setTime(value: number) { time = value; }, time: () => time };
}
it("typed AMRAP execution needs no caption parsing, duration estimate or inferred fixed rounds", () => {
  for (const provenance of ["source", "user", "suggestion"] as const) {
    const workout = { ...amrap(), provenance, notes: ["Arbitrary creator wording"] };
    expect(timedCircuit(workout)?.time_cap_seconds).toBe(1200);
    expect(workout.blocks[0].rounds).toBeUndefined();
    expect(workout.blocks[0].exercises.every((exercise) => exercise.sets == null)).toBe(true);
  }
  const ambiguous = amrap(); ambiguous.blocks.push({ ...ambiguous.blocks[0], id: "second" });
  expect(timedCircuit(ambiguous)).toBeNull();
});
it.each(["AMRAP for 20 minutes", "Repeat this circuit for 20 minutes", "As many rounds as possible for 20 minutes"])(
  "recovers an explicit legacy source circuit: %s", (notes) => {
    const workout = amrap(); delete workout.blocks[0].execution;
    workout.notes = [notes]; workout.estimated_minutes = 20;
    expect(timedCircuit(workout)?.time_cap_seconds).toBe(1200);
  });
it.each(["20 minute full-body workout", "Not an AMRAP for 20 minutes", "Don't use AMRAP for 20 minutes", "AMRAP is not used for 20 minutes",
  "EMOM for 20 minutes", "Repeat the circuit for 10 minutes then 20 minutes", "AMRAP without a time cap"])(
  "never guesses timed execution from ambiguous or negated legacy instructions: %s", (notes) => {
    const workout = amrap(); delete workout.blocks[0].execution;
    workout.notes = [notes]; workout.estimated_minutes = 20;
    expect(timedCircuit(workout)).toBeNull();
  });
it("logs nine exercises as repeatable rounds, preserves sides, undoes without duplicating cells, and never changes source", async () => {
  const workout = amrap(), before = JSON.stringify(workout);
  const { store } = await timedStore(workout);
  for (let cell = 0; cell < 10; cell++) await store.log(next(store));
  expect(store.snapshot().active!.steps).toHaveLength(20);
  expect(store.snapshot().active!.steps[10].round_index).toBe(2);
  expect(completedCircuitRounds(store.snapshot().active!.actuals, 10)).toBe(1);
  await store.undo(); expect(store.snapshot().active!.cursor).toBe(9);
  await store.log(next(store)); expect(store.snapshot().active!.steps).toHaveLength(20);
  for (let cell = 0; cell < 10; cell++) await store.log(next(store));
  const draft = store.snapshot().active!;
  expect(new Set(draft.actuals.map((actual) => JSON.stringify([actual.round_index, actual.exercise_index, actual.side]))).size).toBe(20);
  expect(completedCircuitRounds(draft.actuals, 10)).toBe(2);
  expect(historicalStructureWarning(workout, draft.actuals)).toBeNull();
  expect(draft.undo).toEqual([]); // Repeatable cells do not retain growing copies of prior actuals.
  expect(JSON.stringify(workout)).toBe(before);
  await expect(store.addSet()).rejects.toThrow("repeats whole rounds");
  await expect(store.finish("completed")).rejects.toThrow("Reach the source time cap");
});
it("pauses background time, restores at the durable checkpoint, and resumes the remaining cap", async () => {
  const { store, storage, setTime, time } = await timedStore();
  setTime(12000); await store.log(next(store));
  setTime(15000); await store.pause(true);
  setTime(70000); expect(circuitRemaining(store.snapshot().active!, time())).toBe(1195);
  await expect(store.log(next(store))).rejects.toThrow("Resume the circuit");
  await store.pause(false);
  setTime(90000); await store.checkpoint();
  setTime(180000);
  const restored = createTrainingStore(storage, "owner", 1, time); await restored.load();
  expect(restored.snapshot().active!.paused).toBe(true);
  expect(circuitRemaining(restored.snapshot().active!, time())).toBe(1175);
  await restored.pause(false);
  setTime(190000); expect(circuitRemaining(restored.snapshot().active!, time())).toBe(1165);
});
it("time-cap expiry stops the timer but saves nothing until explicit completion with recorded work", async () => {
  const { store, setTime } = await timedStore();
  await store.log(next(store));
  setTime(1220000); await store.checkpoint(); // Twenty minutes plus ten seconds after the start.
  const draft = store.snapshot().active!;
  expect(circuitRemaining(draft)).toBe(0); expect(draft.paused).toBe(true);
  expect(draft.active_milliseconds).toBe(1200000);
  expect(store.snapshot().history).toEqual([]);
  await store.finish("completed");
  const saved = store.snapshot().history[0];
  expect(saved.request.status).toBe("completed"); expect(saved.request.active_seconds).toBe(1200);
  expect(saved.request.actuals).toHaveLength(1); // An unfinished last round does not invent work.
  expect(saved.request.active_intervals).toEqual([{ started_at: new Date(10000).toISOString(), ended_at: new Date(1210000).toISOString() }]);
});
it("elapsed time alone cannot complete a circuit and deliberate early/skip finishes remain partial", async () => {
  const empty = await timedStore(); empty.setTime(1210000); await empty.store.checkpoint();
  await expect(empty.store.finish("completed")).rejects.toThrow("recorded work");
  expect(empty.store.snapshot().history).toEqual([]);
  const early = await timedStore(); await early.store.log(next(early.store)); early.setTime(70000);
  await early.store.finish("partial");
  expect(early.store.snapshot().history[0].request).toMatchObject({ status: "partial", active_seconds: 60 });
  const skipped = await timedStore(); await skipped.store.log({ ...next(skipped.store), completed: false });
  await skipped.store.log(next(skipped.store)); skipped.setTime(1210000); await skipped.store.checkpoint();
  await expect(skipped.store.finish("completed")).rejects.toThrow("Skipped work");
  await skipped.store.finish("partial"); expect(skipped.store.snapshot().history[0].request.status).toBe("partial");
});
it.each([[1, 100, 1000], [2, 90, 990]])(
  "bounds a restored circuit with %i per-side movements at %i rounds/%i actuals", async (perSide, rounds, cells) => {
    const workout = amrap();
    workout.blocks[0].exercises.forEach((exercise, index) => { exercise.per_side = index < perSide; });
    const { store, storage, time, setTime } = await timedStore(workout);
    const draft = store.snapshot().active!;
    const steps = Array.from({ length: rounds }, (_, index) => draft.steps.map((step) => {
      const repeated = { ...step, round_index: index + 1 };
      return { ...repeated, key: actualIdentity(repeated) };
    })).flat();
    const actuals = steps.slice(0, -1).map((step): ActualSet => ({
      block_id: step.block_id, exercise_index: step.exercise_index, set_index: step.set_index,
      round_index: step.round_index, side: step.side, reps: 10, completed: true,
    }));
    // Start at a realistic durable boundary; persistence throughput is not this test's subject.
    await storage.setItem(trainingKey("owner", 1), JSON.stringify({ ...store.snapshot(),
      active: { ...draft, steps, actuals, cursor: actuals.length } }));
    const restored = createTrainingStore(storage, "owner", 1, time);
    await restored.load(); await restored.pause(false); await restored.log(next(restored));
    const bounded = restored.snapshot().active!;
    expect(bounded.actuals).toHaveLength(cells); expect(bounded.steps).toHaveLength(cells);
    expect(bounded.timed_circuit!.limit_reached).toBe(true); expect(bounded.steps.at(-1)!.round_index).toBe(rounds);
    setTime(1210000); await expect(restored.finish("completed")).rejects.toThrow("partial session");
    await restored.finish("partial"); expect(restored.snapshot().history[0].request.actuals).toHaveLength(cells);
  }
);


it("a completed timed run corrected to skipped work becomes partial without altering its source or active clock", async () => {
  const workout = amrap();
  const { store, setTime } = await timedStore(workout);
  await store.log({ ...next(store), reps: 10, duration_seconds: 12, distance_meters: 3,
    effort: 6, difficulty: "manageable", pain_reported: false, notes: "Original actual note" });
  setTime(1210000);
  await store.finish("completed");
  const completed = store.snapshot().history[0];
  const saved: TrainingSession = { id: "saved-timed", generation: 1, title: workout.title,
    client_session_id: completed.request.client_session_id, started_at: completed.request.started_at, status: "completed",
    content: { ...completed.request, prescription_snapshot: workout } };
  await store.sync(async () => saved);
  await expect(store.correct(saved, [{ ...saved.content.actuals[0], notes: "x".repeat(2001) }],
    "", "invalid-correction")).rejects.toThrow("Set notes must be 2000 characters or fewer");
  expect(store.snapshot().history).toHaveLength(1);
  await store.correct(saved, [{ ...saved.content.actuals[0], completed: false, reps: 8,
    duration_seconds: 9, distance_meters: 2, effort: 7, difficulty: "hard", pain_reported: true,
    notes: "Corrected actual note" }], "Corrected session note", "corrected-timed");
  const correction = store.snapshot().history[0];
  expect(correction.request).toMatchObject({ status: "partial", supersedes_session_id: saved.id, active_seconds: 1200 });
  expect(correction.request.active_intervals).toEqual(saved.content.active_intervals);
  expect(correction.request.actuals[0]).toMatchObject({ completed: false, reps: 8, duration_seconds: 9,
    distance_meters: 2, effort: 7, difficulty: "hard", pain_reported: true, notes: "Corrected actual note" });
  expect(correction.workout).toEqual(workout);
  expect(selectProgressSessions(store.snapshot().history, [saved], 1).sessions).toEqual([
    { started_at: saved.started_at, recorded: false },
  ]);
  expect(saved.status).toBe("completed");
  expect(saved.content.actuals[0].completed).toBe(true);
});
