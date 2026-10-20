/** Calendar components in the schedule's chosen zone, independent of travel. */
export function reminderClock(date: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone, hourCycle: "h23", hour: "2-digit", minute: "2-digit", weekday: "short",
  }).formatToParts(date);
  const part = (type: string) => parts.find(p => p.type === type)!.value;
  return { hour: Number(part("hour")), minute: Number(part("minute")), weekday: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(part("weekday")) + 1 };
}
