import type { BabyRecord, Child, DeviceState } from "./models";
import { spaceOf } from "./spaces";

/** A row as `/changes` sends it, or just its id once it's gone. */
export type ChangeItem = { id: string; seq: number } & (
  | { removed: true; entity?: undefined }
  | ({ entity: "record"; removed?: undefined } & BabyRecord)
  | ({ entity: "child"; removed?: undefined } & Child)
  | { entity: "attachment" | "import" | "conversation" | "message" | "capture" | "credential"; removed?: undefined; [key: string]: unknown }
);
export interface ChangesPage {
  id: string;
  generation: number;
  access_version: number;
  cursor: number;
  has_more: boolean;
  reset: boolean;
  items: ChangeItem[];
}
export interface ChangesAnswer {
  spaces: ChangesPage[];
  cursor: Record<string, number>;
  has_more: boolean;
  removed_space_ids: string[];
}
/** Every page goes through here, so a first snapshot can't run a sync pass for long. The next pass carries on. */
export const changePagesPerPass = 20;

export function withoutSpaceRows(state: DeviceState, space: string): DeviceState {
  const personal = state.bootstrap?.personal_space_id;
  return { ...state, records: state.records.filter((row) => spaceOf(row, personal) !== space) };
}
/**
 * What `/changes` said, on this phone's copy. Removals only count in the space they came from: a move shows up as gone
 * from one space and new in another, in either order. Queued changes and drafts are never touched.
 */
export function applyChanges(state: DeviceState, answer: ChangesAnswer): { state: DeviceState; changed: boolean; more: boolean } {
  const personal = state.bootstrap?.personal_space_id,
    cursor = { ...state.changes?.cursor }, access = { ...state.changes?.access };
  let next = state, changed = false, more = answer.has_more;
  for (const space of answer.removed_space_ids) {
    const left = withoutSpaceRows(next, space);
    changed ||= left.records.length !== next.records.length;
    next = left;
    delete cursor[space];
    delete access[space];
  }
  const rows = new Map(next.records.map((row) => [row.id, row]));
  let children = next.bootstrap?.children ?? [];
  for (const page of answer.spaces) {
    access[page.id] = page.access_version;
    cursor[page.id] = page.cursor;
    if (page.reset) {
      for (const [id, row] of rows) if (spaceOf(row, personal) === page.id) rows.delete(id);
      children = children.filter((child) => spaceOf(child, personal) !== page.id);
      changed = more = true;
      continue;
    }
    for (const item of page.items) {
      if (item.removed) {
        const row = rows.get(item.id);
        if (row && spaceOf(row, personal) === page.id) { rows.delete(item.id); changed = true; }
        const child = children.find((known) => known.id === item.id);
        if (child && spaceOf(child, personal) === page.id) { children = children.filter((known) => known !== child); changed = true; }
      } else if (item.entity === "record") {
        // Routines come from their own snapshot, which also sets their reminders.
        if (item.kind === "routine") continue;
        const { seq: _, entity: __, ...row } = item, prior = rows.get(row.id);
        if (prior && prior.revision > row.revision) continue;
        rows.set(row.id, row);
        changed = true;
      } else if (item.entity === "child") {
        const { seq: _, entity: __, ...child } = item, prior = children.find((known) => known.id === child.id);
        if (prior && prior.revision > child.revision) continue;
        children = [child, ...children.filter((known) => known.id !== child.id)];
        changed = true;
      }
    }
  }
  return {
    changed,
    more,
    state: {
      ...next,
      changes: { cursor, access },
      records: changed ? [...rows.values()].sort((a, b) => b.occurred_at.localeCompare(a.occurred_at)) : next.records,
      ...(next.bootstrap && children !== next.bootstrap.children ? { bootstrap: { ...next.bootstrap, children } } : {}),
    },
  };
}
