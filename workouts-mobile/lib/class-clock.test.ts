import { describe, expect, it } from "vitest";
import { createTrainingStore, displayedClockSeconds, leadInRemaining, sessionElapsedMilliseconds, restRemainingSeconds, type SessionDraft } from "./training";
import { leadInSeconds, reminderErrors, defaultReminderSettings } from "./reminders";
import type { ActualSet, Workout } from "./models";

// Part A of the Nov 17 Unified class: a 15-minute AMRAP with a 1000 m buy-in.
const partA: Workout = { id: "nov17-a", generation: 1, revision: 1, title: "BUILD | BRIK · Tue Nov 17 · A", kind: "session", provenance: "source",
  blocks: [{ id: "a", label: "A", grouping: "circuit", execution: { mode: "amrap", time_cap_seconds: 900 },
    exercises: [{ name: "Run", distance_meters: 1000 }, { name: "Deadlift", reps_min: 15, reps_max: 15 },
      { name: "Burpee", reps_min: 20, reps_max: 20 }, { name: "Run", distance_meters: 400 }] }] };
const emom: Workout = { id: "emom", generation: 1, revision: 1, title: "EMOM 10", kind: "session", provenance: "source",
  blocks: [{ id: "main", label: "Main", grouping: "interval", execution: { mode: "emom", interval_seconds: 60, intervals: 10, rotation: null },
    exercises: [{ name: "Burpee", reps_min: 10 }] }] };
// Part D: alternating sets, no clock.
const partD: Workout = { id: "nov17-d", generation: 1, revision: 1, title: "Accessories", kind: "session", provenance: "source",
  blocks: [{ id: "d", label: "D", grouping: "superset", rounds: 2,
    exercises: [{ name: "Cable Cuban press", reps_min: 10, reps_max: 12, rest_seconds: 30 }] }] };

function device() {
  const data = new Map<string, string>();
  return { data, getItem: async (k: string) => data.get(k) ?? null, setItem: async (k: string, v: string) => { data.set(k, v); },
    removeItem: async (k: string) => { data.delete(k); } };
}
async function session(workout = partA, leadIn?: number, start = 10_000) {
  let time = start;
  const storage = device();
  const store = createTrainingStore(storage, "owner", 1, () => time);
  await store.load();
  await store.start(workout, { workout_id: workout.id, workout_revision: 1 }, "client", time, undefined,
    leadIn == null ? undefined : { lead_in_seconds: leadIn });
  await store.activityType("cross_training");
  const at = (value: number) => { time = value; };
  const relaunch = async () => { const next = createTrainingStore(storage, "owner", 1, () => time); await next.load(); return next; };
  return { store, storage, at, time: () => time, relaunch, d: () => store.snapshot().active! };
}
const seconds = (d: SessionDraft, now: number) => Math.floor(sessionElapsedMilliseconds(d, now) / 1000);
function firstMove(d: SessionDraft): ActualSet {
  const s = d.steps[d.cursor];
  return { block_id: s.block_id, exercise_index: s.exercise_index, set_index: s.set_index, round_index: s.round_index, side: s.side,
    completed: true, distance_meters: 1000 };
}

describe("class clock policy", () => {
  it("timed workouts start on a wall clock; set-by-set workouts stay pausable", async () => {
    expect((await session(partA)).d().clock_policy).toBe("wall");
    expect((await session(emom)).d().clock_policy).toBe("wall");
    expect((await session(partD)).d().clock_policy).toBeUndefined();
  });
  it("background and foreground leave a wall clock running: checkpoints never stop it", async () => {
    const { store, at, d, time } = await session();
    for (const moment of [70_000, 70_500, 130_000, 400_000]) { at(moment); await store.checkpoint(); }
    expect(d().paused).toBe(false);
    expect(seconds(d(), time())).toBe(390);
  });
  it("only an explicit pause stops it, and time paused is not counted", async () => {
    const { store, at, d, time } = await session();
    at(70_000); await store.pause(true);
    at(370_000); expect(seconds(d(), time())).toBe(60);
    await store.pause(false);
    at(400_000); expect(seconds(d(), time())).toBe(90);
    expect(d().active_intervals).toEqual([{ started_at: new Date(10_000).toISOString(), ended_at: new Date(70_000).toISOString() }]);
  });
  it("still stops at the cap with the clock reading exactly the cap", async () => {
    const { store, at, d, time } = await session();
    at(10_000 + 960_000); await store.checkpoint();
    expect(d().paused).toBe(true);
    expect(d().active_milliseconds).toBe(900_000);
    expect(seconds(d(), time())).toBe(900);
  });
});

