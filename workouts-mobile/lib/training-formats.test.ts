import { describe, expect, it } from "vitest";
import { capRemainingSeconds, createTrainingStore, sessionElapsedMilliseconds, stepsFor, trackingPrescriptionWarning, type TrainingStep } from "./training";
import type { ActualSet, Workout } from "./models";
import { formatScore, intervalPosition } from "./timed-execution";

function memory() {
  const data = new Map<string, string>();
  return { data, getItem: async (key: string) => data.get(key) ?? null, setItem: async (key: string, value: string) => { data.set(key, value); },
    removeItem: async (key: string) => { data.delete(key); } };
}
function workout(block: Partial<Workout["blocks"][number]> & Pick<Workout["blocks"][number], "exercises">): Workout {
  return { id: "w", revision: 1, generation: 1, title: "Format", kind: "session", provenance: "source",
    blocks: [{ id: "main", label: "Main", grouping: "interval", ...block }] };
}
const emom20 = () => workout({ execution: { mode: "emom", interval_seconds: 60, intervals: 20, rotation: "alternating" },
  exercises: [{ name: "Burpees", reps_min: 10 }, { name: "Air squats", reps_min: 15 }] });
const source = { workout_id: "w", workout_revision: 1 };
function actual(step: TrainingStep, completed: boolean, reps: number | null = completed ? step.exercise.reps_min ?? 1 : null): ActualSet {
  return { block_id: step.block_id, exercise_index: step.exercise_index, round_index: step.round_index, set_index: step.set_index,
    side: step.side, completed, reps };
}
async function started(w: Workout, data = memory(), clock = { now: 0 }) {
  const store = createTrainingStore(data, "owner", 1, () => clock.now);
  await store.load();
  await store.start(w, source, "session", 0);
  await store.activityType("general_fitness");
  return { store, data, clock, draft: () => store.snapshot().active! };
}
/** Marks the next interval (every move in it) at `at` milliseconds. */
async function mark(s: Awaited<ReturnType<typeof started>>, completed: boolean, at: number, reps?: number | null) {
  s.clock.now = at;
  const d = s.draft();
  const round = d.steps[d.cursor].round_index;
  const steps = d.steps.slice(d.cursor).filter((step) => step.round_index === round);
  await s.store.logGroup(steps.map((step) => actual(step, completed, reps === undefined ? undefined : reps)), at);
}

