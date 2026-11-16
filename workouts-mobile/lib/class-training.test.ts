import { describe, expect, it } from "vitest";
import { nov17Class as w } from "./fixtures/nov17-class";
import { createTrainingStore, historicalStructureWarning } from "./training";
import { buyInDone, endPart, endRest, isRun, partStatus, pausePart, resumePart, skipPart, startPart, tapRound, undoTap } from "./class-session";
import { exerciseRecords } from "./progress-insights";
import { currentPart, isClassWorkout } from "./class-training";
import type { ActualSet, Workout } from "./models";

const min = 60_000;
const T0 = Date.parse("2026-11-17T17:30:00Z");
function device() {
  const data = new Map<string, string>();
  return { getItem: async (k: string) => data.get(k) ?? null, setItem: async (k: string, v: string) => { data.set(k, v); }, removeItem: async (k: string) => { data.delete(k); } };
}
async function classStore(workout: Workout = w, lead = 3) {
  let now = T0;
  const storage = device();
  const store = createTrainingStore(storage, "owner", 1, () => now);
  await store.load();
  store.setLeadIn(lead);
  await store.start(workout, { workout_id: workout.id, workout_revision: 1 }, "class-1", now);
  return { store, storage, at: (ms: number) => (now = T0 + ms), part: () => currentPart(store.snapshot().active!.class_run!, workout, now) };
}
const done = (step: { block_id: string; exercise_index: number; round_index: number; set_index: number; side: ActualSet["side"] }): ActualSet =>
  ({ block_id: step.block_id, exercise_index: step.exercise_index, round_index: step.round_index, set_index: step.set_index, side: step.side, completed: true, reps: 10 });

describe("which workouts run as a class", () => {
  it("multi-part workouts with a runnable timed part, and a timed part with a buy-in", () => {
    expect(isClassWorkout(w)).toBe(true);
    expect(isClassWorkout({ ...w, blocks: [w.blocks[0]] })).toBe(true);
    expect(isClassWorkout({ ...w, blocks: [w.blocks[2], w.blocks[3]] })).toBe(false);
    expect(isClassWorkout({ ...w, kind: "program" })).toBe(false);
    // A part whose clock can't run keeps the existing "choose how to track it" path.
    const unknown = { ...w.blocks[1], execution: { mode: "chipper" } } as unknown as Workout["blocks"][number];
    expect(isClassWorkout({ ...w, blocks: [w.blocks[0], unknown] })).toBe(false);
  });
});

