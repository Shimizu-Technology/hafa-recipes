import type { DeviceState, UpcomingReminder } from "./models";

const heldAtOnce = 20; // iOS holds 64 between all of an app's scheduled notifications, and routines come first.

const stoppedHere = (state: Pick<DeviceState, "outbox">, record: unknown) =>
  state.outbox.some((m) => (m.type === "feed_action" || m.type === "session_action") && m.record_id === record);
function feedLoggedHere(state: Pick<DeviceState, "outbox">, child: unknown) {
  const times = state.outbox.flatMap((m) => (m.type === "save" && m.record.kind === "feeding" && m.record.child_id === (child ?? null) ? [m.record.occurred_at] : []));
  return times.length ? times.sort().at(-1)! : null;
}

/**
 * What this phone keeps scheduled in case no push can reach it, only while it knows it's offline. Online, a push is on its
 * way, and a copy could only sound twice or go stale after another phone's log. The same identity means one replaces the
 * other. Best effort, and nothing else depends on it.
 */
export function wantedCopies(state: Pick<DeviceState, "upcomingReminders" | "dismissing" | "outbox" | "reminderPrefs">, offline: boolean, now: Date): UpcomingReminder[] {
  if (!offline) return [];
  const dismissing = new Set(state.dismissing ?? []);
  return (state.upcomingReminders ?? []).flatMap((item) => {
    if (dismissing.has(item.id) || (item.kind === "running_timer" && stoppedHere(state, item.data.record_id))) return [];
    let moved = item;
    if (item.kind === "feed_interval") {
      const fed = feedLoggedHere(state, item.data.child_id), hours = state.reminderPrefs?.kinds.feed_interval?.hours;
      if (fed && !hours) return [];
      if (fed) moved = { ...item, fire_at: new Date(new Date(fed).getTime() + hours! * 3600_000).toISOString() };
    }
    return new Date(moved.fire_at) > now ? [moved] : [];
  }).sort((a, b) => a.fire_at.localeCompare(b.fire_at)).slice(0, heldAtOnce);
}

/** With the app open: the API's own show, as on the lock screen. Anything else stays as quiet as it always has. */
export function reminderPresentation(data: unknown) {
  const shown = !!data && typeof data === "object" && "notification_id" in data;
  return { shouldShowBanner: shown, shouldShowList: shown, shouldPlaySound: shown, shouldSetBadge: false };
}
