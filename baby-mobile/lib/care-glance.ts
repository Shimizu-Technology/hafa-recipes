import type { BabyRecord, Child, DeviceState, RecordData } from "./models";

import { careSummary, duration, timeAgo } from "./care-format";
import { newestFirst, reduceFeed } from "./feed-reducer";
import { dayRange, recordDay } from "./tracker";

const day = 24 * 60 * 60_000;

function localDay(value: string) {
  const [year, month, date] = value.split("-").map(Number);
  return year && month && date ? new Date(year, month - 1, date) : null;
}

/** "Born today", "5 days old", "3 weeks old", "4 months old", "Due in 12 days". */
export function babyAge(child: Pick<Child, "birth_date" | "due_date">, now = new Date()) {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const birth = child.birth_date ? localDay(child.birth_date) : null;
  if (birth) {
    const days = Math.round((today.getTime() - birth.getTime()) / day);
    if (days < 0) return "";
    if (days === 0) return "Born today";
    if (days < 14) return `${days} day${days === 1 ? "" : "s"} old`;
    if (days < 60) return `${Math.floor(days / 7)} weeks old`;
    const months =
      (today.getFullYear() - birth.getFullYear()) * 12 +
      today.getMonth() -
      birth.getMonth() -
      (today.getDate() < birth.getDate() ? 1 : 0);
    if (months < 24) return `${months} months old`;
    return `${Math.floor(months / 12)} years old`;
  }
  const due = child.due_date ? localDay(child.due_date) : null;
  if (!due) return "";
  const until = Math.round((due.getTime() - today.getTime()) / day);
  if (until === 0) return "Due today";
  return until > 0 ? `Due in ${until} day${until === 1 ? "" : "s"}` : `${-until} days past due`;
}

/** The baby Today summarizes: the selected one, otherwise the first profile. */
export function glanceChild(state: Pick<DeviceState, "bootstrap" | "selectedChild">) {
  const children = state.bootstrap?.children ?? [];
  return children.find((child) => child.id === state.selectedChild) ?? children[0] ?? null;
}

export interface CareGlance {
  lastFeed?: BabyRecord;
  openSleep?: BabyRecord;
  lastSleep?: BabyRecord;
  diapers: { total: number; wet: number; dirty: number };
  feeds: number;
}

/** A sleep counts as happening now only if it is her newest sleep and began within a day;
 * an old one nobody ended is left for the editor rather than ended as a days-long sleep. */
function currentSleep(newestFirst: BabyRecord[], now: Date) {
  const newest = newestFirst.find((row) => row.kind === "sleep");
  return newest && !newest.data.end_at && now.getTime() - new Date(newest.occurred_at).getTime() < day ? newest : undefined;
}

/** Newest-first care rows for one baby reduced to what a parent checks at a glance. */
export function careGlance(rows: BabyRecord[], childId: string | null, now = new Date(), timeZone?: string | null): CareGlance {
  const { from, to } = dayRange(recordDay(now.toISOString(), timeZone), timeZone),
    start = new Date(from).getTime(), end = new Date(to).getTime(),
    mine = rows.filter((row) => row.child_id === childId).sort(newestFirst),
    today = mine.filter((row) => { const at = new Date(row.occurred_at).getTime(); return at >= start && at < end; }),
    diapers = today.filter((row) => row.kind === "diaper");
  return {
    lastFeed: mine.find((row) => row.kind === "feeding"),
    openSleep: currentSleep(mine, now),
    lastSleep: mine.find((row) => row.kind === "sleep" && !!row.data.end_at),
    diapers: {
      total: diapers.length,
      wet: diapers.filter((row) => row.data.type === "wet" || row.data.type === "both").length,
      dirty: diapers.filter((row) => row.data.type === "dirty" || row.data.type === "both").length,
    },
    feeds: today.filter((row) => row.kind === "feeding").length,
  };
}

/** The side to offer next: the opposite of the side the newest one-sided breastfeed started on, or none yet. */
export function nextSide(rows: BabyRecord[], childId: string | null): "left" | "right" | undefined {
  const started = (row: BabyRecord) => reduceFeed(row.data.actions)?.start_side ?? row.data.side,
    last = rows
      .filter((row) => row.kind === "feeding" && row.child_id === childId && row.data.method === "breast" && (started(row) === "left" || started(row) === "right"))
      .sort(newestFirst)[0];
  return last ? (started(last) === "left" ? "right" : "left") : undefined;
}

/** Prefill a new feed from the last one: same method, and the other breast after one side. */
export function nextFeed(last?: Pick<BabyRecord, "data">): RecordData {
  const method = last?.data.method ?? "breast";
  if (method !== "breast") return { method, side: undefined, ...(last?.data.unit ? { unit: last.data.unit } : {}) };
  const side = last?.data.side === "left" ? "right" : last?.data.side === "right" ? "left" : "both";
  return { method, side };
}

/** Missing or malformed sleep times never produce empty labelled fragments. */
export function sleepGlanceDetail(glance: Pick<CareGlance, "openSleep" | "lastSleep">, now: Date) {
  if (glance.openSleep) return careSummary("sleep", glance.openSleep.data, glance.openSleep.occurred_at, now).replace("Sleeping now · ", "");
  if (!glance.lastSleep) return "Log sleep or review your care history.";
  const sleep = glance.lastSleep;
  const woke = sleep.data.end_at ? timeAgo(sleep.data.end_at, now) : "";
  const slept = sleep.data.end_at ? duration((new Date(sleep.data.end_at).getTime() - new Date(sleep.occurred_at).getTime()) / 60_000) : "";
  return [woke ? `Woke ${woke}` : "", slept ? `Last sleep ${slept}` : ""].filter(Boolean).join(" · ") || "Sleep recorded";
}
