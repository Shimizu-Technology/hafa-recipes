import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import { createTrainingStore, type TrainingState } from "./training";
import { drainWatch, planContext, watchPlan, type WatchResult } from "./watch-sync";
import { roundActuals } from "./class-training";
import { nov17Class } from "./fixtures/nov17-class";
const account = "synthetic:1";
const workout = { ...nov17Class, id: "synthetic-workout", revision: 1, generation: 1 };
const source = { workout_id: workout.id, workout_revision: 1 };
const plan = watchPlan(workout, source, account, "2026-11-17");
const start = "2026-11-17T00:00:00Z", end = "2026-11-17T00:15:00Z";
const result = (): WatchResult => ({ v: 1, recorded_on: "watch", client_session_id: "88753900-0192-4f86-879a-7ba599178690", plan_key: plan.plan_key,
  plan, started_at: start, finished_at: end, active_intervals: [{ started_at: start, ended_at: end }], heart_rate: { average: 145, max: 172 },
  actuals: [...roundActuals(workout.blocks[0], 1), ...roundActuals(workout.blocks[0], 2), { block_id: workout.blocks[0].id,
    exercise_index: 0, round_index: 1, set_index: 1, side: null, completed: true, distance_meters: 1000 }], results: [],
  parts: [{ block_id: workout.blocks[0].id, start, end, active_seconds: 900, rounds: 2, buy_in_done_at: "2026-11-17T00:03:00Z", skipped: false }], segments: [] });
