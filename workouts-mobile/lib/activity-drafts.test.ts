import { it, expect } from "vitest";
import { createActivityDraftStore } from "./activity-drafts";
import { activityBody, type ActivityDraft, type ActivityOperation } from "./activity-log";
import { createPrivateStorageRegistry } from "./private-storage";
const input: ActivityDraft = {
  owner: "A",
  generation: 2,
  target_id: null,
  kind: "walk",
  date: "2026-10-10",
  name: "",
  duration: "20",
  distance: "",
  distance_unit: "km",
  notes: "",
  strenuous: false,
  confirm_completed: true,
};
const command: ActivityOperation = {
  owner: "A",
  generation: 2,
  target_id: null,
  action: "save",
  body: activityBody(input, "immutable-request"),
};
function fixture() {
  const map = new Map<string, string>();
  const raw = {
    getItem: async (key: string) => map.get(key) ?? null,
    setItem: async (key: string, value: string) => {
      map.set(key, value);
    },
    removeItem: async (key: string) => {
      map.delete(key);
    },
    getAllKeys: async () => [...map.keys()],
  };
  return { raw, map };
}
it("survives a crash with exact immutable UUID/body and ignores older input autosaves while pending", async () => {
  const f = fixture();
  const store = createActivityDraftStore(f.raw, "A", 2, "new");
  await store.saveInput(input);
  await store.begin(input, command);
  await store.saveInput({ ...input, duration: "90", strenuous: true });
  const restored = await createActivityDraftStore(f.raw, "A", 2, "new").load();
  expect(restored.operation).toEqual(command);
  expect(restored.input?.duration).toBe("20");
  expect(restored.input?.strenuous).toBe(false);
});
it("retains a completion fence against delayed draft recreation and only resets deliberately", async () => {
  const f = fixture();
  const store = createActivityDraftStore(f.raw, "A", 2, "new");
  await store.begin(input, command);
  await store.complete(command.body.request_id);
  await store.saveInput(input);
  expect(await store.load()).toEqual({ input: null, operation: null, finished: true });
  await expect(store.begin(input, command)).rejects.toThrow("already completed");
  await store.reset();
  await store.saveInput(input);
  expect((await store.load()).input).toEqual(input);
});
it("does not move a pending request to another account/target or permit writes after account erasure", async () => {
  const f = fixture();
  const registry = createPrivateStorageRegistry(f.raw);
  const store = createActivityDraftStore(registry.capture("A"), "A", 2, "new");
  await expect(store.begin(input, { ...command, owner: "B" })).rejects.toThrow("ownership");
  await store.begin(input, command);
  await expect(store.begin(input, { ...command, body: { ...command.body, request_id: "other" } })).rejects.toThrow(
    "existing"
  );
  await registry.erase("A");
  await expect(store.saveInput(input)).rejects.toThrow("retired");
  expect(f.map.size).toBe(0);
});

it("scrubs local command notes on an authoritative removed/read-only entry", async () => {
  const f = fixture();
  const store = createActivityDraftStore(f.raw, "A", 2, "owned");
  await store.begin({ ...input, notes: "private" }, command);
  await store.retire();
  await store.saveInput({ ...input, notes: "late private" });
  expect(await store.load()).toEqual({ input: null, operation: null, finished: true });
  expect([...f.map.values()].join()).not.toContain("private");
});

it("serializes two mounted editors for the same command slot instead of overwriting its original UUID", async () => {
  const f = fixture();
  const first = createActivityDraftStore(f.raw, "A", 2, "new");
  const second = createActivityDraftStore(f.raw, "A", 2, "new");
  const outcomes = await Promise.allSettled([
    first.begin(input, command),
    second.begin(input, { ...command, body: { ...command.body, request_id: "competing" } }),
  ]);
  expect(outcomes.filter((item) => item.status === "fulfilled")).toHaveLength(1);
  expect((await first.load()).operation?.body.request_id).toBe(command.body.request_id);
});
