import type { BabyRecord, Kind } from "./models";

/** Everything the Day view lists. Events and milestones join this once they exist. */
export const timelineKinds: Kind[] = ["feeding", "sleep", "diaper", "journal", "question"];

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

function zoneParts(instant: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(instant),
    part = (type: string) => Number(parts.find((value) => value.type === type)?.value);
  return { year: part("year"), month: part("month"), day: part("day"), hour: part("hour"), minute: part("minute"), second: part("second") };
}
function zoneOffset(instant: Date, timeZone: string) {
  const p = zoneParts(instant, timeZone);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(instant.getTime() / 1000) * 1000;
}

/** The instant a family's clock reads this time on this day. Days and totals follow the profile's zone, as the API does. */
export function zonedInstant(key: string, hours: number, minutes: number, timeZone?: string | null) {
  const [year, month, day] = key.split("-").map(Number);
  try {
    if (!timeZone) throw Error("No zone");
    const guess = Date.UTC(year, month - 1, day, hours, minutes),
      first = guess - zoneOffset(new Date(guess), timeZone);
    return new Date(guess - zoneOffset(new Date(first), timeZone));
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

/** Sleep inside a day. A sleep running over midnight counts on both days, and overlaps count once. */
export function sleepMs(rows: readonly BabyRecord[], from: string, to: string, now = new Date()) {
  const start = new Date(from).getTime(), end = Math.min(new Date(to).getTime(), now.getTime());
  const spans = rows.filter((row) => row.kind === "sleep").flatMap((row) => {
    const a = new Date(row.occurred_at).getTime();
    // An open sleep from long ago was never ended, and isn't still happening.
    const b = row.data.end_at ? new Date(row.data.end_at).getTime() : now.getTime() - a < 24 * hour ? now.getTime() : NaN;
    return Number.isFinite(a) && Number.isFinite(b) ? [[Math.max(a, start), Math.min(b, end)] as const] : [];
  }).filter(([a, b]) => b > a).sort((x, y) => x[0] - y[0]);
  let total = 0, reached = start;
  for (const [a, b] of spans) {
    const from = Math.max(a, reached);
    if (b > from) { total += b - from; reached = b; }
  }
  return total;
}

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

/** One line for a day: "9 feeds · 6 pee · 3 poo · 11h sleep". It counts what was logged and never judges it. */
export function daySummary(rows: readonly BabyRecord[], key: string, timeZone?: string | null, now = new Date()) {
  const { from, to } = dayRange(key, timeZone),
    today = rows.filter((row) => recordDay(row.occurred_at, timeZone) === key),
    diapers = today.filter((row) => row.kind === "diaper"),
    sleep = sleepMs(rows, from, to, now) / hour;
  return [
    plural(today.filter((row) => row.kind === "feeding").length, "feed"),
    `${diapers.filter((row) => row.data.type === "wet" || row.data.type === "both").length} pee`,
    `${diapers.filter((row) => row.data.type === "dirty" || row.data.type === "both").length} poo`,
    `${sleep > 0 && sleep < 1 ? "<1" : Math.round(sleep)}h sleep`,
  ].join(" · ");
}
