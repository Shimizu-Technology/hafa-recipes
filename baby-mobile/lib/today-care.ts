import { useCallback, useRef, useState } from "react";
import { AppState } from "react-native";
import { useFocusEffect } from "expo-router";
import { useBaby } from "./context";
import { careKinds, messageFor, type BabyRecord, type DeviceState, type Kind, type RecordPage } from "./models";
import { newestFirst } from "./feed-reducer";
import { pendingRecords, replaceRecord } from "./outbox";

/** A successful scoped response replaces cached matches; private cached care is
 * a fallback only before the first response or while offline. Local saves and
 * deletes still win, including saves that finish syncing while Today is open. */
export function todayCareRows(
  state: DeviceState,
  childId: string | null,
  ids: readonly string[] | null,
  retainedLocal: readonly string[] = [],
  retainedDeleted: readonly string[] = [],
  limit = 3,
  kinds: readonly Kind[] = careKinds
) {
  const remote = ids === null ? null : new Set(ids),
    deleted = new Set(retainedDeleted),
    local = new Set([
      ...retainedLocal,
      ...state.outbox.flatMap((change) => (change.type === "save" ? [change.record.id] : [])),
    ]);
  return pendingRecords(state)
    .filter((row) => kinds.includes(row.kind))
    .filter((row) => !deleted.has(row.id))
    .filter((row) => !childId || !row.child_id || row.child_id === childId)
    .filter((row) => remote === null || remote.has(row.id) || local.has(row.id))
    .sort(newestFirst)
    .slice(0, limit);
}
/** Enough recent care for today's totals at newborn frequency (about 30 entries a day per baby). */
export const glanceLimit = 100;
/** How often Today looks for what the other phone logged, while it's on screen. */
export const carePollMs = 15_000;

/** Today's latest care by default. Tracker asks for a day's window instead, of every kind, over more pages, for one baby. */
export function useTodayCare({ kinds = careKinds, occurred_from, occurred_to, pages = 1, limit = glanceLimit, poll = true, child }: {
  kinds?: readonly Kind[]; occurred_from?: string; occurred_to?: string; pages?: number; limit?: number; poll?: boolean; child?: string | null;
} = {}) {
  const b = useBaby(),
    childId = child === undefined ? b.state.selectedChild : child,
    key = JSON.stringify([b.owner, b.state.bootstrap?.generation, b.api.lease(), childId, occurred_from, occurred_to, poll, kinds]);
  const latest = useRef(b),
    viewKey = useRef(key),
    active = useRef(false),
    request = useRef(0),
    looking = useRef(false),
    local = useRef({ key, ids: new Set<string>(), deleted: new Set<string>() });
  latest.current = b;
  viewKey.current = key;
  if (local.current.key !== key) local.current = { key, ids: new Set(), deleted: new Set() };
  for (const change of b.state.outbox) {
    if (change.type === "save") local.current.ids.add(change.record.id);
    if (change.type === "delete") local.current.deleted.add(change.record.id);
  }
  const [page, setPage] = useState<{ key: string; ids: string[] } | null>(null),
    [loading, setLoading] = useState(false),
    [error, setError] = useState("");
  /** `quiet` is the background look: no spinner, and a failure leaves what's on screen alone. */
  async function refresh({ quiet = false } = {}) {
    if (!active.current) return;
    const account = latest.current,
      capturedKey = key,
      ticket = ++request.current,
      lease = account.api.lease(),
      generation = account.state.bootstrap?.generation;
    const valid = () =>
      active.current && request.current === ticket && capturedKey === viewKey.current && account.current() &&
      latest.current.owner === account.owner && latest.current.api === account.api && account.api.lease() === lease;
    if (!quiet) {
      setLoading(true);
      setError("");
    }
    try {
      const items: BabyRecord[] = [];
      let response: RecordPage;
      do {
        response = await account.api.records({ kinds, child_id: childId, include_general: true, limit: Math.min(limit, glanceLimit), offset: items.length || undefined, occurred_from, occurred_to });
        account.api.assertLease(lease);
        if (!valid()) return;
        items.push(...response.items);
      } while (response.has_more && response.items.length && items.length < pages * glanceLimit);
      await account.commit((state) => {
        account.api.assertLease(lease);
        if (!valid() || state.bootstrap?.generation !== generation) return state;
        const records = items.reduce((rows, row) => {
          // A read begun before a local sync must not restore its older revision
          // or resurrect a delete that has already left the durable outbox.
          const prior = rows.find((item) => item.id === row.id);
          return local.current.deleted.has(row.id) || (prior && prior.revision > row.revision)
            ? rows : replaceRecord(rows, row);
        }, state.records);
        return { ...state, records };
      });
      if (valid()) setPage({ key: capturedKey, ids: items.map((row) => row.id) });
    } catch (failure) {
      if (valid() && !quiet) {
        setPage(null);
        setError(messageFor(failure));
      }
    } finally {
      if (valid() && !quiet) setLoading(false);
    }
  }
  useFocusEffect(useCallback(() => {
    active.current = true;
    local.current = {
      key,
      ids: new Set(latest.current.state.outbox.flatMap((change) => change.type === "save" ? [change.record.id] : [])),
      deleted: new Set(latest.current.state.outbox.flatMap((change) => change.type === "delete" ? [change.record.id] : [])),
    };
    void refresh();
    const timer = poll ? setInterval(() => {
      // Never in the background, and never on top of a look still under way.
      if (AppState.currentState === "active" && !looking.current) {
        looking.current = true;
        void refresh({ quiet: true }).finally(() => { looking.current = false; });
      }
    }, carePollMs) : undefined;
    return () => { active.current = false; request.current++; looking.current = false; clearInterval(timer); };
  }, [key]));
  const ids = page?.key === key ? page.ids : null,
    all = todayCareRows(b.state, childId, ids, [...local.current.ids], [...local.current.deleted], limit, kinds);
  return {
    rows: all.slice(0, 3),
    all,
    loading,
    error,
    refresh,
  };
}