describe("relaunch", () => {
  it("keeps a running wall clock going from its start and asks the person to confirm", async () => {
    const { store, at, relaunch } = await session();
    at(592_000); await store.checkpoint(); // 9:42 into A, then the app is closed.
    at(650_000);
    const reopened = await relaunch();
    const d = reopened.snapshot().active!;
    expect(d).toMatchObject({ paused: false, clock_kept_running: { left_at: 592_000 } });
    expect(seconds(d, 650_000)).toBe(640);
  });
  it("Keep clears the question and the clock runs on", async () => {
    const { store, at, relaunch } = await session();
    at(592_000); await store.checkpoint(); at(650_000);
    const reopened = await relaunch();
    await reopened.confirmKeptClock();
    at(700_000);
    expect(reopened.snapshot().active!.clock_kept_running).toBeUndefined();
    expect(seconds(reopened.snapshot().active!, 700_000)).toBe(690);
  });
  it("I stopped at… pauses at that moment, clamped between leaving the app and now", async () => {
    const { store, at, relaunch } = await session();
    at(592_000); await store.checkpoint(); at(650_000);
    const reopened = await relaunch();
    await reopened.confirmKeptClock(620_000);
    const d = reopened.snapshot().active!;
    expect(d).toMatchObject({ paused: true, active_milliseconds: 610_000 });
    expect(d.clock_kept_running).toBeUndefined();
    expect(d.active_intervals!.at(-1)!.ended_at).toBe(new Date(620_000).toISOString());
    for (const [asked, expected] of [[100_000, 582_000], [9_000_000, 640_000]] as const) {
      const again = await session(); again.at(592_000); await again.store.checkpoint(); again.at(650_000);
      const next = await again.relaunch(); await next.confirmKeptClock(asked);
      expect(next.snapshot().active!.active_milliseconds).toBe(expected);
    }
  });
  it("the relaunch sheet reads the clock the way its screen does: an AMRAP counts down, an EMOM counts up", async () => {
    const amrap = await session();
    // 610 s into a 15-minute AMRAP, the screen shows 4:50 left; stopping there must say 4:50, not 10:10.
    expect(displayedClockSeconds(amrap.d(), 620_000)).toBe(290);
    const interval = await session(emom);
    expect(displayedClockSeconds(interval.d(), 300_000)).toBe(290);
  });
  it("a stop time before the cap trims a clock the cap already froze", async () => {
    const { store, at, relaunch } = await session();
    at(592_000); await store.checkpoint();
    at(2_000_000); // Long after the 15:00 cap.
    const reopened = await relaunch();
    await reopened.checkpoint(); // The cap freezes it at 15:00.
    expect(reopened.snapshot().active).toMatchObject({ paused: true, active_milliseconds: 900_000 });
    await reopened.confirmKeptClock(700_000);
    const d = reopened.snapshot().active!;
    expect(d.active_milliseconds).toBe(690_000);
    expect(d.active_intervals!.at(-1)!.ended_at).toBe(new Date(700_000).toISOString());
  });
  it("the question survives a second relaunch with the original leaving time", async () => {
    const { store, at, relaunch } = await session();
    at(592_000); await store.checkpoint(); at(650_000);
    const first = await relaunch();
    at(660_000); await first.checkpoint(); // Persists the open question.
    at(900_000);
    const second = await relaunch();
    expect(second.snapshot().active!.clock_kept_running).toEqual({ left_at: 592_000 });
  });
  it("a paused wall clock stays paused with no question and no time added", async () => {
    const { store, at, relaunch } = await session();
    at(100_000); await store.pause(true); at(900_000);
    const d = (await relaunch()).snapshot().active!;
    expect(d.paused).toBe(true);
    expect(d.clock_kept_running).toBeUndefined();
    expect(seconds(d, 900_000)).toBe(90);
  });
  it("a rest timer keeps counting down across the relaunch too", async () => {
    const { store, at, relaunch } = await session();
    at(100_000); await store.timer("rest", 90); at(130_000);
    expect(restRemainingSeconds((await relaunch()).snapshot().active!, 130_000)).toBe(60);
  });
  it("drafts from older versions (no clock policy) still pause at their checkpoint", async () => {
    const { store, storage, at, relaunch } = await session();
    at(100_000); await store.checkpoint();
    const key = [...storage.data.keys()][0];
    const saved = JSON.parse(storage.data.get(key)!);
    delete saved.active.clock_policy;
    storage.data.set(key, JSON.stringify(saved));
    at(900_000);
    const d = (await relaunch()).snapshot().active!;
    expect(d).toMatchObject({ paused: true, active_milliseconds: 90_000 });
    expect(d.clock_kept_running).toBeUndefined();
  });
  it("set-by-set sessions still pause at their checkpoint", async () => {
    const { store, at, relaunch } = await session(partD);
    at(100_000); await store.checkpoint(); at(900_000);
    expect((await relaunch()).snapshot().active).toMatchObject({ paused: true, active_milliseconds: 90_000 });
  });
});

