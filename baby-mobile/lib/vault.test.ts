import { describe, it, expect } from "vitest";
import { createVault, storageKey, type SecretStorage } from "./vault";
function fixture() {
  const data = new Map<string, string>();
  let failing = false,
    id = 0;
  const storage: SecretStorage = {
    getItemAsync: async (k) => data.get(k) ?? null,
    setItemAsync: async (k, v) => {
      if (failing && k.endsWith(".1")) throw Error("power interrupted");
      data.set(k, v);
    },
    deleteItemAsync: async (k) => {
      data.delete(k);
    },
  };
  return {
    data,
    storage,
    uuid: () => String(++id),
    fail: () => {
      failing = true;
    },
  };
}
describe("private durable device vault", () => {
  it("round trips emoji and long content without splitting Unicode or exceeding secure storage chunks", async () => {
    const f = fixture(),
      vault = createVault(f.storage, "person:one", f.uuid),
      value = { body: "🌺".repeat(1500) + "A note" };
    await vault.write(value);
    expect(await vault.read()).toEqual(value);
    for (const [key, text] of f.data)
      if (key !== storageKey("person:one")) expect(new TextEncoder().encode(text).length).toBeLessThanOrEqual(1600);
  });
  it("keeps the last committed draft if a later chunk write is interrupted", async () => {
    const f = fixture(),
      vault = createVault(f.storage, "person:one", f.uuid);
    await vault.write({ body: "kept" });
    f.fail();
    await expect(vault.write({ body: "x".repeat(3000) })).rejects.toThrow();
    expect(await vault.read()).toEqual({ body: "kept" });
  });
  it("separates account bindings and clears only the named account", async () => {
    const f = fixture(),
      one = createVault(f.storage, "one", f.uuid),
      two = createVault(f.storage, "two", f.uuid);
    await one.write("one private");
    await two.write("two private");
    await one.clear();
    expect(await two.read()).toBe("two private");
    expect(await createVault(f.storage, "one", f.uuid).read()).toBeNull();
  });
  it("fences writes queued before account retirement", async () => {
    const f = fixture(),
      one = createVault(f.storage, "one", f.uuid);
    one.retire();
    await expect(one.write("late private write")).rejects.toThrow("session has ended");
  });
  it("refuses damaged saves instead of silently replacing them", async () => {
    const f = fixture();
    f.data.set(storageKey("one"), "not valid");
    const v = createVault(f.storage, "one", f.uuid);
    await expect(v.read()).rejects.toThrow();
    await expect(v.write("overwrite")).rejects.toThrow();
  });
});
