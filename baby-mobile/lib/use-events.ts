import { useCallback, useMemo, useRef, useState } from "react";
import { useFocusEffect } from "expo-router";
import { useBaby } from "./context";
import { eventsByDay, visibleEvents, withEventRows } from "./events";
import type { BabyRecord, EventOccurrence, RecordPage } from "./models";
import { mutationRecordIds } from "./outbox";
import { addDays } from "./tracker";
import { useDeleted } from "./use-care-summary";

const pageLimit = 100, keptFor = 30_000;
const lastKept = new WeakMap<object, number>();

/** Every page of a listing. A row that a new one shifts onto the next page still counts once. */
export async function allPages(read: (page: { limit: number; offset?: number }) => Promise<RecordPage>) {
  const rows = new Map<string, BabyRecord>();
  for (let page = 0, more = true; more; page++) {
    const answer = await read({ limit: pageLimit, offset: page * pageLimit || undefined });
    for (const row of answer.items) rows.set(row.id, row);
    more = answer.has_more;
  }
  return [...rows.values()];
}
/** Keeps every event on the phone, however old, so the calendar and the next event still work with no signal after a relaunch. */
async function keepEvents(b: ReturnType<typeof useBaby>) {
  const lease = b.api.lease(), generation = b.state.bootstrap?.generation,
    rows = await allPages((page) => b.api.records({ kinds: ["event"], ...page }));
  if (!b.current()) return;
  await b.commit((state) => {
    b.api.assertLease(lease);
    return state.bootstrap?.generation === generation ? withEventRows(state, rows, true) : state;
  });
}

/**
 * Occurrences on these calendar days, inclusive, by day. `GET /events` answers, since `/care/summary` has no future days,
 * and it's read on focus and whenever a queued change leaves. Queued changes show straight away.
 */
export function useEvents(childId: string | null, first: string, last: string) {
  const b = useBaby(), timezone = b.state.bootstrap?.profile.timezone, key = JSON.stringify([b.owner, b.state.bootstrap?.generation, childId, first, last]),
    waiting = b.state.outbox.length, [answer, setAnswer] = useState<{ key: string; items: EventOccurrence[]; complete: boolean } | null>(null),
    [failed, setFailed] = useState(false), asked = useRef(0), shown = useRef(0), local = useRef(new Set<string>()), gone = useDeleted(), latest = useRef(b);
  latest.current = b;
  for (const change of b.state.outbox) if ((change.type === "save" && change.record.kind === "event") || change.type === "event_split") mutationRecordIds(change).forEach((id) => local.current.add(id));
  useFocusEffect(useCallback(() => {
    let active = true;
    const ticket = ++asked.current, account = latest.current;
    void account.api.events(first, last, childId).then((result) => {
      if (!active || ticket < shown.current) return;
      shown.current = ticket;
      setFailed(false);
      setAnswer({ key, items: result.items, complete: result.complete });
    }).catch(() => { if (active) setFailed(true); });
    if (Date.now() - (lastKept.get(account.api) ?? 0) > keptFor) {
      lastKept.set(account.api, Date.now());
      void keepEvents(account).catch(() => lastKept.delete(account.api));
    }
    return () => { active = false; };
  }, [key, waiting]));
  const remote = answer?.key === key ? answer.items : undefined, { records, outbox } = b.state,
    items = useMemo(() => visibleEvents(b.state, remote, local.current, gone, childId, first, last, timezone), [records, outbox, remote, childId, first, last, timezone]),
    byDay = useMemo(() => eventsByDay(items, first, last, timezone), [items, first, last, timezone]);
  return { items, byDay, failed, complete: answer?.key === key ? answer.complete : true };
}
/** Enough ahead that a baptism months away still counts as next, inside the 400 days the API takes at once. */
export const useUpcomingEvents = (childId: string | null, today: string) => useEvents(childId, today, addDays(today, 399));
