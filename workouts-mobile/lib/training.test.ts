import { describe, it, expect, vi } from "vitest";
import {
  createTrainingStore,
  stepsFor,
  remainingSeconds,
  canonicalLoad,
  displayLoad,
  canonicalHeight,
  displayHeight,
  type TrainingStore,
} from "./training";
import type { Workout, ActualSet, TrainingSession } from "./models";
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