describe("a class draft (Nov 17)", () => {
  it("starts with sets only for untimed parts, and A waiting for Start", async () => {
    const { store, part } = await classStore();
    const d = store.snapshot().active!;
    expect(d.timed_circuit).toBeUndefined();
    expect(d.timed_format).toBeUndefined();
    expect(new Set(d.steps.map((s) => s.block_id))).toEqual(new Set(["c", "d"]));
    expect(part().status).toBe("pending");
    expect(d.lead_in_until).toBeUndefined();
  });
  it("runs A with its buy-in once, remembers Treadmill for the next run, rests 3:00, then B starts on time", async () => {
    const { store, at, part } = await classStore();
    await store.classAct(startPart);
    expect(part().status).toBe("lead_in");
    at(3000 + 6 * min);
    // Outdoor by default the first time; the person switches the buy-in to Treadmill.
    expect(store.snapshot().active!.class_run!.parts[0].runs?.[0]).toEqual({ environment: "outdoor" });
    await store.classAct((run, workout, now) => buyInDone(run, workout, now), undefined, "treadmill");
    expect(store.snapshot().run_environment).toBe("treadmill");
    at(3000 + 9 * min); await store.classAct(tapRound);
    at(3000 + 12 * min); await store.classAct(tapRound);
    await store.classAct(undoTap);
    expect(store.snapshot().active!.class_run!.parts[0].round_taps).toHaveLength(1);
    // Nothing happens between the cap and B: the phone is locked.
    at(3000 + 15 * min + 30_000);
    expect(part()).toMatchObject({ index: 0, status: "resting_after" });
    at(3000 + 18 * min + 1000);
    expect(part()).toMatchObject({ index: 1, status: "lead_in" });
    at(3000 + 18 * min + 4000);
    expect(part().status).toBe("running");
    // B's runs pick up the remembered Treadmill on the next action.
    await store.classAct(buyInDone);
    expect(store.snapshot().active!.class_run!.parts[1].runs?.[0]).toEqual({ environment: "treadmill" });
  });
  it("C and D log sets; the last set of D ends the class; undo reopens it", async () => {
    const { store, at, part } = await classStore();
    await store.classAct(skipPart);
    await store.classAct(skipPart);
    expect(part()).toMatchObject({ index: 2, status: "running" });
    // Logging belongs to the part on screen.
    let d = store.snapshot().active!;
    expect(d.steps[d.cursor].block_id).toBe("c");
    at(11 * min);
    await store.log({ ...done(d.steps[d.cursor]), reps: null, duration_seconds: 600 });
    expect(part()).toMatchObject({ index: 3, status: "running" });
    d = store.snapshot().active!;
    while (d.cursor < d.steps.length - 1) { await store.log(done(d.steps[d.cursor])); d = store.snapshot().active!; }
    expect(part().status).toBe("running");
    await store.log(done(d.steps[d.cursor]));
    expect(part()).toMatchObject({ index: 3, status: "done" });
    await store.undo();
    expect(part()).toMatchObject({ index: 3, status: "running" });
    expect(store.snapshot().active!.cursor).toBe(store.snapshot().active!.steps.length - 1);
  });
  it("won't log a set while a timed part is on screen", async () => {
    const { store } = await classStore();
    const d = store.snapshot().active!;
    await expect(store.log(done(d.steps[d.cursor]))).rejects.toThrow("This part isn’t running");
  });
  it("skipping a set-by-set part passes over its sets without logging them", async () => {
    const { store, part } = await classStore();
    for (let i = 0; i < 3; i++) await store.classAct(skipPart);
    const d = store.snapshot().active!;
    expect(part().index).toBe(3);
    expect(d.steps[d.cursor].block_id).toBe("d");
    expect(d.actuals).toEqual([]);
  });
  it("saves active time from part clocks only, partial when parts were skipped", async () => {
    const { store, at } = await classStore(w, 0);
    await store.classAct(startPart);
    at(15 * min);
    expect(store.snapshot().active!.class_run).toBeDefined();
    at(18 * min); // A capped at 15:00 and rested 3:00; B waits for nothing (rest ends into B's clock).
    at(20 * min);
    await store.classAct(endPart);
    await expect(store.finish("completed", undefined, "keep", "general_fitness")).rejects.toThrow("partial");
    await store.finish("partial", undefined, "keep", "general_fitness");
    const saved = store.snapshot().history[0].request;
    expect(saved.active_seconds).toBe(17 * 60);
    expect(saved.active_intervals).toEqual([
      { started_at: new Date(T0).toISOString(), ended_at: new Date(T0 + 15 * min).toISOString() },
      { started_at: new Date(T0 + 18 * min).toISOString(), ended_at: new Date(T0 + 20 * min).toISOString() },
    ]);
    expect(saved.actuals).toEqual([]);
  });
  it("refuses to save a class nobody started", async () => {
    const { store } = await classStore();
    await expect(store.finish("partial", undefined, "keep", "general_fitness")).rejects.toThrow("Start a part");
  });
  it("keeps running across a relaunch without the 'kept running' sheet", async () => {
    const { store, storage, at } = await classStore();
    await store.classAct(startPart);
    at(10 * min);
    const again = createTrainingStore(storage, "owner", 1, () => T0 + 10 * min);
    await again.load();
    expect(again.snapshot().active!.clock_kept_running).toBeUndefined();
    expect(currentPart(again.snapshot().active!.class_run!, w, T0 + 10 * min).status).toBe("running");
    await again.classAct(endRest);
  });
  it("won't skip a part that already capped, or end one during its lead-in", async () => {
    const { store, at, part } = await classStore();
    await store.classAct(startPart);
    await store.classAct(endPart, T0 + 1000);
    expect(store.snapshot().active!.class_run!.parts[0].ended_at).toBeUndefined();
    at(3000 + 16 * min);
    await store.classAct(skipPart);
    expect(store.snapshot().active!.class_run!.parts[0].skipped).toBeUndefined();
    expect(part()).toMatchObject({ index: 0, status: "resting_after" });
  });
  it("keeps undo inside the part on screen", async () => {
    const { store, at, part } = await classStore();
    await store.classAct(skipPart); await store.classAct(skipPart);
    const d = store.snapshot().active!;
    at(min);
    await store.log({ ...done(d.steps[d.cursor]), reps: null, duration_seconds: 600 });
    expect(part().index).toBe(3);
    // C's last set ended C; once anything in D has changed, undo can't reach back into C.
    await store.classAct(pausePart, T0 + 2 * min); await store.classAct(resumePart, T0 + 3 * min);
    await expect(store.undo()).rejects.toThrow("no set to undo in this part");
    expect(store.snapshot().active!.steps[store.snapshot().active!.cursor].block_id).toBe("d");
  });
  it("saves as partial when a set-by-set part ended with sets not logged", async () => {
    const { store, at } = await classStore();
    for (let i = 0; i < 2; i++) await store.classAct(startPart).then(() => store.classAct(endPart, T0 + 5000 * (i + 1)));
    at(30 * min);
    await store.classAct(endPart); await store.classAct(endPart);
    await expect(store.finish("completed", undefined, "keep", "general_fitness")).rejects.toThrow("partial");
  });
});

