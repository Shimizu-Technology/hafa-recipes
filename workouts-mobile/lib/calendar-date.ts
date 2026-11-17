import { isISODate } from "./sharing";

/** A local calendar day as YYYY-MM-DD, the format every date field stores. */
export function toISODate(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
/** Today on this device, never earlier than `min` when a screen sets one. */
export function todayISODate(min?: string | null, now = new Date()) {
  const today = toISODate(now);
  return min && isISODate(min) && min > today ? min : today;
}
