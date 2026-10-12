import { describe, it, expect } from "vitest";
import { createPrivateStorageRegistry, ownedStorageKey } from "./private-storage";
function fixture() {
  const map = new Map<string, string>();
  return {
    map,
    raw: {
      getItem: async (key: string) => map.get(key) ?? null,
      setItem: async (key: string, value: string) => {
        map.set(key, value);
      },
      removeItem: async (key: string) => {
        map.delete(key);
      },
      getAllKeys: async () => [...map.keys()],
    },
  };
}
describe("private device deletion", () => {
  it("rejects delayed old saves and preserves another account", async () => {
    const f = fixture();
    const registry = createPrivateStorageRegistry(f.raw);
    const old = registry.capture("A");
    const key = "hafa-workouts:training:v1:A:1";
    await old.setItem(key, "sensitive");
    f.map.set("hafa-workouts:training:v1:AB:1", "other");
    await registry.erase("A");
    await expect(old.setItem(key, "late")).rejects.toThrow("retired");
    expect(f.map.has(key)).toBe(false);
    expect(f.map.get("hafa-workouts:training:v1:AB:1")).toBe("other");
    await registry.capture("A").setItem("hafa-workouts:training:v1:A:3", "fresh");
  });
  it("orders cleanup after an already started write and blocks queued writes", async () => {
    const f = fixture();
    let release!: () => void;
    let started!: () => void;
    const entered = new Promise<void>((r) => (started = r));
    const held = new Promise<void>((r) => (release = r));
    const registry = createPrivateStorageRegistry({
      ...f.raw,
      setItem: async (key, value) => {
        started();
        await held;
        await f.raw.setItem(key, value);
      },
    });
    const old = registry.capture("A");
    const save = old.setItem("hafa-workouts:v1:A:capture%3A1", "private");
    await entered;
    const erase = registry.erase("A");
    const late = old.setItem("hafa-workouts:v1:A:capture%3A1", "late");
    release();
    await save;
    await erase;
    await expect(late).rejects.toThrow("retired");
    expect(f.map.size).toBe(0);
  });
  it("matches only exact private namespaces and cleans file descriptors before removing drafts", async () => {
    expect(ownedStorageKey("hafa-workouts:reminders:v1:A%3Aworkouts%3A1", "A")).toBe(true);
    expect(ownedStorageKey("hafa-workouts:reminders:v1:AA%3Aworkouts%3A1", "A")).toBe(false);
    const f = fixture();
    f.map.set("hafa-workouts:v1:A:capture%3A1", "draft");
    let cleaned = "";
    await createPrivateStorageRegistry(f.raw).erase("A", async (value) => {
      cleaned = value;
    });
    expect(cleaned).toBe("draft");
    expect(f.map.size).toBe(0);
  });
  it("keeps a draft available for cleanup retry when file cleanup fails", async () => {
    const f = fixture();
    const key = "hafa-workouts:v1:A:capture%3A1";
    f.map.set(key, "private");
    const registry = createPrivateStorageRegistry(f.raw);
    await expect(
      registry.erase("A", async () => {
        throw Error("disk locked");
      })
    ).rejects.toThrow("disk locked");
    expect(f.map.get(key)).toBe("private");
    await registry.erase("A");
    expect(f.map.size).toBe(0);
  });
});
