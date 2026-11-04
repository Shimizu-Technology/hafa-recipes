import type { BabyRecord } from "./models";
import { newestFirst } from "./feed-reducer";

/** A contraction nobody stopped isn't still going after this long. It stays saved, with no end. */
export const contractionLimit = 30 * 60_000;
const hour = 60 * 60_000;
const time = (iso: string) => new Date(iso).getTime();

export function ownContractions(rows: readonly BabyRecord[], childId: string | null) {
  return rows.filter((row) => row.kind === "contraction" && row.child_id === childId).sort(newestFirst);
}
export function runningContraction(rows: readonly BabyRecord[], childId: string | null, now = new Date()) {
  const newest = ownContractions(rows, childId)[0];
  return newest && !newest.data.end_at && now.getTime() - time(newest.occurred_at) < contractionLimit ? newest : undefined;
}
/** How long one lasted, in seconds. Nothing without an end. */
export function lasted(row: BabyRecord) {
  return row.data.end_at ? Math.max(0, (time(row.data.end_at) - time(row.occurred_at)) / 1000) : undefined;
}
/** The gap beside each one: from the start of the one before to its own start. */
export function withGaps(newestFirst: readonly BabyRecord[]) {
  return newestFirst.map((record, index) => {
    const before = newestFirst[index + 1];
    return { record, seconds: lasted(record), apart: before ? (time(record.occurred_at) - time(before.occurred_at)) / 1000 : undefined };
  });
}
/** "45 sec", "5 min 10 sec", "1 h 4 min". */
export function secondsWords(seconds: number) {
  const whole = Math.max(0, Math.round(seconds));
  if (whole < 60) return `${whole} sec`;
  if (whole < 3600) return `${Math.floor(whole / 60)} min${whole % 60 ? ` ${whole % 60} sec` : ""}`;
  return `${Math.floor(whole / 3600)} h${Math.floor((whole % 3600) / 60) ? ` ${Math.floor((whole % 3600) / 60)} min` : ""}`;
}
/** The last hour's counts and averages. It reports them and never says what they mean. */
export function lastHour(newestFirst: readonly BabyRecord[], now = new Date()) {
  const inside = newestFirst.filter((row) => { const ago = now.getTime() - time(row.occurred_at); return ago >= 0 && ago < hour; }),
    timed = inside.flatMap((row) => { const seconds = lasted(row); return seconds === undefined ? [] : [seconds]; });
  return {
    count: inside.length,
    averageSeconds: timed.length ? timed.reduce((total, seconds) => total + seconds, 0) / timed.length : undefined,
    averageApart: inside.length > 1 ? (time(inside[0].occurred_at) - time(inside[inside.length - 1].occurred_at)) / 1000 / (inside.length - 1) : undefined,
  };
}
export function hourLine({ count, averageSeconds, averageApart }: ReturnType<typeof lastHour>) {
  if (!count) return "None in the last hour";
  return [`${count} in the last hour`, averageSeconds === undefined ? "" : `about ${secondsWords(averageSeconds)} long`,
    averageApart === undefined ? "" : `about ${secondsWords(averageApart)} apart`].filter(Boolean).join(" · ");
}
/** The second line of a contraction anywhere it's listed. */
export function contractionDetail(row: BabyRecord, now = new Date()) {
  const seconds = lasted(row);
  if (seconds !== undefined) return secondsWords(seconds);
  return now.getTime() - time(row.occurred_at) < contractionLimit ? "Timing now" : "No end time";
}

export const doctorNoteTitle = "What my doctor told me";
/** The newest copy of her note. Two phones offline could each make one; the newest is the one she last wrote. */
export function doctorNote(rows: readonly BabyRecord[]) {
  return rows.filter((row) => row.kind === "journal" && row.title === doctorNoteTitle && row.data.provenance === "clinician_instruction").sort(newestFirst)[0];
}
