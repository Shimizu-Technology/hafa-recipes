import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "./api";
import { emptyState, type DeviceState, type DueReminder, type Mutation } from "./models";
import { dismissReminder, refreshDue, sendDismissals, shownDue } from "./reminder-due";

const due = (id: string, extra: Partial<DueReminder> = {}): DueReminder => ({
  id, kind: "event", text: `Reminder ${id}`, due_at: "2026-11-06T00:00:00Z", delivery: "accepted", identity: `i-${id}`, data: {}, ...extra,
});
function account(state: Partial<DeviceState> = {}) {
  const b: any = {
    state: { ...emptyState(), bootstrap: { generation: 1, children: [], ai_available: false, profile: {}, reminders: { push: true } }, ...state },
    sync: vi.fn(async () => {}),
    commit: vi.fn(async (change: (s: DeviceState) => DeviceState) => { b.state = change(b.state); }),
    api: { dueReminders: vi.fn(async () => ({ items: [due("a")] })), dismissReminder: vi.fn(async () => undefined) },
  };
  return b;
}
const feedSave = (child: string): Mutation => ({ id: "m", generation: 1, type: "save", files: [], record: { id: "new-feed", kind: "feeding", title: "", body: "", child_id: child, occurred_at: "2026-11-06T01:00:00Z", data: {} } });

describe("what Today shows", () => {
  let b: ReturnType<typeof account>;
  beforeEach(() => { b = account(); });
  it("nothing with the flag off, whatever this phone kept", () => {
    b.state.bootstrap.reminders = undefined;
    expect(shownDue({ ...b.state, dueReminders: [due("a")] })).toEqual([]);
  });
  it("what the API last said, with this phone's dismissals taken out at once", async () => {
    b.state.dueReminders = [due("a"), due("b")];
    await dismissReminder(b, "a");
    expect(shownDue(b.state).map((item) => item.id)).toEqual(["b"]);
    expect(b.state.dismissing).toEqual(["a"]);
    expect(b.sync).toHaveBeenCalled();
  });
  it("a feed logged on this phone with no signal clears that baby's feed reminder, not another's", () => {
    const state = { ...b.state, dueReminders: [due("a", { kind: "feed_interval", data: { child_id: "baby" } }), due("b", { kind: "feed_interval", data: { child_id: "other" } })], outbox: [feedSave("baby")] };
    expect(shownDue(state).map((item) => item.id)).toEqual(["b"]);
  });
  it("stopping a timer with no signal clears its reminder", () => {
    const stop: Mutation = { id: "s", generation: 1, type: "feed_action", record_id: "running", action: { id: "s", action: "finish", at: "2026-11-06T01:00:00Z" } };
    const state = { ...b.state, dueReminders: [due("a", { kind: "running_timer", data: { record_id: "running" } }), due("b", { kind: "running_timer", data: { record_id: "another" } })], outbox: [stop] };
    expect(shownDue(state).map((item) => item.id)).toEqual(["b"]);
  });
});

describe("keeping it current", () => {
  it("keeps what the API answers", async () => {
    const b = account({ dueReminders: [due("old")] });
    await refreshDue(b.api, b.commit);
    expect(b.state.dueReminders.map((item: DueReminder) => item.id)).toEqual(["a"]);
  });
  it("offline keeps what it had and says nothing", async () => {
    const b = account({ dueReminders: [due("old")] });
    b.api.dueReminders = vi.fn(async () => { throw new ApiError("offline", 0); });
    await expect(refreshDue(b.api, b.commit)).resolves.toBeUndefined();
    expect(b.state.dueReminders.map((item: DueReminder) => item.id)).toEqual(["old"]);
  });
  it("doesn't save again when nothing changed", async () => {
    const b = account({ dueReminders: [due("a")] });
    await refreshDue(b.api, b.commit);
    expect(b.commit.mock.results[0].value).toBeDefined();
    const before = b.state;
    await refreshDue(b.api, b.commit);
    expect(b.state.dueReminders).toEqual(before.dueReminders);
    expect(b.state).toBe(before);
  });
});

describe("sending dismissals", () => {
  it("each goes once, and leaves the list when the API has it", async () => {
    const b = account({ dismissing: ["a", "b"] });
    await sendDismissals(b.api, b.commit, () => b.state);
    expect(b.api.dismissReminder.mock.calls).toEqual([["a"], ["b"]]);
    expect(b.state.dismissing).toEqual([]);
  });
  it("with no signal it waits, and doesn't try the rest", async () => {
    const b = account({ dismissing: ["a", "b"] });
    b.api.dismissReminder = vi.fn(async () => { throw new ApiError("offline", 0); });
    await sendDismissals(b.api, b.commit, () => b.state);
    expect(b.api.dismissReminder).toHaveBeenCalledOnce();
    expect(b.state.dismissing).toEqual(["a", "b"]);
  });
  it("a refusal isn't worth keeping: it stays off Today until the next read", async () => {
    const b = account({ dismissing: ["a"] });
    b.api.dismissReminder = vi.fn(async () => { throw new ApiError("Not found", 404); });
    await sendDismissals(b.api, b.commit, () => b.state);
    expect(b.state.dismissing).toEqual([]);
  });
});
