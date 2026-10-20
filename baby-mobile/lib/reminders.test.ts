import { beforeEach, describe, expect, it, vi } from "vitest";
import { optimisticRecord } from "./models";
const native = vi.hoisted(() => ({
  getPermissionsAsync: vi.fn(),
  getAllScheduledNotificationsAsync: vi.fn(),
  cancelScheduledNotificationAsync: vi.fn(),
  scheduleNotificationAsync: vi.fn(),
  SchedulableTriggerInputTypes: { CALENDAR: "calendar", DATE: "date" },
}));
vi.mock("expo-notifications", () => native);
vi.mock("react-native", () => ({ Platform: { OS: "ios" } }));
import { reconcileReminders } from "./reminders";
import { reminderNotificationData } from "./notification-route";
const row = (id: string, enabled = true) =>
  optimisticRecord({
    id,
    kind: "routine",
    title: id,
    body: "",
    child_id: null,
    occurred_at: "2026-10-20T00:00:00Z",
    data: { enabled, reminder_at: "2027-01-01T10:00:00Z", repeat: "daily" as const },
  });
const scheduled = (id: string, generation = 1) => ({
  identifier: id,
  content: { data: reminderNotificationData("owner", generation, row(id)) },
});
beforeEach(() => {
  vi.clearAllMocks();
  native.getPermissionsAsync.mockResolvedValue({ granted: true });
  native.getAllScheduledNotificationsAsync.mockResolvedValue([]);
});
describe("authoritative versus legacy reminder restoration", () => {
  it("preserves same-generation unmanaged reminders and never schedules stale cached routines", async () => {
    native.getAllScheduledNotificationsAsync.mockResolvedValue([
      scheduled("unknown-old"),
      scheduled("previous-generation", 0),
    ]);
    await reconcileReminders("owner", 1, [row("stale-cache")], { authoritative: false, managedIds: [] });
    expect(native.cancelScheduledNotificationAsync.mock.calls).toEqual([["previous-generation"]]);
    expect(native.scheduleNotificationAsync).not.toHaveBeenCalled();
  });
  it("honors explicit offline disable/delete/completion/discard without touching unmanaged reminders", async () => {
    native.getAllScheduledNotificationsAsync.mockResolvedValue([
      scheduled("disabled"),
      scheduled("deleted"),
      scheduled("done"),
      scheduled("discarded"),
      scheduled("unknown"),
    ]);
    await reconcileReminders(
      "owner",
      1,
      [
        row("disabled", false),
        {
          ...row("done"),
          data: { ...row("done").data, routine_type: "checklist", items: [{ id: "i", label: "Done", done: true }] },
        },
      ],
      { authoritative: false, managedIds: ["disabled", "deleted", "done", "discarded"] }
    );
    expect(native.cancelScheduledNotificationAsync.mock.calls.flat()).toEqual([
      "disabled",
      "deleted",
      "done",
      "discarded",
    ]);
  });
  it("schedules explicit local choices and removes remotely disabled/deleted routines after full restore", async () => {
    native.getAllScheduledNotificationsAsync.mockResolvedValue([scheduled("deleted"), scheduled("disabled")]);
    await reconcileReminders("owner", 1, [row("disabled", false), row("new")], { authoritative: true, managedIds: [] });
    expect(native.cancelScheduledNotificationAsync.mock.calls.flat()).toEqual(["deleted", "disabled"]);
    expect(native.scheduleNotificationAsync.mock.calls[0][0].content.data.recordId).toBe("new");
    native.scheduleNotificationAsync.mockClear();
    native.getAllScheduledNotificationsAsync.mockResolvedValue([]);
    await reconcileReminders("owner", 1, [row("chosen"), row("unverified")], {
      authoritative: false,
      managedIds: ["chosen"],
    });
    expect(native.scheduleNotificationAsync.mock.calls.map(([n]) => n.content.data.recordId)).toEqual(["chosen"]);
  });
  it("stops obsolete reconciliation while awaiting native permission state", async () => {
    let release!: (value: { granted: boolean }) => void,
      valid = true;
    native.getPermissionsAsync.mockReturnValue(
      new Promise((yes) => {
        release = yes;
      })
    );
    const work = reconcileReminders("owner", 1, [row("stale")], {
      authoritative: true,
      managedIds: [],
      current: () => valid,
    });
    await vi.waitFor(() => expect(native.getPermissionsAsync).toHaveBeenCalled());
    valid = false;
    release({ granted: true });
    await work;
    expect(native.scheduleNotificationAsync).not.toHaveBeenCalled();
    expect(native.cancelScheduledNotificationAsync).not.toHaveBeenCalled();
  });
});

it("schedules healthy routines after a scheduler failure and reports it",async()=>{
  native.scheduleNotificationAsync.mockReset().mockRejectedValueOnce(Error("OS unavailable")).mockResolvedValue("scheduled");
  await expect(reconcileReminders("owner",1,[row("failed"),row("healthy")])).rejects.toThrow("reminder");
  expect(native.scheduleNotificationAsync.mock.calls.map(([n])=>n.content.data.recordId)).toEqual(["failed","healthy"]);
});
it("keeps the chosen timezone and schedules a healthy routine after a bad timezone",async()=>{
  native.scheduleNotificationAsync.mockReset().mockResolvedValue("scheduled");
  const invalid={...row("invalid"),data:{...row("invalid").data,timezone:"Invalid/Zone"}};
  await expect(reconcileReminders("owner",1,[invalid,row("healthy")])).rejects.toThrow("reminder");
  expect(native.scheduleNotificationAsync.mock.calls.map(([n])=>n.content.data.recordId)).toEqual(["healthy"]);
});
