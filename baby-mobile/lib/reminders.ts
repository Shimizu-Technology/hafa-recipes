import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import type { BabyRecord, UpcomingReminder } from "./models";
import { reminderNotificationData } from "./notification-route";
import { reminderClock } from "./reminder-clock";
async function clearOwnedReminders(owner: string) {
  if (Platform.OS === "web") return;
  for (const n of await Notifications.getAllScheduledNotificationsAsync())
    if (n.content.data?.babyOwner === owner || n.content.data?.copyOwner === owner) await Notifications.cancelScheduledNotificationAsync(n.identifier);
}
export interface ReminderScope {
  authoritative: boolean;
  managedIds: readonly string[];
  current?: () => boolean;
}
async function reconcileOwnedReminders(owner: string, generation: number, records: BabyRecord[], scope: ReminderScope) {
  if (Platform.OS === "web") return;
  const current = scope.current ?? (() => true);
  if (!current()) return;
  const allowed = (await Notifications.getPermissionsAsync()).granted;
  const existing = (await Notifications.getAllScheduledNotificationsAsync()).filter(
    (n) => n.content.data?.babyOwner === owner
  );
  if (!current()) return;
  const managed = new Set(scope.managedIds);
  const desired = records.filter(
    (r) =>
      (scope.authoritative || managed.has(r.id)) &&
      r.kind === "routine" &&
      r.data.enabled &&
      r.data.reminder_at &&
      !(r.data.routine_type === "checklist" && r.data.items?.length && r.data.items.every((i) => i.done))
  );
  const metadata = new Map(desired.map((record) => [record.id, reminderNotificationData(owner, generation, record)]));
  const signatures = new Map([...metadata].map(([id, data]) => [id, data.signature]));
  for (const n of existing) {
    if (!current()) return;
    if (
      !allowed ||
      n.content.data?.generation !== generation ||
      ((scope.authoritative || managed.has(String(n.content.data?.recordId))) &&
        signatures.get(String(n.content.data?.recordId)) !== n.content.data?.signature)
    )
      await Notifications.cancelScheduledNotificationAsync(n.identifier);
  }
  if (!allowed) return;
  let failed = 0;
  for (const r of desired) {
    if (!current()) return;
    try {
      const signature = signatures.get(r.id)!;
      if (existing.some((n) => n.content.data?.recordId === r.id && n.content.data?.signature === signature)) continue;
      const date = new Date(r.data.reminder_at!);
      if (!Number.isFinite(date.getTime())) continue;
      let trigger: Notifications.NotificationTriggerInput;
      if (Platform.OS === "ios" && ["daily", "weekly"].includes(r.data.repeat ?? "")) {
        const timezone = r.data.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
        const clock = reminderClock(date, timezone);
        trigger = {
          type: Notifications.SchedulableTriggerInputTypes.CALENDAR,
          repeats: true,
          timezone,
          hour: clock.hour,
          minute: clock.minute,
          second: 0,
          ...(r.data.repeat === "weekly" ? { weekday: clock.weekday } : {}),
        };
      } else if (r.data.repeat === "daily")
        trigger = {
          type: Notifications.SchedulableTriggerInputTypes.DAILY,
          hour: date.getHours(),
          minute: date.getMinutes(),
        };
      else if (r.data.repeat === "weekly")
        trigger = {
          type: Notifications.SchedulableTriggerInputTypes.WEEKLY,
          weekday: date.getDay() + 1,
          hour: date.getHours(),
          minute: date.getMinutes(),
        };
      else {
        if (date.getTime() <= Date.now()) continue;
        trigger = { type: Notifications.SchedulableTriggerInputTypes.DATE, date };
      }
      await Notifications.scheduleNotificationAsync({
        content: {
          title: "A moment for your routine",
          body: "Open Håfa Baby to see your reminder.",
          sound: "default",
          data: metadata.get(r.id)!,
        },
        trigger,
      });
    } catch {
      failed++;
    }
  }
  if (failed && current())
    throw Error("Some reminders could not be scheduled. Review their time settings and try again.");
}
export async function requestReminders() {
  if (Platform.OS === "web") throw Error("Reminders need the installed iPhone or Android app.");
  if (Platform.OS === "android")
    await Notifications.setNotificationChannelAsync("default", {
      name: "Chosen reminders",
      importance: Notifications.AndroidImportance.DEFAULT,
    });
  const result = await Notifications.requestPermissionsAsync();
  if (!result.granted) throw Error("Notifications are off. You can enable them in your phone’s Settings.");
}

/** Named by the reminder's identity, as a push is, so one replaces the other. Its own, marked apart from routines. Never throws. */
async function reconcileOwnedCopies(owner: string, copies: UpcomingReminder[]) {
  if (Platform.OS === "web") return;
  try {
    const allowed = (await Notifications.getPermissionsAsync()).granted,
      wanted = new Map(copies.map((copy) => [copy.identity, copy])),
      existing = (await Notifications.getAllScheduledNotificationsAsync()).filter((n) => n.content.data?.copyOwner === owner),
      kept = new Set<string>();
    for (const n of existing) {
      if (allowed && wanted.get(n.identifier)?.fire_at === n.content.data?.fireAt) kept.add(n.identifier);
      else await Notifications.cancelScheduledNotificationAsync(n.identifier);
    }
    if (!allowed) return;
    for (const copy of copies) {
      if (kept.has(copy.identity)) continue;
      await Notifications.scheduleNotificationAsync({
        identifier: copy.identity,
        content: {
          body: copy.text,
          sound: "default",
          ...(copy.time_sensitive ? { interruptionLevel: "timeSensitive" as const } : {}),
          data: { notification_id: copy.id, space_id: copy.space_id, identity: copy.identity, copyOwner: owner, fireAt: copy.fire_at },
        },
        trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: new Date(copy.fire_at) },
      }).catch(() => undefined);
    }
  } catch { /* Best effort: the push and Today don't depend on it. */ }
}

const pending = new Map<string, Promise<unknown>>();
function ordered<T>(owner: string, work: () => Promise<T>) {
  const next = (pending.get(owner) ?? Promise.resolve()).catch(() => undefined).then(work);
  pending.set(owner, next);
  return next;
}
export function reconcileCopies(owner: string, copies: UpcomingReminder[]) {
  return ordered(owner, () => reconcileOwnedCopies(owner, copies));
}
/** The push got here, so the copy of it isn't needed. */
export function cancelCopy(owner: string, identity: string) {
  return ordered(owner, async () => {
    if (Platform.OS === "web") return;
    for (const n of await Notifications.getAllScheduledNotificationsAsync())
      if (n.identifier === identity && n.content.data?.copyOwner === owner) await Notifications.cancelScheduledNotificationAsync(n.identifier);
  }).catch(() => undefined);
}
export function clearReminders(owner: string) {
  return ordered(owner, () => clearOwnedReminders(owner));
}
export function reconcileReminders(
  owner: string,
  generation: number,
  records: BabyRecord[],
  scope: ReminderScope = { authoritative: true, managedIds: [] }
) {
  return ordered(owner, () => reconcileOwnedReminders(owner, generation, records, scope));
}
