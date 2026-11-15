import { describe, expect, it } from "vitest";
import { dailyAiLimitMessage, sourceRefusalMessages } from "./import-status";
import { advanceOrganize, clearOrganize, findWaiting, organizeAtOnce, organizeWords, startOrganize, stopOrganize, waitingSource } from "./organize-waiting";
import { emptyState, type BabyRecord, type DeviceState } from "./models";

const source = (id: string, over: Partial<BabyRecord["data"]> = {}, at = `2026-11-0${id.length}T10:00:00.000Z`): BabyRecord => ({
  id, kind: "source", title: `Post ${id}`, body: "", child_id: null, occurred_at: at, revision: 1, created_at: at, updated_at: at,
  data: { url: `https://www.tiktok.com/@a/video/${id}`, status: "saved", topics: [], ...over },
} as BabyRecord);
const base = (): DeviceState => ({ ...emptyState(), bootstrap: { generation: 4 } as DeviceState["bootstrap"] });
let n = 0;
const uuid = () => `import-${++n}`;
const now = new Date("2026-11-15T12:00:00.000Z");

describe("which posts are waiting", () => {
  it("are saved or failed posts with something to read, and nothing on its way", () => {
    const state = base();
    expect(waitingSource(source("a"), state)).toBe(true);
    expect(waitingSource(source("b", { status: "failed" }), state)).toBe(true);
    expect(waitingSource(source("c", { status: "ready" }), state)).toBe(false);
    expect(waitingSource(source("d", { status: "incomplete" }), state)).toBe(false);
    expect(waitingSource(source("e", { url: undefined }), state)).toBe(false);
    expect(waitingSource(source("f", { url: undefined, source_text: "Swaddle tips" }), state)).toBe(true);
    expect(waitingSource({ ...source("g"), kind: "journal" } as BabyRecord, state)).toBe(false);
    const queued = { ...state, imports: [{ id: "j", status: "queued", record_id: "a" }] };
    expect(waitingSource(source("a"), queued)).toBe(false);
  });
  it("are read a page at a time, oldest first", async () => {
    const pages = [{ items: [source("aa"), source("b", { status: "ready" })], has_more: true }, { items: [source("c")], has_more: false }];
    const offsets: number[] = [];
    const rows = await findWaiting(async (offset) => { offsets.push(offset); return pages[offset / 100]; }, base());
    expect(offsets).toEqual([0, 100]);
    expect(rows.map((r) => r.id)).toEqual(["c", "aa"]);
  });
});

