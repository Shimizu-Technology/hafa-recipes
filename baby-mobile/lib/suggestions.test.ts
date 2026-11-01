import { describe, expect, it, vi } from "vitest";
import { emptyState, optimisticRecord, type BabyRecord, type DeviceState, type RecordWrite, type SuggestionResult } from "./models";
import { acceptMessage, acceptSuggestions, dismissSuggestion, pendingSuggestion, undoAccepted } from "./suggestions";

const post = (id: string, name: string, collection_id: string | null = null, status: "pending" | "accepted" = "pending"): BabyRecord => ({
  ...optimisticRecord({ id, kind: "source", title: id, body: "", child_id: null, occurred_at: "2026-10-20T00:00:00Z",
    data: { suggested_category: { name, collection_id, confidence: 0.8, status } } }), revision: 3,
});
const folder = (id: string, title: string, record_ids: string[]): BabyRecord => ({
  ...optimisticRecord({ id, kind: "collection", title, body: "", child_id: null, occurred_at: "2026-10-20T00:00:00Z", data: { record_ids } }), revision: 2,
});
function account(result: SuggestionResult, rows: BabyRecord[] = []) {
  const store = new Map(rows.map((row) => [row.id, row]));
  const value = {
    state: { ...emptyState(), records: rows, bootstrap: { generation: 4, children: [], ai_available: false, profile: { display_name: "", timezone: "Pacific/Guam", ai_consent: false } } } as DeviceState,
    api: {
      decideSuggestions: vi.fn(async () => result),
      record: vi.fn(async (id: string) => store.get(id)!),
      save: vi.fn(async (row: RecordWrite) => { const saved = { ...store.get(row.id)!, ...row, revision: (row.revision ?? 0) + 1 }; store.set(row.id, saved); return saved; }),
      remove: vi.fn(async () => undefined),
    },
    commit: vi.fn(async (change: (s: DeviceState) => DeviceState) => { value.state = change(value.state); }),
    store,
  };
  return value;
}

describe("suggested categories", () => {
  it("files each post independently and reports conflicts and full categories", async () => {
    const tea = post("tea", "Labor prep", "labor"), bag = post("bag", "Hospital bag"), stale = post("stale", "Labor prep", "labor"),
      full = post("full", "Feeding", "feeding"), gone = post("gone", "Sleep"), filed = post("filed", "Sleep", null, "accepted");
    const labor = folder("labor", "Labor prep", ["tea"]), hospital = folder("new-bag", "Hospital bag", ["bag"]);
    const b = account({
      results: [{ record_id: "tea", status: "accepted", collection_id: "labor" }, { record_id: "bag", status: "accepted", collection_id: "new-bag" },
        { record_id: "stale", status: "conflict" }, { record_id: "full", status: "category_full" }, { record_id: "gone", status: "unavailable" }],
      records: [{ ...tea, revision: 4 }, { ...bag, revision: 4 }], collections: [labor, hospital],
    }, [{ ...stale, revision: 5 }]);
    const outcome = await acceptSuggestions(b, [tea, bag, stale, full, gone, filed], new Set(["labor", "feeding"]));
    expect(b.api.decideSuggestions).toHaveBeenCalledWith(["tea", "bag", "stale", "full", "gone"].map((record_id) => ({ record_id, revision: 3 })), 4);
    expect(outcome).toMatchObject({ created: ["new-bag"], conflicts: 1, full: ["Feeding"], skipped: 1 });
    expect(outcome.accepted.map((item) => [item.record_id, item.name])).toEqual([["tea", "Labor prep"], ["bag", "Hospital bag"]]);
    expect(b.api.record).toHaveBeenCalledWith("stale");
    expect(b.state.records.map((row) => [row.id, row.revision]).sort()).toEqual([["bag", 4], ["labor", 2], ["new-bag", 2], ["stale", 5], ["tea", 4]]);
    expect(acceptMessage(outcome)).toBe("Filed 2 posts into 2 categories. 1 changed elsewhere, so try it again. Feeding is full. Choose another category.");
    expect(acceptMessage({ ...outcome, accepted: outcome.accepted.slice(0, 1), conflicts: 0, full: [] })).toBe("Added to Labor prep.");
    expect(pendingSuggestion(filed)).toBeNull();
  });

  it("undoes an accept: takes posts back out, restores the suggestion, and removes a new empty category", async () => {
    const tea = post("tea", "Labor prep", "labor"), bag = post("bag", "Hospital bag");
    const labor = folder("labor", "Labor prep", ["older", "tea"]), hospital = folder("new-bag", "Hospital bag", ["bag"]);
    const accepted = (row: BabyRecord, collection_id: string) => ({ ...row, data: { suggested_category: { ...row.data.suggested_category!, status: "accepted" as const, collection_id } } });
    const b = account({ results: [], records: [], collections: [] }, [accepted(tea, "labor"), accepted(bag, "new-bag"), labor, hospital]);
    await undoAccepted(b, { accepted: [
      { record_id: "tea", collection_id: "labor", name: "Labor prep", before: tea.data.suggested_category! },
      { record_id: "bag", collection_id: "new-bag", name: "Hospital bag", before: bag.data.suggested_category! },
    ], created: ["new-bag"], conflicts: 0, full: [], skipped: 0 });
    expect(b.store.get("labor")!.data.record_ids).toEqual(["older"]);
    expect(b.api.remove).toHaveBeenCalledWith(expect.objectContaining({ id: "new-bag" }), 4);
    expect(b.store.get("tea")!.data.suggested_category).toMatchObject({ status: "pending", collection_id: "labor" });
    expect(b.store.get("bag")!.data.suggested_category).toMatchObject({ status: "pending", collection_id: null });
    expect(b.state.records.some((row) => row.id === "new-bag")).toBe(false);
  });

  it("dismisses one suggestion so it can be restored, and asks again after a conflict", async () => {
    const tea = post("tea", "Labor prep");
    const dismissed = { ...tea, revision: 4, data: { suggested_category: { ...tea.data.suggested_category!, status: "dismissed" as const } } };
    const b = account({ results: [{ record_id: "tea", status: "dismissed" }], records: [dismissed], collections: [] });
    expect(await dismissSuggestion(b, tea)).toMatchObject({ name: "Labor prep" });
    expect(b.api.decideSuggestions).toHaveBeenCalledWith([{ record_id: "tea", revision: 3 }], 4, "dismiss");
    expect(b.state.records[0].data.suggested_category?.status).toBe("dismissed");
    const conflict = account({ results: [{ record_id: "tea", status: "conflict" }], records: [], collections: [] }, [{ ...tea, revision: 9 }]);
    await expect(dismissSuggestion(conflict, tea)).rejects.toThrow("changed on another device");
    expect(conflict.state.records[0].revision).toBe(9);
  });
});
