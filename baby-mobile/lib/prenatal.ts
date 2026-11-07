import type { EditorDraft } from "./models";
/** Calendar-day arithmetic, independent of DST and device timezone. */
export function estimatedAge(day: string, due: string | null | undefined) {
  if (!due) return null;
  const days = 280 + Math.round((Date.parse(day + "T00:00:00Z") - Date.parse(due + "T00:00:00Z")) / 86400000);
  return Number.isFinite(days) && days >= 0 && days < 315 ? `${Math.floor(days / 7)} weeks ${days % 7} days` : null;
}
export function snapshotVisit(draft: EditorDraft, due: string | null | undefined): EditorDraft {
  return draft.kind === "event" && draft.data.category === "appointment" && due && !draft.data.due_date_snapshot
    ? { ...draft, data: { ...draft.data, due_date_snapshot: due } } : draft;
}
