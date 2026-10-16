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
it("restores exact pending cancellation intent without changing the request identity or focus", async () => {
  const values = new Map<string, string>();
  const storage = { getItem: async (key: string) => values.get(key) ?? null,
    setItem: async (key: string, value: string) => { values.set(key, value); },
    removeItem: async (key: string) => { values.delete(key); }, getAllKeys: async () => [...values.keys()] };
  const pending = { request_id: "same-request", message: "Private question", generation: 2,
    focus: { context_workout_id: "workout", context_revision: 7 }, created_at: "2026-10-15T00:00:00Z", stop_requested: true as const };
  expect(await createCoachDraftStore(storage).save("owner", 2, "workout", { message: pending.message, pending }, "initial")).toBe(true);
  expect((await createCoachDraftStore(storage).load("owner", 2, "workout")).value?.pending).toEqual(pending);
  expect((await createCoachDraftStore(storage).load("other", 2, "workout")).value).toBeNull();
});
