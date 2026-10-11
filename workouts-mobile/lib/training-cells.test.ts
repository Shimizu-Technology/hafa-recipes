import { it, expect, vi } from "vitest";
import { spawnSync } from "node:child_process";
import { createTrainingStore, actualIdentity, draftStructureWarning, stepsFor, trainingKey, historicalStructureWarning } from "./training";
import { createWorkoutsApi } from "./api";
import type { ActualSet, Workout } from "./models";
function workout(grouping: "sequential" | "circuit" | "superset" | "interval" = "superset", rounds = 2, sets = 1, per_side = true): Workout {
  return { id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", revision: 1, generation: 1, title: "Explicit cells", kind: "session", provenance: "user",
    blocks: [{ id: "main", label: "Main", grouping, rounds, exercises: [{ name: "Exercise", sets, per_side, reps_min: 8, reps_max: 10, duration_seconds: null }] }] };
}
function memory() {
  const data = new Map<string, string>();
  return { data, getItem: async (key: string) => data.get(key) ?? null,
    setItem: async (key: string, value: string) => { data.set(key, value); }, removeItem: async (key: string) => { data.delete(key); } };
}
function actual(store: ReturnType<typeof createTrainingStore>): ActualSet {
  const step = store.snapshot().active!.steps[store.snapshot().active!.cursor];
  return { block_id: step.block_id, exercise_index: step.exercise_index, round_index: step.round_index, set_index: step.set_index, side: step.side, reps: 10, completed: true };
}
it("uses per-round set indices and full collision-free UI identities for unilateral and bilateral groups", () => {
  for (const grouping of ["sequential", "circuit", "superset", "interval"] as const) {
    for (const perSide of [true, false]) {
      const steps = stepsFor(workout(grouping, 2, 2, perSide));
      expect(steps.map((s) => [s.round_index, s.set_index, s.side])).toEqual(perSide ?
        [[1, 1, "left"], [1, 1, "right"], [1, 2, "left"], [1, 2, "right"], [2, 1, "left"], [2, 1, "right"], [2, 2, "left"], [2, 2, "right"]] :
        [[1, 1, null], [1, 2, null], [2, 1, null], [2, 2, null]]);
      expect(new Set(steps.map((s) => s.key)).size).toBe(steps.length);
      expect(steps.every((s) => s.key === actualIdentity(s) && s.set_index === s.target_set)).toBe(true);
    }
  }
  expect(actualIdentity({ block_id: "a:b", exercise_index: 0, round_index: 1, set_index: 1, side: null })).not.toBe(
    actualIdentity({ block_id: "a", exercise_index: 0, round_index: 1, set_index: 1, side: null }));
});
it("allocates deliberate extra paired sets within only the current round and survives undo/restart", async () => {
  const storage = memory(), store = createTrainingStore(storage, "owner", 1);
  await store.load();
  await store.start(workout(), { workout_id: workout().id, workout_revision: 1 }, "client");
  await store.addSet();
  await store.addSet();
  expect(store.snapshot().active!.steps.map((s) => [s.round_index, s.set_index, s.side])).toEqual(
    [[1, 1, "left"], [1, 1, "right"], [1, 2, "left"], [1, 2, "right"], [1, 3, "left"], [1, 3, "right"], [2, 1, "left"], [2, 1, "right"]]);
  await store.log(actual(store));
  await store.undo();
  await store.log(actual(store));
  const recovered = createTrainingStore(storage, "owner", 1);
  await recovered.load();
  while (recovered.snapshot().active!.cursor < recovered.snapshot().active!.steps.length) await recovered.log(actual(recovered));
  await recovered.activityType("strength_training");
  await recovered.finish("completed");
  const rows = recovered.snapshot().history[0].request.actuals;
  expect(new Set(rows.map(actualIdentity)).size).toBe(8);
  expect(rows.filter((a) => a.round_index === 2).every((a) => a.set_index === 1)).toBe(true);
});
it("checks canonical per-round limits rather than rejecting 100 distinct left/right/round cells", () => {
  expect(stepsFor(workout("circuit", 5, 100, true))).toHaveLength(1000);
  expect(() => stepsFor(workout("circuit", 6, 100, true))).toThrow("too many");
});
it("rejects a duplicate actual cell, even when a stale cursor tries to log it twice", async () => {
  const storage = memory(), store = createTrainingStore(storage, "owner", 1);
  await store.load();
  await store.start(workout(), { workout_id: workout().id, workout_revision: 1 }, "client");
  await store.log(actual(store));
  const state = JSON.parse(storage.data.get(trainingKey("owner", 1))!);
  state.active.cursor = 0;
  storage.data.set(trainingKey("owner", 1), JSON.stringify(state));
  const reopened = createTrainingStore(storage, "owner", 1);
  await reopened.load();
  await expect(reopened.log(actual(reopened))).rejects.toThrow("already has");
  expect(reopened.snapshot().active!.actuals).toHaveLength(1);
});
async function legacyFixture() {
  const storage = memory(), store = createTrainingStore(storage, "owner", 1, () => 10000);
  await store.load();
  await store.start(workout(), { workout_id: workout().id, workout_revision: 1 }, "client");
  await store.activityType("strength_training");
  const state = JSON.parse(storage.data.get(trainingKey("owner", 1))!);
  delete state.active.cell_identity_version;
  state.active.steps.forEach((s: { set_index: number }, index: number) => { s.set_index = index + 1; });
  state.active.actuals = state.active.steps.slice(0, 2).map((s: ActualSet) => ({ block_id: s.block_id, exercise_index: s.exercise_index, round_index: s.round_index, set_index: s.set_index, side: s.side, completed: true, reps: 10 }));
  state.active.cursor = 2;
  state.active.undo = [{ actuals: [], cursor: 0 }, { actuals: state.active.actuals.slice(0, 1), cursor: 1 }];
  storage.data.set(trainingKey("owner", 1), JSON.stringify(state));
  const reopened = createTrainingStore(storage, "owner", 1, () => 20000);
  await reopened.load();
  return { storage, reopened, original: state.active.actuals };
}
it("keeps legacy recorded actuals unchanged, requires explicit empty-draft review, and restores canonical pending cells", async () => {
  const { reopened, original } = await legacyFixture();
  expect(draftStructureWarning(reopened.snapshot().active!)).toContain("older set numbering");
  await expect(reopened.log(actual(reopened))).rejects.toThrow("older set numbering");
  await expect(reopened.addSet()).rejects.toThrow("older set numbering");
  await expect(reopened.reviewEmptyDraft()).rejects.toThrow("Undo recorded");
  expect(reopened.snapshot().active!.actuals).toEqual(original);
  await reopened.undo(); await reopened.undo();
  expect(reopened.snapshot().active!.actuals).toEqual([]);
  expect(draftStructureWarning(reopened.snapshot().active!)).toContain("older set numbering");
  await reopened.reviewEmptyDraft();
  expect(draftStructureWarning(reopened.snapshot().active!)).toBeNull();
  expect(reopened.snapshot().active!.steps.map((s) => s.set_index)).toEqual([1, 1, 1, 1]);
  while (reopened.snapshot().active!.cursor < reopened.snapshot().active!.steps.length) await reopened.log(actual(reopened));
  expect(new Set(reopened.snapshot().active!.actuals.map(actualIdentity)).size).toBe(4);
});
it("keeps old queued bodies/UUIDs unchanged across lost responses, warns truthfully, and never reindexes synced history", async () => {
  const { storage, reopened, original } = await legacyFixture();
  await expect(reopened.finish("completed")).rejects.toThrow("Older set numbering");
  await reopened.finish("partial");
  const before = structuredClone(reopened.snapshot().history[0].request);
  const send = vi.fn().mockRejectedValueOnce(Error("lost response")).mockResolvedValue({ id: "cloud" });
  await reopened.sync(send); await reopened.sync(send);
  expect(send.mock.calls.map((c) => c[0])).toEqual([before, before]);
  expect(reopened.snapshot().history[0].request.actuals).toEqual(original);
  expect(reopened.snapshot().history[0].state).toBe("synced");
  expect(reopened.snapshot().history[0].problem).toContain("unchanged");
  const later = createTrainingStore(storage, "owner", 1);
  await later.load();
  expect(later.snapshot().history[0].request).toEqual(before);
  expect(historicalStructureWarning(workout(), original)).toContain("automatic progression");
});
// Root runs this explicit cross-domain gate with a verified backend checkout/Python.
// It compiles the actual backend validators/cell functions without booting its app,
// importing settings, opening a database, or reading credentials. It is not a mirror.
it.skipIf(!process.env.WORKOUTS_BACKEND_ROOT || !process.env.WORKOUTS_BACKEND_PYTHON)("native store → API wire payload satisfies real backend schema and continuity cell contract", async () => {
  const root = process.env.WORKOUTS_BACKEND_ROOT!, python = process.env.WORKOUTS_BACKEND_PYTHON!;
  const bridge = String.raw`
import ast, json, sys, hashlib
from pathlib import Path
from types import SimpleNamespace
from typing import Literal
from uuid import UUID
from pydantic import AwareDatetime, BaseModel, ConfigDict, Field, StrictBool, model_validator
root=Path(sys.argv[1])
ns=dict(globals())
for file, names in [('schemas.py', {'DomainModel'}), ('router.py', {'ActualSet','ActiveInterval','SessionRequest'}), ('coach_continuity.py', {'expected_cells','actual_cells'})]:
    path=root/'api/app/domains/workouts'/file
    tree=ast.parse(path.read_text())
    nodes=[node for node in tree.body if isinstance(node,(ast.ClassDef,ast.FunctionDef)) and node.name in names]
    assert {node.name for node in nodes} == names, f'Missing authoritative definitions in {path.name}'
    exec(compile(ast.Module(body=nodes,type_ignores=[]),str(path),'exec'),ns)
fixture=json.load(sys.stdin)
request=ns['SessionRequest'].model_validate(fixture['request'])
content=request.model_dump(mode='json')
results=[]
for raw in fixture['workout']['blocks']:
    block=SimpleNamespace(**{**raw, 'exercises':[SimpleNamespace(**e) for e in raw['exercises']]})
    for index in range(len(block.exercises)):
        expected=ns['expected_cells'](block,index)
        cells=ns['actual_cells'](content,block,index)
        results.append({'eligible':expected is not None,'matches':expected is not None and cells is not None and set(cells)==expected,'actual_count':len(cells) if cells else 0})
print(json.dumps({'results':results,'schema_valid':True,'continuity_sha256':hashlib.sha256((root/'api/app/domains/workouts/coach_continuity.py').read_bytes()).hexdigest()}))
`;
  for (const [grouping, rounds, sets, perSide, eligible] of [
    ["superset", 2, 1, true, true], ["circuit", 2, 2, false, true], ["interval", 2, 1, true, true],
    ["sequential", 1, 2, true, true], ["sequential", 2, 2, false, false], ["sequential", 2, 1, true, false],
  ] as const) {
    const w = workout(grouping, rounds, sets, perSide), store = createTrainingStore(memory(), "owner", 1, () => 10000);
    await store.load(); await store.start(w, { workout_id: w.id, workout_revision: 1 }, "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
    while (store.snapshot().active!.cursor < store.snapshot().active!.steps.length) await store.log(actual(store));
    await store.activityType("strength_training"); await store.finish("completed", 20000);
    let body = "";
    const api = createWorkoutsApi("https://example.test", async () => "fixture-token", (async (_url, init) => {
      body = String(init!.body);
      expect((init!.headers as Record<string,string>)["X-Workouts-Generation"]).toBe("1");
      return new Response(JSON.stringify({ id: "saved", generation: 1, client_session_id: JSON.parse(body).client_session_id, content: { ...JSON.parse(body), prescription_snapshot: w } }));
    }) as typeof fetch);
    await store.sync(api.saveSession);
    expect(store.snapshot().history[0].state).toBe("synced");
    const result = spawnSync(python, ["-c", bridge, root], { input: JSON.stringify({ request: JSON.parse(body), workout: w }), encoding: "utf8", timeout: 10000 });
    expect(result.status, result.stderr).toBe(0);
    const checked = JSON.parse(result.stdout);
    expect(checked.schema_valid).toBe(true);
    expect(checked.results[0]).toEqual({ eligible, matches: eligible, actual_count: rounds * sets * (perSide ? 2 : 1) });
    if (eligible && (perSide || rounds > 1)) {
      // Reproduce the old global ordinal on the same genuine finished payload:
      // the real schema accepts historical actuals, but continuity must hold.
      const old = JSON.parse(body);
      old.actuals.forEach((a: ActualSet, i: number) => { a.set_index = i + 1; });
      const legacy = spawnSync(python, ["-c", bridge, root], { input: JSON.stringify({ request: old, workout: w }), encoding: "utf8", timeout: 10000 });
      expect(legacy.status, legacy.stderr).toBe(0);
      expect(JSON.parse(legacy.stdout).results[0]).toMatchObject({ eligible: true, matches: false });
    }
  }
}, 30000);
