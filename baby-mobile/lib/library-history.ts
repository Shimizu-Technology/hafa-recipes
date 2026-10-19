import type { RecordFilters } from "./api";
import type { BabyRecord, DeviceState, RecordPage } from "./models";
import { pendingRecords, searchLocal } from "./outbox";

export interface LibraryView {
  kind: "source" | "collection";
  childId: string | null;
  query: string;
  collectionId?: string;
  topic?: string;
  pageSize?: number;
}
export function libraryViewKey(view: LibraryView) {
  return JSON.stringify([
    view.kind,
    view.childId,
    view.query.trim(),
    view.collectionId ?? "",
    view.topic ?? "",
    view.pageSize ?? 30,
  ]);
}
/** One sequential, filtered cursor per focused view. Every refresh starts at
 * page zero; retained rows disappear only when the fresh sequence is complete. */
export function createLibraryPager(load: (filters: RecordFilters, current: () => boolean) => Promise<RecordPage>) {
  let ticket = 0,
    offset = 0,
    busy = false,
    more = true;
  let view: LibraryView = { kind: "source", childId: null, query: "" },
    ids: string[] = [],
    refreshed: string[] = [];
  const current = (captured: number) => ticket === captured;
  return {
    current,
    reset(next: LibraryView, retain = false) {
      const same = libraryViewKey(next) === libraryViewKey(view);
      ticket++;
      offset = 0;
      busy = false;
      more = true;
      refreshed = [];
      if (!retain || !same) ids = [];
      view = { ...next, query: next.query.trim() };
      return ticket;
    },
    cancel() {
      ticket++;
      busy = false;
    },
    snapshot: () => ({ ticket, offset, busy, more, ids: [...ids] }),
    async next() {
      if (busy || !more) return null;
      const captured = ticket,
        start = offset;
      busy = true;
      try {
        const page = await load(
          {
            kind: view.kind,
            child_id: view.childId,
            include_general: true,
            q: view.query || undefined,
            collection_id: view.collectionId || undefined,
            topic: view.topic || undefined,
            limit: view.pageSize ?? 30,
            offset: start,
          },
          () => current(captured)
        );
        if (!current(captured)) return null;
        offset = start + page.items.length;
        refreshed = [...new Set([...refreshed, ...page.items.map((row) => row.id)])];
        more = page.has_more && page.items.length > 0 && offset < page.total;
        ids = more ? [...new Set([...ids, ...refreshed])] : [...refreshed];
        return page;
      } catch (error) {
        if (!current(captured)) return null;
        throw error;
      } finally {
        if (current(captured)) busy = false;
      }
    },
  };
}
/** Remote IDs are authoritative; local edits/deletes and unsynced membership
 * changes overlay them. A null page intentionally means offline private cache. */
export function libraryRows(
  state: DeviceState,
  view: LibraryView,
  ids: readonly string[] | null,
  retainedLocal: readonly string[] = [],
  retainedMembers?: readonly string[],
  retainedAdded: readonly string[] = []
): BabyRecord[] {
  const rows = pendingRecords(state),
    remote = ids === null ? null : new Set(ids);
  const changed = new Set([...retainedLocal, ...state.outbox.flatMap((m) => (m.type === "save" ? [m.record.id] : []))]);
  const collection = rows.find((row) => row.kind === "collection" && row.id === view.collectionId);
  if (view.collectionId && state.outbox.some((m) => m.type === "delete" && m.record.id === view.collectionId))
    return [];
  const editedCollection = state.outbox.some((m) => m.type === "save" && m.record.id === view.collectionId);
  const members = retainedMembers ?? (editedCollection || remote === null ? collection?.data.record_ids : undefined);
  const memberSet = members === undefined ? null : new Set(members);
  const cachedMembers = new Set(collection?.data.record_ids ?? []);
  const persistedMembers = new Set(state.records.find((row) => row.id === view.collectionId)?.data.record_ids ?? []);
  const added = new Set([...retainedAdded, ...(members ?? []).filter((id) => !persistedMembers.has(id))]);
  return rows
    .filter((row) => row.kind === view.kind)
    .filter((row) => !view.childId || !row.child_id || row.child_id === view.childId)
    .filter((row) => !view.topic || row.data.topics?.includes(view.topic))
    .filter(
      (row) =>
        !view.collectionId ||
        (memberSet ? memberSet.has(row.id) : remote?.has(row.id) || (changed.has(row.id) && cachedMembers.has(row.id)))
    )
    .filter((row) => remote === null || remote.has(row.id) || changed.has(row.id) || added.has(row.id))
    .filter(
      (row) =>
        !view.query.trim() || (remote?.has(row.id) && !changed.has(row.id)) || searchLocal(row, view.query.trim())
    );
}
export function toggleCollectionMember(ids: readonly string[], id: string) {
  return ids.includes(id) ? ids.filter((value) => value !== id) : ids.length < 500 ? [...ids, id] : [...ids];
}
/** Keep every selected ID independently of paging/search, including unavailable
 * members. They remain removable without issuing a GET for each missing row. */
export function collectionMemberRows(
  ids: readonly string[],
  rows: readonly BabyRecord[],
  persisted: readonly string[] = [],
  hydrated: readonly string[] | null = null
) {
  const available = new Map(rows.filter((row) => row.kind === "source").map((row) => [row.id, row]));
  const original = new Set(persisted),
    live = hydrated === null ? null : new Set(hydrated);
  return ids.map((id, index) => {
    const row = available.get(id),
      unavailable = live !== null && original.has(id) && !live.has(id);
    return {
      id,
      title: row?.title || `${unavailable ? "Unavailable source" : "Saved source"} ${index + 1}`,
      detail: unavailable
        ? "Not available in the saved collection. You can remove it from this draft."
        : row
          ? "Selected · tap to remove"
          : "Details are not on this device yet. You can still remove this source.",
    };
  });
}
