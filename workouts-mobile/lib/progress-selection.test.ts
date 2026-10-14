import { expect, it, vi } from "vitest";
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { selectProgressSessions, missingProgressParents, loadProgressAncestry, effectiveTrainingHistory } from "./progress-selection";
import { activityFrequency } from "./activity-log";
import { createTrainingStore, type SavedLocalSession } from "./training";
import type { TrainingSession, Workout } from "./models";
import { previousActual, stepsFor } from "./training";
import { sessionsQuery, sessionReadStartedAt } from "./session-query";
import { completedProgramSessions, programSessionKey } from "./program-session-identity";

const workout: Workout = { id: "workout", generation: 1, revision: 1, title: "Strength", kind: "session", provenance: "user",
  blocks: [{ id: "main", label: "Strength", grouping: "sequential", exercises: [{ name: "Row", sets: 2, reps_min: 8, reps_max: 8 }] }] };
function saved(id = "A", previous?: string): TrainingSession {
  return { id, client_session_id: `client-${id}`, generation: 1, title: workout.title,
    started_at: "2026-10-10T00:00:00Z", status: "completed", duration_minutes: 2,
    content: { client_session_id: `client-${id}`, workout_id: workout.id, workout_revision: 1,
      started_at: "2026-10-10T00:00:00Z", finished_at: "2026-10-10T00:02:00Z", status: "completed",
      prescription_snapshot: workout, ...(previous ? { supersedes_session_id: previous } : {}),
      actuals: [8, 7].map((reps, i) => ({ block_id: "main", exercise_index: 0, round_index: 1, set_index: i + 1, side: null, reps, completed: true })) } };
}
function local(record: TrainingSession, state: SavedLocalSession["state"] = "synced"): SavedLocalSession {
  const { prescription_snapshot, ...request } = record.content;
  return { generation: record.generation, workout: prescription_snapshot, request, state,
    ...(state === "synced" ? { synced_id: record.id } : {}), ...(state === "blocked" ? { problem: "Review the conflict" } : {}) };
}
it("last performance uses the latest other-device result and excludes rejected/pending corrections", () => {
  const old = saved(), corrected = saved("C", "omitted-intermediate"), pending = saved("pending", "A");
  corrected.content.actuals[1].reps = 12; pending.content.actuals[1].reps = 99;
  corrected.content.actuals.forEach((actual) => { delete actual.side; }); // Older records may omit the optional side.
  const history = effectiveTrainingHistory([local(pending, "blocked"), local(old)], [corrected], 1);
  expect(history).toHaveLength(1);
  expect(previousActual(workout, stepsFor(workout)[0], history.map((h) => ({ workout: h.workout, actuals: h.request.actuals })))?.reps).toBe(12);
  expect(effectiveTrainingHistory([local(pending, "queued"), local(old)], [corrected], 1)).toEqual(history);
});
it("offline history keeps the accepted correction and orders new on-device work by training date", () => {
  const old = saved(), correction = saved("B", "A"), newer = saved("newer");
  newer.content.started_at = "2026-10-12T00:00:00Z";
  const selected = effectiveTrainingHistory([local(correction), local(old), local(newer, "queued")], undefined, 1);
  expect(selected.map((h) => h.request.client_session_id)).toEqual(["client-newer", "client-B"]);
});
it("a newly acknowledged result stays effective until the server cache catches up", () => {
  const result = local(saved()); result.synced_at = 200;
  expect(effectiveTrainingHistory([result], [], 1, 100)).toHaveLength(1);
  expect(effectiveTrainingHistory([result], [], 1, 300)).toHaveLength(0);
});
it("a late initial QueryObserver read cannot retire a real acknowledged save, including reused post-sync refetch", async () => {
  let clock = 100, resolveRead!: (value: TrainingSession[]) => void;
  const date = vi.spyOn(Date, "now").mockImplementation(() => clock);
  const cache = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  const api = { sessions: vi.fn(() => new Promise<TrainingSession[]>((resolve) => { resolveRead = resolve; })) };
  const observer = new QueryObserver(cache, sessionsQuery(api, "owner", { enrolled: true, generation: 1 }));
  const unsubscribe = observer.subscribe(() => undefined);
  try {
    expect(api.sessions).toHaveBeenCalledTimes(1);
    const map = new Map<string, string>();
    const store = createTrainingStore({ getItem: async (key) => map.get(key) ?? null,
      setItem: async (key, value) => { map.set(key, value); }, removeItem: async (key) => { map.delete(key); } }, "owner", 1, () => clock);
    await store.load();
    await store.start(workout, { program_id: "plan", program_revision: 1, program_session_id: "today" }, "real-client");
    await store.activityType("strength_training");
    for (const actual of saved().content.actuals) await store.log(actual);
    await store.finish("completed");
    clock = 200;
    await store.sync(async (request) => ({ id: "server-saved", generation: 1,
      client_session_id: request.client_session_id, title: workout.title, started_at: request.started_at, status: request.status,
      content: { ...request, prescription_snapshot: workout } }));
    expect(store.snapshot().history[0].synced_at).toBe(200);
    const afterSync = observer.refetch(); // No cached data: React Query reuses the already-running GET.
    expect(api.sessions).toHaveBeenCalledTimes(1);
    clock = 300; resolveRead([]);
    const stale = await afterSync;
    expect(stale.dataUpdatedAt).toBe(300);
    expect(sessionReadStartedAt(stale.data)).toBe(100);
    const key = programSessionKey("plan", "today")!;
    expect(completedProgramSessions(stale.data, store.snapshot().history, 1, sessionReadStartedAt(stale.data)).has(key)).toBe(true);
    expect(effectiveTrainingHistory(store.snapshot().history, stale.data, 1, sessionReadStartedAt(stale.data))).toHaveLength(1);
    // A genuinely later complete read can confirm removal/supersession. Even
    // []→[] must replace the read boundary rather than structurally reuse it.
    clock = 400; api.sessions.mockResolvedValueOnce([]);
    const fresh = await observer.refetch();
    expect(api.sessions).toHaveBeenCalledTimes(2);
    expect(sessionReadStartedAt(fresh.data)).toBe(400);
    expect(effectiveTrainingHistory(store.snapshot().history, fresh.data, 1, sessionReadStartedAt(fresh.data))).toHaveLength(0);
  } finally { unsubscribe(); cache.clear(); date.mockRestore(); }
});
const frequency = (selection: ReturnType<typeof selectProgressSessions>) =>
  activityFrequency([], selection.sessions, "UTC", "2026-10-04", "2026-10-10");

