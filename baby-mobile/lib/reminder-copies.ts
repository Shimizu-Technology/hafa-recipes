import type { DeviceState, QuietHours, ReminderKind, UpcomingReminder } from "./models";
import { reminderClock } from "./reminder-clock";
import { stillHers } from "./reminder-due";
import { shownPrefs } from "./reminder-prefs";

const heldAtOnce = 20; // iOS holds 64 between all of an app's scheduled notifications, and routines come first.

const stoppedHere = (state: Pick<DeviceState, "outbox">, record: unknown) =>
  state.outbox.some((m) => (m.type === "feed_action" || m.type === "session_action") && m.record_id === record);
function feedLoggedHere(state: Pick<DeviceState, "outbox">, child: unknown) {
  const times = state.outbox.flatMap((m) => (m.type === "save" && m.record.kind === "feeding" && m.record.child_id === (child ?? null) ? [m.record.occurred_at] : []));
  return times.length ? times.sort().at(-1)! : null;
}

const clockMinutes = (clock: string) => Number(clock.slice(0, 2)) * 60 + Number(clock.slice(3, 5));
/** Quiet hours set here that the API's times don't know about yet. Good enough for a best-effort copy: a clock change inside the window can be an hour out. */
function afterQuiet(at: Date, quiet: QuietHours) {
  try {
    const { hour, minute } = reminderClock(at, quiet.timezone), now = hour * 60 + minute,
      start = clockMinutes(quiet.start), end = clockMinutes(quiet.end),
      inside = start < end ? now >= start && now < end : now >= start || now < end;
    return inside ? new Date(at.getTime() + ((end - now + 1440) % 1440) * 60_000).toISOString() : at.toISOString();
  } catch {
    return at.toISOString();
  }
}
const quietPending = (state: Pick<DeviceState, "outbox">) => state.outbox.some((m) => m.type === "reminder_prefs" && !m.error && m.patch.quiet_hours !== undefined);
const hoursPending = (state: Pick<DeviceState, "outbox">) => state.outbox.some((m) => m.type === "reminder_prefs" && !m.error && m.patch.kinds?.feed_interval?.hours !== undefined);

/**
 * What this phone keeps scheduled in case no push can reach it, only while it knows it's offline. Online, a push is on its
 * way, and a copy could only sound twice or go stale after another phone's log. The same identity means one replaces the
 * other. What's changed here since the list came counts: a kind turned off, new hours, quiet hours, lost access. Best
 * effort, and nothing else depends on it.
 */
export function wantedCopies(state: Pick<DeviceState, "upcomingReminders" | "dismissing" | "outbox" | "reminderPrefs" | "bootstrap" | "records">, offline: boolean, now: Date): UpcomingReminder[] {
  if (!offline) return [];
  const dismissing = new Set(state.dismissing ?? []), prefs = shownPrefs(state);
  return (state.upcomingReminders ?? []).flatMap((item) => {
    const pref = prefs.kinds[item.kind as ReminderKind];
    if (pref?.enabled === false || !stillHers(state.bootstrap, item) || dismissing.has(item.id) || (item.kind === "running_timer" && stoppedHere(state, item.data.record_id))) return [];
    let moved: UpcomingReminder = { ...item, time_sensitive: pref?.break_through ?? item.time_sensitive };
    if (item.kind === "feed_interval") {
      const hours = pref?.hours, fed = feedLoggedHere(state, item.data.child_id) ?? (hoursPending(state) ? state.records.find((row) => row.id === item.data.record_id)?.occurred_at : null);
      if (fed && !hours) return [];
      if (fed) moved = { ...moved, fire_at: new Date(new Date(fed).getTime() + hours! * 3600_000).toISOString() };
      else if (hoursPending(state)) return [];
    }
    if (prefs.quiet_hours && quietPending(state) && !moved.time_sensitive) moved = { ...moved, fire_at: afterQuiet(new Date(moved.fire_at), prefs.quiet_hours) };
    return new Date(moved.fire_at) > now ? [moved] : [];
  }).sort((a, b) => a.fire_at.localeCompare(b.fire_at)).slice(0, heldAtOnce);
}

/** With the app open: the API's own show, as on the lock screen. Anything else stays as quiet as it always has. */
export function reminderPresentation(data: unknown) {
  const shown = !!data && typeof data === "object" && "notification_id" in data;
  return { shouldShowBanner: shown, shouldShowList: shown, shouldPlaySound: shown, shouldSetBadge: false };
}
