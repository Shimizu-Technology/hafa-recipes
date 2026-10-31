import type { BabyRecord } from "./models";
/** Today's explicitly enabled reminders, plus unfinished undated checklists. */
export function routineToday(record: BabyRecord, now: Date) {
  if (record.kind !== "routine") return false;
  const data = record.data;
  if (data.items?.length && data.items.every(item => item.done)) return false;
  if (!data.reminder_at) return !!data.items?.some(item => !item.done);
  if (!data.enabled) return false;
  const due = new Date(data.reminder_at);
  if (!Number.isFinite(due.getTime())) return false;
  const zone = typeof data.timezone === "string" ? data.timezone : undefined;
  try {
    const date = new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" });
    const today = date.format(now), start = date.format(due);
    if (today < start) return false;
    if (data.repeat === "daily") return true;
    if (data.repeat === "weekly") {
      const weekday = new Intl.DateTimeFormat("en-US", { timeZone: zone, weekday: "short" });
      return weekday.format(now) === weekday.format(due);
    }
    return today === start;
  } catch { return false; }
}

/** Recurrences keep the wall clock in the user's chosen schedule timezone. */
export function routineReminderLabel(record: BabyRecord) {
  const { reminder_at, repeat, timezone } = record.data;
  const due = new Date(reminder_at!);
  const timeZone = timezone ?? undefined;
  const time = due.toLocaleTimeString(undefined, { timeZone, hour: "numeric", minute: "2-digit" });
  if (repeat === "daily") return `Daily · ${time}`;
  if (repeat === "weekly") {
    const weekday = due.toLocaleDateString(undefined, { timeZone, weekday: "short" });
    return `Weekly · ${weekday} ${time}`;
  }
  return `Reminder ${time}`;
}
