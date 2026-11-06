import { describe, expect, it, vi } from "vitest";
import { emptyState, type DeviceState } from "./models";
import { kindsFor, quietWindow, remindersOn, savePrefs, shownPrefs, turnOn } from "./reminder-prefs";
let made = 0;
vi.mock("expo-crypto", () => ({ randomUUID: () => `id-${made++}` }));

const off = { enabled: false, break_through: false, hours: null, feed_hours: null, sleep_hours: null };
const prefs = { quiet_hours: null, kinds: { event: off, feed_interval: { ...off, hours: 3 } } };
const held = (extra: Partial<DeviceState> = {}): DeviceState => ({
  ...emptyState(),
  bootstrap: { generation: 2, children: [], ai_available: false, active: true, profile: {} as any, reminders: { push: true } },
  reminderPrefs: prefs as any,
  ...extra,
});
function account(state: DeviceState) {
  const b = { state, sync: vi.fn(async () => {}), commit: vi.fn(async (change: (s: DeviceState) => DeviceState) => { b.state = change(b.state); }) };
  return b;
}

describe("whether reminders show at all", () => {
  it("only when the API says so", () => {
    expect(remindersOn(undefined)).toBe(false);
    expect(remindersOn({ reminders: undefined })).toBe(false);
    expect(remindersOn({ reminders: { push: true } })).toBe(true);
  });
});

describe("saving", () => {
  it("shows straight away and queues as one change under the personal generation", async () => {
    const b = account(held());
    await savePrefs(b, { kinds: { event: { enabled: true } } });
    expect(shownPrefs(b.state).kinds.event?.enabled).toBe(true);
    expect(b.state.outbox).toMatchObject([{ type: "reminder_prefs", generation: 2, patch: { kinds: { event: { enabled: true } } } }]);
    expect(b.sync).toHaveBeenCalled();
  });
  it("quick changes travel together, the later one winning", async () => {
    const b = account(held());
    await savePrefs(b, { kinds: { event: { enabled: true } } });
    await savePrefs(b, { kinds: { event: { enabled: false }, feed_interval: { enabled: true, hours: 2 } } });
    await savePrefs(b, { quiet_hours: { start: "22:00", end: "07:00", timezone: "Pacific/Guam" } });
    expect(b.state.outbox).toHaveLength(1);
    const [change] = b.state.outbox as any[];
    expect(change.patch).toEqual({ quiet_hours: { start: "22:00", end: "07:00", timezone: "Pacific/Guam" }, kinds: { event: { enabled: false }, feed_interval: { enabled: true, hours: 2 } } });
  });
  it("one already on its way can't take more, so nothing is lost when it lands", async () => {
    const b = account(held());
    await savePrefs(b, { kinds: { event: { enabled: true } } });
    b.state = { ...b.state, outbox: b.state.outbox.map((m) => ({ ...m, sent: true })) };
    await savePrefs(b, { kinds: { event: { enabled: false } } });
    expect(b.state.outbox).toHaveLength(2);
    expect(shownPrefs(b.state).kinds.event?.enabled).toBe(false);
  });
  it("turning quiet hours off is a change, not an absence", async () => {
    const b = account(held({ reminderPrefs: { ...prefs, quiet_hours: { start: "22:00", end: "07:00", timezone: "UTC" } } as any }));
    await savePrefs(b, { quiet_hours: null });
    expect(shownPrefs(b.state).quiet_hours).toBeNull();
    expect((b.state.outbox[0] as any).patch).toEqual({ quiet_hours: null });
  });
  it("a kind the API hasn't listed still shows what she chose", async () => {
    const b = account(held({ reminderPrefs: undefined }));
    await savePrefs(b, { kinds: { running_timer: { enabled: true } } });
    expect(shownPrefs(b.state).kinds.running_timer?.enabled).toBe(true);
    expect(shownPrefs(account(held({ reminderPrefs: undefined })).state).kinds.event?.enabled).toBeFalsy();
  });
});

describe("what a person is offered", () => {
  const spaces = (role: string) => ({ spaces: [{ id: "f", kind: "family", role, generation: 1, access_version: 1 }] }) as any;
  const pregnant = [{ id: "c", name: "A", due_date: "2026-12-10" }] as any;
  it("a parent expecting sees everything that can work, and none of the stubs", () => {
    expect(kindsFor(undefined, pregnant)).toEqual(["feed_interval", "event", "running_timer", "pregnancy_week", "visit_prep", "import"]);
  });
  it("after the birth there's no new week to hear about", () => {
    expect(kindsFor(undefined, [{ id: "c", name: "A", due_date: "2026-12-10", birth_date: "2026-12-09" }] as any)).not.toContain("pregnancy_week");
  });
  it("a caregiver hears only events and running timers, as the API sends them", () => {
    expect(kindsFor(spaces("caregiver"), pregnant)).toEqual(["event", "running_timer"]);
    expect(kindsFor(spaces("parent"), pregnant)).toContain("feed_interval");
  });
});

describe("turning something on", () => {
  const stub = (answer: "granted" | "denied" | "later") => vi.fn(async () => answer);
  it("waits for her answer before saving, and Not now leaves it off", async () => {
    const b = account(held()), ask = stub("later"), register = vi.fn();
    expect(await turnOn(b, "event", {}, ask, register)).toBe("later");
    expect(b.state.outbox).toEqual([]);
    expect(register).not.toHaveBeenCalled();
    expect(ask).toHaveBeenCalledWith("event");
  });
  it("granted: saves and puts this phone on the list", async () => {
    const b = account(held()), register = vi.fn();
    await turnOn(b, "feed_interval", { hours: 2.5 }, stub("granted"), register);
    expect(shownPrefs(b.state).kinds.feed_interval).toMatchObject({ enabled: true, hours: 2.5 });
    expect(register).toHaveBeenCalled();
  });
  it("refused at the phone: still saved, since Today shows it whatever the phone allows", async () => {
    const b = account(held()), register = vi.fn();
    await turnOn(b, "event", {}, stub("denied"), register);
    expect(shownPrefs(b.state).kinds.event?.enabled).toBe(true);
    expect(register).not.toHaveBeenCalled();
  });
});

describe("the quiet window", () => {
  it("makes a good default that's clearly hers to change", () => {
    expect(quietWindow(undefined, "Pacific/Guam")).toEqual({ start: "22:00", end: "07:00", timezone: "Pacific/Guam" });
  });
  it("won't save an empty window: moving one end past the other shifts it by an hour", () => {
    expect(quietWindow({ start: "22:00", end: "07:00", timezone: "UTC" }, "UTC", { end: "22:00" })).toEqual({ start: "22:00", end: "23:00", timezone: "UTC" });
    expect(quietWindow({ start: "22:00", end: "07:00", timezone: "UTC" }, "UTC", { start: "07:00" })).toEqual({ start: "07:00", end: "08:00", timezone: "UTC" });
    expect(quietWindow({ start: "22:00", end: "23:00", timezone: "UTC" }, "UTC", { start: "23:00" })).toEqual({ start: "23:00", end: "00:00", timezone: "UTC" });
  });
  it("follows the phone's zone whenever it's changed", () => {
    expect(quietWindow({ start: "22:00", end: "07:00", timezone: "UTC" }, "Pacific/Guam", { start: "21:00" }).timezone).toBe("Pacific/Guam");
  });
});