it.each(["queued", "synced", "blocked"] as const)("counts one workout family for a %s correction while the original server query stays stale", (state) => {
  const original = saved(), correction = saved("B", "A"); correction.content.actuals[1].reps = 6;
  const device = [local(correction, state), local(original)]; const before = JSON.stringify([device, original]);
  const result = selectProgressSessions(device, [original], 1);
  expect(frequency(result)).toEqual({ days: 1, sessions: 1, activities: 0 });
  if (state === "blocked") {
    expect(result.local.map((x) => x.request.client_session_id)).toEqual(expect.arrayContaining(["client-A", "client-B"]));
    expect(result.local.find((x) => x.state === "blocked")?.problem).toBe("Review the conflict");
  } else {
    expect(result.local.map((x) => x.request.client_session_id)).toEqual(["client-B"]);
    expect(result.remote).toEqual([]);
  }
  expect(JSON.stringify([device, original])).toBe(before);
});

it("real training.correct queues 8/6 without rewriting 8/7; immediate, acknowledged and refreshed progress each count one", async () => {
  const map = new Map<string, string>();
  const store = createTrainingStore({ getItem: async (key) => map.get(key) ?? null,
    setItem: async (key, value) => { map.set(key, value); }, removeItem: async (key) => { map.delete(key); } }, "owner", 1);
  await store.load(); const original = saved(); const before = JSON.stringify(original);
  const actuals = original.content.actuals.map((x, i) => ({ ...x, reps: i === 1 ? 6 : 8 }));
  await store.correct(original, actuals, "Corrected reps", "correction-client");
  expect(frequency(selectProgressSessions(store.snapshot().history, [original], 1)).sessions).toBe(1);
  const accepted = saved("B", "A"); accepted.client_session_id = "correction-client";
  accepted.content = { ...accepted.content, client_session_id: "correction-client", actuals };
  await store.sync(async (request) => { expect(request.supersedes_session_id).toBe("A"); return accepted; });
  expect(frequency(selectProgressSessions(store.snapshot().history, [original], 1)).sessions).toBe(1);
  expect(frequency(selectProgressSessions(store.snapshot().history, [accepted], 1)).sessions).toBe(1);
  expect(JSON.stringify(original)).toBe(before);
  expect(store.snapshot().history[0].request.actuals.map((x) => x.reps)).toEqual([8, 6]);
});

it("unions multi-step chains across local synced aliases and overlapping server pages", () => {
  const a = saved(), b = saved("B", "A"), c = saved("C", "B");
  const result = selectProgressSessions([local(c, "queued"), local(b), local(a)], [a, b, b], 1);
  expect(frequency(result).sessions).toBe(1); expect(result.local.map((x) => x.request.client_session_id)).toEqual(["client-C"]);
  expect(result.remote).toHaveLength(0);
  const remote = selectProgressSessions([], [a, b, c, c], 1);
  expect(remote.remote.map((x) => x.id)).toEqual(["C"]); expect(frequency(remote).sessions).toBe(1);
});