describe("a run", () => {
  const started = (count = 5) => advanceOrganize(startOrganize(base(), Array.from({ length: count }, (_, i) => source("x".repeat(i + 1))), now), uuid, now);

  it("hands the outbox a few at a time, each as an ordinary import of that post", () => {
    const state = started();
    expect(state.outbox).toHaveLength(organizeAtOnce);
    expect(state.outbox[0]).toMatchObject({ type: "import", record_id: "x", files: [], generation: 4, child_id: null });
    expect(state.organizeRun).toMatchObject({ total: 5, organized: 0 });
    expect(state.organizeRun!.waiting).toHaveLength(2);
    // The posts are on this phone while they're read.
    expect(state.records).toHaveLength(5);
    // Nothing changes until something does.
    expect(advanceOrganize(state, uuid, now)).toBe(state);
  });

  it("counts what finished and starts the next", () => {
    let state = started();
    const [first, second] = state.organizeRun!.active;
    state = { ...state, outbox: state.outbox.filter((m) => m.id !== first.import_id && m.id !== second.import_id),
      imports: [{ id: first.import_id, status: "ready", record_id: first.record_id }, { id: second.import_id, status: "failed", record_id: second.record_id }] };
    state = advanceOrganize(state, uuid, now);
    expect(state.organizeRun).toMatchObject({ organized: 1, attention: [second.record_id] });
    expect(state.organizeRun!.active).toHaveLength(3);
    expect(state.organizeRun!.waiting).toHaveLength(0);
    expect(organizeWords(state.organizeRun, 0).body).toBe("2 of 5 done. A few go at a time, and it keeps going while the app is open.");
  });

  it("leaves room for imports it didn't start", () => {
    const busy = { ...base(), imports: [{ id: "other", status: "processing", record_id: "z" }] };
    const state = advanceOrganize(startOrganize(busy, [source("a"), source("bb"), source("ccc")], now), uuid, now);
    expect(state.outbox).toHaveLength(organizeAtOnce - 1);
  });

  it("stops at the daily allowance, and the post that was refused waits with the rest", () => {
    let state = started();
    const first = state.organizeRun!.active[0];
    state = { ...state, outbox: state.outbox.map((m) => m.id === first.import_id ? { ...m, error: sourceRefusalMessages.source_daily_limit } : m) };
    state = advanceOrganize(state, uuid, now);
    expect(state.outbox.some((m) => m.id === first.import_id)).toBe(false);
    expect(state.organizeRun).toMatchObject({ stopped: "limit" });
    expect(state.organizeRun!.waiting[0].record_id).toBe(first.record_id);
    expect(state.outbox).toHaveLength(2);
    // The two already reading finish, then it's done for today.
    state = { ...state, outbox: [], imports: state.organizeRun!.active.map((a) => ({ id: a.import_id, status: "ready", record_id: a.record_id })) };
    state = advanceOrganize(state, uuid, now);
    expect(state.organizeRun!.finished_at).toBeTruthy();
    expect(organizeWords(state.organizeRun, 0)).toMatchObject({ heading: "Done for now" });
    expect(organizeWords(state.organizeRun, 0).body).toContain("3 are still waiting: today’s processing allowance is used.");
  });

  it("stops when the AI spending limit is reached while reading", () => {
    let state = started(3);
    const first = state.organizeRun!.active[0];
    state = { ...state, outbox: state.outbox.filter((m) => m.id !== first.import_id),
      imports: [{ id: first.import_id, status: "failed", record_id: first.record_id, error: dailyAiLimitMessage }] };
    state = advanceOrganize(state, uuid, now);
    expect(state.organizeRun).toMatchObject({ stopped: "limit", attention: [] });
  });

  it("waits a couple of minutes when the API's queue is full, then carries on", () => {
    let state = started();
    const first = state.organizeRun!.active[0];
    state = { ...state, outbox: state.outbox.map((m) => m.id === first.import_id ? { ...m, error: sourceRefusalMessages.source_queue_full } : m) };
    state = advanceOrganize(state, uuid, now);
    expect(state.organizeRun!.paused_until).toBe("2026-11-15T12:02:00.000Z");
    expect(state.outbox).toHaveLength(2);
    expect(advanceOrganize(state, uuid, new Date("2026-11-15T12:01:00.000Z"))).toBe(state);
    state = advanceOrganize(state, uuid, new Date("2026-11-15T12:02:01.000Z"));
    expect(state.organizeRun!.paused_until).toBeUndefined();
    expect(state.outbox).toHaveLength(3);
  });

  it("sets aside a post the API refuses for itself, and keeps going", () => {
    let state = started();
    const first = state.organizeRun!.active[0];
    state = { ...state, outbox: state.outbox.map((m) => m.id === first.import_id ? { ...m, error: sourceRefusalMessages.source_retry_limit } : m) };
    state = advanceOrganize(state, uuid, now);
    expect(state.organizeRun!.attention).toEqual([first.record_id]);
    expect(state.organizeRun!.stopped).toBeUndefined();
    expect(state.outbox).toHaveLength(3);
  });

  it("skips a post started from its own page since", () => {
    let state = startOrganize(base(), [source("a")], now);
    state = { ...state, imports: [{ id: "own", status: "queued", record_id: "a" }] };
    state = advanceOrganize(state, uuid, now);
    expect(state.outbox).toHaveLength(0);
    expect(state.organizeRun).toMatchObject({ organized: 1 });
    expect(state.organizeRun!.finished_at).toBeTruthy();
  });

  it("can stop after the ones already reading, and be dismissed", () => {
    let state = stopOrganize(started(), now);
    expect(state.organizeRun!.finished_at).toBeUndefined();
    state = { ...state, outbox: [], imports: state.organizeRun!.active.map((a) => ({ id: a.import_id, status: "ready", record_id: a.record_id })) };
    state = advanceOrganize(state, uuid, now);
    expect(state.outbox).toHaveLength(0);
    expect(state.organizeRun!.finished_at).toBeTruthy();
    expect(organizeWords(state.organizeRun, 0).body).toBe("Organized 3 of 5 saved posts. 2 are still saved as they were. Suggested categories are in Uncategorized.");
    expect(clearOrganize(state).organizeRun).toBeUndefined();
  });

  it("doesn't start twice", () => {
    const state = started();
    expect(startOrganize(state, [source("new")], now)).toBe(state);
  });
});

describe("the words", () => {
  it("before a run", () => {
    expect(organizeWords(undefined, 1).heading).toBe("1 saved post is waiting to be organized");
    expect(organizeWords(undefined, 23).heading).toBe("23 saved posts are waiting to be organized");
  });
  it("when everything worked", () => {
    expect(organizeWords({ started_at: "", total: 4, waiting: [], active: [], organized: 4, attention: [], finished_at: "x" }, 0))
      .toMatchObject({ heading: "All organized", body: "All 4 saved posts are organized. Suggested categories are in Uncategorized." });
  });
});
