import type { Child, Kind, RecordData } from "./models";

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

function sameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/** "6:02 PM", "Yesterday 11:40 PM", "Oct 18, 9:15 AM", or with the year when it differs. */
export function friendlyTime(iso: string, now = new Date()) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const time = date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  if (sameDay(date, now)) return time;
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (sameDay(date, yesterday)) return `Yesterday ${time}`;
  const day = date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    ...(date.getFullYear() === now.getFullYear() ? {} : { year: "numeric" }),
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
const diapers = { wet: "Wet", dirty: "Dirty", both: "Wet and dirty", dry: "Dry" } as const;

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

/** One readable line for a care entry, e.g. "Breastfeeding · Left side · 15 min". */
export function careSummary(kind: Kind, data: RecordData, occurredAt: string, now = new Date()) {
  if (kind === "feeding") {
    const parts = [data.method === "breast" ? "Breastfeeding" : data.method === "bottle" ? "Bottle" : "Feeding"];
    if (data.method === "breast" && data.side && sides[data.side]) parts.push(sides[data.side]);
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
      if (open < -2) return `Sleep starts ${friendlyTime(occurredAt, now)}`;
      if (open > 24 * 60) return `Sleep not ended · started ${friendlyTime(occurredAt, now)}`;
      // A sleep that began moments ago (or a clock a beat behind its start) reads the same everywhere.
      return open < 1 ? "Sleeping now · just started" : `Sleeping now · ${duration(open)}`;
    }
    const slept = duration((new Date(data.end_at).getTime() - start) / minute);
    return slept ? `Slept ${slept}` : "Sleep recorded";
  }
  if (kind === "diaper") return `${data.type && diapers[data.type] ? diapers[data.type] : "Recorded"} diaper`;
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