describe("3-2-1 lead-in", () => {
  it("delays the clock by the lead-in, so the finish time excludes it", async () => {
    const { store, at, d } = await session(partA, 3);
    expect(d()).toMatchObject({ lead_in_until: 13_000, active_started_at: 13_000, checkpoint_at: 10_000 });
    expect(leadInRemaining(d(), 11_000)).toBe(2_000);
    expect(seconds(d(), 12_900)).toBe(0);
    at(12_000); await store.checkpoint();
    expect(d().checkpoint_at).toBe(12_000); // Never in the future.
    at(73_000); await store.log(firstMove(d()));
    await store.finish("partial");
    const saved = store.snapshot().history[0].request;
    expect(saved.active_seconds).toBe(60);
    expect(saved.active_intervals).toEqual([{ started_at: new Date(13_000).toISOString(), ended_at: new Date(73_000).toISOString() }]);
  });
  it("Start now begins the clock immediately", async () => {
    const { store, at, d } = await session(partA, 10);
    at(12_000); await store.skipLeadIn();
    expect(d()).toMatchObject({ active_started_at: 12_000, lead_in_until: 12_000 });
    expect(leadInRemaining(d(), 12_000)).toBe(0);
    expect(seconds(d(), 42_000)).toBe(30);
  });
  it("pausing during the lead-in cancels it; Resume starts the clock at once", async () => {
    const { store, at, d } = await session(partA, 5);
    at(12_000); await store.pause(true);
    expect(d()).toMatchObject({ paused: true, active_started_at: null, lead_in_until: null, active_milliseconds: 0, checkpoint_at: 12_000 });
    at(50_000); await store.pause(false);
    expect(d().active_started_at).toBe(50_000);
    expect(seconds(d(), 80_000)).toBe(30);
  });
  it("a relaunch during the lead-in keeps its start time", async () => {
    const { at, relaunch } = await session(partA, 3);
    at(11_000);
    const d = (await relaunch()).snapshot().active!;
    expect(d).toMatchObject({ paused: false, active_started_at: 13_000, clock_kept_running: { left_at: 10_000 } });
  });
  it("applies to interval formats, never to set-by-set work, and is capped at 10 seconds", async () => {
    expect((await session(emom, 5)).d().active_started_at).toBe(15_000);
    expect((await session(partD, 5)).d()).toMatchObject({ active_started_at: 10_000 });
    expect((await session(partD, 5)).d().lead_in_until).toBeUndefined();
    expect((await session(partA, 60)).d().lead_in_until).toBe(20_000);
    expect((await session(partA, 0)).d().lead_in_until).toBeUndefined();
  });
  it("uses the device choice the reminders provider mirrors in", async () => {
    let time = 10_000;
    const store = createTrainingStore(device(), "owner", 1, () => time);
    await store.load();
    store.setLeadIn(5);
    await store.start(partA, { workout_id: partA.id, workout_revision: 1 }, "device-choice");
    expect(store.snapshot().active!.lead_in_until).toBe(15_000);
  });
  it("the device choice defaults to 3 seconds and accepts only off, 3, 5 or 10", () => {
    expect(leadInSeconds(defaultReminderSettings())).toBe(3);
    expect(leadInSeconds({ ...defaultReminderSettings(), lead_in_seconds: 0 })).toBe(0);
    expect(reminderErrors({ ...defaultReminderSettings(), lead_in_seconds: 10 })).toEqual([]);
    expect(reminderErrors({ ...defaultReminderSettings(), lead_in_seconds: 7 })).toEqual(["Choose a countdown of off, 3, 5 or 10 seconds."]);
  });
});
