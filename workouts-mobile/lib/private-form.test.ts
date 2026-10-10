import { expect, it, vi } from "vitest";
import { createPrivateForm } from "./private-form";
import { createPrivateStorageRegistry } from "./private-storage";
import { draftKey } from "./drafts";
function fixture() {
  const map = new Map<string, string>();
  const raw = {
    getItem: async (k: string) => map.get(k) ?? null,
    setItem: async (k: string, v: string) => {
      map.set(k, v);
    },
    removeItem: async (k: string) => {
      map.delete(k);
    },
    getAllKeys: async () => [...map.keys()]
  };
  return { map, raw };
}
it("persists a frozen command before transport and survives restart/lost acknowledgment/new input autosaves", async () => {
  const { raw } = fixture();
  const form = createPrivateForm(raw, "A", "manual:1");
  const input = { title: "Original", reps: 8 },
    command = { key: "one-UUID", body: { reps: 8 }, generation: 1 };
  const saving = form.begin(input, command);
  input.reps = 99;
  command.body.reps = 99;
  expect(await saving).toEqual({ key: "one-UUID", body: { reps: 8 }, generation: 1 });
  expect(await form.save({ title: "Late", reps: 99 })).toBe(false);
  const restarted = await createPrivateForm(raw, "A", "manual:1").load();
  expect(restarted.input).toEqual({ title: "Original", reps: 8 });
  expect(restarted.command).toEqual({ key: "one-UUID", body: { reps: 8 }, generation: 1 });
  await expect(form.begin(input, command)).rejects.toThrow("Retry these saved details");
});
it("terminal completion and remote removal scrub sensitive drafts and reject delayed autosaves/completions across instances", async () => {
  const { raw, map } = fixture();
  const a = createPrivateForm(raw, "A", "measurement:m:1"),
    b = createPrivateForm(raw, "A", "measurement:m:1");
  const command = { request_id: "original", value: "PRIVATE_MEASUREMENT", recorded_at: "PRIVATE_DATE" };
  await a.begin({ value: "PRIVATE_MEASUREMENT" }, command);
  await b.retire();
  expect(await a.save({ value: "late PRIVATE_MEASUREMENT" })).toBe(false);
  await expect(a.complete(command)).rejects.toThrow("removed");
  await expect(b.reset()).rejects.toThrow("removed");
  expect(await b.load()).toMatchObject({ input: null, command: null, terminal: true, removed: true });
  expect([...map.values()].join()).not.toContain("PRIVATE");
});
it("local acknowledgment retains a completion fence until deliberate new intent and never erases another account/generation", async () => {
  const { raw, map } = fixture();
  const a = createPrivateForm(raw, "A", "manual:1"),
    other = createPrivateForm(raw, "B", "manual:1"),
    later = createPrivateForm(raw, "A", "manual:2");
  await other.save({ value: "B" });
  await later.save({ value: "generation2" });
  const command = { request_id: "original" };
  await a.begin({ value: "A" }, command);
  await a.complete(command, "saved-id");
  expect(await a.save({ value: "late A" })).toBe(false);
  await expect(a.begin({}, command)).rejects.toThrow("complete");
  await a.reset();
  expect(await a.save({ value: "explicit new intent" })).toBe(true);
  expect(map.get(draftKey("B", "manual:1"))).toContain("B");
  expect(map.get(draftKey("A", "manual:2"))).toContain("generation2");
});
it("reads legacy measurement operations without changing their original identity or revision", async () => {
  const { raw } = fixture();
  const legacy = {
    generation: 1,
    value: "75",
    operation: { body: { request_id: "old", expected_revision: 3 }, generation: 1 }
  };
  await raw.setItem(draftKey("A", "measurement:legacy:1"), JSON.stringify(legacy));
  expect(await createPrivateForm(raw, "A", "measurement:legacy:1").load()).toMatchObject({
    input: legacy,
    command: legacy.operation
  });
});
it("retired private storage stops original pending commands without moving them into a fresh enrollment", async () => {
  const { raw, map } = fixture();
  const registry = createPrivateStorageRegistry(raw);
  const original = createPrivateForm(registry.capture("A"), "A", "manual:1");
  await original.begin({ private: "value" }, { key: "original" });
  await registry.erase("A");
  await expect(original.begin({}, { key: "original" })).rejects.toThrow("retired");
  expect(map.size).toBe(0);
});
it("failed durable retirement still fences late autosaves and new controllers until a content-free retry succeeds", async () => {
  const { raw, map } = fixture();
  let failed = false;
  const writes: string[] = [];
  const storage = {
    ...raw,
    setItem: async (key: string, value: string) => {
      writes.push(value);
      if (failed) throw Error("disk unavailable");
      await raw.setItem(key, value);
    }
  };
  const form = createPrivateForm(storage, "retired-owner", "measurement:failed-retire:1");
  await form.save({ value: "PRIVATE_VALUE", recorded_at: "PRIVATE_DATE" });
  await createPrivateForm(raw, "another-owner", "measurement:failed-retire:1").save({ value: "OTHER_OWNER" });
  failed = true;
  const removal = form.retire(),
    late = form.save({ value: "LATE_PRIVATE_VALUE" });
  await expect(removal).rejects.toThrow("disk unavailable");
  expect(await late).toBe(false);
  const restarted = createPrivateForm(storage, "retired-owner", "measurement:failed-retire:1");
  expect(await restarted.load()).toMatchObject({ removed: true, input: null, command: null });
  await expect(restarted.begin({}, { request_id: "late" })).rejects.toThrow("complete");
  await expect(restarted.reset()).rejects.toThrow("removed");
  await expect(restarted.complete({ request_id: "late" })).rejects.toThrow("removed");
  expect(await restarted.save({ value: "NEW_CONTROLLER_PRIVATE_VALUE" })).toBe(false);
  expect(writes.join()).not.toContain("LATE_PRIVATE_VALUE");
  expect(writes.join()).not.toContain("NEW_CONTROLLER_PRIVATE_VALUE");
  failed = false;
  await restarted.retire();
  expect(map.get(draftKey("retired-owner", "measurement:failed-retire:1"))).not.toContain("PRIVATE");
  expect(map.get(draftKey("another-owner", "measurement:failed-retire:1"))).toContain("OTHER_OWNER");
});
it("retirement during an in-flight device write rejects that stale write's completion even when subsequent cleanup fails", async () => {
  const { raw } = fixture();
  let entered!: () => void,
    release!: () => void,
    failed = true;
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const storage = {
    ...raw,
    setItem: async (key: string, value: string) => {
      if (!JSON.parse(value).removed) {
        entered();
        await held;
      } else if (failed) throw Error("cleanup unavailable");
      await raw.setItem(key, value);
    }
  };
  const form = createPrivateForm(storage, "in-flight-owner", "measurement:in-flight:1");
  const stale = form.save({ value: "PRIVATE_IN_FLIGHT" });
  await started;
  const removal = form.retire(),
    late = form.save({ value: "LATE" });
  release();
  await expect(stale).rejects.toThrow("removed");
  await expect(removal).rejects.toThrow("cleanup unavailable");
  expect(await late).toBe(false);
  expect(await createPrivateForm(storage, "in-flight-owner", "measurement:in-flight:1").load()).toMatchObject({
    input: null,
    command: null,
    removed: true
  });
  failed = false;
  await form.retire();
  expect(await raw.getItem(draftKey("in-flight-owner", "measurement:in-flight:1"))).not.toContain("PRIVATE");
});