describe("EMOM", () => {
  it("starts on the interval clock without a start-sheet choice, and rotates alternating moves", async () => {
    expect(trackingPrescriptionWarning(emom20())).toBeNull();
    const steps = stepsFor(emom20());
    expect(steps).toHaveLength(20);
    expect(steps.slice(0, 3).map((s) => [s.round_index, s.exercise.name])).toEqual([[1, "Burpees"], [2, "Air squats"], [3, "Burpees"]]);
    const s = await started(emom20());
    expect(s.draft().timed_format).toEqual({ mode: "emom", interval_seconds: 60, intervals: 20, rotation: "alternating" });
    expect(s.draft().rest_until).toBeNull();
  });
  it("lets the person finish a minute early, leaves the remainder as rest, and never marks a minute before it starts", async () => {
    const s = await started(emom20());
    await mark(s, true, 30_000);
    expect(s.draft().actuals).toMatchObject([{ round_index: 1, exercise_index: 0, reps: 10, completed: true }]);
    expect(intervalPosition(s.draft().timed_format as never, sessionElapsedMilliseconds(s.draft(), 30_000))).toEqual({ index: 1, phase: "work", remaining: 30 });
    await expect(mark(s, true, 45_000)).rejects.toThrow("hasn't started");
    await mark(s, true, 61_000);
    expect(s.draft().actuals.at(-1)).toMatchObject({ round_index: 2, exercise_index: 1, reps: 15 });
    expect(s.draft().rest_until).toBeNull();
  });
  it("keeps elapsed time across pause, resume and termination using real timestamps, without completing anything", async () => {
    const s = await started(emom20());
    s.clock.now = 100_000; await s.store.pause(true, 100_000);
    s.clock.now = 1_000_000; await s.store.pause(false, 1_000_000);
    expect(intervalPosition(s.draft().timed_format as never, sessionElapsedMilliseconds(s.draft(), 1_030_000)).index).toBe(3);
    s.clock.now = 1_050_000; await s.store.checkpoint();
    // The app is killed; a new process loads the saved draft much later.
    const relaunched = createTrainingStore(s.data, "owner", 1, () => 9_000_000);
    await relaunched.load();
    const d = relaunched.snapshot().active!;
    expect(d.paused).toBe(true);
    expect(sessionElapsedMilliseconds(d, 9_000_000)).toBe(150_000);
    expect(intervalPosition(d.timed_format as never, 150_000)).toMatchObject({ index: 3, remaining: 30 });
    expect(d.actuals).toEqual([]);
    // Passed minutes are still waiting to be marked, in order.
    await relaunched.logGroup([actual(d.steps[0], true)], 9_000_000);
    expect(relaunched.snapshot().active!.actuals).toHaveLength(1);
  });
  it("records missed minutes, keeps them partial and scores intervals completed", async () => {
    const w = workout({ execution: { mode: "emom", interval_seconds: 60, intervals: 3, rotation: null }, exercises: [{ name: "Burpees", reps_min: 10 }] });
    const s = await started(w);
    await mark(s, true, 10_000);
    await mark(s, false, 70_000);
    await mark(s, true, 130_000);
    await expect(s.store.finish("completed", 150_000)).rejects.toThrow("Skipped work stays partial");
    await s.store.finish("partial", 150_000);
    const saved = s.store.snapshot().history[0];
    expect(saved.request.actuals.map((a) => a.completed)).toEqual([true, false, true]);
    expect(formatScore(saved.workout, saved.request)).toBe("2 of 3 minutes");
  });
  it("stops the clock at the end of the last interval", async () => {
    const w = workout({ execution: { mode: "emom", interval_seconds: 120, intervals: 6, rotation: null }, exercises: [{ name: "Power clean", reps_min: 5 }] });
    const s = await started(w);
    expect(capRemainingSeconds(s.draft(), 700_000)).toBe(20);
    s.clock.now = 800_000; await s.store.checkpoint();
    expect(s.draft().paused).toBe(true);
    expect(s.draft().active_milliseconds).toBe(720_000);
  });
  it("runs Death by until the first missed minute and scores the last full minute plus reps", async () => {
    const w = workout({ execution: { mode: "emom", interval_seconds: 60, intervals: null, rotation: null },
      exercises: [{ name: "Burpees", ladder: { start: 1, step: 1, end: null } }] });
    expect(trackingPrescriptionWarning(w)).toBeNull();
    const s = await started(w);
    expect(s.draft().steps).toHaveLength(1);
    await mark(s, true, 10_000, 1);
    await mark(s, true, 70_000, 2);
    expect(s.draft().steps).toHaveLength(3);
    await mark(s, false, 170_000, 1);
    expect(s.draft().steps).toHaveLength(3);
    await s.store.undo();
    expect(s.draft().steps).toHaveLength(3);
    await s.store.undo();
    expect(s.draft().steps).toHaveLength(2);
    await mark(s, true, 70_000 + 100_000, 2);
    await mark(s, false, 190_000, 1);
    // A missed minute ends Death by and stops its clock. The first miss stopped it at 170 s;
    // undoing that miss leaves the session paused, so the clock never ran on by itself.
    expect(s.draft().paused).toBe(true);
    expect(s.draft().active_milliseconds).toBe(170_000);
    await s.store.finish("completed", 200_000);
    const saved = s.store.snapshot().history[0];
    expect(saved.request.status).toBe("completed");
    expect(formatScore(saved.workout, saved.request)).toBe("2 full minutes + 1 rep");
  });
});

