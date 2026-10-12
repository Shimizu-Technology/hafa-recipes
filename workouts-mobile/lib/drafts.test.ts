import { describe, it, expect } from "vitest";
import { drafts, draftKey } from "./drafts";
describe("private local drafts", () => {
  it("scopes persisted drafts to the authenticated owner and removes only the requested draft", async () => {
    const values = new Map<string, string>();
    const store = drafts({
      async getItem(key) {
        return values.get(key) ?? null;
      },
      async setItem(key, value) {
        values.set(key, value);
      },
      async removeItem(key) {
        values.delete(key);
      },
    });
    await store.save("owner-a", "profile", { goal: "running" });
    await store.save("owner-b", "profile", { goal: "strength" });
    expect(await store.load("owner-a", "profile")).toEqual({ goal: "running" });
    await store.remove("owner-a", "profile");
    expect(await store.load("owner-a", "profile")).toBeNull();
    expect(await store.load("owner-b", "profile")).toEqual({ goal: "strength" });
  });
  it("refuses anonymous storage and prevents separator collisions", () => {
    expect(() => draftKey("", "profile")).toThrow();
    expect(draftKey("a:b", "c")).not.toBe(draftKey("a", "b:c"));
  });
  it("finishes pending edits before removal so a completed save cannot resurrect a draft", async () => {
    const values = new Map<string, string>();
    const store = drafts({
      async getItem(key) {
        return values.get(key) ?? null;
      },
      async setItem(key, value) {
        await new Promise((resolve) => setTimeout(resolve, 5));
        values.set(key, value);
      },
      async removeItem(key) {
        values.delete(key);
      },
    });
    const pending = store.save("owner", "workout", { title: "Latest edit" });
    const removal = store.remove("owner", "workout");
    await Promise.all([pending, removal]);
    expect(await store.load("owner", "workout")).toBeNull();
  });
});