it("content-free removal replay survives a fresh runtime after acknowledged removal and failed durable retirement", async () => {
  const { raw, map } = fixture();
  let failWrites = false;
  const storage = {
    ...raw,
    setItem: async (key: string, value: string) => {
      if (failWrites) throw Error("disk unavailable");
      await raw.setItem(key, value);
    }
  };
  const owner = "cold-restart-owner", scope = "measurement:cold:1";
  const input = { value: "PRIVATE_VALUE", recorded_at: "PRIVATE_DATE", generation: 1 };
  const command = {
    kind: "remove", profile_revision: 6, generation: 1,
    body: { request_id: "original-removal-UUID", expected_revision: 3 }
  };
  const form = createPrivateForm(storage, owner, scope);
  await form.save(input);
  expect(await form.begin(null, command)).toEqual(command);
  expect(JSON.parse(map.get(draftKey(owner, scope))!)).toMatchObject({ input: null, command });
  failWrites = true;
  await expect(form.retire()).rejects.toThrow("disk unavailable");
  expect(map.get(draftKey(owner, scope))).not.toContain("PRIVATE");
  vi.resetModules();
  const fresh = await import("./private-form");
  const restarted = fresh.createPrivateForm(storage, owner, scope);
  expect(await restarted.load()).toMatchObject({ input: null, command, terminal: false, removed: false });
  failWrites = false;
  expect(await restarted.begin(null, command)).toEqual(command);
  await restarted.retire();
  expect(await restarted.load()).toMatchObject({ input: null, command: null, removed: true });
});
it("scrubs legacy pending removal input while retaining its exact original command", async () => {
  const { raw, map } = fixture();
  const scope = "measurement:legacy-remove:1", owner = "legacy-removal-owner";
  const command = { kind: "remove", body: { request_id: "old-remove", expected_revision: 3 }, profile_revision: 4, generation: 1 };
  await raw.setItem(draftKey(owner, scope), JSON.stringify({ value: "PRIVATE_VALUE", recorded_at: "PRIVATE_DATE", operation: command }));
  const form = createPrivateForm(raw, owner, scope);
  expect((await form.load()).command).toEqual(command);
  expect(await form.begin(null, command)).toEqual(command);
  expect(map.get(draftKey(owner, scope))).not.toContain("PRIVATE");
  expect((await form.load()).input).toBeNull();
  await expect(form.begin(null, { ...command, body: { ...command.body, request_id: "replacement" } })).rejects.toThrow("Retry these saved details");
});
