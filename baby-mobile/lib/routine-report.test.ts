import { describe, expect, it } from "vitest";
import { optimisticRecord, emptyState, type BabyRecord, type DeviceState } from "./models";
import { reminderNotificationData } from "./notification-route";
import { heldRoutines, routineSchedule } from "./routine-report";

const row = (id: string, data: Record<string, unknown> = {}, revision = 3): BabyRecord => ({
  ...optimisticRecord({ id, kind: "routine", title: id, body: "", child_id: null, occurred_at: "2026-10-20T00:00:00Z",
    data: { enabled: true, reminder_at: "2027-01-01T10:00:00Z", repeat: "daily" as const, timezone: "Pacific/Guam", ...data } }),
  revision,
});
const scheduled = (record: BabyRecord, generation = 1, owner = "owner") => ({ identifier: `n-${record.id}`, content: { data: reminderNotificationData(owner, generation, record) } });
const state = (records: BabyRecord[], extra: Partial<DeviceState> = {}) => ({ ...emptyState(), records, ...extra }) as DeviceState;

describe("what this phone can say it holds", () => {
  it("a routine scheduled at its current schedule, in the words the API compares", () => {
    const a = row("a");
    expect(heldRoutines([scheduled(a)], "owner", 1, state([a]))).toEqual({ a: "2027-01-01T10:00:00Z|daily|Pacific/Guam" });
  });
  it("what isn't actually scheduled isn't claimed, even if it should be", () => {
    expect(heldRoutines([], "owner", 1, state([row("a")]))).toEqual({});
  });
  it("one scheduled from an older revision of the same schedule isn't claimed until it's rescheduled", () => {
    const a = row("a"), newer = { ...a, revision: 4 };
    expect(heldRoutines([scheduled(a)], "owner", 1, state([newer]))).toEqual({});
  });
  it("not another account's, an old generation's or an offline copy", () => {
    const a = row("a");
    expect(heldRoutines([scheduled(a, 1, "someone-else"), scheduled(a, 0), { content: { data: { copyOwner: "owner", notification_id: "x" } } }], "owner", 1, state([a]))).toEqual({});
  });
  it("a schedule nobody knows the record for isn't claimed", () => {
    expect(heldRoutines([scheduled(row("gone"))], "owner", 1, state([]))).toEqual({});
  });
  it("the schedule leaves out what doesn't change when it fires", () => {
    expect(routineSchedule({ reminder_at: "x", timezone: "UTC" })).toBe("x|none|UTC");
    expect(routineSchedule({ reminder_at: "x", repeat: "weekly", timezone: undefined, items: [{ id: "a", label: "A", done: true }] } as Parameters<typeof routineSchedule>[0])).toBe("x|weekly|");
  });
});

describe("an edit still waiting on this phone", () => {
  const save = (record: BabyRecord) => ({ id: "m", generation: 1, type: "save" as const, files: [], record });
  it("a new title changes nothing about what it holds, so it still says so", () => {
    const a = row("a"), renamed = { ...a, title: "A better name" };
    expect(heldRoutines([scheduled(a)], "owner", 1, state([a], { outbox: [save(renamed)] }))).toEqual({ a: routineSchedule(a.data) });
  });
  it("a schedule rebuilt from the waiting copy still counts, if the time is the same", () => {
    const a = row("a"), ticked = { ...a, data: { ...a.data, items: [{ id: "x", label: "X", done: true }] } };
    expect(heldRoutines([scheduled(ticked)], "owner", 1, state([a], { outbox: [save(ticked)] }))).toEqual({ a: routineSchedule(a.data) });
  });
  it("a new time isn't claimed: the API doesn't have that schedule yet", () => {
    const a = row("a"), moved = { ...a, data: { ...a.data, reminder_at: "2027-01-01T11:00:00Z" } };
    expect(heldRoutines([scheduled(moved)], "owner", 1, state([a], { outbox: [save(moved)] }))).toEqual({});
  });
  it("one waiting to be deleted isn't claimed", () => {
    const a = row("a");
    expect(heldRoutines([scheduled(a)], "owner", 1, state([a], { outbox: [{ id: "d", generation: 1, type: "delete" as const, record: a }] }))).toEqual({});
  });
  it("a schedule held from before a time change that's still waiting isn't claimed either", () => {
    const a = row("a"), moved = { ...a, data: { ...a.data, reminder_at: "2027-01-01T11:00:00Z" } };
    expect(heldRoutines([scheduled(a)], "owner", 1, state([a], { outbox: [save(moved)] }))).toEqual({});
  });
});
