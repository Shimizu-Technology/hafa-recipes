import { it, expect, vi } from "vitest";
import {
  createReminders,
  defaultReminderSettings,
  notificationIntents,
  reminderErrors,
  type LocalNotifications,
  type NotificationIntent,
} from "./reminders";
function fixture() {
  const saved = new Map<string, string>();
  const pending = new Map<string, NotificationIntent>();
  let current: string | null = "stable:workouts:2";
  let permission: "granted" | "denied" = "granted";
  const adapter: LocalNotifications = {
    permission: vi.fn(async () => permission),
    list: vi.fn(async () => [...pending.values()]),
    schedule: vi.fn(async (intent) => {
      pending.set(intent.id, intent);
    }),
    cancel: vi.fn(async (id) => {
      pending.delete(id);
    }),
    openSettings: vi.fn(async () => {}),
  };
  const deps = {
    storage: {
      getItem: async (k: string) => saved.get(k) ?? null,
      setItem: async (k: string, v: string) => {
        saved.set(k, v);
      },
      removeItem: async (k: string) => {
        saved.delete(k);
      },
    },
    adapter,
    owner_scope: "stable:workouts:2",
    currentOwnerScope: () => current,
    now: () => 10000,
  };
  return {
    saved,
    pending,
    adapter,
    deps,
    controller: createReminders(deps),
    owner: (value: string | null) => {
      current = value;
    },
    permission: (value: "granted" | "denied") => {
      permission = value;
    },
  };
}
it("maps Monday-zero profile days to Sunday-one device trigger days without inferring completion", () => {
  const result = notificationIntents(
    "scope",
    { ...defaultReminderSettings(), weekly_enabled: true, days: [0, 6] },
    null,
    0
  );
  expect(result.map((item) => item.weekday)).toEqual([2, 1]);
  expect(result.every((item) => item.kind === "routine")).toBe(true);
  expect(reminderErrors({ ...defaultReminderSettings(), weekly_enabled: true })).toHaveLength(1);
});
it("rest alerts follow persisted deadlines and cancel on pause/finish rather than completing a set", async () => {
  const f = fixture();
  await f.controller.load();
  await f.controller.save({ ...defaultReminderSettings(), rest_enabled: true });
  await f.controller.timer({ session_id: "session", until: 20000 });
  expect([...f.pending.values()][0]).toMatchObject({ until: 20000, session_id: "session" });
  await f.controller.timer(null);
  expect(f.pending.size).toBe(0);
  expect(f.controller.snapshot().timer).toBeNull();
});
it("permission denial saves optional preferences and keeps timers usable without scheduling", async () => {
  const f = fixture();
  await f.controller.load();
  f.permission("denied");
  await f.controller.save({ ...defaultReminderSettings(), rest_enabled: true });
  await f.controller.timer({ session_id: "session", until: 20000 });
  expect(f.controller.snapshot().permission).toBe("denied");
  expect(f.controller.snapshot().settings.rest_enabled).toBe(true);
  expect(f.pending.size).toBe(0);
});
it("restarts from exact timer/settings checkpoints and does not create another copy of an existing alert", async () => {
  const f = fixture();
  await f.controller.load();
  await f.controller.save({ ...defaultReminderSettings(), rest_enabled: true });
  await f.controller.timer({ session_id: "session", until: 20000 });
  const before = vi.mocked(f.adapter.schedule).mock.calls.length;
  const restored = createReminders(f.deps);
  await restored.load();
  expect(restored.snapshot().timer).toEqual({ session_id: "session", until: 20000 });
  expect(f.adapter.schedule).toHaveBeenCalledTimes(before);
});
it("account switches during an OS schedule cancel that exact owned alert and never cancel unrelated app data", async () => {
  const f = fixture();
  await f.controller.load();
  vi.mocked(f.adapter.schedule).mockImplementationOnce(async (intent) => {
    f.pending.set(intent.id, intent);
    f.owner("other:workouts:2");
  });
  await expect(f.controller.save({ ...defaultReminderSettings(), weekly_enabled: true, days: [0] })).rejects.toThrow(
    "account changed"
  );
  expect(f.pending.size).toBe(0);
});
it("cleanup only cancels the original account namespace and leaves other owners alone", async () => {
  const f = fixture();
  await f.controller.load();
  await f.controller.save({ ...defaultReminderSettings(), weekly_enabled: true, days: [0] });
  const unrelated = {
    id: "hafa-workouts:v1:other:routine:1",
    owner_scope: "other",
    kind: "routine" as const,
    fingerprint: "other",
  };
  f.pending.set(unrelated.id, unrelated);
  f.owner(null);
  await f.controller.cleanupOwned();
  expect([...f.pending.values()]).toEqual([unrelated]);
});
it("does not overwrite malformed preferences when a timer update is attempted after load failure", async () => {
  const f = fixture();
  f.saved.set("hafa-workouts:reminders:v1:stable%3Aworkouts%3A2", "broken");
  await expect(f.controller.load()).rejects.toThrow();
  await expect(f.controller.timer(null)).rejects.toThrow("load");
  expect([...f.saved.values()]).toEqual(["broken"]);
});
