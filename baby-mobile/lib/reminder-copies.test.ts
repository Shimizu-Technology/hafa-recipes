import { beforeEach, describe, expect, it, vi } from "vitest";
import { emptyState, type DeviceState, type UpcomingReminder } from "./models";
const native = vi.hoisted(() => ({
  getPermissionsAsync: vi.fn(),
  getAllScheduledNotificationsAsync: vi.fn(),
  cancelScheduledNotificationAsync: vi.fn(),
  scheduleNotificationAsync: vi.fn(),
  SchedulableTriggerInputTypes: { DATE: "date", CALENDAR: "calendar" },
}));
vi.mock("expo-notifications", () => native);
vi.mock("react-native", () => ({ Platform: { OS: "ios" } }));
import { clearReminders, reconcileCopies, cancelCopy } from "./reminders";
import { reminderPresentation, wantedCopies } from "./reminder-copies";

const now = new Date("2026-11-06T00:00:00Z");
const later = (hours: number) => new Date(now.getTime() + hours * 3600_000).toISOString();
const up = (identity: string, extra: Partial<UpcomingReminder> = {}): UpcomingReminder => ({
  id: `id-${identity}`, kind: "event", identity, fire_at: later(1), text: "You have something on your calendar.", time_sensitive: false, data: {}, ...extra,
});
const held = (upcomingReminders: UpcomingReminder[], extra: Partial<DeviceState> = {}) => ({ ...emptyState(), upcomingReminders, ...extra }) as DeviceState;
const feedSave = (child: string, at: string) => ({ id: `m-${at}`, generation: 1, type: "save" as const, files: [], record: { id: `feed-${at}`, kind: "feeding" as const, title: "", body: "", child_id: child, occurred_at: at, data: {} } });

describe("what this phone holds as its offline copy", () => {
  it("nothing while it's online: a push is coming, and a copy could only double it or go stale", () => {
    expect(wantedCopies(held([up("a")]), false, now)).toEqual([]);
  });
  it("offline, what was last waiting, with the API's identity, time and lock-screen words", () => {
    expect(wantedCopies(held([up("a")]), true, now)).toEqual([up("a")]);
  });
  it("not one that's already passed, or that she dismissed", () => {
    const state = held([up("past", { fire_at: later(-1) }), up("gone", { id: "dismissed" }), up("a")], { dismissing: ["dismissed"] });
    expect(wantedCopies(state, true, now).map((item) => item.identity)).toEqual(["a"]);
  });
  it("a feed logged with no signal moves that baby's reminder, and leaves another's", () => {
    const state = held([
      up("baby", { kind: "feed_interval", data: { child_id: "baby" } }),
      up("other", { kind: "feed_interval", data: { child_id: "other" } }),
    ], {
      reminderPrefs: { quiet_hours: null, kinds: { feed_interval: { enabled: true, break_through: false, hours: 2, feed_hours: null, sleep_hours: null } } },
      outbox: [feedSave("baby", later(0.5)), feedSave("baby", later(0.25))],
    });
    const copies = wantedCopies(state, true, now);
    expect(copies.find((item) => item.identity === "baby")?.fire_at).toBe(later(2.5));
    expect(copies.find((item) => item.identity === "other")?.fire_at).toBe(later(1));
  });
  it("a feed logged offline with no hours known has nothing to move to", () => {
    const state = held([up("baby", { kind: "feed_interval", data: { child_id: "baby" } })], { outbox: [feedSave("baby", later(0.5))] });
    expect(wantedCopies(state, true, now)).toEqual([]);
  });
  it("a timer stopped with no signal is no reason to remind", () => {
    const state = held([up("t", { kind: "running_timer", data: { record_id: "running" } })], {
      outbox: [{ id: "s", generation: 1, type: "feed_action", record_id: "running", action: { id: "s", action: "finish", at: later(0) } }],
    });
    expect(wantedCopies(state, true, now)).toEqual([]);
  });
  it("holds a bounded number, soonest first", () => {
    const many = Array.from({ length: 40 }, (_, i) => up(`n${i}`, { fire_at: later(40 - i) }));
    const copies = wantedCopies(held(many), true, now);
    expect(copies).toHaveLength(20);
    expect(copies[0].identity).toBe("n39");
  });
});

