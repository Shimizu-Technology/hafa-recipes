import { describe, expect, it, vi } from "vitest";
import { nov17Class as w } from "./fixtures/nov17-class";
import { buyInDone, endPart, planClass, setRun, skipPart, startPart, tapRound, type PartResult } from "./class-session";
import { classPayload, cleanScore, parseTime, scoreProblem, scoredParts, wodupScore, wodupText } from "./class-scores";
import { endClass } from "./class-training";
import { createTrainingStore, pruneHistory, syncedHistoryLimit, unsentProblem } from "./training";
import { createWorkoutsApi } from "./api";
import type { SessionRequest, TrainingSession } from "./models";

const min = 60_000;
const T0 = Date.parse("2026-11-17T17:30:00Z");
const iso = (ms: number) => new Date(T0 + ms).toISOString();
function device() {
  const data = new Map<string, string>();
  return { getItem: async (k: string) => data.get(k) ?? null, setItem: async (k: string, v: string) => { data.set(k, v); }, removeItem: async () => {} };
}
/** A and B on the clock: A's buy-in on a treadmill at 6:00 and two rounds; B capped during its buy-in; C and D skipped. */
async function classDay() {
  let now = T0;
  const store = createTrainingStore(device(), "owner", 1, () => now);
  await store.load();
  await store.start(w, { workout_id: w.id, workout_revision: 1 }, "11111111-1111-4111-8111-111111111111", now);
  await store.classAct(startPart);
  await store.classAct((r, wk, at) => setRun(r, wk, 0, "treadmill", undefined, at), now, "treadmill");
  now = T0 + 6 * min; await store.classAct(buyInDone);
  now = T0 + 10 * min; await store.classAct(tapRound);
  now = T0 + 14 * min; await store.classAct(tapRound);
  now = T0 + 34 * min; // B ran its whole cap in the buy-in.
  await store.classAct(skipPart); await store.classAct(skipPart);
  return { store, at: (ms: number) => (now = T0 + ms) };
}

