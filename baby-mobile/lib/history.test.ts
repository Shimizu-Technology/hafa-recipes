import { describe, expect, it, vi } from "vitest";
import { createHistoryPager, historyRows, historyKinds } from "./history";
import { emptyState, optimisticRecord, type Kind, type RecordPage } from "./models";

const view = { filter: "all", childId: "child", query: "" };
function row(id: string, kind: Kind = "journal", child_id: string | null = null, body = "hospital note") {
  return optimisticRecord({
    id,
    kind,
    child_id,
    title: kind,
    body,
    occurred_at: "2026-10-20T00:00:00Z",
    data: kind === "feeding" ? { method: "bottle" } : {},
  });
}
function page(ids: string[], has_more = false): RecordPage {
  return { items: ids.map((id) => row(id)), total: 100, has_more };
}
function deferred() {
  let resolve!: (value: RecordPage) => void, reject!: (error: Error) => void;
  const promise = new Promise<RecordPage>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

describe("journal history recovery", () => {
  it("starts kind-scoped history at zero even with no cached journal, then advances by actual rows", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(page(["old-one", "old-two"], true))
      .mockResolvedValueOnce(page(["old-three"]));
    const pager = createHistoryPager(fetch);
    pager.reset(view);
    await pager.next();
    expect(fetch.mock.calls[0][0]).toMatchObject({
      kinds: ["journal", "question", "feeding", "sleep", "diaper"],
      child_id: "child",
      include_general: true,
      offset: 0,
      limit: 30,
    });
    await pager.next();
    expect(fetch.mock.calls[1][0].offset).toBe(2);
    expect(pager.snapshot()).toMatchObject({
      offset: 3,
      more: false,
      ids: ["old-one", "old-two", "old-three"],
    });
    const state = {
      ...emptyState(),
      records: [...Array.from({ length: 125 }, (_, i) => row("source-" + i, "source")), row("old-one")],
    };
    expect(historyRows(state, view, pager.snapshot().ids).map((r) => r.id)).toEqual(["old-one"]);
  });

  it("refreshes page zero on return while retaining older entries and restarting the cursor", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(page(["newer", "middle"], true))
      .mockResolvedValueOnce(page(["older"], true))
      .mockResolvedValueOnce(page(["newer"], true));
    const pager = createHistoryPager(fetch);
    pager.reset(view);
    await pager.next();
    await pager.next();
    pager.cancel();
    pager.reset(view, true);
    await pager.next();
    expect(fetch.mock.calls[2][0].offset).toBe(0);
    expect(pager.snapshot()).toMatchObject({ offset: 1, ids: ["newer", "middle", "older"] });
  });

  it("re-pages sequentially after 35 new matches arrive beyond 60 previously loaded entries", async () => {
    const original = Array.from({ length: 60 }, (_, i) => `old-${i}`);
    let remote = [...original];
    const fetch = vi.fn(async ({ offset = 0, limit = 30 }) => ({
      items: remote.slice(offset, offset + limit).map((id) => row(id)),
      total: remote.length,
      has_more: offset + limit < remote.length,
    }));
    const pager = createHistoryPager(fetch);
    pager.reset(view);
    await pager.next();
    await pager.next();
    remote = [...Array.from({ length: 35 }, (_, i) => `new-${i}`), ...original];
    pager.cancel();
    pager.reset(view, true);
    await pager.next();
    expect(pager.snapshot().ids).toHaveLength(90);
    expect(pager.snapshot().offset).toBe(30);
    while (pager.snapshot().more) await pager.next();
    expect(fetch.mock.calls.slice(2).map(([filters]) => filters.offset)).toEqual([0, 30, 60, 90]);
    expect(pager.snapshot()).toMatchObject({ offset: 95, more: false, ids: remote });
  });

  it("removes stale retained IDs only once the refreshed sequence reaches its end", async () => {
    let remote = Array.from({ length: 60 }, (_, i) => `old-${i}`);
    const fetch = vi.fn(async ({ offset = 0, limit = 30 }) => ({
      items: remote.slice(offset, offset + limit).map((id) => row(id)),
      total: remote.length,
      has_more: offset + limit < remote.length,
    }));
    const pager = createHistoryPager(fetch);
    pager.reset(view);
    await pager.next();
    await pager.next();
    remote = remote.slice(0, 31);
    pager.reset(view, true);
    await pager.next();
    expect(pager.snapshot().ids).toHaveLength(60);
    await pager.next();
    expect(pager.snapshot()).toMatchObject({ offset: 31, more: false, ids: remote });
  });

  it("honors a complete empty refresh while keeping local pending work separate", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(page(["removed-on-another-device"]))
      .mockResolvedValueOnce({ items: [], total: 0, has_more: false });
    const pager = createHistoryPager(fetch);
    pager.reset(view);
    await pager.next();
    pager.reset(view, true);
    await pager.next();
    expect(pager.snapshot()).toMatchObject({ offset: 0, ids: [], more: false });
  });

  it("fences a delayed page after child, filter, or query changes without clearing the new request", async () => {
    const first = deferred(),
      second = deferred(),
      commits: string[] = [];
    let count = 0;
    const fetch = vi.fn(async (_filters, current: () => boolean) => {
      const response = await (++count === 1 ? first.promise : second.promise);
      if (current()) commits.push(response.items[0].id);
      return response;
    });
    const pager = createHistoryPager(fetch);
    pager.reset(view);
    const stale = pager.next();
    pager.reset({ filter: "question", childId: "other-child", query: " old doctor question " });
    const fresh = pager.next();
    first.resolve(page(["stale"]));
    expect(await stale).toBeNull();
    expect(pager.snapshot()).toMatchObject({ offset: 0, busy: true });
    second.resolve(page(["fresh"]));
    await fresh;
    expect(fetch.mock.calls[1][0]).toMatchObject({
      kinds: ["question"],
      child_id: "other-child",
      q: "old doctor question",
      offset: 0,
    });
    expect(commits).toEqual(["fresh"]);
    expect(pager.snapshot()).toMatchObject({ offset: 1, ids: ["fresh"] });
  });

  it("ignores late failures and blurred responses, and retries a failed page at the same offset", async () => {
    const held = deferred();
    const fetch = vi
      .fn()
      .mockReturnValueOnce(held.promise)
      .mockRejectedValueOnce(Error("offline"))
      .mockResolvedValueOnce(page(["restored"]));
    const pager = createHistoryPager(fetch);
    pager.reset(view);
    const stale = pager.next();
    pager.cancel();
    held.reject(Error("old failure"));
    expect(await stale).toBeNull();
    pager.reset({ ...view, filter: "care" });
    await expect(pager.next()).rejects.toThrow("offline");
    expect(pager.snapshot()).toMatchObject({ offset: 0, busy: false, more: true });
    await pager.next();
    expect(fetch.mock.calls[2][0]).toMatchObject({ kinds: ["feeding", "sleep", "diaper"], offset: 0 });
  });

  it("prevents overlapping loads and stops a contradictory empty-page loop", async () => {
    const held = deferred(),
      fetch = vi.fn().mockReturnValue(held.promise);
    const pager = createHistoryPager(fetch);
    pager.reset(view);
    const loading = pager.next();
    expect(await pager.next()).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(1);
    held.resolve(page([], true));
    await loading;
    expect(pager.snapshot().more).toBe(false);
  });

  it("preserves matching pending entries and corrections, excludes pending deletes and other children", () => {
    const state = {
      ...emptyState(),
      records: [row("remote"), row("cached"), row("deleted"), row("edited")],
      outbox: [
        { id: "save-local", type: "save" as const, generation: 1, record: row("local"), files: [] },
        {
          id: "save-other",
          type: "save" as const,
          generation: 1,
          record: row("other", "journal", "other-child"),
          files: [],
        },
        {
          id: "edit",
          type: "save" as const,
          generation: 1,
          record: row("edited", "journal", null, "changed locally"),
          files: [],
        },
        { id: "remove", type: "delete" as const, generation: 1, record: row("deleted") },
      ],
    };
    expect(
      historyRows(state, { ...view, query: "hospital" }, ["remote", "edited", "deleted"])
        .map((r) => r.id)
        .sort()
    ).toEqual(["local", "remote"]);
    expect(
      historyRows(state, { ...view, query: "hospital" }, null)
        .map((r) => r.id)
        .sort()
    ).toEqual(["cached", "local", "remote"]);
    expect(state.outbox).toHaveLength(4);
  });

  it("keeps a newly synchronized local note visible until the next focused refresh", () => {
    const state = { ...emptyState(), records: [row("new-local")] };
    expect(historyRows(state, view, [], ["new-local"]).map((r) => r.id)).toEqual(["new-local"]);
    expect(historyRows(state, view, [])).toEqual([]);
    expect(historyRows(state, { ...view, query: "unrelated" }, [], ["new-local"])).toEqual([]);
  });

  it("searches structured care data offline and honors server matches that exceed the local projection", () => {
    const state = { ...emptyState(), records: [row("care", "feeding")] };
    expect(historyRows(state, { ...view, filter: "care", query: "feeding bottle" }, null)).toHaveLength(1);
    expect(
      historyRows(state, { ...view, filter: "care", query: "word only found in full server text" }, ["care"])
    ).toHaveLength(1);
  });
});

it.each(["empty","total"])("drops stale retained IDs at a completed %s boundary",async boundary=>{
  const fetch=vi.fn().mockResolvedValueOnce(page(["removed","retained"])).mockResolvedValueOnce(boundary==="empty"?{items:[],total:20,has_more:true}:{...page(["retained"],true),total:1});
  const pager=createHistoryPager(fetch); pager.reset(view); await pager.next(); pager.reset(view,true); await pager.next();
  expect(pager.snapshot()).toMatchObject({more:false,ids:boundary==="empty"?[]:["retained"]});
});

it("keeps the Journal's written timeline separate from the pushed care history", () => {
  expect(historyKinds("writing")).toEqual(["journal", "question"]);
  expect(historyKinds("care")).toEqual(["feeding", "sleep", "diaper"]);
  const state = { ...emptyState(), records: [row("note"), row("question", "question"), row("feed", "feeding")] };
  expect(historyRows(state, { ...view, filter: "writing" }, null).map(r => r.id)).toEqual(["note", "question"]);
});
