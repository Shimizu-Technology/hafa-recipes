import type { RecordFilters } from "./api";
import { careKinds, type BabyRecord, type DeviceState, type Kind, type RecordPage } from "./models";
import { pendingRecords } from "./outbox";

export interface HistoryView {
  filter: string;
  childId: string | null;
  query: string;
}
export function historyKinds(filter: string): Kind[] {
  if (filter === "writing") return ["journal", "question"];
  if (filter === "care") return [...careKinds];
  if (filter === "journal" || filter === "question") return [filter];
  return ["journal", "question", ...careKinds];
}

/** A request belongs to one focused view. Superseded pages cannot advance its
 * cursor or replace an error; the loader uses current() around durable commits. */
export function createHistoryPager(
  load: (filters: RecordFilters, current: () => boolean) => Promise<RecordPage>
) {
  let ticket = 0,
    offset = 0,
    more = true,
    busy = false;
  let view: HistoryView = { filter: "all", childId: null, query: "" };
  let ids: string[] = [];
  let refreshedIds: string[] = [];
  const current = (value: number) => value === ticket;
  return {
    current,
    reset(next: HistoryView, retainPages = false) {
      ticket++;
      const same =
        view.filter === next.filter && view.childId === next.childId && view.query === next.query.trim();
      refreshedIds = [];
      view = { ...next, query: next.query.trim() };
      offset = 0;
      more = true;
      busy = false;
      if (!retainPages || !same) ids = [];
      return ticket;
    },
    cancel() {
      ticket++;
      busy = false;
    },
    snapshot: () => ({ ticket, offset, more, busy, ids: [...ids] }),
    async next() {
      if (busy || !more) return null;
      const captured = ticket,
        start = offset;
      busy = true;
      try {
        const page = await load(
          {
            kinds: historyKinds(view.filter),
            child_id: view.childId,
            include_general: true,
            q: view.query || undefined,
            limit: 30,
            offset: start,
          },
          () => current(captured)
        );
        if (!current(captured)) return null;
        offset = start + page.items.length;
        refreshedIds = [...new Set([...refreshedIds, ...page.items.map((row) => row.id)])];
        more = page.has_more && page.items.length > 0 && offset < page.total;
        // Keep already displayed history during a refresh, but walk every new
        // page in order. Once complete, drop IDs absent from the fresh result.
        ids = !more ? [...refreshedIds] : [...new Set([...ids, ...refreshedIds])];
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

/** Pending edits win over server matches; pending deletes never reappear. A
 * null ID set deliberately falls back to the private cache when offline. */
export function historyRows(
  state: DeviceState,
  view: HistoryView,
  ids: readonly string[] | null,
  retainedLocal: readonly string[] = []
): BabyRecord[] {
  const kinds = historyKinds(view.filter),
    remote = ids === null ? null : new Set(ids),
    pending = new Set([
      ...retainedLocal,
      ...state.outbox.flatMap((m) => (m.type === "save" ? [m.record.id] : [])),
    ]),
    query = view.query.trim();
  return pendingRecords(state)
    .filter((row) => kinds.includes(row.kind))
    .filter((row) => !view.childId || !row.child_id || row.child_id === view.childId)
    .filter((row) => remote === null || remote.has(row.id) || pending.has(row.id))
    .filter((row) => {
      if (!query || (remote?.has(row.id) && !pending.has(row.id))) return true;
      const content = `${row.title} ${row.body} ${JSON.stringify(row.data)}`.toLocaleLowerCase();
      return query
        .toLocaleLowerCase()
        .split(/\s+/)
        .every((word) => content.includes(word));
    });
}
