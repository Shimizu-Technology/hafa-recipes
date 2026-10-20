import type { RecordFilters } from "./api";
import type { BabyRecord, DeviceState, Mutation, RecordPage } from "./models";

const routineMutation = (m: Mutation) => m.type !== "import" && m.record.kind === "routine";
const routines = (s: DeviceState) => s.records.filter((r) => r.kind === "routine");
function sameRows(a: BabyRecord[], b: BabyRecord[]) {
  const rows = new Map(a.map((r) => [r.id, r]));
  return a.length === b.length && b.every((r) => rows.get(r.id) === r);
}
/** A queued edit AND its later accepted write both invalidate an overlapping read. */
export function routineStateChanged(before: DeviceState, after: DeviceState) {
  const a = before.outbox.filter(routineMutation),
    b = after.outbox.filter(routineMutation);
  return !sameRows(routines(before), routines(after)) || a.length !== b.length || a.some((m, i) => m !== b[i]);
}
export function routineReminderScope(state: DeviceState, owner: string) {
  const marker = state.routine_sync,
    generation = state.bootstrap?.generation;
  const valid = marker?.owner === owner && marker.generation === generation;
  return {
    authoritative: !!valid && marker.complete,
    managedIds: [
      ...new Set([
        ...(valid ? marker.managed_ids : []),
        ...state.outbox
          .filter((m) => m.generation === generation && routineMutation(m))
          .map((m) => (m.type === "import" ? "" : m.record.id)),
      ]),
    ],
  };
}
/** Keep explicit local decisions durable even after an accepted or discarded mutation. */
export function trackRoutineIntents(before: DeviceState, after: DeviceState, owner: string): DeviceState {
  const generation = after.bootstrap?.generation;
  if (generation === undefined || after.bootstrap?.active === false) return after;
  const changed = [...before.outbox, ...after.outbox].filter(
    (m) =>
      m.generation === generation &&
      routineMutation(m) &&
      before.outbox.find((a) => a.id === m.id) !== after.outbox.find((a) => a.id === m.id)
  );
  if (!changed.length) return after;
  const scope = routineReminderScope(after, owner);
  return {
    ...after,
    routine_sync: {
      owner,
      generation,
      complete: scope.authoritative,
      managed_ids: [...new Set([...scope.managedIds, ...changed.map((m) => (m.type === "import" ? "" : m.record.id))])],
    },
  };
}

/** No partial page is installed. Inconsistent/moving pagination retries on the next sync. */
export async function readAllRoutines(
  fetch: (filters: RecordFilters) => Promise<RecordPage>,
  current: () => boolean
): Promise<BabyRecord[] | null> {
  const rows: BabyRecord[] = [],
    ids = new Set<string>();
  let total: number | undefined;
  while (current()) {
    let page: RecordPage;
    try {
      page = await fetch({ kind: "routine", limit: 100, offset: rows.length, include_general: true });
    } catch (error) {
      if (!current()) return null;
      throw error;
    }
    if (!current()) return null;
    if (!Number.isSafeInteger(page.total) || page.total < 0 || (total !== undefined && total !== page.total))
      throw Error("Routines changed while restoring. Your saved routines are safe; sync again.");
    total = page.total;
    for (const row of page.items) {
      if (row.kind !== "routine" || ids.has(row.id))
        throw Error("Routines changed while restoring. Your saved routines are safe; sync again.");
      ids.add(row.id);
      rows.push(row);
    }
    if (rows.length > total || (page.has_more && (!page.items.length || rows.length >= total)))
      throw Error("Routine restoration was interrupted. Your saved routines are safe; sync again.");
    if (!page.has_more) {
      if (rows.length !== total)
        throw Error("Routine restoration was interrupted. Your saved routines are safe; sync again.");
      return rows;
    }
  }
  return null;
}
export function installRoutineSnapshot(state: DeviceState, rows: BabyRecord[], owner: string): DeviceState {
  const existing = new Map(state.records.filter((r) => r.kind === "routine").map((r) => [r.id, r]));
  const restored = rows.map((r) => {
    const old = existing.get(r.id);
    return old && old.revision === r.revision && old.updated_at === r.updated_at ? old : r;
  });
  return {
    ...state,
    records: [...state.records.filter((r) => r.kind !== "routine"), ...restored].sort((a, b) =>
      b.occurred_at.localeCompare(a.occurred_at)
    ),
    routine_sync: { owner, generation: state.bootstrap!.generation, complete: true, managed_ids: [] },
  };
}