describe("class results and splits (W2 contract)", () => {
  it("scores each scored part, splits rounds, and adds the rest after A on A", async () => {
    const { store } = await classDay();
    const d = store.snapshot().active!;
    const { results, segments } = classPayload(d.class_run!, d.workout, T0 + 34 * min, d.actuals);
    expect(results).toEqual([
      { block_id: "a", kind: "rounds_reps", rounds: 2, reps: 0, buy_in_done: true, buy_in_seconds: 360, origin: "timer", started_at: iso(0), ended_at: iso(15 * min) },
      { block_id: "b", kind: "rounds_reps", buy_in_done: false, distance_meters: 0, origin: "timer", started_at: iso(18 * min), ended_at: iso(33 * min) },
    ]);
    expect(segments).toEqual([
      { block_id: "a", kind: "buy_in", index: 1, label: "Run", started_at: iso(0), ended_at: iso(6 * min),
        run_environment: "treadmill", distance_meters: 1000, distance_source: "prescribed" },
      { block_id: "a", kind: "round", index: 1, started_at: iso(6 * min), ended_at: iso(10 * min), run_environment: "treadmill", distance_meters: 400, distance_source: "prescribed" },
      { block_id: "a", kind: "round", index: 2, started_at: iso(10 * min), ended_at: iso(14 * min), run_environment: "treadmill", distance_meters: 400, distance_source: "prescribed" },
      { block_id: "a", kind: "rest", index: 1, started_at: iso(15 * min), ended_at: iso(18 * min) },
    ]);
  });
  it("saves reviewed scores with the session, keeping the clock's timestamps, and an edited treadmill distance", async () => {
    const { store } = await classDay();
    await store.classScore("a", { block_id: "a", kind: "rounds_reps", rounds: 2, reps: 12, buy_in_done: true, buy_in_seconds: 360, scaling: "rx", origin: "manual",
      started_at: iso(1), ended_at: iso(2) });
    await store.classScore("b", { block_id: "b", kind: "rounds_reps", buy_in_done: false, distance_meters: 900, scaling: "scaled", scaling_note: "14 lb ball", origin: "timer" });
    await store.classRunDistance("a", 0, 950);
    await expect(store.classScore("a", { block_id: "a", kind: "rounds_reps", rounds: 1.5, reps: 0, origin: "manual" })).rejects.toThrow("whole numbers");
    await store.finish("partial", undefined, "keep", "general_fitness");
    const request = store.snapshot().history[0].request;
    expect(request.recorded_on).toBe("phone");
    expect(request.results![0]).toMatchObject({ rounds: 2, reps: 12, scaling: "rx", origin: "timer", started_at: iso(0), ended_at: iso(15 * min) });
    expect(request.results![1]).toMatchObject({ buy_in_done: false, distance_meters: 900, scaling: "scaled", scaling_note: "14 lb ball" });
    expect(request.segments![0]).toMatchObject({ kind: "buy_in", distance_meters: 950, distance_source: "edited", run_environment: "treadmill" });
    // Every split and score lies inside the session.
    for (const item of [...request.results!, ...request.segments!])
      expect(Date.parse(item.ended_at!) <= Date.parse(request.finished_at) && Date.parse(item.started_at!) >= Date.parse(request.started_at)).toBe(true);
    expect(wodupText(w, request.results!, request.segments)).toBe([
      "BUILD | BRIK · Tue Nov 17",
      "A: 2 rounds + 12 reps · Rx", "  Buy-in 6:00 (treadmill) · Rounds 4:00, 4:00",
      "B: Buy-in · 900 m · Scaled (14 lb ball)",
    ].join("\n"));
  });
  it("says 1 round and 1 rep, not 1 rounds, in the WodUp text", () => {
    const base = { block_id: "b", origin: "timer", scaling: "rx" } as const;
    expect(wodupScore({ ...base, kind: "rounds_reps", rounds: 1, reps: 0, buy_in_done: true } as PartResult)).toBe("1 round + 0 reps");
    expect(wodupScore({ ...base, kind: "rounds_reps", rounds: 2, reps: 1, buy_in_done: true } as PartResult)).toBe("2 rounds + 1 rep");
    expect(wodupScore({ ...base, kind: "time", capped: true, rounds: 1, reps: 1 } as PartResult)).toBe("Capped · 1 round + 1 rep");
  });
  it("never strands a session over a refused score: saves it without scores and keeps them on the device", async () => {
    const { store } = await classDay();
    await store.finish("partial", undefined, "keep", "general_fitness");
    const sent: SessionRequest[] = [];
    const send = vi.fn(async (request: SessionRequest) => {
      sent.push(request);
      if (request.results) throw Object.assign(Error("Some details could not be saved."), { status: 422 });
      return { id: "saved", generation: 1, client_session_id: request.client_session_id } as TrainingSession;
    });
    await store.sync(send);
    expect(sent.map((r) => !!r.results)).toEqual([true, false]);
    const item = store.snapshot().history[0];
    expect(item).toMatchObject({ state: "synced", synced_id: "saved", problem: unsentProblem });
    expect(item.unsent_results?.results).toHaveLength(2);
    expect(item.request.segments).toBeUndefined();
  });
  it("corrects a saved score and sends back only fields the server accepts", async () => {
    const store = createTrainingStore(device(), "owner", 1);
    await store.load();
    const result: PartResult = { block_id: "a", kind: "time", time_seconds: 522, origin: "timer" };
    const saved = { id: "s1", generation: 1, content: { client_session_id: "c1", workout_id: "w", workout_revision: 1, started_at: iso(0), finished_at: iso(20 * min),
      status: "completed", actuals: [], results: [result], results_summary: [{ block_id: "a", is_best: true }], prescription_snapshot: w } } as unknown as TrainingSession;
    await store.correct(saved, [], "", "c2", [{ ...result, time_seconds: 492, scaling: "rx" }]);
    const request = store.snapshot().history[0].request as unknown as Record<string, unknown>;
    expect(request.results).toEqual([{ block_id: "a", kind: "time", time_seconds: 492, capped: false, scaling: "rx", origin: "timer" }]);
    expect(request.results_summary).toBeUndefined();
    expect(request.prescription_snapshot).toBeUndefined();
    expect(request.supersedes_session_id).toBe("s1");
    await expect(store.correct(saved, [], "", "c3", [{ ...result, time_seconds: undefined }])).rejects.toThrow("8:42");
  });
});

