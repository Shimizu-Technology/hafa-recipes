import { describe, expect, it, vi } from "vitest";
import {
  collectionMemberRows,
  createLibraryPager,
  libraryRows,
  libraryViewKey,
  toggleCollectionMember,
  type LibraryView,
} from "./library-history";
import { emptyState, optimisticRecord, type BabyRecord, type RecordPage } from "./models";
const view: LibraryView = { kind: "source", childId: "child", query: "", collectionId: "collection" };
function source(id: string, body = "hospital bag", child_id: string | null = null): BabyRecord {
  return optimisticRecord({
    id,
    kind: "source",
    title: id,
    body,
    child_id,
    occurred_at: "2026-10-20T00:00:00Z",
    data: { topics: ["Prep"] },
  });
}
function collection(ids: string[]) {
  return { ...source("collection"), kind: "collection" as const, data: { record_ids: ids } };
}
function page(ids: string[], more = false, total = 500): RecordPage {
  return { items: ids.map((id) => source(id)), total, has_more: more };
}
function held() {
  let resolve!: (page: RecordPage) => void, reject!: (error: Error) => void;
  const promise = new Promise<RecordPage>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
describe("full-history source collections", () => {
  it("uses server-wide uncategorized filtering and does not reintroduce an edited categorized source", async () => {
    const fetch = vi.fn().mockResolvedValue(page(["old-uncategorized"], false));
    const pager = createLibraryPager(fetch), inbox = { kind: "source" as const, childId: null, query: "", uncategorized: true };
    pager.reset(inbox);
    await pager.next();
    expect(fetch.mock.calls[0][0].uncategorized).toBe(true);
    const state = { ...emptyState(), records: [source("old-uncategorized"), source("edited-existing")],
      outbox: [{ id: "edit", generation: 1, type: "save" as const, record: { ...source("edited-existing"), revision: 2 }, files: [] }] };
    expect(libraryRows(state, inbox, pager.snapshot().ids).map((row) => row.id)).toEqual(["old-uncategorized"]);
    state.records.push(collection(["old-uncategorized"]));
    expect(libraryRows(state, inbox, pager.snapshot().ids).map(row => row.id)).toEqual(["old-uncategorized"]);
    state.outbox.push({ id: "category-edit", generation: 1, type: "save", record: { ...collection(["old-uncategorized"]), revision: 1 }, files: [] });
    expect(libraryRows(state, inbox, pager.snapshot().ids)).toEqual([]);
  });
  it("starts the collection+topic+query+child cursor at zero even with only unrelated recent cached sources", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(page(["old-member"], true))
      .mockResolvedValueOnce(page(["older-member"]));
    const pager = createLibraryPager(fetch);
    pager.reset({ ...view, query: " hospital ", topic: "Prep" });
    await pager.next();
    await pager.next();
    expect(fetch.mock.calls[0][0]).toEqual({
      kind: "source",
      collection_id: "collection",
      topic: "Prep",
      q: "hospital",
      child_id: "child",
      include_general: true,
      limit: 30,
      offset: 0,
    });
    expect(fetch.mock.calls[1][0].offset).toBe(1);
    const state = {
      ...emptyState(),
      records: [
        ...Array.from({ length: 105 }, (_, i) => source(`recent-${i}`)),
        collection(["old-member", "older-member"]),
        ...page(["old-member", "older-member"]).items,
      ],
    };
    expect(libraryRows(state, view, pager.snapshot().ids).map((row) => row.id)).toEqual(["old-member", "older-member"]);
  });
  it("keeps an empty filtered page authoritative rather than leaking generic cached sources", async () => {
    const pager = createLibraryPager(async () => ({ items: [], total: 0, has_more: false }));
    pager.reset(view);
    await pager.next();
    const state = { ...emptyState(), records: [source("unrelated"), collection(["unrelated"])] };
    expect(libraryRows(state, view, pager.snapshot().ids)).toEqual([]);
    expect(pager.snapshot().more).toBe(false);
  });
  it("retains loaded members on return but refreshes the cursor and removes server-removed IDs when complete", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(page(["first"], true))
      .mockResolvedValueOnce(page(["old-member"], true))
      .mockResolvedValueOnce(page(["first"], true))
      .mockResolvedValueOnce(page(["new-member"]));
    const pager = createLibraryPager(fetch);
    pager.reset(view);
    await pager.next();
    await pager.next();
    pager.cancel();
    pager.reset(view, true);
    await pager.next();
    expect(pager.snapshot()).toMatchObject({ offset: 1, ids: ["first", "old-member"] });
    await pager.next();
    expect(pager.snapshot().ids).toEqual(["first", "new-member"]);
    expect(fetch.mock.calls.map(([filter]) => filter.offset)).toEqual([0, 1, 0, 1]);
  });
  it("retires a held page when collection, topic, query or child changes", async () => {
    const old = held(),
      commits: string[] = [];
    const fetch = vi.fn(async (_filters, current: () => boolean) => {
      const result = await old.promise;
      if (current()) commits.push(result.items[0].id);
      return result;
    });
    const pager = createLibraryPager(fetch);
    pager.reset(view);
    const pending = pager.next();
    pager.reset({ ...view, collectionId: "another", topic: "Feeding", query: "milk", childId: "baby-two" });
    old.resolve(page(["stale"]));
    expect(await pending).toBeNull();
    expect(commits).toEqual([]);
    expect(pager.snapshot()).toMatchObject({ offset: 0, ids: [] });
  });
  it("does not clear a newer page's busy state after blur or a late failure", async () => {
    const old = held(),
      fresh = held();
    const fetch = vi.fn().mockReturnValueOnce(old.promise).mockReturnValueOnce(fresh.promise);
    const pager = createLibraryPager(fetch);
    pager.reset(view);
    const pending = pager.next();
    pager.cancel();
    pager.reset(view);
    const next = pager.next();
    old.reject(Error("stale offline"));
    expect(await pending).toBeNull();
    expect(pager.snapshot().busy).toBe(true);
    fresh.resolve(page(["fresh"]));
    await next;
    expect(pager.snapshot()).toMatchObject({ busy: false, ids: ["fresh"] });
  });
  it("retries the same failed offset without overlapping loads or looping on contradictory empty pages", async () => {
    const request = held(),
      fetch = vi.fn().mockRejectedValueOnce(Error("offline")).mockReturnValueOnce(request.promise);
    const pager = createLibraryPager(fetch);
    pager.reset(view);
    await expect(pager.next()).rejects.toThrow("offline");
    const retry = pager.next();
    expect(await pager.next()).toBeNull();
    request.resolve(page([], true));
    await retry;
    expect(fetch.mock.calls.map(([filter]) => filter.offset)).toEqual([0, 0]);
    expect(pager.snapshot()).toMatchObject({ more: false, busy: false });
  });
  it("hydrates500 members with five sequential100-row pages, not one GET per missing member", async () => {
    let active = 0,
      maximum = 0;
    const fetch = vi.fn(async ({ offset = 0, limit = 0 }) => {
      active++;
      maximum = Math.max(maximum, active);
      await Promise.resolve();
      active--;
      return page(
        Array.from({ length: limit }, (_, i) => `member-${offset + i}`),
        offset + limit < 500
      );
    });
    const pager = createLibraryPager(fetch);
    pager.reset({ ...view, childId: null, pageSize: 100 });
    while (pager.snapshot().more) await pager.next();
    expect(maximum).toBe(1);
    expect(fetch.mock.calls.map(([filter]) => filter.offset)).toEqual([0, 100, 200, 300, 400]);
    expect(pager.snapshot().ids).toHaveLength(500);
  });
  it("pages the collection chooser itself without assuming its first page is complete", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(page(["collection-one"], true))
      .mockResolvedValueOnce(page(["collection-old"]));
    const pager = createLibraryPager(fetch);
    pager.reset({ kind: "collection", query: "", childId: null });
    await pager.next();
    await pager.next();
    expect(fetch.mock.calls[0][0]).toMatchObject({ kind: "collection", offset: 0, limit: 30 });
    expect(fetch.mock.calls[0][0].collection_id).toBeUndefined();
    expect(pager.snapshot().ids).toEqual(["collection-one", "collection-old"]);
  });
});
describe("pending membership and offline recovery", () => {
  it("overlays unsynced membership additions/removals, edited topic/child/query and pending source deletion", () => {
    const state = {
      ...emptyState(),
      records: [
        collection(["removed", "remote", "deleted", "edited"]),
        source("removed"),
        source("remote"),
        source("added"),
        source("deleted"),
        source("edited"),
      ],
      outbox: [
        {
          id: "membership",
          type: "save" as const,
          generation: 1,
          record: collection(["remote", "added", "deleted", "edited"]),
          files: [],
        },
        {
          id: "edit",
          type: "save" as const,
          generation: 1,
          record: source("edited", "different advice", "other-child"),
          files: [],
        },
        { id: "delete", type: "delete" as const, generation: 1, record: source("deleted") },
      ],
    };
    expect(
      libraryRows(state, { ...view, query: "hospital", topic: "Prep" }, ["removed", "remote", "deleted", "edited"])
        .map((row) => row.id)
        .sort()
    ).toEqual(["added", "remote"]);
    expect(
      libraryRows(state, { ...view, query: "hospital" }, null)
        .map((row) => row.id)
        .sort()
    ).toEqual(["added", "remote"]);
  });
  it("shows an edited known member that now matches query/topic/child before the server index catches up", () => {
    const state = {
      ...emptyState(),
      records: [collection(["edited"]), source("edited", "old words", "other-child")],
      outbox: [
        {
          id: "edit",
          type: "save" as const,
          generation: 1,
          record: source("edited", "new hospital advice", "child"),
          files: [],
        },
      ],
    };
    expect(libraryRows(state, { ...view, query: "hospital", topic: "Prep" }, []).map((row) => row.id)).toEqual([
      "edited",
    ]);
  });
  it("trusts server text search beyond the offline projection while applying changed source content locally", () => {
    const state = { ...emptyState(), records: [collection(["remote"]), source("remote", "")] };
    expect(libraryRows(state, { ...view, query: "word-only-in-server-transcript" }, ["remote"])).toHaveLength(1);
    expect(libraryRows(state, { ...view, query: "word-only-in-server-transcript" }, null)).toEqual([]);
    expect(libraryRows(state, { ...view, query: "word-only-in-server-transcript" }, ["remote"], ["remote"])).toEqual(
      []
    );
  });
  it("retains local membership after sync until refresh without masking remote search matches", () => {
    const state = { ...emptyState(), records: [collection(["added"]), source("removed"), source("added", "")] };
    expect(libraryRows(state, view, ["removed"], [], ["added"], ["added"]).map((row) => row.id)).toEqual(["added"]);
    expect(
      libraryRows(state, { ...view, query: "remote-only-text" }, ["added"], [], ["added"], ["added"])
    ).toHaveLength(1);
  });
  it("does not show generic cached sources for an unknown or locally deleted collection", () => {
    const state = { ...emptyState(), records: [source("not-a-member")] };
    expect(libraryRows(state, view, null)).toEqual([]);
    const deleted = {
      ...state,
      records: [collection(["not-a-member"]), ...state.records],
      outbox: [{ id: "delete", type: "delete" as const, generation: 1, record: collection(["not-a-member"]) }],
    };
    expect(libraryRows(deleted, view, ["not-a-member"])).toEqual([]);
  });
  it("keeps unsaved selected IDs stable across search/pages and lets an unavailable member be removed", () => {
    const selected = ["old-unloaded", "deleted", "newly-added"];
    const rows = collectionMemberRows(selected, [source("newly-added")], ["old-unloaded", "deleted"], ["old-unloaded"]);
    expect(rows.map((row) => row.id)).toEqual(selected);
    expect(rows[1]).toMatchObject({ title: "Unavailable source 2", detail: expect.stringContaining("remove") });
    expect(toggleCollectionMember(selected, "deleted")).toEqual(["old-unloaded", "newly-added"]);
    expect(selected).toEqual(["old-unloaded", "deleted", "newly-added"]);
    expect(toggleCollectionMember(selected, "another-old-source")).toEqual([...selected, "another-old-source"]);
  });
  it("keeps the500-member bound without silently dropping existing selection", () => {
    const selected = Array.from({ length: 500 }, (_, i) => `source-${i}`);
    expect(toggleCollectionMember(selected, "new")).toEqual(selected);
    expect(toggleCollectionMember(selected, "source-400")).toHaveLength(499);
  });
});
describe("saved tips by timing", () => {
  const timing = { mode: "now" as const, childId: "child", context: { stage: "pregnancy" as const, value: 34 } };
  const tip = (id: string, min: number | null, max: number | null = null) =>
    ({ ...source(id), data: { relevance: { pregnancy_week_min: min, pregnancy_week_max: max } } });
  it("asks the API for this child's timing and keeps a fresh view per mode", async () => {
    const fetch = vi.fn().mockResolvedValue(page([], false, 0)), pager = createLibraryPager(fetch);
    pager.reset({ kind: "source", childId: null, query: "", timing });
    await pager.next();
    expect(fetch.mock.calls[0][0]).toMatchObject({ timing: "now", timing_child_id: "child", uncategorized: undefined });
    expect(libraryViewKey({ kind: "source", childId: null, query: "", timing })).not.toBe(
      libraryViewKey({ kind: "source", childId: null, query: "", timing: { ...timing, mode: "upcoming" } }));
  });
  it("uses the API's matches online and the same rules on cached tips offline or after a local edit", () => {
    const rows = [tip("bag", 32, 36), tip("tea", 37), tip("edited", 30, 33)];
    const state = { ...emptyState(), records: rows };
    const view: LibraryView = { kind: "source", childId: null, query: "", timing };
    expect(libraryRows(state, view, null).map((row) => row.id)).toEqual(["bag"]);
    expect(libraryRows(state, view, ["tea"]).map((row) => row.id)).toEqual(["tea"]);
    const edited = { ...rows[2], data: { relevance: { pregnancy_week_min: 34 } } };
    const pending = { ...state, outbox: [{ id: "m", generation: 1, type: "save" as const, record: edited, files: [] }] };
    expect(libraryRows(pending, view, ["edited"]).map((row) => row.id)).toEqual(["edited"]);
    expect(libraryRows({ ...pending, outbox: [{ ...pending.outbox[0], record: rows[2] }] }, view, ["edited"])).toEqual([]);
  });
});
