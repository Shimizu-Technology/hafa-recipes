import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import { createTrainingStore, trainingKey, type TrainingState } from "./training";
import { drainWatch, planContext, watchPlan, pruneWatchCatalog, stablePlans, watchCollisions, type WatchResult } from "./watch-sync";
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
  it("preserves the phone's selected activity in recent watch plans", () => {
    const state: TrainingState = { version: 1, generation: 1, active: null, history: [{ generation: 1, workout, state: "synced",
      request: { ...source, client_session_id: "recent", started_at: start, finished_at: end, status: "completed", actuals: [], activity_type: "hiit" } }] };
    const context = JSON.parse(planContext({ account, units: "metric", today: "2026-11-17", leadIn: 3, state, library: [], programs: [] }).json);
    expect(context.plans[0].activity_type).toBe(63);
  });
  it("retains invalid cells and overlapping intervals in the inbox without importing", async () => {
    const store = setup(); await store.load(); let marked = 0;
    const invalid = result(); invalid.actuals = [{ ...invalid.actuals[0], block_id: "missing" }];
    const overlap = result(); overlap.active_intervals = [overlap.active_intervals[0], overlap.active_intervals[0]];
    await drainWatch({ store, account, generation: 1, catalog: { [plan.plan_key]: workout }, current: () => true,
      pendingResults: async () => [JSON.stringify(invalid), JSON.stringify(overlap)], markImported: async () => { marked++; } });
    expect(marked).toBe(0); expect(store.snapshot().history).toHaveLength(0);
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
  it("deduplicates dated classes from recents and excludes pending and saved Open timers", async () => {
    const store = setup(); await store.load();
    await store.start(workout, source, "phone", Date.parse(start));
    const options = { account, units: "metric", today: "2026-11-17", leadIn: 3, state: store.snapshot(), programs: [],
      library: [{ ...workout, programming: { source_kind: "gym" as const, date: "2026-11-17" } }] };
    expect(JSON.parse(planContext(options).json).plans).toHaveLength(1);
    const r = result(); r.plan = { ...plan, title: "Open timer", source: undefined }; r.plan_key = "open-timer";
    r.parts = [{ ...r.parts[0], block_id: "timer" }]; r.actuals = [];
    const timers = setup(async () => ({ ...workout, id: "saved-timer", blocks: [{ id: "timer", label: "Open timer", grouping: "circuit", score_kind: "none", exercises: [{ name: "Open timer" }] }] }));
    await timers.load();
    await drainWatch({ store: timers, account, generation: 1, catalog: {}, current: () => true,
      pendingResults: async () => [JSON.stringify(r)], markImported: async () => {} });
    const plans = () => JSON.parse(planContext({ ...options, state: timers.snapshot(), library: [] }).json).plans;
    expect(plans()).toHaveLength(0);
    await timers.sync(async () => { throw Error("offline"); });
    expect(timers.snapshot().history[0].watch_quick).toBeUndefined(); expect(plans()).toHaveLength(0);
  });
  it("ignores generated_at when comparing plans and expires old catalog snapshots except pending references", () => {
    expect(stablePlans('{"v":1,"generated_at":"a","plans":[]}')).toBe(stablePlans('{"v":1,"generated_at":"b","plans":[]}'));
    const now = Date.parse(end), old = now - 46 * 86400000;
    const catalog = pruneWatchCatalog({ expired: { ...workout, watch_cached_at: old }, pending: { ...workout, watch_cached_at: old },
      recent: { ...workout, watch_cached_at: now - 86400000 } }, { sent: workout }, [JSON.stringify({ plan_key: "pending" })], now);
    expect(Object.keys(catalog).sort()).toEqual(["pending", "recent", "sent"]);
    expect(catalog.sent.watch_cached_at).toBe(now);
  });
  it("reports account/generation, nil-account timer, missing snapshot and invalid actuals without acking", async () => {
    const store = setup(); await store.load(); const other = result(), nil = result(), invalid = result();
    other.plan = { ...plan, account_key: "synthetic:2" }; nil.plan = { ...plan, source: undefined, account_key: undefined! };
    invalid.actuals = [{ ...invalid.actuals[0], block_id: "missing" }];
    let marks = 0;
    const options = { store, account, generation: 1, current: () => true, markImported: async () => { marks++; } };
    const issues = await drainWatch({ ...options, catalog: {}, pendingResults: async () => [other, nil, result()].map(r => JSON.stringify(r)) });
    expect(issues.map(i => i.reason).join(" ")).toMatch(/earlier training setup.*no account.*snapshot/s);
    expect(issues.map(i => i.discardable)).toEqual([true, true, false]);
    const validation = await drainWatch({ ...options, catalog: { [plan.plan_key]: workout }, pendingResults: async () => [JSON.stringify(invalid)] });
    expect(validation[0].reason).toContain("actuals"); expect(validation[0].discardable).toBe(true); expect(marks).toBe(0);
  });
  it("expires collision notices at the account's local midnight", async () => {
    const store = setup(); await store.load(); await store.start(workout, source, "phone", Date.parse(start));
    await drainWatch({ store, account, generation: 1, catalog: { [plan.plan_key]: workout }, current: () => true,
      pendingResults: async () => [JSON.stringify(result())], markImported: async () => {} });
    expect(watchCollisions(store.snapshot(), "2026-11-17", "Pacific/Guam")).toHaveLength(1);
    expect(watchCollisions(store.snapshot(), "2026-11-18", "Pacific/Guam")).toHaveLength(0);
  });
  it("blocks a permanently rejected Open timer without dropping scores or blocking the remaining queue", async () => {
    const store = setup(async () => { throw Object.assign(Error("Workout rejected"), { status: 422 }); });
    await store.load(); const r = result(); r.plan = { ...plan, source: undefined, title: "Open timer" };
    r.parts = [{ ...r.parts[0], block_id: "timer" }]; r.actuals = []; r.results = [{ block_id: "timer", kind: "rounds_reps", origin: "watch", rounds: 2 }];
    const next = result(); next.client_session_id = "88753900-0192-4f86-879a-7ba599178691";
    await drainWatch({ store, account, generation: 1, catalog: { [plan.plan_key]: workout }, current: () => true,
      pendingResults: async () => [JSON.stringify(next)], markImported: async () => {} });
    await drainWatch({ store, account, generation: 1, catalog: {}, current: () => true,
      pendingResults: async () => [JSON.stringify(r)], markImported: async () => {} });
    let sent = 0; await store.sync(async request => {
      sent++; expect(request.client_session_id).toBe(next.client_session_id);
      return { id: "server", generation: 1, client_session_id: request.client_session_id, title: "Saved", started_at: start,
        status: request.status, content: { ...request, prescription_snapshot: workout } };
    });
    const item = store.snapshot().history.find(h => h.watch_quick)!;
    expect(sent).toBe(1); expect(item.state).toBe("blocked"); expect(item.rejection_status).toBe(422); expect(item.watch_quick).toBe(true);
    expect(item.request.results).toEqual(r.results); expect(item.unsent_results).toBeUndefined();
    expect(item.problem).toContain("Could not create this Open timer workout");
  });

});