describe("runs the API asks Outdoor/Treadmill for", () => {
  it("matches its names, with a distance", () => {
    for (const name of ["Run", "Running", "Jog", "Jogging", "Treadmill"]) expect(isRun({ name, distance_meters: 400 })).toBe(true);
    expect(isRun({ name: "Run", distance_meters: null })).toBe(false);
    expect(isRun({ name: "Rowing", distance_meters: 500 })).toBe(false);
    expect(partStatus).toBeDefined();
  });
});

it("logs repeating movement actuals with prescribed or edited loads, persists them, and undoes just the last round", async () => {
  const workout = structuredClone(w);
  workout.blocks[0].exercises[1] = { ...workout.blocks[0].exercises[1], relative_load: null, load: 50, load_unit: "kg" };
  const { store, storage, at } = await classStore(workout, 0);
  await store.classAct(startPart); at(min); await store.classAct(buyInDone);
  at(2 * min); await store.classAct(tapRound);
  expect(store.snapshot().active!.actuals).toMatchObject([
    { block_id: "a", exercise_index: 1, round_index: 1, reps: 15, load: 50, load_unit: "kg" },
    { block_id: "a", exercise_index: 2, round_index: 1, reps: 20 },
    { block_id: "a", exercise_index: 3, round_index: 1, distance_meters: 400 },
  ]);
  await store.classLoad("a", 1, 60, "kg");
  at(3 * min); await store.classAct(tapRound);
  expect(store.snapshot().active!.actuals[3]).toMatchObject({ load: 60, round_index: 2 });
  expect(historicalStructureWarning(workout, store.snapshot().active!.actuals)).toBeNull();
  const restored = createTrainingStore(storage, "owner", 1, () => T0 + 3 * min);
  await restored.load();
  expect(restored.snapshot().active!.actuals).toHaveLength(6);
  await restored.classAct(undoTap);
  expect(restored.snapshot().active!.actuals).toHaveLength(3);
  expect(restored.snapshot().active!.actuals[0].load).toBe(50);
  await restored.finish("partial", undefined, "keep", "general_fitness");
  expect(restored.snapshot().history[0].request.actuals[0]).toMatchObject({ reps: 15, load: 50, load_unit: "kg" });
  const records = exerciseRecords(restored.snapshot().history.map((h) => ({ request: h.request, workout: h.workout })), "metric");
  expect(records.find((r) => r.name === "Deadlift")!.best).toContain("50 kg");
});
it("never invents a relative or multiple-choice load", async () => {
  const { store, at } = await classStore(w, 0);
  await store.classAct(startPart); at(min); await store.classAct(buyInDone);
  at(2 * min); await store.classAct(tapRound);
  expect(store.snapshot().active!.actuals[0].load).toBeUndefined();
  await expect(store.classLoad("a", 1, -1, "kg")).rejects.toThrow("weight");
});
