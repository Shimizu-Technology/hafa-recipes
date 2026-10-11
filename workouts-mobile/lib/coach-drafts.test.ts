import { it, expect } from "vitest";
import { createCoachDraftStore } from "./coach-drafts";
import { draftKey } from "./drafts";
it("clears all conversation focuses for only this owner/generation and fences delayed saves from the old reset epoch", async () => {
  const values = new Map<string, string>();
  const storage = {
    getItem: async (k: string) => values.get(k) ?? null,
    setItem: async (k: string, v: string) => {
      values.set(k, v);
    },
    removeItem: async (k: string) => {
      values.delete(k);
    },
    getAllKeys: async () => [...values.keys()],
  };
  const store = createCoachDraftStore(storage);
  await store.save("owner", 2, "workout", { message: "private old message", pending: null }, "initial");
  await store.save("owner", 2, "plan", { message: "private old plan message", pending: null }, "initial");
  await store.save("other", 2, "plan", { message: "other message", pending: null }, "initial");
  await store.save("owner", 3, "plan", { message: "other enrollment", pending: null }, "initial");
  await store.clear("owner", 2, "reset");
  expect(await store.save("owner", 2, "workout", { message: "late callback", pending: null }, "initial")).toBe(false);
  expect((await store.load("owner", 2, "plan")).value).toBeNull();
  expect(values.has(draftKey("other", "coach-draft:2:plan"))).toBe(true);
  expect(values.has(draftKey("owner", "coach-draft:3:plan"))).toBe(true);
  expect(await store.save("owner", 2, "plan", { message: "new explicit message", pending: null }, "reset")).toBe(true);
});