it("offers discard only for permanent refusal categories, never another owner or transient storage failures", async () => {
  const store = setup(); await store.load();
  const other = result(); other.plan = { ...plan, account_key: "other:1" };
  const unsupported = { ...result(), v: 2 };
  const options = { store, account, generation: 1, current: () => true, catalog: { [plan.plan_key]: workout }, markImported: async () => {} };
  const issues = await drainWatch({ ...options, pendingResults: async () => [JSON.stringify(other), JSON.stringify(unsupported)] });
  expect(issues.map(i => i.discardable)).toEqual([false, true]);
  expect(issues[0].title).toBe("Watch result");
  const failed = await drainWatch({ ...options, store: { ...store, importWatch: async () => { throw Error("disk locked"); } },
    pendingResults: async () => [JSON.stringify(result())] });
  expect(failed[0].discardable).toBe(false);
});
it("retains snapshots through day 45 and preserves sent timestamps for unchanged snapshots", () => {
  const now = Date.parse(end);
  const prior = { old: { ...workout, watch_cached_at: now - 44 * 86400000 } };
  expect(pruneWatchCatalog(prior, {}, [], now).old).toEqual(prior.old);
  const sent = pruneWatchCatalog({}, { sent: workout }, [], now);
  expect(pruneWatchCatalog(sent, { sent: workout }, [], now + 300)).toEqual(sent);
  expect(pruneWatchCatalog(sent, { sent: workout }, [], now + 2 * 86400000)).toEqual(sent);
  expect(pruneWatchCatalog(sent, { sent: { ...workout, title: "Edited" } }, [], now + 2 * 86400000).sent.watch_cached_at).toBe(now + 2 * 86400000);
});
it("bounds imported IDs on load and write and still dedupes recent replay after reload", async () => {
  const disk = new Map<string, string>();
  const ids = Array.from({ length: 510 }, (_, i) => `receipt-${i}`);
  disk.set(trainingKey("synthetic", 1), JSON.stringify({ version: 1, generation: 1, active: null, history: [], watch_imported: ids }));
  const storage = { getItem: async (key: string) => disk.get(key) ?? null, setItem: async (key: string, value: string) => { disk.set(key, value); }, removeItem: async () => {} };
  const store = createTrainingStore(storage, "synthetic", 1); await store.load();
  expect(store.snapshot().watch_imported).toEqual(ids.slice(-500));
  await drainWatch({ store, account, generation: 1, current: () => true, catalog: { [plan.plan_key]: workout },
    pendingResults: async () => [JSON.stringify(result())], markImported: async () => {} });
  expect(store.snapshot().watch_imported).toHaveLength(500);
  const reloaded = createTrainingStore(storage, "synthetic", 1); await reloaded.load();
  await drainWatch({ store: reloaded, account, generation: 1, current: () => true, catalog: {},
    pendingResults: async () => [JSON.stringify(result())], markImported: async () => {} });
  expect(reloaded.snapshot().history).toHaveLength(1);
});
