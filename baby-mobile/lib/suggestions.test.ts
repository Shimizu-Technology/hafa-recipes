import { describe, expect, it, vi } from "vitest";
import { ApiError } from "./api";
import { emptyState, optimisticRecord, type BabyRecord, type DeviceState, type RecordWrite, type SuggestionResult } from "./models";
import {
  acceptMessage, acceptSuggestions, createsCategory, decidable, decisionError, dismissMessage, dismissSuggestion, pendingSuggestion, undoAccepted,
  undoMessage, type AcceptOutcome,
} from "./suggestions";

const post = (id: string, name: string, collection_id: string | null = null, status: "pending" | "accepted" = "pending"): BabyRecord => ({
  ...optimisticRecord({ id, kind: "source", title: id, body: "", child_id: null, occurred_at: "2026-10-20T00:00:00Z",
    data: { suggested_category: { name, collection_id, confidence: 0.8, status } } }), revision: 3,
});
const folder = (id: string, title: string, record_ids: string[], revision = 2): BabyRecord => ({
  ...optimisticRecord({ id, kind: "collection", title, body: "", child_id: null, occurred_at: "2026-10-20T00:00:00Z", data: { record_ids } }), revision,
});
const accepted = (row: BabyRecord, collection_id: string) => ({ ...row, data: { suggested_category: { ...row.data.suggested_category!, status: "accepted" as const, collection_id } } });
const offline = () => new ApiError("Could not connect.", 0);
function account(result: SuggestionResult | (() => Promise<SuggestionResult>), rows: BabyRecord[] = []) {
  const store = new Map(rows.map((row) => [row.id, row]));
  const value = {
    state: { ...emptyState(), records: [] as BabyRecord[], bootstrap: { generation: 4, children: [], ai_available: false, profile: { display_name: "", timezone: "Pacific/Guam", ai_consent: false } } } as DeviceState,
    api: {
      decideSuggestions: vi.fn(async () => typeof result === "function" ? result() : result),
      record: vi.fn(async (id: string) => { if (!store.has(id)) throw new ApiError("gone", 404); return store.get(id)!; }),
      save: vi.fn(async (row: RecordWrite) => { const saved = { ...store.get(row.id)!, ...row, revision: (row.revision ?? 0) + 1 }; store.set(row.id, saved); return saved; }),
      remove: vi.fn(async (row: BabyRecord) => { store.delete(row.id); }),
    },
    commit: vi.fn(async (change: (s: DeviceState) => DeviceState) => { value.state = change(value.state); }),
    store,
  };
  return value;
}
const outcomeFor = (items: [BabyRecord, string, string][], created: string[] = []): AcceptOutcome => ({
  accepted: items.map(([row, collection_id, name]) => ({ record_id: row.id, collection_id, name, before: row.data.suggested_category! })),
  created, conflicts: 0, full: [], skipped: 0,
});

