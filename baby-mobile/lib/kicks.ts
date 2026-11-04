import type { BabyRecord } from "./models";
import { newestFirst } from "./feed-reducer";
import { secondsWords } from "./contractions";

/** A session nobody finished isn't still counting after this long. It stays in the history as it was left. */
export const sessionLimit = 3 * 60 * 60_000;
const time = (iso: string) => new Date(iso).getTime();

export function ownSessions(rows: readonly BabyRecord[], childId: string | null) {
  return rows.filter((row) => row.kind === "kick_session" && row.child_id === childId).sort(newestFirst);
}
export function openSession(rows: readonly BabyRecord[], childId: string | null, now = new Date()) {
  const newest = ownSessions(rows, childId)[0];
  return newest && !newest.data.end_at && now.getTime() - time(newest.occurred_at) < sessionLimit ? newest : undefined;
}
/** How long a session has run, or ran. */
export function sessionSeconds(row: BabyRecord, now = new Date()) {
  return Math.max(0, ((row.data.end_at ? time(row.data.end_at) : now.getTime()) - time(row.occurred_at)) / 1000);
}
const movements = (count: number) => `${count} movement${count === 1 ? "" : "s"}`;
/** Count and time, and nothing that sounds like a result. */
export function kickDetail(row: BabyRecord, now = new Date()) {
  const count = row.data.count ?? 0;
  if (row.data.end_at) return `${movements(count)} in ${secondsWords(sessionSeconds(row))}`;
  return now.getTime() - time(row.occurred_at) < sessionLimit ? `${movements(count)} so far` : `${movements(count)}, not finished`;
}
