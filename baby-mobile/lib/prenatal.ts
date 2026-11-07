import { recordDay } from "./tracker";
import type { EditorDraft } from "./models";
/** Calendar-day arithmetic, independent of DST and device timezone. */
export const pregnancyVisit = (day: string, birth?: string | null) => !birth || day < birth;
export function estimatedAge(day: string, due: string | null | undefined, birth?: string | null) {
  if (!due || !pregnancyVisit(day, birth)) return null;
  const days = 280 + Math.round((Date.parse(day + "T00:00:00Z") - Date.parse(due + "T00:00:00Z")) / 86400000);
  return Number.isFinite(days) && days >= 0 && days < 315 ? `${Math.floor(days / 7)} weeks ${days % 7} days` : null;
}
export function snapshotVisit(draft: EditorDraft, due: string | null | undefined, birth?: string | null): EditorDraft {
  if (draft.kind === "event" && !pregnancyVisit(recordDay(draft.occurred_at, draft.data.timezone), birth))
    return draft.data.due_date_snapshot ? { ...draft, data: { ...draft.data, due_date_snapshot: null } } : draft;
  return draft.kind === "event" && draft.data.category === "appointment" && due && !draft.data.due_date_snapshot
    ? { ...draft, data: { ...draft.data, due_date_snapshot: due } } : draft;
}
