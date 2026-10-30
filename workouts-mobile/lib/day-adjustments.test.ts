import { expect, it } from "vitest";
import { dayAdjustments, type DayReceipt } from "./day-adjustments";
it("keeps program/session receipts distinct and refuses a closed account lease", async () => {
 const map = new Map<string, string>(); let current = true;
 const storage = { isCurrent: () => current, getItem: async (key: string) => map.get(key) ?? null, setItem: async (key: string, value: string) => { map.set(key, value); }, removeItem: async (key: string) => { map.delete(key); } };
 const store = dayAdjustments(storage, "owner", 1);
 const receipt = { owner: "owner", generation: 1, program: { id: "plan" }, session: { id: "a" }, proposal: { id: "first" }, state: "accepted", pending: null } as DayReceipt;
 await store.save(receipt);
 await store.save({ ...receipt, session: { ...receipt.session!, id: "b" }, proposal: { ...receipt.proposal, id: "second" } });
 expect((await store.list()).map(r => r.proposal.id)).toEqual(["first", "second"]);
 expect(await dayAdjustments(storage, "other", 1).list()).toEqual([]);
 expect(await dayAdjustments(storage, "owner", 2).list()).toEqual([]);
 await expect(store.save({ ...receipt, proposal: { ...receipt.proposal, id: "replacement" } })).rejects.toThrow("Resolve the saved adjustment");
 current = false;
 await expect(store.remove(receipt)).rejects.toThrow("account or training enrollment changed");
 expect(JSON.stringify([...map.values()])).toContain("first");
});
