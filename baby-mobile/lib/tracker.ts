import type { BabyRecord, Kind } from "./models";

/** The records the Day view lists as they are. Events join them as dated occurrences, from `useEvents`. */
export const timelineKinds: Kind[] = ["feeding", "sleep", "diaper", "journal", "question", "contraction", "kick_session"];

const pad = (value: number) => String(value).padStart(2, "0");
const hour = 60 * 60_000;

/** A calendar day as YYYY-MM-DD, never as an instant, so a day can't drift across a time zone. */
export const dayKey = (date: Date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
export function keyDate(key: string) {
  const [year, month, day] = key.split("-").map(Number);
  return new Date(year, month - 1, day);
}
export function addDays(key: string, days: number) {
  const date = keyDate(key);
  date.setDate(date.getDate() + days);
  return dayKey(date);
}
/** Sunday to Saturday, the week holding this day. */
export function weekOf(key: string) {
  const first = addDays(key, -keyDate(key).getDay());
  return Array.from({ length: 7 }, (_, index) => addDays(first, index));
}

export function zoneParts(instant: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(instant),
    part = (type: string) => Number(parts.find((value) => value.type === type)?.value);
  return { year: part("year"), month: part("month"), day: part("day"), hour: part("hour"), minute: part("minute"), second: part("second") };
}
function zoneOffset(instant: Date, timeZone: string) {
  const p = zoneParts(instant, timeZone);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(instant.getTime() / 1000) * 1000;
}

/**
 * The instant a family's clock reads this time on this day. Days and totals follow the profile's zone, as the API does,
 * and resolve the same way: a time read twice is the first, and a time the clock skips is the moment after the jump, so
 * a midnight skipped in spring (Santiago) starts its day at 1:00 rather than pulling in the hour before. `second` asks
 * for the later reading, as a repeat does whose first date was in the repeated hour.
 */
export function zonedInstant(key: string, hours: number, minutes: number, timeZone?: string | null, second = false) {
  const [year, month, day] = key.split("-").map(Number);
  try {
    if (!timeZone) throw Error("No zone");
    const guess = Date.UTC(year, month - 1, day, hours, minutes),
      before = zoneOffset(new Date(guess - 24 * hour), timeZone), after = zoneOffset(new Date(guess + 24 * hour), timeZone),
      reads = (offset: number) => zoneOffset(new Date(guess - offset), timeZone) === offset,
      real = [before, after].filter(reads).map((offset) => guess - offset);
    return new Date(real.length ? (second ? Math.max : Math.min)(...real) : guess - (second ? after : before));
  } catch { return new Date(year, month - 1, day, hours, minutes); }
}
export function dayRange(key: string, timeZone?: string | null) {
  return { from: zonedInstant(key, 0, 0, timeZone).toISOString(), to: zonedInstant(addDays(key, 1), 0, 0, timeZone).toISOString() };
}
/** The calendar day a saved time falls on, on the family's clock. */
export function recordDay(iso: string, timeZone?: string | null) {
  const instant = new Date(iso);
  if (Number.isNaN(instant.getTime())) return "";
  try {
    if (!timeZone) throw Error("No zone");
    const p = zoneParts(instant, timeZone);
    return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
  } catch { return dayKey(instant); }
}

/** A clock time on the family's clock, or the phone's if the zone can't be read. */
export function clockIn(date: Date, timeZone?: string | null) {
  const format = { hour: "numeric", minute: "2-digit" } as const;
  try { return date.toLocaleTimeString(undefined, timeZone ? { ...format, timeZone } : format); }
  catch { return date.toLocaleTimeString(undefined, format); }
}

/** Sleep inside a day, as the API counts it. A sleep over midnight counts on both days, overlaps count once, and one still going has no minutes until it ends. */
export function sleepMs(rows: readonly BabyRecord[], from: string, to: string, now = new Date()) {
  return mergedMs(rows.filter((row) => row.kind === "sleep" && row.data.end_at).map((row) => [row.occurred_at, row.data.end_at!] as const), from, to, now);
}
/** How much of a window these spans cover, counting overlaps once. */
export function mergedMs(list: readonly (readonly [string, string])[], from: string, to: string, now = new Date()) {
  const start = new Date(from).getTime(), end = Math.min(new Date(to).getTime(), now.getTime());
  const spans = list.flatMap(([first, last]) => {
    const a = new Date(first).getTime(), b = new Date(last).getTime();
    return Number.isFinite(a) && Number.isFinite(b) ? [[Math.max(a, start), Math.min(b, end)] as const] : [];
  }).filter(([a, b]) => b > a).sort((x, y) => x[0] - y[0]);
  let total = 0, reached = start;
  for (const [a, b] of spans) {
    const from = Math.max(a, reached);
    if (b > from) { total += b - from; reached = b; }
  }
  return total;
}

/** Whether an entry belongs on a day's timeline. A sleep is there on every day it touches, while it's still current too. */
export function onDay(row: BabyRecord, key: string, timeZone?: string | null, now = new Date()) {
  if (recordDay(row.occurred_at, timeZone) === key) return true;
  if (row.kind !== "sleep") return false;
  const { from, to } = dayRange(key, timeZone), start = new Date(row.occurred_at).getTime(),
    end = row.data.end_at ? new Date(row.data.end_at).getTime() : now.getTime() - start < 24 * hour ? now.getTime() : NaN;
  return start < new Date(to).getTime() && end > new Date(from).getTime();
}

/** One day's totals, in the shape `/care/summary` returns. */
export interface CareDay {
  date: string;
  feeding: { count: number };
  diapers: { count: number; pee: number; poo: number; dry: number };
  /** `spans` names each finished sleep on this day, unmerged, so a queued one can be swapped in without guessing at the rest. */
  sleep: { total_minutes: number; spans?: { record_id: string; from: string; to: string }[] };
  dots: string[];
}
/** The API's day worked out from rows on this phone, for offline and for changes it hasn't seen. Half-open, and never the future. */
export function dayTotals(rows: readonly BabyRecord[], key: string, timeZone?: string | null, now = new Date()): CareDay {
  // Screens pass a clock that ticks once a minute, and what she just tapped is newer than its last tick.
  const { from, to } = dayRange(key, timeZone), start = new Date(from).getTime(), end = Math.min(new Date(to).getTime(), now.getTime() + 60_000),
    today = rows.filter((row) => { const at = new Date(row.occurred_at).getTime(); return at >= start && at < end; }),
    diapers = today.filter((row) => row.kind === "diaper"),
    count = today.filter((row) => row.kind === "feeding").length,
    minutes = sleepMs(rows, from, to, now) / 60_000;
  return {
    date: key,
    feeding: { count },
    diapers: { count: diapers.length, pee: diapers.filter((row) => row.data.type === "wet" || row.data.type === "both").length,
      poo: diapers.filter((row) => row.data.type === "dirty" || row.data.type === "both").length, dry: diapers.filter((row) => row.data.type === "dry").length },
    sleep: { total_minutes: minutes },
    dots: [count && "feeding", diapers.length && "diaper", (minutes || today.some((row) => row.kind === "sleep" && !row.data.end_at)) && "sleep"].filter(Boolean) as string[],
  };
}

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

/** One line for a day: "9 feeds · 6 pee · 3 poo · 11h sleep". It counts what was logged and never judges it. */
export function summaryLine(day: CareDay) {
  const sleep = day.sleep.total_minutes / 60;
  return [plural(day.feeding.count, "feed"), `${day.diapers.pee} pee`, `${day.diapers.poo} poo`, `${sleep > 0 && sleep < 1 ? "<1" : Math.round(sleep)}h sleep`].join(" · ");
}
export function daySummary(rows: readonly BabyRecord[], key: string, timeZone?: string | null, now = new Date()) {
  return summaryLine(dayTotals(rows, key, timeZone, now));
}