describe("accepting suggested categories", () => {
  it("files each post independently and reports conflicts and full categories", async () => {
    const tea = post("tea", "Labor prep", "labor"), bag = post("bag", "Hospital bag"), stale = post("stale", "Labor prep", "labor"),
      full = post("full", "Feeding", "feeding"), gone = post("gone", "Sleep"), filed = post("filed", "Sleep", null, "accepted");
    const labor = folder("labor", "Labor prep", ["tea"]), hospital = folder("new-bag", "Hospital bag", ["bag"], 1);
    const b = account({
      results: [{ record_id: "tea", status: "accepted", collection_id: "labor" }, { record_id: "bag", status: "accepted", collection_id: "new-bag" },
        { record_id: "stale", status: "conflict" }, { record_id: "full", status: "category_full" }, { record_id: "gone", status: "unavailable" }],
      records: [{ ...tea, revision: 4 }, { ...bag, revision: 4 }], collections: [labor, hospital],
    }, [{ ...stale, revision: 5 }]);
    const outcome = await acceptSuggestions(b, [tea, bag, stale, full, gone, filed]);
    expect(b.api.decideSuggestions).toHaveBeenCalledWith(["tea", "bag", "stale", "full", "gone"].map((record_id) => ({ record_id, revision: 3 })), 4);
    expect(outcome).toMatchObject({ created: ["new-bag"], conflicts: 1, full: [{ name: "Feeding", record_id: "full" }], skipped: 1 });
    expect(outcome.accepted.map((item) => [item.record_id, item.name])).toEqual([["tea", "Labor prep"], ["bag", "Hospital bag"]]);
    expect(b.api.record.mock.calls).toEqual([["stale"]]);
    expect(b.state.records.map((row) => [row.id, row.revision]).sort()).toEqual([["bag", 4], ["labor", 2], ["new-bag", 1], ["stale", 5], ["tea", 4]]);
    expect(acceptMessage(outcome)).toBe("Filed 2 posts into 2 categories. 1 changed elsewhere, so try it again. Feeding is full (500 posts). Choose another category.");
    expect(acceptMessage({ ...outcome, accepted: outcome.accepted.slice(0, 1), conflicts: 0, full: [] })).toBe("Added to Labor prep.");
    expect(pendingSuggestion(filed)).toBeNull();
  });

  it("counts a category as new only when the server returns it at revision 1, even if this phone never cached it", async () => {
    const tea = post("tea", "Labor prep"), bag = post("bag", "Bag");
    // "old" existed on the server (never loaded on this phone); accepting bumped it from 4 to 5.
    const b = account({ results: [{ record_id: "tea", status: "accepted", collection_id: "old" }, { record_id: "bag", status: "accepted", collection_id: "fresh" }],
      records: [accepted(tea, "old"), accepted(bag, "fresh")], collections: [folder("old", "Labor prep", ["tea"], 5), folder("fresh", "Bag", ["bag"], 1)] });
    expect((await acceptSuggestions(b, [tea, bag])).created).toEqual(["fresh"]);
  });

  it("refetches a replayed accept's post and category instead of counting it as created", async () => {
    const tea = post("tea", "Labor prep");
    const b = account({ results: [{ record_id: "tea", status: "accepted", collection_id: "labor" }], records: [], collections: [] },
      [{ ...accepted(tea, "labor"), revision: 4 }, folder("labor", "Labor & delivery", ["tea"], 1)]);
    const outcome = await acceptSuggestions(b, [tea]);
    expect(outcome).toMatchObject({ created: [], accepted: [{ record_id: "tea", collection_id: "labor", name: "Labor & delivery" }] });
    expect(b.api.record.mock.calls.flat().sort()).toEqual(["labor", "tea"]);
    expect(b.state.records.map((row) => [row.id, row.revision]).sort()).toEqual([["labor", 1], ["tea", 4]]);
  });

  it("skips posts with a queued offline save in Accept all and Not this", async () => {
    const tea = post("tea", "Labor prep", "labor"), bag = post("bag", "Hospital bag");
    const b = account({ results: [{ record_id: "bag", status: "dismissed" }], records: [], collections: [] });
    b.state = { ...b.state, outbox: [{ type: "save", id: "m1", generation: 4, files: [], record: { ...tea, title: "Renamed offline" } }] };
    expect(decidable(b.state, tea)).toBe(false);
    expect(decidable(b.state, bag)).toBe(true);
    await acceptSuggestions(b, [tea, bag]);
    expect(b.api.decideSuggestions).toHaveBeenLastCalledWith([{ record_id: "bag", revision: 3 }], 4);
    expect(await dismissSuggestion(b, tea)).toEqual({ status: "no_suggestion", before: null });
    expect(b.api.decideSuggestions).toHaveBeenCalledTimes(1);
  });

  it("explains a broken category and being offline without promising a queued retry", async () => {
    const tea = post("tea", "Labor prep", "labor");
    const broken = account(async () => { throw new ApiError("Some details need review.", 422); });
    await expect(acceptSuggestions(broken, [tea])).rejects.toMatchObject({ status: 422 });
    expect(decisionError(new ApiError("x", 422))).toBe("This category can’t be updated. Choose another category.");
    expect(decisionError(offline())).toBe("You’re offline. Try again when you’re connected.");
  });

  it("marks a suggestion new only when the server won't reuse a same-name category", () => {
    const categories = [folder("labor", "Labor  Prep!", []), folder("baby", "👶", []), folder("hafa", "Håfa", [])];
    expect(createsCategory({ name: "labor prep", collection_id: null, status: "pending" }, categories)).toBe(false);
    expect(createsCategory({ name: "Ｌａｂｏｒ ｐｒｅｐ", collection_id: null, status: "pending" }, categories)).toBe(false);
    expect(createsCategory({ name: "👶", collection_id: null, status: "pending" }, categories)).toBe(false);
    expect(createsCategory({ name: "❤️", collection_id: null, status: "pending" }, categories)).toBe(true);
    expect(createsCategory({ name: "Hafa", collection_id: null, status: "pending" }, categories)).toBe(true);
    expect(createsCategory({ name: "Sleep", collection_id: "sleep", status: "pending" }, [])).toBe(false);
  });
});

