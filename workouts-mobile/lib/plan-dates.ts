import { isISODate } from "./sharing";

const day = 86_400_000;
const utc = (iso: string) => Date.parse(`${iso}T00:00:00Z`);

/** The calendar date `days` after `iso` (YYYY-MM-DD). Invalid input returns it unchanged. */
export function addDays(iso: string, days: number) {
  if (!isISODate(iso) || !Number.isInteger(days)) return iso;
  return new Date(utc(iso) + days * day).toISOString().slice(0, 10);
}

/** Whole days from `start` to `date`; null if either is not a real calendar date. */
export function daysBetween(start: string, date: string) {
  if (!isISODate(start) || !isISODate(date)) return null;
  return Math.round((utc(date) - utc(start)) / day);
}

/** A session's date from the plan's first day and its stored day offset; null while the offset is blank. */
export function sessionDate(start: string, offset: string) {
  const days = offset.trim() ? Number(offset) : NaN;
  return Number.isInteger(days) && isISODate(start) ? addDays(start, days) : null;
}

/** The day offset to save for a chosen session date. */
export function offsetFor(start: string, date: string | null) {
  const days = date ? daysBetween(start, date) : null;
  return days == null ? "" : String(days);
}

/** A new session lands the day after the latest one, so adding days builds a week naturally. */
export function nextOffset(offsets: string[]) {
  const used = offsets.map(Number).filter((value) => Number.isInteger(value) && value >= 0);
  return String(used.length ? Math.min(365, Math.max(...used) + 1) : 0);
}
