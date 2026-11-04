import type { useBaby } from "./context";
import { pendingRecords } from "./outbox";
import { recordDay, timelineKinds } from "./tracker";

type Account = Pick<ReturnType<typeof useBaby>, "api" | "state">;

/** Most entries a month's dots read: over 30 logs a day. L6's summary replaces this, in this one function. */
const pageLimit = 100, pagesLimit = 12;

/** Which days in a range have anything on them. Saved entries come from the API; unsynced ones from this phone. */
export async function careDays(b: Account, childId: string | null, from: string, to: string, timezone?: string | null, current = () => true) {
  const days = new Set<string>();
  for (let page = 0; page < pagesLimit; page++) {
    const response = await b.api.records({ kinds: timelineKinds, child_id: childId, include_general: true, occurred_from: from, occurred_to: to, limit: pageLimit, offset: page * pageLimit || undefined });
    if (!current()) return days;
    for (const row of response.items) {
      // By real time: the API's and this phone's timestamps aren't always written the same way.
      const at = new Date(row.occurred_at).getTime();
      if (at >= new Date(from).getTime() && at < new Date(to).getTime()) days.add(recordDay(row.occurred_at, timezone));
    }
    if (!response.has_more) break;
  }
  return days;
}

export function localCareDays(b: Pick<Account, "state">, childId: string | null, timezone?: string | null) {
  return new Set(pendingRecords(b.state)
    .filter((row) => timelineKinds.includes(row.kind) && (!childId || !row.child_id || row.child_id === childId))
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
