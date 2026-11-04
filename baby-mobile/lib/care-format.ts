import type { Child, Kind, RecordData } from "./models";
import { addDays, clockIn, keyDate, recordDay } from "./tracker";

const minute = 60_000;

/** "45 min", "1 h", "1 h 20 min"; never negative. */
export function duration(minutes: number) {
  if (!Number.isFinite(minutes)) return "";
  if (minutes > 0 && minutes < 1) return "under 1 min";
  const total = Math.max(0, Math.round(minutes)),
    hours = Math.floor(total / 60),
    rest = total % 60;
  if (!hours) return `${rest} min`;
  return rest ? `${hours} h ${rest} min` : `${hours} h`;
}

/** "6:02 PM", "Yesterday 11:40 PM", "Oct 18, 9:15 AM", or with the year when it differs. On the family's clock when given one. */
export function friendlyTime(iso: string, now = new Date(), timeZone?: string | null) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const time = clockIn(date, timeZone), key = recordDay(iso, timeZone), today = recordDay(now.toISOString(), timeZone);
  if (key === today) return time;
  if (key === addDays(today, -1)) return `Yesterday ${time}`;
  const day = keyDate(key).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    ...(key.slice(0, 4) === today.slice(0, 4) ? {} : { year: "numeric" }),
  });
  return `${day}, ${time}`;
}

/** "just now", "25 min ago", "2 h 10 min ago", "3 days ago". */
export function timeAgo(iso: string, now = new Date()) {
  const minutes = Math.floor((now.getTime() - new Date(iso).getTime()) / minute);
  if (!Number.isFinite(minutes)) return "";
  if (minutes < 1) return "just now";
  if (minutes < 48 * 60) return `${duration(minutes)} ago`;
  return `${Math.floor(minutes / (24 * 60))} days ago`;
}

/** A calendar date stored as YYYY-MM-DD, shown without timezone drift. */
export function friendlyDate(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return value;
  return new Date(year, month - 1, day).toLocaleDateString(undefined, {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

const sides = { left: "Left side", right: "Right side", both: "Both sides" } as const;
/** Kami's words on screen; the stored values stay wet, dirty, both and dry so older entries still count. */
export const diaperWords = { wet: "Pee", dirty: "Poo", both: "Pee and poo", dry: "Dry" } as const;
export const colorWords = { black: "Black", green: "Green", yellow: "Yellow", brown: "Brown", red: "Red", white: "White" } as const;
export const contentWords = { breast_milk: "Breast milk", formula: "Formula" } as const;

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

/** One readable line for a care entry, e.g. "Breastfeeding · Left side · 15 min". */
export function careSummary(kind: Kind, data: RecordData, occurredAt: string, now = new Date(), timeZone?: string | null) {
  if (kind === "feeding") {
    const parts = [data.method === "breast" ? "Breastfeeding" : data.method === "bottle" ? "Bottle" : "Feeding"];
    if (data.method === "breast" && data.side && sides[data.side]) parts.push(sides[data.side]);
    if (data.method === "bottle" && data.contents && contentWords[data.contents]) parts.push(contentWords[data.contents]);
    if (finite(data.amount)) parts.push(`${data.amount} ${data.unit === "oz" ? "oz" : "mL"}`);
    if (finite(data.duration_minutes)) parts.push(duration(data.duration_minutes));
    return parts.join(" · ");
  }
  if (kind === "sleep") {
    const start = new Date(occurredAt).getTime();
    if (!data.end_at) {
      const open = (now.getTime() - start) / minute;
      // A sleep nobody ended is not still happening a day later.
      if (!Number.isFinite(open)) return "Sleep in progress";
      // A sleep entered ahead of time has not started yet.
      if (open < -2) return `Sleep starts ${friendlyTime(occurredAt, now, timeZone)}`;
      if (open > 24 * 60) return `Sleep not ended · started ${friendlyTime(occurredAt, now, timeZone)}`;
      // A sleep that began moments ago (or a clock a beat behind its start) reads the same everywhere.
      return open < 1 ? "Sleeping now · just started" : `Sleeping now · ${duration(open)}`;
    }
    const slept = duration((new Date(data.end_at).getTime() - start) / minute);
    return slept ? `Slept ${slept}` : "Sleep recorded";
  }
  if (kind === "diaper") {
    const parts = ["Diaper"];
    if (data.type && diaperWords[data.type]) parts.push(diaperWords[data.type]);
    if (data.color && colorWords[data.color]) parts.push(colorWords[data.color]);
    return parts.join(" · ");
  }
  return "";
}

export function isCare(kind: Kind) {
  return kind === "feeding" || kind === "sleep" || kind === "diaper";
}

/** The child a new entry belongs to. Care goes to the selected baby or the only baby; with
 * several babies and none selected the parent chooses, so a log is never filed to the wrong one. */
export function defaultChild(kind: Kind, selected: string | null, children: Pick<Child, "id">[]) {
  if (selected && children.some((child) => child.id === selected)) return selected;
  return isCare(kind) && children.length === 1 ? children[0].id : null;
}