describe("undoing an accept", () => {
  it("takes posts back out, restores the suggestion, and removes only a new category that is now empty", async () => {
    const tea = post("tea", "Labor prep", "labor"), bag = post("bag", "Hospital bag");
    const b = account({ results: [], records: [], collections: [] },
      [accepted(tea, "labor"), accepted(bag, "new-bag"), folder("labor", "Labor prep", ["older", "tea"]), folder("new-bag", "Hospital bag", ["bag"], 1)]);
    const result = await undoAccepted(b, outcomeFor([[tea, "labor", "Labor prep"], [bag, "new-bag", "Hospital bag"]], ["new-bag"]));
    expect(result).toEqual({ restored: 2, remaining: null, offline: false });
    expect(undoMessage(result)).toBe("Moved back to Uncategorized.");
    expect(b.store.get("labor")!.data.record_ids).toEqual(["older"]);
    expect(b.api.remove).toHaveBeenCalledTimes(1);
    expect(b.api.remove).toHaveBeenCalledWith(expect.objectContaining({ id: "new-bag" }), 4);
    expect(b.store.get("tea")!.data.suggested_category).toMatchObject({ status: "pending", collection_id: "labor" });
    expect(b.store.get("bag")!.data.suggested_category).toMatchObject({ status: "pending", collection_id: null });
    expect(b.state.records.some((row) => row.id === "new-bag")).toBe(false);
  });

  it("never deletes a pre-existing, uncached or non-empty category", async () => {
    const tea = post("tea", "Labor prep"), bag = post("bag", "Hospital bag");
    // "labor" pre-existed (never cached here) and is now empty; "new-bag" was created but got another post meanwhile.
    const b = account({ results: [], records: [], collections: [] },
      [accepted(tea, "labor"), accepted(bag, "new-bag"), folder("labor", "Labor prep", ["tea"], 6), folder("new-bag", "Hospital bag", ["bag", "other"], 3)]);
    await undoAccepted(b, outcomeFor([[tea, "labor", "Labor prep"], [bag, "new-bag", "Hospital bag"]], ["new-bag"]));
    expect(b.api.remove).not.toHaveBeenCalled();
    expect(b.store.get("labor")!.data.record_ids).toEqual([]);
    expect(b.store.get("new-bag")!.data.record_ids).toEqual(["other"]);
  });

  it("puts back what it can, says what's left, and finishes on Try again", async () => {
    const tea = post("tea", "Labor prep", "labor"), bag = post("bag", "Sleep", "sleep");
    const b = account({ results: [], records: [], collections: [] },
      [accepted(tea, "labor"), accepted(bag, "sleep"), folder("labor", "Labor prep", ["tea"]), folder("sleep", "Sleep", ["bag"])]);
    const read = b.api.record.getMockImplementation()!;
    b.api.record.mockImplementation(async (id: string) => { if (id === "labor") throw offline(); return read(id); });
    const first = await undoAccepted(b, outcomeFor([[tea, "labor", "Labor prep"], [bag, "sleep", "Sleep"]]));
    expect(first).toMatchObject({ restored: 1, offline: true, remaining: { accepted: [{ record_id: "tea" }] } });
    expect(undoMessage(first)).toBe("Moved 1 back. You’re offline. Try the other 1 post when you’re connected.");
    expect(b.store.get("bag")!.data.suggested_category?.status).toBe("pending");
    // Back online, but restoring the tea post's suggestion fails once: it is already out of its category.
    b.api.record.mockImplementation(read);
    const write = b.api.save.getMockImplementation()!;
    let failures = 1;
    b.api.save.mockImplementation(async (row: RecordWrite) => {
      if (row.kind === "source" && failures-- > 0) throw new ApiError("Retry later.", 500);
      return write(row);
    });
    const second = await undoAccepted(b, first.remaining!);
    expect(second).toMatchObject({ restored: 0, offline: false, remaining: { accepted: [{ record_id: "tea", unfiled: true }] } });
    expect(undoMessage(second)).toBe("1 post couldn’t be moved back yet.");
    expect(b.store.get("labor")!.data.record_ids).toEqual([]);
    b.api.record.mockClear();
    expect(await undoAccepted(b, second.remaining!)).toEqual({ restored: 1, remaining: null, offline: false });
    expect(b.api.record.mock.calls).toEqual([["tea"]]); // the category isn't touched again
    expect(b.store.get("tea")!.data.suggested_category?.status).toBe("pending");
    expect(undoMessage({ restored: 0, offline: true, remaining: first.remaining })).toBe("You’re offline. Try again when you’re connected.");
  });
});

