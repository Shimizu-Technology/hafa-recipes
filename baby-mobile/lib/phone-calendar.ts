import { requireOptionalNativeModule } from "expo";
import { dayName, repeatName } from "./events";
import type { BabyRecord, EventOccurrence, EventRecurrence } from "./models";
import { keyDate, recordDay } from "./tracker";

/** What goes to the phone's calendar. Notes, who's coming and categories stay in the app: they can be private, and Google or Apple would hold them. */
export interface PhoneEvent {
  title: string;
  startDate: Date;
  endDate: Date;
  allDay: boolean;
  location?: string;
  timeZone?: string;
  recurrenceRule?: { frequency: EventRecurrence["frequency"]; interval: number; endDate?: Date };
}
const hour = 3_600_000;
/** A changed date is a one-off, as it is on screen. Anything else carries its rule, starting from the date she has open. */
const carriesRule = (row: Pick<BabyRecord, "data">, shown: EventOccurrence) => !!row.data.recurrence && !shown.changed;
const dayIn = (iso: string, zone: string) => keyDate(recordDay(iso, zone));

export function phoneEvent(row: Pick<BabyRecord, "data">, shown: EventOccurrence): PhoneEvent {
  const zone = shown.timezone, rule = row.data.recurrence, start = new Date(shown.occurrence_start),
    // An all-day event is a date, not an instant: a phone in another zone must still show the same day. Its end is the midnight after its last day.
    time = shown.all_day
      ? { startDate: dayIn(shown.occurrence_start, zone), endDate: shown.occurrence_end ? dayIn(new Date(new Date(shown.occurrence_end).getTime() - 1).toISOString(), zone) : dayIn(shown.occurrence_start, zone) }
      : { startDate: start, endDate: shown.occurrence_end ? new Date(shown.occurrence_end) : new Date(start.getTime() + hour), timeZone: zone };
  return { title: shown.title, ...time, allDay: shown.all_day, ...(shown.location ? { location: shown.location } : {}),
    ...(carriesRule(row, shown) ? { recurrenceRule: { frequency: rule!.frequency, interval: rule!.interval ?? 1, ...(rule!.until ? { endDate: lastMoment(rule!.until) } : {}) } } : {}) };
}
const lastMoment = (key: string) => { const end = keyDate(key); end.setHours(23, 59, 59, 0); return end; };

/** Which dates go, and what doesn't, in a line under the button. */
export function phoneEventLine(row: Pick<BabyRecord, "data">, shown: EventOccurrence, today: string) {
  const rule = row.data.recurrence, when = dayName(recordDay(shown.occurrence_start, shown.timezone), today), copied = "Only the title, time and place are copied.";
  if (!rule) return copied;
  if (!carriesRule(row, shown)) return `Only ${when}, since it’s changed. ${copied}`;
  const day = Number(recordDay(shown.occurrence_start, shown.timezone).slice(8)), short = rule.frequency !== "daily" && rule.frequency !== "weekly" && day > 28;
  return [`${repeatName(rule)} from ${when}.`, row.data.exceptions?.length ? "Changes to single dates stay in Håfa." : "", short ? "Your phone’s calendar may skip months without this date." : "", copied].filter(Boolean).join(" ");
}

/** Whether this binary has the native sheet. A build from before it was added has no way to open one. */
export const phoneCalendarAvailable = () => !!requireOptionalNativeModule("ExpoCalendar");

/**
 * Opens the phone's own add-event sheet, where she picks Apple or a Google calendar already on the phone. It's one way and
 * once: nothing reads her calendars, so it asks for no permission. Loaded here, since the module throws on a binary without it.
 */
export async function addToPhoneCalendar(event: PhoneEvent): Promise<"saved" | "canceled" | "done" | "unavailable"> {
  if (!phoneCalendarAvailable()) return "unavailable";
  try {
    const { createEventInCalendarAsync } = await import("expo-calendar/legacy"), result = await createEventInCalendarAsync(event as never);
    return result.action === "saved" ? "saved" : result.action === "canceled" ? "canceled" : "done";
  } catch { return "unavailable"; }
}