describe("score entry", () => {
  it("parses times and checks each kind like the API", () => {
    expect([parseTime("8:42"), parseTime("1:02:03"), parseTime("90"), parseTime("8:75"), parseTime("abc")]).toEqual([522, 3723, 90, null, null]);
    expect(scoreProblem({ block_id: "a", kind: "time", capped: true, rounds: 2, reps: 14, origin: "manual" })).toBeNull();
    expect(scoreProblem({ block_id: "a", kind: "load", load: 100, origin: "manual" })).toMatch("kg or lb");
    // Switching to capped drops the finish time, so the API never sees a value for another kind.
    expect(cleanScore({ block_id: "a", kind: "time", capped: true, time_seconds: 522, rounds: 2, reps: 3, origin: "manual" }))
      .toEqual({ block_id: "a", kind: "time", capped: true, rounds: 2, reps: 3, origin: "manual" });
  });
});

describe("sending scores only to a server that takes them", () => {
  const request: SessionRequest = { client_session_id: "c", workout_id: "w", workout_revision: 1, started_at: iso(0), finished_at: iso(min),
    status: "partial", actuals: [], results: [{ block_id: "a", kind: "completed", origin: "timer" }], recorded_on: "phone" };
  async function sentBody(features?: string[]) {
    const transport = vi.fn(async (url: string) => url.endsWith("/enrollment")
      ? new Response(JSON.stringify({ enrolled: true, generation: 1, disclosure_version: 1, adult_confirmed: true, shared_account_deletion_acknowledged: true,
        enrolled_at: null, ...(features ? { features } : {}) }))
      : new Response(JSON.stringify({ id: "s", generation: 1, client_session_id: "c", content: { prescription_snapshot: w }, created_at: iso(0) }))) as unknown as typeof fetch;
    const api = createWorkoutsApi("https://example.test", async () => "token", transport);
    await api.enrollment();
    await api.saveSession(request, 1);
    return JSON.parse((transport as unknown as ReturnType<typeof vi.fn>).mock.calls[1][1].body);
  }
  it("strips results unless enrollment lists session_results_v1", async () => {
    expect((await sentBody()).results).toBeUndefined();
    expect((await sentBody(["class_parts_v1"])).recorded_on).toBeUndefined();
    expect((await sentBody(["session_results_v1", "class_parts_v1"])).results).toHaveLength(1);
  });
});

describe("review fixes", () => {
  it("End class ends the part on screen and skips the rest without starting or scoring them", async () => {
    let now = T0;
    const store = createTrainingStore(device(), "owner", 1, () => now);
    await store.load(); store.setLeadIn(10);
    await store.start(w, { workout_id: w.id, workout_revision: 1 }, "e1", now);
    await store.classAct(startPart);
    now = T0 + 5 * min; await store.classAct(endClass);
    const d = store.snapshot().active!;
    expect(d.class_run!.parts.map((p) => [p.skipped ?? false, p.started_at != null])).toEqual([[false, true], [true, false], [true, false], [true, false]]);
    expect(classPayload(d.class_run!, w, now, d.actuals).results.map((r) => r.block_id)).toEqual(["a"]);
    await expect(store.finish("completed", undefined, "keep", "general_fitness")).rejects.toThrow("partial");
    // End class during a lead-in skips that part too, so nothing ends in the future.
    const other = createTrainingStore(device(), "owner", 1, () => now);
    await other.load(); other.setLeadIn(10);
    await other.start(w, { workout_id: w.id, workout_revision: 1 }, "e2", now);
    await other.classAct(startPart); await other.classAct(endClass);
    expect(other.snapshot().active!.class_run!.parts[0]).toMatchObject({ skipped: true, ended_at: now });
    await expect(other.finish("partial", undefined, "keep", "general_fitness")).rejects.toThrow("Start a part");
  });
  it("asks for the score a part sets (load) and sends none until it's entered", async () => {
    const scored = { ...w, blocks: [{ ...w.blocks[3], score_kind: "load" as const }, w.blocks[0]] };
    const run = endPart(startPart(planClass(scored), scored, 0), scored, min);
    const [first] = scoredParts(run, scored, min, []);
    expect(first.result).toMatchObject({ block_id: "d", kind: "load" });
    expect(scoreProblem(first.result)).toMatch("kg or lb");
    expect(classPayload(run, scored, min, []).results).toEqual([]);
  });
  it("keeps scores on a 403 that isn't about heart rate", async () => {
    const { store } = await classDay();
    await store.finish("partial", undefined, "keep", "general_fitness");
    await store.sync(async () => { throw Object.assign(Error("enrollment"), { status: 403 }); });
    const item = store.snapshot().history[0];
    expect(item.state).toBe("blocked");
    expect(item.request.results).toHaveLength(2);
    expect(item.unsent_results).toBeUndefined();
  });
});