describe("the copies themselves", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    native.getPermissionsAsync.mockResolvedValue({ granted: true });
    native.getAllScheduledNotificationsAsync.mockResolvedValue([]);
  });
  const scheduled = (identity: string, fireAt = later(1), owner = "owner") => ({ identifier: identity, content: { data: { copyOwner: owner, fireAt, notification_id: `id-${identity}`, identity } } });
  it("uses the reminder's identity as its own, carries only opaque ids and lock-screen words", async () => {
    await reconcileCopies("owner", [up("a", { data: { child_id: "secret", record_id: "secret" }, kind: "feed_interval", text: "Feed reminder.", space_id: "s", time_sensitive: true })]);
    const [{ identifier, content, trigger }] = native.scheduleNotificationAsync.mock.calls[0];
    expect(identifier).toBe("a");
    expect(content.body).toBe("Feed reminder.");
    expect(content.title).toBeUndefined();
    expect(content.data).toEqual({ notification_id: "id-a", space_id: "s", identity: "a", copyOwner: "owner", fireAt: later(1) });
    expect(content.interruptionLevel).toBe("timeSensitive");
    expect(trigger).toMatchObject({ type: "date" });
    expect(trigger.date.toISOString()).toBe(later(1));
  });
  it("is cancelled once this phone is online again, and leaves routine reminders alone", async () => {
    native.getAllScheduledNotificationsAsync.mockResolvedValue([scheduled("a"), { identifier: "routine", content: { data: { babyOwner: "owner", recordId: "r", generation: 1 } } }]);
    await reconcileCopies("owner", []);
    expect(native.cancelScheduledNotificationAsync.mock.calls).toEqual([["a"]]);
  });
  it("one already right is left alone, and one whose time moved is replaced", async () => {
    native.getAllScheduledNotificationsAsync.mockResolvedValue([scheduled("same"), scheduled("moved", later(3))]);
    await reconcileCopies("owner", [up("same"), up("moved")]);
    expect(native.cancelScheduledNotificationAsync.mock.calls).toEqual([["moved"]]);
    expect(native.scheduleNotificationAsync.mock.calls.map(([{ identifier }]) => identifier)).toEqual(["moved"]);
  });
  it("without permission nothing is scheduled, and nothing is asked", async () => {
    native.getPermissionsAsync.mockResolvedValue({ granted: false });
    await reconcileCopies("owner", [up("a")]);
    expect(native.scheduleNotificationAsync).not.toHaveBeenCalled();
  });
  it("a failure scheduling one doesn't stop the others or show anywhere", async () => {
    native.scheduleNotificationAsync.mockRejectedValueOnce(Error("limit"));
    await expect(reconcileCopies("owner", [up("a"), up("b")])).resolves.toBeUndefined();
    expect(native.scheduleNotificationAsync).toHaveBeenCalledTimes(2);
  });
  it("sign-out takes another account's nothing, and its own copies with its reminders", async () => {
    native.getAllScheduledNotificationsAsync.mockResolvedValue([scheduled("mine"), scheduled("theirs", later(1), "someone-else")]);
    await clearReminders("owner");
    expect(native.cancelScheduledNotificationAsync.mock.calls).toEqual([["mine"]]);
  });
  it("a delivered push drops the copy with its identity", async () => {
    native.getAllScheduledNotificationsAsync.mockResolvedValue([scheduled("a"), scheduled("b")]);
    await cancelCopy("owner", "a");
    expect(native.cancelScheduledNotificationAsync.mock.calls).toEqual([["a"]]);
  });
});

describe("a reminder with the app open", () => {
  const silent = { shouldShowBanner: false, shouldShowList: false, shouldPlaySound: false, shouldSetBadge: false };
  it("one of the API's shows; a routine stays silent as it always has, and so does a refresh", () => {
    expect(reminderPresentation({ notification_id: "x" })).toEqual({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false });
    expect(reminderPresentation({ babyOwner: "o", recordId: "r" })).toEqual(silent);
    expect(reminderPresentation({ refresh: true })).toEqual(silent);
    expect(reminderPresentation(undefined)).toEqual(silent);
  });
});