it("hydrates an omitted intermediate server revision so an old device original joins the latest server leaf", async () => {
  const a = saved(), b = saved("B", "A"), c = saved("C", "B");
  const parents = missingProgressParents([local(a)], [c], 1); expect(parents).toEqual(["B"]);
  const load = vi.fn(async (id: string) => { expect(id).toBe("B"); return b; });
  const ancestry = await loadProgressAncestry(parents, load, 1, 64, ["A", "C"]);
  expect(load).toHaveBeenCalledOnce(); expect(ancestry.complete).toBe(true);
  const result = selectProgressSessions([local(a)], [c], 1, ancestry.records);
  expect(frequency(result).sessions).toBe(1); expect(result.local).toHaveLength(0); expect(result.remote[0].id).toBe("C");
});

it("keeps blocked and competing queued review controls while counting one family", () => {
  const a = saved(), b = local(saved("B", "A"), "queued"), c = local(saved("C", "A"), "queued"), d = local(saved("D", "A"), "blocked");
  const result = selectProgressSessions([c, b, d, local(a)], [a], 1);
  expect(frequency(result).sessions).toBe(1);
  expect(result.local.map((x) => x.request.client_session_id)).toEqual(expect.arrayContaining(["client-B", "client-C", "client-D"]));
  expect(result.local.find((x) => x.state === "blocked")?.problem).toBe("Review the conflict");
});

it("counts partial actuals and distinct same-day workouts without treating elapsed or skipped work as recorded", () => {
  const a = saved(), b = saved("B"), skipped = saved("skipped");
  b.status = b.content.status = "partial"; b.content.actuals = b.content.actuals.slice(0, 1);
  skipped.content.actuals.forEach((x) => { x.completed = false; });
  const result = selectProgressSessions([local(a)], [a, b, skipped], 1);
  expect(frequency(result)).toEqual({ days: 1, sessions: 2, activities: 0 });
});

it("a queued correction can remove recorded sets, but a blocked correction cannot replace accepted actuals", () => {
  const a = saved(), b = saved("B", "A"); b.content.actuals.forEach((x) => { x.completed = false; });
  expect(frequency(selectProgressSessions([local(b, "queued"), local(a)], [a], 1)).sessions).toBe(0);
  expect(frequency(selectProgressSessions([local(b, "blocked"), local(a)], [a], 1)).sessions).toBe(1);
});

it("a server-accepted competing correction takes precedence without hiding the stale device queue", () => {
  const a = saved(), remote = saved("B", "A"), stale = local(saved("C", "A"), "queued");
  stale.request.actuals = [];
  const result = selectProgressSessions([stale, local(a)], [remote], 1);
  expect(frequency(result).sessions).toBe(1);
  expect(result.remote).toEqual([remote]); expect(result.local).toEqual([stale]);
  expect(result.conflictingQueued).toEqual([stale.request.client_session_id]);
  expect(stale.state).toBe("queued");
});

it("never mixes membership generations or lets a blocked reused client identity overwrite server actuals", () => {
  const original = saved(), old = saved("old"); old.generation = 2;
  const conflicting = local(original, "blocked"); conflicting.request.actuals = []; conflicting.request.supersedes_session_id = "old";
  const result = selectProgressSessions([conflicting, local(old)], [original, old], 1);
  expect(frequency(result).sessions).toBe(1); expect(result.remote).toEqual([original]);
  expect(result.local).toEqual([conflicting]);
});

it("ancestry failures, mismatched identity/generation, and read limits fail closed without leaking transport errors", async () => {
  const failed = await loadProgressAncestry(["B"], async () => { throw Error("private error body"); }, 1);
  expect(failed).toEqual({ records: [], complete: false });
  expect(await loadProgressAncestry(["B"], async () => saved("other"), 1)).toEqual(failed);
  const wrongGeneration = saved("B"); wrongGeneration.generation = 2;
  expect(await loadProgressAncestry(["B"], async () => wrongGeneration, 1)).toEqual(failed);
  const load = vi.fn(async (id: string) => saved(id, `${id}-parent`));
  const limited = await loadProgressAncestry(["B"], load, 1, 2);
  expect(limited.complete).toBe(false); expect(load).toHaveBeenCalledTimes(2);
});

it("ancestry cancellation, elapsed admission time and retained payload limits stop before any further reads", async () => {
  const controller = new AbortController();
  const load = vi.fn(async (id: string) => { controller.abort(); return saved(id, "parent"); });
  expect(await loadProgressAncestry(["B"], load, 1, 64, [], { signal: controller.signal })).toEqual({ records: [], complete: false });
  expect(load).toHaveBeenCalledOnce();
  let time = 0;
  const slow = vi.fn(async (id: string) => { time = 16000; return saved(id, "parent"); });
  expect(await loadProgressAncestry(["B"], slow, 1, 64, [], { now: () => time })).toEqual({ records: [], complete: false });
  expect(slow).toHaveBeenCalledOnce();
  const large = vi.fn(async (id: string) => saved(id, "parent"));
  expect(await loadProgressAncestry(["B"], large, 1, 64, [], { maxCharacters: 10 })).toEqual({ records: [], complete: false });
  expect(large).toHaveBeenCalledOnce();
});
