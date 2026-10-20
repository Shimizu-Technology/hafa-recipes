import { useCallback, useRef, useState } from "react";
import { useFocusEffect } from "expo-router";
import { useBaby } from "./context";
import { careKinds, messageFor, type DeviceState } from "./models";
import { pendingRecords, replaceRecord } from "./outbox";

/** A successful scoped response replaces cached matches; private cached care is
 * a fallback only before the first response or while offline. Local saves and
 * deletes still win, including saves that finish syncing while Today is open. */
export function todayCareRows(
  state: DeviceState,
  childId: string | null,
  ids: readonly string[] | null,
  retainedLocal: readonly string[] = [],
  retainedDeleted: readonly string[] = []
) {
  const remote = ids === null ? null : new Set(ids),
    deleted = new Set(retainedDeleted),
    local = new Set([
      ...retainedLocal,
      ...state.outbox.flatMap((change) => (change.type === "save" ? [change.record.id] : [])),
    ]);
  return pendingRecords(state)
    .filter((row) => careKinds.includes(row.kind))
    .filter((row) => !deleted.has(row.id))
    .filter((row) => !childId || !row.child_id || row.child_id === childId)
    .filter((row) => remote === null || remote.has(row.id) || local.has(row.id))
    .sort((a, b) => b.occurred_at.localeCompare(a.occurred_at) || a.id.localeCompare(b.id))
    .slice(0, 3);
}

export function useTodayCare() {
  const b = useBaby(),
    childId = b.state.selectedChild,
    key = JSON.stringify([b.owner, b.state.bootstrap?.generation, b.api.lease(), childId]);
  const latest = useRef(b),
    viewKey = useRef(key),
    active = useRef(false),
    request = useRef(0),
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
  async function refresh() {
    if (!active.current) return;
    const account = latest.current,
      capturedKey = key,
      ticket = ++request.current,
      lease = account.api.lease(),
      generation = account.state.bootstrap?.generation;
    const valid = () =>
      active.current && request.current === ticket && capturedKey === viewKey.current && account.current() &&
      latest.current.owner === account.owner && latest.current.api === account.api && account.api.lease() === lease;
    setLoading(true);
    setError("");
    try {
      const response = await account.api.records({ kinds: careKinds, child_id: childId, include_general: true, limit: 3 });
      account.api.assertLease(lease);
      if (!valid()) return;
      await account.commit((state) => {
        account.api.assertLease(lease);
        if (!valid() || state.bootstrap?.generation !== generation) return state;
        const records = response.items.reduce((rows, row) => {
          // A read begun before a local sync must not restore its older revision
          // or resurrect a delete that has already left the durable outbox.
          const prior = rows.find((item) => item.id === row.id);
          return local.current.deleted.has(row.id) || (prior && prior.revision > row.revision)
            ? rows : replaceRecord(rows, row);
        }, state.records);
        return { ...state, records };
      });
      if (valid()) setPage({ key: capturedKey, ids: response.items.map((row) => row.id) });
    } catch (failure) {
      if (valid()) {
        setPage(null);
        setError(messageFor(failure));
      }
    } finally {
      if (valid()) setLoading(false);
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
    return () => { active.current = false; request.current++; };
  }, [key]));
  return {
    rows: todayCareRows(b.state, childId, page?.key === key ? page.ids : null, [...local.current.ids], [...local.current.deleted]),
    loading,
    error,
    refresh,
  };
}