function setup(saveWorkout?: Parameters<typeof createTrainingStore>[4]) {
  const memory = new Map<string, string>();
  return createTrainingStore({ getItem: async k => memory.get(k) ?? null, setItem: async (k, v) => { memory.set(k, v); }, removeItem: async k => { memory.delete(k); } }, "synthetic", 1, Date.now, saveWorkout);
}
describe("watch sync", () => {
  it("matches the same encoded fixture Swift decodes", () => {
    const fixture = JSON.parse(readFileSync(new URL("../watch-tests/Tests/HafaWatchCoreTests/Fixtures/watch-plans-v1.json", import.meta.url), "utf8"));
    const w = { ...nov17Class, id: "e830bca7-a32f-4adb-a5aa-6649b536ad98", revision: 1, generation: 1, title: "Morning class" };
    expect(JSON.parse(JSON.stringify(watchPlan(w, { workout_id: w.id, workout_revision: 1 }, account, "2026-11-17"))))
      .toEqual(fixture.plans[0]);
  });
  it("includes only today and the next two days, plus five distinct recent starts", () => {
    const history = Array.from({ length: 6 }, (_, i) => ({ generation: 1, state: "synced" as const, workout: { ...workout, id: `recent-${i}` },
      request: { client_session_id: String(i), workout_id: `recent-${i}`, workout_revision: 1, started_at: `2026-11-0${i + 1}T00:00:00Z`, finished_at: end, status: "completed" as const, actuals: [] } }));
    const state = { version: 1 as const, generation: 1, active: null, history };
    const context = JSON.parse(planContext({ account, units: "metric", today: "2026-11-17", leadIn: 3, state, programs: [],
      library: [16, 17, 18, 19, 20].map(day => ({ ...workout, id: `day-${day}`, blocks: [workout.blocks[2]], programming: { source_kind: "gym", date: `2026-11-${day}` } })) }).json);
    // Use compact one-part recent workouts to fit all eight under the transport bound.
    const recent = JSON.parse(planContext({ account, units: "metric", today: "2026-11-17", leadIn: 3,
      state: { ...state, history: history.map(h => ({ ...h, workout: { ...h.workout, blocks: [workout.blocks[2]] } })) }, programs: [], library: [] }).json);
    expect(context.plans.filter((p: typeof plan) => p.date).map((p: typeof plan) => p.date)).toEqual(["2026-11-17", "2026-11-18", "2026-11-19"]);
    expect(recent.plans).toHaveLength(5);
    expect(recent.plans.some((p: typeof plan) => p.source && "workout_id" in p.source && p.source.workout_id === "recent-0")).toBe(false);
  });
  it("selects dated plans plus five recent starts within the UTF-8 budget", () => {
    const state: TrainingState = { version: 1, generation: 1, active: null, history: [] };
    const output = planContext({ account, units: "metric", today: "2026-11-17", leadIn: 5, state, programs: [],
      library: Array.from({ length: 50 }, (_, i) => ({ ...workout, id: `w${i}`, title: "長いクラス".repeat(30), programming: { source_kind: "gym", date: i === 49 ? "2026-11-20" : "2026-11-17" } })) });
    expect(new TextEncoder().encode(output.json).length).toBeLessThan(16384);
    const context = JSON.parse(output.json);
    expect(context.plans.length).toBeGreaterThan(0);
    expect(context.plans.every((p: typeof plan) => p.date === "2026-11-17" && p.lead_in_seconds === 5)).toBe(true);
    expect(Object.keys(output.catalog)).toHaveLength(context.plans.length);
  });
  it("durably queues before marking imported, dedupes replay, and keeps HR local", async () => {
    const store = setup(); await store.load(); let marked = 0;
    const r = result();
    const options = { store, account, generation: 1, catalog: { [plan.plan_key]: workout }, current: () => true,
      pendingResults: async () => [JSON.stringify(r)], markImported: async () => { expect(store.snapshot().history).toHaveLength(1); marked++; } };
    await drainWatch(options); await drainWatch(options);
    const saved = store.snapshot().history[0];
    expect(marked).toBe(2); expect(store.snapshot().history).toHaveLength(1);
    expect(saved.request.recorded_on).toBe("watch"); expect(saved.request.active_seconds).toBe(900);
    expect(saved.request.actuals.filter(a => a.round_index === 2).length).toBeGreaterThan(0);
    expect(saved.request.actuals.filter(a => a.exercise_index === 0)).toHaveLength(1);
    expect(saved.watch?.heart_rate?.average).toBe(145); expect(JSON.stringify(saved.request)).not.toContain("heart_rate");
    const reloaded = { ...store.snapshot(), history: [] }; // Receipt still dedupes after history pruning.
    const receiptsOnly = { ...store, snapshot: () => reloaded };
    await drainWatch({ ...options, store: receiptsOnly });
    expect(store.snapshot().history).toHaveLength(1);
  });
  it("does not drain background/account changes; source-less timers queue offline", async () => {
    const store = setup(); await store.load(); let marked = 0;
    const options = { store, account, generation: 1, catalog: {}, current: () => false,
      pendingResults: async () => [JSON.stringify(result())], markImported: async () => { marked++; } };
    await drainWatch(options); expect(store.snapshot().history).toHaveLength(0);
    await drainWatch({ ...options, current: () => true }); expect(marked).toBe(0); // Missing pinned snapshot.
    const r = result(); r.plan = { ...plan, source: undefined }; r.plan_key = "open-timer";
    r.parts = [{ ...r.parts[0], block_id: "timer" }]; r.actuals = [];
    await drainWatch({ ...options, current: () => true, pendingResults: async () => [JSON.stringify(r)] });
    expect(store.snapshot().history[0].watch_quick).toBe(true);
    expect(store.snapshot().history[0].workout.title).toContain("watch, Nov 17"); expect(marked).toBe(1);
  });
  it("manual sync creates a private quick workout before the session and persists its source", async () => {
    let creations = 0;
    const store = setup(async (_workout, key, generation) => {
      expect(key).toBe(`watch-${result().client_session_id}`); creations++;
      return { ...workout, id: "saved-private-timer", generation };
    });
    await store.load(); const r = result(); r.plan = { ...plan, title: "Open timer", source: undefined }; r.plan_key = "open-timer";
    r.parts = [{ ...r.parts[0], block_id: "timer" }]; r.actuals = [];
    await drainWatch({ store, account, generation: 1, catalog: {}, current: () => true,
      pendingResults: async () => [JSON.stringify(r)], markImported: async () => {} });
    await store.sync(async request => {
      expect(creations).toBe(1); expect(request.workout_id).toBe("saved-private-timer");
      expect(store.snapshot().history[0].watch_quick).toBeUndefined();
      return { id: "saved-session", generation: 1, client_session_id: request.client_session_id, title: "Open timer",
        started_at: request.started_at, status: request.status, content: { ...request, prescription_snapshot: workout } };
    });
    expect(store.snapshot().history[0].request.workout_id).toBe("saved-private-timer");
  });
  it("keeps an active phone session and flags the collision", async () => {
    const store = setup(); await store.load();
    await store.start(workout, source, "phone-session", Date.parse(start));
    await drainWatch({ store, account, generation: 1, catalog: { [plan.plan_key]: workout }, current: () => true,
      pendingResults: async () => [JSON.stringify(result())], markImported: async () => {} });
    expect(store.snapshot().active?.id).toBe("phone-session");
    expect(store.snapshot().history[0].watch?.duplicate_phone_id).toBe("phone-session");
  });
});
