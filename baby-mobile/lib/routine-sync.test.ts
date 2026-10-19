import { describe, expect, it, vi } from "vitest";
import { emptyState, optimisticRecord, type BabyRecord, type DeviceState, type RecordPage } from "./models";
import { fencedState, pendingRecords } from "./outbox";
import {
  installRoutineSnapshot,
  readAllRoutines,
  routineReminderScope,
  routineStateChanged,
  trackRoutineIntents,
} from "./routine-sync";
const row = (id: string, enabled = true): BabyRecord =>
  optimisticRecord({
    id,
    kind: "routine",
    title: id,
    body: "",
    child_id: null,
    occurred_at: "2026-10-20T00:00:00Z",
    data: { enabled, reminder_at: "2027-01-01T10:00:00Z", repeat: "daily" },
  });
const initial = (): DeviceState => ({
  ...emptyState(),
  bootstrap: {
    generation: 1,
    children: [],
    ai_available: false,
    profile: { display_name: "", timezone: "Pacific/Guam", ai_consent: false },
  },
});
const page = (items: BabyRecord[], total = items.length, has_more = false): RecordPage => ({ items, total, has_more });
describe("complete routine restoration", () => {
  it("fetches every kind-scoped page across all children, independent of recent mixed history", async () => {
    const remote = Array.from({ length: 205 }, (_, i) => ({
      ...row(String(i)),
      child_id: i % 2 ? "other-child" : null,
    }));
    const fetch = vi.fn(async ({ offset = 0, limit = 100 }) =>
      page(remote.slice(offset, offset + limit), remote.length, offset + limit < remote.length)
    );
    const restored = await readAllRoutines(fetch, () => true);
    expect(restored).toEqual(remote);
    expect(fetch.mock.calls.map(([f]) => f)).toEqual(
      [0, 100, 200].map((offset) => ({ kind: "routine", limit: 100, offset, include_general: true }))
    );
    const mixed = Array.from({ length: 156 }, (_, i) => ({ ...row("source" + i), kind: "source" as const }));
    expect(installRoutineSnapshot({ ...initial(), records: mixed }, restored!, "owner").records).toHaveLength(361);
  });
  it("authoritatively replaces remote edits, disabled and deleted rows while preserving pending local overlays", () => {
    const state = {
      ...initial(),
      records: [row("edited"), row("disabled"), row("deleted")],
      outbox: [
        {
          id: "local",
          generation: 1,
          type: "save" as const,
          record: { ...row("edited"), title: "my pending correction" },
          files: [],
        },
        { id: "new", generation: 1, type: "save" as const, record: row("offline-new"), files: [] },
      ],
    };
    const next = installRoutineSnapshot(
      state,
      [
        { ...row("edited"), title: "remote correction", revision: 2 },
        { ...row("disabled", false), revision: 2 },
      ],
      "owner"
    );
    expect(next.records.find((r) => r.id === "disabled")?.data.enabled).toBe(false);
    expect(next.records.some((r) => r.id === "deleted")).toBe(false);
    expect(pendingRecords(next).find((r) => r.id === "edited")?.title).toBe("my pending correction");
    expect(pendingRecords(next).some((r) => r.id === "offline-new")).toBe(true);
    expect(next.outbox).toBe(state.outbox);
    expect(next.routine_sync).toMatchObject({ owner: "owner", generation: 1, complete: true });
  });
  it("does not install partial failures or contradictory/nonadvancing pages", async () => {
    const state = { ...initial(), records: [row("keep")] };
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(page([row("partial")], 2, true))
      .mockRejectedValueOnce(Error("offline"));
    await expect(readAllRoutines(fetch, () => true)).rejects.toThrow("offline");
    expect(state.records[0].id).toBe("keep");
    expect(state.routine_sync).toBeUndefined();
    for (const broken of [page([], 2, true), page([row("same"), row("same")]), page([], 1), page([row("x")], 0)])
      await expect(
        readAllRoutines(
          async () => broken,
          () => true
        )
      ).rejects.toThrow();
  });
  it("fences account/generation/lease changes and ignores an obsolete failure", async () => {
    for (const rejected of [false, true]) {
      let current = true;
      let release!: (p: RecordPage) => void, reject!: (e: Error) => void;
      const held = new Promise<RecordPage>((yes, no) => {
        release = yes;
        reject = no;
      });
      const reading = readAllRoutines(
        () => held,
        () => current
      );
      current = false;
      if (rejected) reject(Error("old session"));
      else release(page([row("old")]));
      expect(await reading).toBeNull();
    }
  });
  it("retains local decisions after accepted/discarded writes and clears markers across generations without bootstrap", () => {
    const state = initial(),
      record = row("chosen"),
      m = { id: "write", generation: 1, type: "save" as const, record, files: [] };
    const queued = trackRoutineIntents(state, { ...state, outbox: [m] }, "owner");
    const accepted = trackRoutineIntents(queued, { ...queued, records: [record], outbox: [] }, "owner");
    expect(routineStateChanged(queued, accepted)).toBe(true);
    expect(routineReminderScope(accepted, "owner")).toEqual({ authoritative: false, managedIds: ["chosen"] });
    const discarded = trackRoutineIntents(queued, { ...queued, outbox: [] }, "owner");
    expect(routineReminderScope(discarded, "owner").managedIds).toEqual(["chosen"]);
    expect(routineReminderScope(accepted, "other-owner")).toEqual({ authoritative: false, managedIds: [] });
    const { bootstrap: _, ...noBootstrap } = accepted;
    expect(fencedState(noBootstrap, 2)).toMatchObject({ records: [], outbox: [] });
    expect(fencedState(noBootstrap, 2).routine_sync).toBeUndefined();
  });
});
