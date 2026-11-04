import type { useBaby } from "./context";
import type { Kind } from "./models";
import { pendingRecords } from "./outbox";
import { isCare } from "./care-format";
import { dayRange, recordDay, timelineKinds } from "./tracker";

type Account = Pick<ReturnType<typeof useBaby>, "api" | "state">;

/** Over 30 a day, more than a month ever has. These kinds have no totals, so `/care/summary` doesn't put a dot on them. */
const pageLimit = 100, pagesLimit = 12, otherKinds: readonly Kind[] = timelineKinds.filter((kind) => !isCare(kind));

/** Which days in a range have something on them, from the API: its care days, and the days with notes or questions. */
export async function careDays(b: Account, childId: string | null, first: string, last: string, timezone?: string | null, current = () => true) {
  const { from } = dayRange(first, timezone), { to } = dayRange(last, timezone), others = new Set<string>(),
    days = Object.fromEntries((await b.api.careSummary(first, last, childId)).days.map((day) => [day.date, day]));
  for (let page = 0; page < pagesLimit; page++) {
    const response = await b.api.records({ kinds: otherKinds, child_id: childId, include_general: true, occurred_from: from, occurred_to: to, limit: pageLimit, offset: page * pageLimit || undefined });
    if (!current()) break;
    for (const row of response.items) {
      // By real time: the API's and this phone's timestamps aren't always written the same way.
      const at = new Date(row.occurred_at).getTime();
      if (at >= new Date(from).getTime() && at < new Date(to).getTime()) others.add(recordDay(row.occurred_at, timezone));
    }
    if (!response.has_more) break;
  }
  return { days, others };
}

/** Days holding a note or question not yet saved. Queued care goes through `dayOverlay`, with the rest of its day. */
export function localOtherDays(b: Pick<Account, "state">, childId: string | null, timezone?: string | null) {
  return new Set(pendingRecords(b.state)
    .filter((row) => otherKinds.includes(row.kind) && (!childId || !row.child_id || row.child_id === childId))
    .map((row) => recordDay(row.occurred_at, timezone)));
}

/** The oldest care entry's day: usually the first day home. The list is newest first, so it's the last row of the total. */
export async function firstCareDay(b: Account, childId: string | null, timezone?: string | null) {
  const kinds = ["feeding", "sleep", "diaper"] as const,
    first = await b.api.records({ kinds, child_id: childId, include_general: false, limit: 1 });
  if (!first.total) return undefined;
  const last = first.total > 1 ? await b.api.records({ kinds, child_id: childId, include_general: false, limit: 1, offset: first.total - 1 }) : first;
  const row = last.items[0];
  return row ? recordDay(row.occurred_at, timezone) : undefined;
}
