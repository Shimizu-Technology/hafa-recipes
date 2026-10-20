import { useCallback, useRef, useState } from "react";
import { useFocusEffect } from "expo-router";
import { ApiError } from "./api";
import { importFinished } from "./import-status";
import { useBaby } from "./context";
import { messageFor } from "./models";
import { replaceRecord } from "./outbox";
import { createLibraryPager, libraryRows, libraryViewKey, type LibraryView } from "./library-history";

export function useLibraryHistory(view: LibraryView, enabled = true) {
  const b = useBaby(),
    lease = b.api.lease();
  const scopeKey = JSON.stringify([b.owner, b.state.bootstrap?.generation, lease, enabled, libraryViewKey(view)]);
  // A new capture or terminal result changes server search/membership. Keep
  // loaded pages while refetching; ordinary processing polls do not reset them.
  const key = JSON.stringify([
    scopeKey,
    view.kind === "source"
      ? b.state.imports.map((job) => [job.id, job.record_id ?? null, importFinished(job.status)])
      : [],
  ]);
  const latest = useRef(b),
    viewKey = useRef(key),
    focused = useRef<string | null>(null),
    active = useRef(false);
  latest.current = b;
  viewKey.current = key;
  const local = useRef<{ key: string; ids: Set<string>; members?: string[]; added?: Set<string> }>({
    key,
    ids: new Set(),
  });
  if (local.current.key !== key) local.current = { key, ids: new Set() };
  for (const mutation of b.state.outbox)
    if (mutation.type === "save") {
      local.current.ids.add(mutation.record.id);
      if (mutation.record.kind === "collection" && mutation.record.id === view.collectionId) {
        local.current.members = mutation.record.data.record_ids ?? [];
        const persisted = new Set(b.state.records.find((row) => row.id === view.collectionId)?.data.record_ids ?? []);
        local.current.added ??= new Set();
        for (const id of local.current.members) if (!persisted.has(id)) local.current.added.add(id);
      }
    }
  const [loading, setLoading] = useState(false),
    [error, setError] = useState("");
  const [page, setPage] = useState<{ key: string; ids: string[] | null; more: boolean; missing: boolean } | null>(null);
  const pager = useRef(
    createLibraryPager(async (filters, current) => {
      const account = latest.current,
        capturedKey = viewKey.current,
        capturedLease = account.api.lease(),
        generation = account.state.bootstrap?.generation;
      const valid = () =>
        active.current &&
        current() &&
        account.current() &&
        capturedKey === viewKey.current &&
        latest.current.owner === account.owner &&
        latest.current.api === account.api &&
        account.api.lease() === capturedLease;
      const response = await account.api.records(filters);
      account.api.assertLease(capturedLease);
      if (!valid()) throw new ApiError("This library view changed.", 410, true);
      await account.commit((state) => {
        account.api.assertLease(capturedLease);
        if (!valid() || state.bootstrap?.generation !== generation) return state;
        return { ...state, records: response.items.reduce(replaceRecord, state.records) };
      });
      if (!valid()) throw new ApiError("This library view changed.", 410, true);
      return response;
    })
  );
  async function load(ticket: number, capturedKey: string) {
    if (
      !enabled ||
      !active.current ||
      !pager.current.current(ticket) ||
      capturedKey !== viewKey.current ||
      pager.current.snapshot().busy
    )
      return;
    const account = latest.current,
      capturedLease = account.api.lease();
    const valid = () =>
      active.current &&
      pager.current.current(ticket) &&
      capturedKey === viewKey.current &&
      account.current() &&
      latest.current.api === account.api &&
      account.api.lease() === capturedLease;
    setLoading(true);
    try {
      const response = await pager.current.next();
      if (!response || !valid()) return;
      const snapshot = pager.current.snapshot();
      setPage({ key: capturedKey, ids: snapshot.ids, more: snapshot.more, missing: false });
      setError("");
    } catch (failure) {
      if (!valid()) return;
      const missing = failure instanceof ApiError && failure.status === 404 && !!view.collectionId;
      setError(
        missing
          ? "This collection is no longer available. Choose another collection or show all sources."
          : messageFor(failure)
      );
      const snapshot = pager.current.snapshot();
      setPage({
        key: capturedKey,
        ids: missing ? [] : snapshot.ids.length ? snapshot.ids : null,
        more: !missing && snapshot.more,
        missing,
      });
    } finally {
      if (valid()) setLoading(false);
    }
  }
  function resetLocal() {
    const saves = latest.current.state.outbox.filter((m) => m.type === "save");
    const membership = saves.find(
      (m) => m.type === "save" && m.record.kind === "collection" && m.record.id === view.collectionId
    );
    const members = membership?.type === "save" ? membership.record.data.record_ids : undefined;
    const prior = new Set(
      latest.current.state.records.find((row) => row.id === view.collectionId)?.data.record_ids ?? []
    );
    local.current = {
      key,
      ids: new Set(saves.map((m) => (m.type === "save" ? m.record.id : ""))),
      members,
      added: new Set((members ?? []).filter((id) => !prior.has(id))),
    };
  }
  function refresh() {
    resetLocal();
    const ticket = pager.current.reset(view, true);
    setPage({
      key,
      ids: pager.current.snapshot().ids.length ? pager.current.snapshot().ids : null,
      more: enabled,
      missing: false,
    });
    setError("");
    if (enabled) void load(ticket, key);
  }
  useFocusEffect(
    useCallback(() => {
      const retained = focused.current === scopeKey;
      focused.current = scopeKey;
      active.current = true;
      resetLocal();
      const ticket = pager.current.reset(view, retained);
      setPage({
        key,
        ids: retained && pager.current.snapshot().ids.length ? pager.current.snapshot().ids : null,
        more: enabled,
        missing: false,
      });
      setError("");
      setLoading(enabled);
      const timer = enabled ? setTimeout(() => void load(ticket, key), view.query.trim() ? 350 : 0) : undefined;
      return () => {
        active.current = false;
        if (timer !== undefined) clearTimeout(timer);
        pager.current.cancel();
      };
    }, [key])
  );
  const activePage = page?.key === key ? page : null;
  return {
    rows: activePage?.missing
      ? []
      : libraryRows(b.state, view, activePage?.ids ?? null, [...local.current.ids], local.current.members, [
          ...(local.current.added ?? []),
        ]),
    loading: enabled && loading,
    error,
    missing: activePage?.missing ?? false,
    more: enabled && (activePage?.more ?? true),
    ids: activePage?.ids ?? null,
    complete: activePage !== null && activePage.ids !== null && !activePage.more && !activePage.missing,
    loadMore: () => load(pager.current.snapshot().ticket, key),
    refresh,
  };
}