it("retains feature-gated scores and splits through a successful correction", async () => {
  const { store } = await classDay();
  await store.finish("partial", undefined, "keep", "general_fitness");
  const original = store.snapshot().history[0].request;
  const transport = vi.fn(async (url: string, init?: RequestInit) => new Response(JSON.stringify(url.endsWith("/enrollment")
    ? { enrolled: true, generation: 1 }
    : { id: "saved", generation: 1, client_session_id: original.client_session_id, content: { ...JSON.parse(String(init!.body)), prescription_snapshot: w } })));
  const api = createWorkoutsApi("https://example.test", async () => "token", transport as typeof fetch);
  await api.enrollment(); await store.sync(api.saveSession);
  const retained = store.snapshot().history[0];
  expect(retained).toMatchObject({ state: "synced", problem: unsentProblem, unsent_results: { results: original.results, segments: original.segments } });
  expect(retained.request.results).toBeUndefined();
  const saved = { id: "saved", generation: 1, content: { ...retained.request, prescription_snapshot: w } } as TrainingSession;
  await store.correct(saved, [], "", "correction", retained.unsent_results!.results, retained.unsent_results!.segments);
  const send = vi.fn(async (request: SessionRequest) => ({ ...saved, id: "corrected", content: { ...request, prescription_snapshot: w } }));
  await store.sync(send);
  expect(send.mock.calls[0][0]).toMatchObject({ results: original.results, segments: original.segments, supersedes_session_id: "saved" });
});
it("keeps End class partial during the final timed part", async () => {
  let now = T0;
  const store = createTrainingStore(device(), "owner", 1, () => now);
  await store.load();
  const workout = { ...w, blocks: [w.blocks[0], w.blocks[1]] };
  await store.start(workout, { workout_id: w.id, workout_revision: 1 }, "final", now);
  await store.classAct(startPart); now += 20 * min; await store.classAct(endClass);
  expect(store.snapshot().active!.class_run).toMatchObject({ ended_early: true });
  await expect(store.finish("completed", undefined, "keep", "general_fitness")).rejects.toThrow("partial");
  await store.finish("partial", undefined, "keep", "general_fitness");
  expect(store.snapshot().history[0].request.status).toBe("partial");
});

it("never prunes class scores that exist only on this device", async () => {
  const { store } = await classDay();
  await store.finish("partial", undefined, "keep", "general_fitness");
  await store.sync(async (request) => ({ id: "saved", generation: 1, client_session_id: request.client_session_id,
    title: w.title, started_at: request.started_at, status: request.status, content: { ...request, prescription_snapshot: w },
    unsent_results: { results: request.results, segments: request.segments } }));
  const retained = store.snapshot().history[0];
  const newer = Array.from({ length: syncedHistoryLimit + 5 }, (_, i) => ({ ...retained, unsent_results: undefined,
    request: { ...retained.request, client_session_id: `new-${i}` } }));
  const pruned = pruneHistory([...newer, retained]);
  expect(pruned).toHaveLength(syncedHistoryLimit + 1);
  expect(pruned.at(-1)!.unsent_results).toEqual(retained.unsent_results);
});
it("keeps a completed timed class completed when correcting its score without set actuals", async () => {
  const { store } = await classDay();
  await store.finish("partial", undefined, "keep", "general_fitness");
  const prior = store.snapshot().history[0].request;
  const saved: TrainingSession = { id: "saved", generation: 1, client_session_id: prior.client_session_id, title: w.title,
    started_at: prior.started_at, status: "completed", content: { ...prior, actuals: [], status: "completed", prescription_snapshot: w } };
  await store.correct(saved, [], "Corrected score", "score-correction", prior.results);
  expect(store.snapshot().history[0].request.status).toBe("completed");
});