describe("Not this", () => {
  it("dismisses one suggestion so it can be restored, and asks again after a conflict", async () => {
    const tea = post("tea", "Labor prep");
    const dismissed = { ...tea, revision: 4, data: { suggested_category: { ...tea.data.suggested_category!, status: "dismissed" as const } } };
    const b = account({ results: [{ record_id: "tea", status: "dismissed" }], records: [dismissed], collections: [] });
    expect(await dismissSuggestion(b, tea)).toMatchObject({ status: "dismissed", before: { name: "Labor prep" } });
    expect(b.api.decideSuggestions).toHaveBeenCalledWith([{ record_id: "tea", revision: 3 }], 4, "dismiss");
    expect(b.api.record).not.toHaveBeenCalled();
    expect(b.state.records[0].data.suggested_category?.status).toBe("dismissed");
    const conflict = account({ results: [{ record_id: "tea", status: "conflict" }], records: [], collections: [] }, [{ ...tea, revision: 9 }]);
    await expect(dismissSuggestion(conflict, tea)).rejects.toThrow("changed on another device");
    expect(conflict.state.records[0].revision).toBe(9);
  });

  it("refetches a replayed dismiss and doesn't call an already-handled post removed", async () => {
    const tea = post("tea", "Labor prep");
    const dismissed = { ...tea, revision: 4, data: { suggested_category: { ...tea.data.suggested_category!, status: "dismissed" as const } } };
    const replay = account({ results: [{ record_id: "tea", status: "dismissed" }], records: [], collections: [] }, [dismissed]);
    expect(await dismissSuggestion(replay, tea)).toMatchObject({ status: "dismissed" });
    expect(replay.state.records).toEqual([dismissed]);
    const handled = account({ results: [{ record_id: "tea", status: "no_suggestion" }], records: [], collections: [] }, [dismissed]);
    expect(await dismissSuggestion(handled, tea)).toEqual({ status: "no_suggestion", before: null });
    expect(handled.state.records).toEqual([dismissed]);
    expect(dismissMessage("no_suggestion")).toBe("This suggestion was already handled.");
    expect(dismissMessage("unavailable")).toBe("This post is no longer available.");
    expect(dismissMessage("dismissed")).toBe("Suggestion removed.");
  });
});