describe("for time", () => {
  const thrusters = () => workout({ grouping: "circuit", rounds: 3, execution: { mode: "for_time", time_cap_seconds: 720 },
    exercises: [{ name: "Thrusters", rep_scheme: [21, 15, 9] }, { name: "Pull-ups", rep_scheme: [21, 15, 9] }] });
  it("logs each round with its rep scheme, stops the clock on the last movement and saves the finish time", async () => {
    const s = await started(thrusters());
    expect(s.draft().steps).toHaveLength(6);
    for (const [at, reps] of [[100_000, 21], [250_000, 15], [400_000, 9]] as const) {
      s.clock.now = at;
      const d = s.draft();
      const round = d.steps.slice(d.cursor, d.cursor + 2);
      await s.store.logGroup(round.map((step) => actual(step, true, reps)), at);
    }
    expect(s.draft().paused).toBe(true);
    expect(s.draft().active_milliseconds).toBe(400_000);
    await s.store.finish("completed", 999_000);
    const saved = s.store.snapshot().history[0];
    expect(saved.request.active_seconds).toBe(400);
    expect(saved.request.actuals.map((a) => a.reps)).toEqual([21, 21, 15, 15, 9, 9]);
    expect(formatScore(saved.workout, saved.request)).toBe("Time 6:40");
  });
  it("records a capped result with rounds and reps done, and keeps it partial", async () => {
    const w = workout({ grouping: "circuit", rounds: 5, execution: { mode: "for_time", time_cap_seconds: 1200 },
      exercises: [{ name: "Burpees", reps_min: 10 }, { name: "Air squats", reps_min: 20 }] });
    const s = await started(w);
    for (const at of [300_000, 600_000]) {
      s.clock.now = at;
      const d = s.draft();
      await s.store.logGroup(d.steps.slice(d.cursor, d.cursor + 2).map((step) => actual(step, true)), at);
    }
    s.clock.now = 1_300_000; await s.store.checkpoint();
    expect(s.draft().paused).toBe(true);
    expect(capRemainingSeconds(s.draft(), 1_300_000)).toBe(0);
    const d = s.draft();
    await s.store.logGroup([actual(d.steps[d.cursor], true), actual(d.steps[d.cursor + 1], false, 12)], 1_300_000);
    await expect(s.store.finish("completed", 1_300_000)).rejects.toThrow();
    await s.store.finish("partial", 1_300_000);
    const saved = s.store.snapshot().history[0];
    expect(saved.request.active_seconds).toBe(1200);
    expect(formatScore(saved.workout, saved.request)).toBe("Capped · 2 rounds + 22 reps");
  });
});

describe("work and rest", () => {
  const tabata = () => workout({ execution: { mode: "work_rest", work_seconds: 20, rest_seconds: 10, intervals: 8 }, exercises: [{ name: "Squats" }] });
  it("cycles work and rest on the clock and logs reps per interval or a skip", async () => {
    expect(intervalPosition({ mode: "work_rest", work_seconds: 20, rest_seconds: 10, intervals: 8 }, 0)).toEqual({ index: 1, phase: "work", remaining: 20 });
    expect(intervalPosition({ mode: "work_rest", work_seconds: 20, rest_seconds: 10, intervals: 8 }, 20_500)).toEqual({ index: 1, phase: "rest", remaining: 10 });
    expect(intervalPosition({ mode: "work_rest", work_seconds: 20, rest_seconds: 10, intervals: 8 }, 30_000)).toEqual({ index: 2, phase: "work", remaining: 20 });
    expect(intervalPosition({ mode: "work_rest", work_seconds: 20, rest_seconds: 10, intervals: 8 }, 240_000)).toEqual({ index: 8, phase: "ended", remaining: 0 });
    const s = await started(tabata());
    expect(s.draft().steps).toHaveLength(8);
    s.clock.now = 25_000;
    const first = s.draft().steps[0];
    await s.store.logGroup([{ ...actual(first, true, 14), duration_seconds: 20 }], 25_000);
    await expect(s.store.logGroup([actual(s.draft().steps[1], false)], 25_000)).rejects.toThrow("hasn't started");
    await s.store.logGroup([actual(s.draft().steps[1], false)], 31_000);
    await s.store.finish("partial", 40_000);
    const saved = s.store.snapshot().history[0];
    expect(formatScore(saved.workout, saved.request)).toBe("14 reps · 1 of 8 intervals");
  });
  it("needs an interval count before the timer can run", () => {
    const w = tabata();
    (w.blocks[0].execution as { intervals: number | null }).intervals = null;
    expect(trackingPrescriptionWarning(w)).toMatch(/how many intervals/);
  });
});

describe("superset rest", () => {
  it("rests after each pass through the pair, not only between rounds", async () => {
    const w = workout({ grouping: "superset", rest_between_rounds_seconds: 90,
      exercises: [{ name: "Bench press", sets: 3, reps_min: 10 }, { name: "Row", sets: 3, reps_min: 10 }] });
    w.provenance = "user";
    const s = await started(w);
    expect(s.draft().timed_format).toBeUndefined();
    await s.store.log(actual(s.draft().steps[0], true), 1000);
    expect(s.draft().rest_until).toBeNull();
    await s.store.log(actual(s.draft().steps[1], true), 2000);
    expect(s.draft().rest_until).toBe(92_000);
    await s.store.log(actual(s.draft().steps[2], true), 100_000);
    expect(s.draft().rest_until).toBeNull();
  });
});
