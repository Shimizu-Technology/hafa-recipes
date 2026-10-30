import type { AuthoredWorkout } from "./models";
export interface MissingDetail { key: string; label: string; block?: string; exercise?: number }
/** Unknown source facts are review prompts, never invented defaults or save errors. */
export function missingDetails(w: AuthoredWorkout): MissingDetail[] {
  const items: MissingDetail[] = [];
  if (!w.equipment_required?.length) items.push({ key: "equipment", label: "Equipment not specified" });
  for (const b of w.blocks) {
    if (!b.execution && b.rounds == null && b.grouping !== "sequential")
      items.push({ key: `${b.id}:rounds`, block: b.id, label: `${b.label}: rounds not specified` });
    if (b.rest_between_rounds_seconds == null && b.grouping !== "sequential")
      items.push({ key: `${b.id}:rest`, block: b.id, label: `${b.label}: rest between rounds not specified` });
    b.exercises.forEach((e, i) => {
      const add = (field: string, text: string) => items.push({ key: `${b.id}:${i}:${field}`, block: b.id, exercise: i, label: `${e.name}: ${text}` });
      if (e.sets == null && b.rounds == null && !b.execution) add("sets", "sets not specified");
      if (e.reps_min == null && e.duration_seconds == null && e.distance_meters == null) add("target", "reps, time or distance not specified");
      if (e.rest_seconds == null) add("rest", "rest not specified");
    });
  }
  return items;
}
